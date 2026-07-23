import { app, BrowserWindow, ipcMain, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { wrap } from '../utils/ipc-wrapper';

let mainWindow: BrowserWindow | null = null;

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'downloading' | 'available' | 'notavailable' | 'downloaded' | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  downloadSpeed?: number;
  downloadTransferred?: number;
  downloadTotal?: number;
  error?: string;
}

let currentStatus: UpdateStatus = { status: 'idle' };

const R2_CONFIG = {
  baseUrl: 'https://data.semove.ccwu.cc',
};

let updateSource: 'github' | 'r2' | null = null;
let r2UpdateInfo: { version: string; sha512: string; size: number; releaseDate?: string; releaseNotes?: string } | null = null;
let r2InstallerPath: string | null = null;
let pendingCheckFallback = false;

const GITHUB_CHECK_TIMEOUT = 15000;

function checkWithTimeout(timeoutMs: number = GITHUB_CHECK_TIMEOUT): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('error', onError);
        reject(new Error('GITHUB_TIMEOUT'));
      }
    }, timeoutMs);

    function onAvailable() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    }
    function onNotAvailable() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    }
    function onError(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    }

    function cleanup() {
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
    }

    autoUpdater.on('update-available', onAvailable);
    autoUpdater.on('update-not-available', onNotAvailable);
    autoUpdater.on('error', onError);
    autoUpdater.checkForUpdates();
  });
}

function sendStatusToWindow(status: UpdateStatus) {
  currentStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function isNetworkError(error: any): boolean {
  const msg = (error.message || error.toString?.() || '').toLowerCase();
  const keywords = [
    'enotfound', 'econnrefused', 'econnreset', 'etimedout',
    'socket hang up', 'request timeout', 'name resolution',
    'getaddrinfo', 'fetch failed', 'network', 'proxy',
    'status code', 'unable to verify', 'self signed certificate',
    'certificate', 'dns', 'tunnel', 'connect e',
  ];
  return keywords.some(k => msg.includes(k));
}

function parseLatestYml(yml: string): { version: string; sha512: string; size: number; releaseDate?: string; releaseNotes?: string } | null {
  const lines = yml.split('\n');
  let version = '';
  let sha512 = '';
  let size = 0;
  let releaseDate = '';
  let releaseNotes = '';
  let inReleaseNotes = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('version:')) {
      version = trimmed.substring(8).trim();
    } else if (trimmed.startsWith('sha512:')) {
      sha512 = trimmed.substring(7).trim();
    } else if (trimmed.startsWith('size:')) {
      size = parseInt(trimmed.substring(5).trim(), 10) || 0;
    } else if (trimmed.startsWith('releaseDate:')) {
      releaseDate = trimmed.substring(12).trim().replace(/^['"]|['"]$/g, '');
    } else if (trimmed.startsWith('releaseNotes:')) {
      inReleaseNotes = true;
      releaseNotes = trimmed.substring(13).trim();
    } else if (inReleaseNotes && line.startsWith(' ')) {
      releaseNotes += '\n' + trimmed;
    } else {
      inReleaseNotes = false;
    }
  }
  if (!version || !sha512) return null;
  return { version, sha512, size, releaseDate, releaseNotes };
}

async function checkR2ForUpdates(): Promise<{ version: string; sha512: string; size: number; releaseDate?: string; releaseNotes?: string } | null> {
  try {
    log.info('[更新-R2] 正在检查 Cloudflare R2 更新源...');
    const response = await net.fetch(`${R2_CONFIG.baseUrl}/latest.yml`, { method: 'GET' });
    if (!response.ok) {
      log.warn(`[更新-R2] 获取 latest.yml 失败: HTTP ${response.status}`);
      return null;
    }
    const ymlText = await response.text();
    const info = parseLatestYml(ymlText);
    if (!info) {
      log.warn('[更新-R2] 解析 latest.yml 失败');
      return null;
    }
    const currentVersion = app.getVersion();
    log.info(`[更新-R2] 当前版本: ${currentVersion}, R2 版本: ${info.version}`);
    if (compareVersions(info.version, currentVersion) <= 0) {
      log.info('[更新-R2] R2 上无新版本');
      return null;
    }
    return info;
  } catch (error: any) {
    log.warn('[更新-R2] 检查失败:', error.message);
    return null;
  }
}

async function downloadFromR2(version: string, expectedSha512: string): Promise<string> {
  const installerName = `JSecProbe Setup ${version}.exe`;
  const downloadUrl = `${R2_CONFIG.baseUrl}/${encodeURIComponent(installerName)}`;
  const tempDir = app.getPath('temp');
  const destPath = path.join(tempDir, installerName);

  log.info(`[更新-R2] 开始下载: ${downloadUrl}`);
  const response = await net.fetch(downloadUrl, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body!.getReader();
  const writeStream = fs.createWriteStream(destPath);

  let received = 0;
  let lastTime = Date.now();
  let lastReceived = 0;
  let speed = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writeStream.write(Buffer.from(value));
    received += value.length;

    const now = Date.now();
    if (now - lastTime >= 500) {
      speed = (received - lastReceived) / ((now - lastTime) / 1000);
      lastTime = now;
      lastReceived = received;
    }

    if (contentLength > 0) {
      const percent = Math.min(Math.round((received / contentLength) * 100), 100);
      sendStatusToWindow({
        status: 'downloading',
        downloadProgress: percent,
        downloadSpeed: speed,
        downloadTransferred: received,
        downloadTotal: contentLength,
        version,
      });
    }
  }
  writeStream.end();

  log.info('[更新-R2] 校验文件完整性...');
  const fileBuffer = fs.readFileSync(destPath);
  const actualSha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
  if (actualSha512 !== expectedSha512) {
    fs.unlinkSync(destPath);
    throw new Error('SHA512 校验失败，下载文件可能已损坏');
  }
  log.info('[更新-R2] SHA512 校验通过');

  return destPath;
}

export function initAutoUpdater(window: BrowserWindow) {
  mainWindow = window;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.removeAllListeners();

  autoUpdater.on('checking-for-update', () => {
    log.info('[更新] 正在检查更新...');
    sendStatusToWindow({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[更新] 发现新版本:', info.version);
    updateSource = 'github';
    r2UpdateInfo = null;
    sendStatusToWindow({
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('[更新] 当前已是最新版本');
    sendStatusToWindow({
      status: 'notavailable',
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = progressObj.percent.toFixed(1);
    log.info(`[更新] 下载进度: ${percent}%`);
    sendStatusToWindow({
      ...currentStatus,
      status: 'downloading',
      downloadProgress: progressObj.percent,
      downloadSpeed: progressObj.bytesPerSecond,
      downloadTransferred: progressObj.transferred,
      downloadTotal: progressObj.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[更新] 下载完成，版本:', info.version);
    sendStatusToWindow({
      status: 'downloaded',
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('error', (error) => {
    if (pendingCheckFallback) {
      pendingCheckFallback = false;
      log.warn('[更新] 检查更新网络错误，即将尝试备用源:', error.message);
      return;
    }
    log.error('[更新] 更新出错:', error);
    sendStatusToWindow({
      status: 'error',
      error: error.message || '未知错误',
    });
  });

  setTimeout(() => {
    log.info('[更新] 启动时自动检查更新');
    if (!process.env.VITE_DEV_SERVER_URL) {
      pendingCheckFallback = true;
      checkWithTimeout().catch((err: any) => {
        pendingCheckFallback = false;
        if (err.message === 'GITHUB_TIMEOUT') {
          log.warn('[更新] 自动检查超时，尝试备用源');
        } else {
          log.warn('[更新] 自动检查更新失败:', err.message);
        }
        checkR2ForUpdates().then((r2Info) => {
          if (r2Info) {
            updateSource = 'r2';
            r2UpdateInfo = r2Info;
            sendStatusToWindow({
              status: 'available',
              version: r2Info.version,
              releaseDate: r2Info.releaseDate,
              releaseNotes: r2Info.releaseNotes,
            });
          }
        }).catch(() => {});
      });
    }
  }, 5000);
}

export function triggerUpdateCheck(): void {
  if (process.env.VITE_DEV_SERVER_URL) return;
  if (pendingCheckFallback) return;

  pendingCheckFallback = true;
  checkWithTimeout().catch((err: any) => {
    pendingCheckFallback = false;
    if (err.message === 'GITHUB_TIMEOUT') {
      log.warn('[更新] 手动检查超时，尝试备用源');
    } else {
      log.warn('[更新] 手动检查更新失败:', err.message);
    }
    checkR2ForUpdates().then((r2Info) => {
      if (r2Info) {
        updateSource = 'r2';
        r2UpdateInfo = r2Info;
        sendStatusToWindow({
          status: 'available',
          version: r2Info.version,
          releaseDate: r2Info.releaseDate,
          releaseNotes: r2Info.releaseNotes,
        });
      }
    }).catch(() => {});
  });
}

export function registerUpdateHandlers() {
  ipcMain.handle('update:check', wrap(async () => {
    if (process.env.VITE_DEV_SERVER_URL) {
      log.info('[更新] 开发模式下跳过更新检查');
      sendStatusToWindow({ status: 'notavailable', version: app.getVersion() });
      return;
    }

    log.info('[更新] 检查更新');
    updateSource = null;
    r2UpdateInfo = null;
    r2InstallerPath = null;

    pendingCheckFallback = true;
    try {
      await checkWithTimeout();
    } catch (error: any) {
      pendingCheckFallback = false;
      if (error.message === 'GITHUB_TIMEOUT') {
        log.warn('[更新] GitHub 检查超时，尝试 Cloudflare R2 备用更新源...');
        const r2Info = await checkR2ForUpdates();
        if (r2Info) {
          updateSource = 'r2';
          r2UpdateInfo = r2Info;
          sendStatusToWindow({
            status: 'available',
            version: r2Info.version,
            releaseDate: r2Info.releaseDate,
            releaseNotes: r2Info.releaseNotes,
          });
          return;
        }
        sendStatusToWindow({ status: 'error', error: 'GitHub 连接超时，请检查网络后重试' });
        return;
      }
      log.error('[更新] GitHub 检查更新失败:', error.message);

      if (isNetworkError(error)) {
        log.info('[更新] 网络错误，尝试 Cloudflare R2 备用更新源...');
        const r2Info = await checkR2ForUpdates();
        if (r2Info) {
          updateSource = 'r2';
          r2UpdateInfo = r2Info;
          sendStatusToWindow({
            status: 'available',
            version: r2Info.version,
            releaseDate: r2Info.releaseDate,
            releaseNotes: r2Info.releaseNotes,
          });
          return;
        }
        log.info('[更新-R2] 备用源也无更新可用');
      }

      sendStatusToWindow({ status: 'error', error: error.message || '检查更新失败' });
      throw error;
    }
  }, 'update'));

  ipcMain.handle('update:download', wrap(async () => {
    if (updateSource === 'r2') {
      log.info('[更新-R2] 开始从 Cloudflare R2 下载更新');
      if (!r2UpdateInfo) {
        const info = await checkR2ForUpdates();
        if (!info) throw new Error('无法获取更新信息，请重新检查更新');
        r2UpdateInfo = info;
      }
      const destPath = await downloadFromR2(r2UpdateInfo.version, r2UpdateInfo.sha512);
      r2InstallerPath = destPath;
      sendStatusToWindow({ status: 'downloaded', version: r2UpdateInfo.version });
      return;
    }

    log.info('[更新] 开始下载更新');
    await autoUpdater.downloadUpdate();
  }, 'update'));

  ipcMain.handle('update:install', wrap(async () => {
    if (updateSource === 'r2' && r2InstallerPath) {
      log.info('[更新-R2] 安装更新:', r2InstallerPath);
      spawn(r2InstallerPath, ['/S'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      app.quit();
      return;
    }

    log.info('[更新] 安装更新并重启');
    autoUpdater.quitAndInstall(false, true);
  }, 'update'));

  ipcMain.handle('update:getStatus', wrap(() => {
    return currentStatus;
  }, 'update'));

  ipcMain.handle('update:getCurrentVersion', wrap(() => {
    return app.getVersion();
  }, 'update'));
}