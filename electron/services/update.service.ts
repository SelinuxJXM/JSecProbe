import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { wrap } from '../utils/ipc-wrapper';

function getSafeTempDir(): string {
  const appDataPath = app.getPath('temp');
  const safeDir = path.join(appDataPath, 'jsecprobe-updates');
  if (!fs.existsSync(safeDir)) {
    fs.mkdirSync(safeDir, { recursive: true });
  }
  return safeDir;
}

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

const INSTALLER_PATHS_FILE = 'installer-paths.json';

function getInstallerPathsFile(): string {
  return path.join(app.getPath('userData'), INSTALLER_PATHS_FILE);
}

function saveInstallerPaths(): void {
  try {
    const data = {
      updateSource: updateSource,
      r2: r2InstallerPath,
      r2Version: r2UpdateInfo?.version || null,
      r2Sha512: r2UpdateInfo?.sha512 || null,
      r2UpdateInfo: r2UpdateInfo,
    };
    const p = getInstallerPathsFile();
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
    log.info('[更新] 安装包路径已持久化');
  } catch (err: any) {
    log.warn('[更新] 持久化安装包路径失败:', err.message);
  }
}

function loadInstallerPaths(): void {
  try {
    const p = getInstallerPathsFile();
    if (!fs.existsSync(p)) return;
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as any;
    if (data.r2) {
      r2InstallerPath = data.r2;
      updateSource = 'r2';
    }
    if (data.r2UpdateInfo) r2UpdateInfo = data.r2UpdateInfo;
    log.info('[更新] 已加载持久化的安装包路径');
  } catch (err: any) {
    log.warn('[更新] 加载持久化安装包路径失败:', err.message);
  }
}

function clearInstallerPaths(): void {
  try {
    const p = getInstallerPathsFile();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err: any) {
    log.warn('[更新] 清理持久化安装包路径失败:', err.message);
  }
}

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
  const MULTILINE_MARKERS = ['|', '>', '|-', '>-', '|+', '>+'];
  for (const line of lines) {
    const trimmed = line.trim();
    if (inReleaseNotes && line.startsWith(' ')) {
      releaseNotes += (releaseNotes ? '\n' : '') + trimmed;
      continue;
    }
    inReleaseNotes = false;
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
      const value = trimmed.substring(13).trim();
      if (MULTILINE_MARKERS.includes(value)) {
        releaseNotes = '';
      } else {
        releaseNotes = value.replace(/^['"]|['"]$/g, '');
      }
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

function waitForDrain(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (err: Error) => { cleanup(); reject(err); };
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function downloadFromR2(version: string, expectedSha512: string): Promise<string> {
  const installerName = `JSecProbe Setup ${version}.exe`;
  const downloadUrl = `${R2_CONFIG.baseUrl}/${encodeURIComponent(installerName)}`;
  const tempDir = getSafeTempDir();
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      const chunk = Buffer.from(value);
      if (!writeStream.write(chunk)) {
        await waitForDrain(writeStream);
      }

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
  } catch (err) {
    writeStream.destroy();
    try { fs.unlinkSync(destPath); } catch { /* 忽略清理失败 */ }
    throw err;
  }
  writeStream.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

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

  // 启动时恢复上次下载的安装包路径（支持重启后继续安装）
  loadInstallerPaths();

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
      performUpdateCheck('自动').catch(() => {});
    }
  }, 5000);
}

/**
 * 统一的更新检查流程（GitHub 主源 → Cloudflare R2 备用源）。
 * 供启动自动检查、托盘手动检查、IPC 手动检查三处复用。
 * 检查结果通过 autoUpdater 事件或 sendStatusToWindow 推送到渲染进程。
 */
async function performUpdateCheck(context: string): Promise<void> {
  if (pendingCheckFallback) return;

  pendingCheckFallback = true;
  try {
    await checkWithTimeout();
  } catch (error: any) {
    if (error.message === 'GITHUB_TIMEOUT') {
      log.warn(`[更新] ${context}检查超时，尝试 Cloudflare R2 备用更新源...`);
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

    log.error(`[更新] ${context}检查更新失败:`, error.message);
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
  } finally {
    pendingCheckFallback = false;
  }
}

export function triggerUpdateCheck(): void {
  if (process.env.VITE_DEV_SERVER_URL) return;
  performUpdateCheck('手动').catch(() => {});
}

/**
 * 启动已下载的 R2 安装包执行静默安装。
 * 返回 true 表示安装进程已成功启动；false 表示启动失败（原因已记录日志）。
 * 注意：shell.openPath 失败时 resolve 错误描述字符串（空串代表成功）而非 reject，
 * 必须通过返回值判断成败；spawn 的 error 事件必须监听，否则会变成未捕获异常。
 */
async function launchR2Installer(installerPath: string): Promise<boolean> {
  log.info(`[更新-${updateSource}] 安装更新: ${installerPath}`);
  try {
    const openResult = await shell.openPath(installerPath);
    if (!openResult) return true;
    log.warn(`[更新] shell.openPath 失败: ${openResult}，尝试 spawn 静默安装`);
  } catch (err: any) {
    log.warn(`[更新] shell.openPath 异常: ${err?.message || err}，尝试 spawn 静默安装`);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const spawnInstaller = () => spawn(installerPath, ['/S'], {
        detached: true,
        stdio: 'ignore',
      });

      const child = spawnInstaller();
      child.on('error', (spawnErr: any) => {
        if (spawnErr.code === 'EBUSY') {
          // 文件被占用（常见为应用自身句柄未释放），受控重试一次
          log.warn('[更新] 安装包被占用，5秒后重试...');
          setTimeout(() => {
            const retry = spawnInstaller();
            retry.on('error', (retryErr: any) => reject(retryErr));
            retry.on('spawn', () => {
              retry.unref();
              resolve();
            });
          }, 5000);
          return;
        }
        reject(spawnErr);
      });
      child.on('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return true;
  } catch (err: any) {
    log.error('[更新] 启动安装包失败:', err);
    return false;
  }
}

export function registerUpdateHandlers() {
  ipcMain.handle('update:check', wrap(async () => {
    if (process.env.VITE_DEV_SERVER_URL) {
      log.info('[更新] 开发模式下跳过更新检查');
      sendStatusToWindow({ status: 'notavailable', version: app.getVersion() });
      return;
    }

    log.info('[更新] 手动检查更新');
    updateSource = null;
    r2UpdateInfo = null;
    r2InstallerPath = null;
    clearInstallerPaths();

    await performUpdateCheck('手动');
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
      saveInstallerPaths();
      sendStatusToWindow({ status: 'downloaded', version: r2UpdateInfo.version });
      return;
    }

    log.info('[更新] 开始下载更新');
    await autoUpdater.downloadUpdate();
  }, 'update'));

  ipcMain.handle('update:install', wrap(async () => {
    const installerPath = r2InstallerPath;
    if (installerPath) {
      // 前置校验：持久化路径（installer-paths.json）在重启恢复后可能指向已被清理的临时文件，
      // 此时必须清理失效状态并报错，绝不能退出应用（否则用户将永远卡在旧版本）
      if (!fs.existsSync(installerPath)) {
        log.error(`[更新] 安装包不存在或已被清理: ${installerPath}`);
        clearInstallerPaths();
        throw new Error('安装包不存在或已被系统清理，请重新检查并下载更新');
      }
      // 启动成功之前不得清理持久化路径、不得退出应用；
      // 启动失败时保留安装包路径，供用户点击重试
      const launched = await launchR2Installer(installerPath);
      if (!launched) {
        throw new Error('启动安装包失败，请稍后重试，或到系统设置中重新下载更新后手动安装');
      }
      clearInstallerPaths();
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