import { app, BrowserWindow, ipcMain, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

let mainWindow: BrowserWindow | null = null;

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'downloading' | 'available' | 'notavailable' | 'downloaded' | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
}

let currentStatus: UpdateStatus = { status: 'idle' };

const OSS_CONFIG = {
  baseUrl: 'https://secprobe.oss-cn-beijing.aliyuncs.com',
};

let updateSource: 'github' | 'oss' | null = null;
let ossUpdateInfo: { version: string; sha512: string; size: number } | null = null;
let ossInstallerPath: string | null = null;

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

function parseLatestYml(yml: string): { version: string; sha512: string; size: number } | null {
  const lines = yml.split('\n');
  let version = '';
  let sha512 = '';
  let size = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('version:')) {
      version = trimmed.substring(8).trim();
    } else if (trimmed.startsWith('sha512:')) {
      sha512 = trimmed.substring(7).trim();
    } else if (trimmed.startsWith('  size:')) {
      size = parseInt(trimmed.substring(6).trim(), 10) || 0;
    }
  }
  if (!version || !sha512) return null;
  return { version, sha512, size };
}

async function checkOssForUpdates(): Promise<{ version: string; sha512: string; size: number } | null> {
  try {
    log.info('[更新-OSS] 正在检查阿里云 OSS 更新源...');
    const response = await net.fetch(`${OSS_CONFIG.baseUrl}/latest.yml`, { method: 'GET' });
    if (!response.ok) {
      log.warn(`[更新-OSS] 获取 latest.yml 失败: HTTP ${response.status}`);
      return null;
    }
    const ymlText = await response.text();
    const info = parseLatestYml(ymlText);
    if (!info) {
      log.warn('[更新-OSS] 解析 latest.yml 失败');
      return null;
    }
    const currentVersion = app.getVersion();
    log.info(`[更新-OSS] 当前版本: ${currentVersion}, OSS 版本: ${info.version}`);
    if (compareVersions(info.version, currentVersion) <= 0) {
      log.info('[更新-OSS] OSS 上无新版本');
      return null;
    }
    return info;
  } catch (error: any) {
    log.warn('[更新-OSS] 检查失败:', error.message);
    return null;
  }
}

async function downloadFromOss(version: string, expectedSha512: string): Promise<string> {
  const installerName = `JSecProbe Setup ${version}.exe`;
  const downloadUrl = `${OSS_CONFIG.baseUrl}/${encodeURIComponent(installerName)}`;
  const tempDir = app.getPath('temp');
  const destPath = path.join(tempDir, installerName);

  log.info(`[更新-OSS] 开始下载: ${downloadUrl}`);
  const response = await net.fetch(downloadUrl, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  const reader = response.body!.getReader();
  const writeStream = fs.createWriteStream(destPath);

  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writeStream.write(Buffer.from(value));
    received += value.length;
    if (contentLength > 0) {
      const percent = Math.min(Math.round((received / contentLength) * 100), 100);
      sendStatusToWindow({
        status: 'downloading',
        downloadProgress: percent,
        version,
      });
    }
  }
  writeStream.end();

  log.info('[更新-OSS] 校验文件完整性...');
  const fileBuffer = fs.readFileSync(destPath);
  const actualSha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
  if (actualSha512 !== expectedSha512) {
    fs.unlinkSync(destPath);
    throw new Error('SHA512 校验失败，下载文件可能已损坏');
  }
  log.info('[更新-OSS] SHA512 校验通过');

  return destPath;
}

export function initAutoUpdater(window: BrowserWindow) {
  mainWindow = window;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('[更新] 正在检查更新...');
    sendStatusToWindow({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[更新] 发现新版本:', info.version);
    updateSource = 'github';
    ossUpdateInfo = null;
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
    log.error('[更新] 更新出错:', error);
    sendStatusToWindow({
      status: 'error',
      error: error.message || '未知错误',
    });
  });
}

export function registerUpdateHandlers() {
  ipcMain.handle('update:check', async () => {
    try {
      if (process.env.VITE_DEV_SERVER_URL) {
        log.info('[更新] 开发模式下跳过更新检查');
        sendStatusToWindow({ status: 'notavailable', version: app.getVersion() });
        return { success: true, message: '开发模式下不检查更新' };
      }

      log.info('[更新] 手动检查更新');
      updateSource = null;
      ossUpdateInfo = null;
      ossInstallerPath = null;

      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (error: any) {
      log.error('[更新] GitHub 检查更新失败:', error.message);

      if (isNetworkError(error)) {
        log.info('[更新] 网络错误，尝试阿里云 OSS 备用更新源...');
        const ossInfo = await checkOssForUpdates();
        if (ossInfo) {
          updateSource = 'oss';
          ossUpdateInfo = ossInfo;
          sendStatusToWindow({
            status: 'available',
            version: ossInfo.version,
          });
          return { success: true, message: `从阿里云 OSS 发现新版本 v${ossInfo.version}` };
        }
        log.info('[更新-OSS] 备用源也无更新可用');
      }

      sendStatusToWindow({ status: 'error', error: error.message || '检查更新失败' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      if (updateSource === 'oss') {
        log.info('[更新-OSS] 开始从阿里云 OSS 下载更新');
        if (!ossUpdateInfo) {
          const info = await checkOssForUpdates();
          if (!info) throw new Error('无法获取更新信息，请重新检查更新');
          ossUpdateInfo = info;
        }
        const destPath = await downloadFromOss(ossUpdateInfo.version, ossUpdateInfo.sha512);
        ossInstallerPath = destPath;
        sendStatusToWindow({ status: 'downloaded', version: ossUpdateInfo.version });
        return { success: true };
      }

      log.info('[更新] 开始下载更新');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error: any) {
      log.error('[更新] 下载更新失败:', error);
      sendStatusToWindow({ status: 'error', error: error.message || '下载更新失败' });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update:install', async () => {
    try {
      if (updateSource === 'oss' && ossInstallerPath) {
        log.info('[更新-OSS] 安装更新:', ossInstallerPath);
        spawn(ossInstallerPath, ['/S'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        app.quit();
        return { success: true };
      }

      log.info('[更新] 安装更新并重启');
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error: any) {
      log.error('[更新] 安装更新失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update:getStatus', () => currentStatus);

  ipcMain.handle('update:getCurrentVersion', () => app.getVersion());
}