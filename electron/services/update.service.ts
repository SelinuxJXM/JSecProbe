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

/**
 * GitCode 更新源（国内优先）。
 * 公开仓库，只读 Release 无需鉴权 —— 不要在这里塞令牌。
 */
const GITCODE_CONFIG = {
  baseUrl: 'https://gitcode.com',
  apiBaseUrl: 'https://gitcode.com/api/v5',
  owner: 'giver',
  repo: 'JSecProbe',
};

/**
 * 自管理下载源（GitCode / R2）解析出的更新信息。
 * 与 electron-updater 托管的 GitHub 通道区分：这条路要我们自己下载、校验、启动安装包。
 */
export interface ManualUpdateInfo {
  version: string;
  sha512: string;
  size: number;
  releaseDate?: string;
  releaseNotes?: string;
  installerUrl: string;
}

/**
 * 三源优先级：GitCode（国内）→ GitHub（electron-updater 原生）→ Cloudflare R2（兜底）。
 * 判定"是否适用某个源"不依赖 GeoIP，直接用可达性表达：
 * 先问 GitCode，8 秒内不通或没数据就降级，这与"能连上就用"的实际体验一致。
 */
let updateSource: 'gitcode' | 'github' | 'r2' | null = null;
let manualUpdateInfo: ManualUpdateInfo | null = null;
let manualInstallerPath: string | null = null;
let pendingCheckFallback = false;
let activeDownload = false;

/** 整个 GitCode 阶段的耗时上限：超过就认定"国内源不适用"，立即降级 GitHub */
const GITCODE_PHASE_TIMEOUT = 10000;
const INSTALLER_PATHS_FILE = 'installer-paths.json';

function getInstallerPathsFile(): string {
  return path.join(app.getPath('userData'), INSTALLER_PATHS_FILE);
}

function saveInstallerPaths(): void {
  try {
    const data = {
      updateSource: updateSource,
      manual: manualInstallerPath,
      manualVersion: manualUpdateInfo?.version || null,
      manualSha512: manualUpdateInfo?.sha512 || null,
      manualUpdateInfo: manualUpdateInfo,
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
    // 兼容 v2.4.3 及更早版本写入的 r2* 键名
    const savedPath: string | null = data.manual || data.r2 || null;
    const savedInfo = data.manualUpdateInfo || data.r2UpdateInfo || null;
    if (savedPath && fs.existsSync(savedPath)) {
      manualInstallerPath = savedPath;
      updateSource = data.updateSource === 'gitcode' ? 'gitcode' : 'r2';
      log.info(`[更新] 已恢复 ${updateSource} 源的安装包路径`);
    } else if (savedPath) {
      log.warn('[更新] 持久化的安装包已被系统清理，忽略');
    }
    if (savedInfo) manualUpdateInfo = savedInfo;
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
    // electron-updater 的 checkForUpdates 在 emit("error") 之后还会 reject 返回的 Promise，
    // 必须接住，否则超时切换备用源后迟到的网络错误（如 net::ERR_CONNECTION_CLOSED）
    // 会变成未处理的 Promise 拒绝，触发全局兜底弹窗并退出应用
    void autoUpdater.checkForUpdates().catch(() => { /* 错误已经过 error 事件处理 */ });
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

/**
 * 带超时的网络请求。
 * Electron 的 net.fetch 不保证响应 AbortSignal，所以用外部计时器兜底：
 * 超时后立即 reject，底层请求仍在跑也无妨 —— 结果被丢弃即可。
 */
function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('FETCH_TIMEOUT')), timeoutMs);
    net.fetch(url, init ?? { method: 'GET' })
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err: Error) => { clearTimeout(timer); reject(err); });
  });
}

interface GitCodeRelease {
  tag_name?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

/**
 * 解析 GitCode 上某个 Release 的安装包下载地址。
 *
 * 历史包袱：GitCode 侧的 Release 由仓库外的机制自动同步，产出的是空格命名
 * （JSecProbe Setup 2.4.3.exe），而 GitHub / R2 用连字符（JSecProbe-Setup-2.4.3.exe）。
 *
 * 踩过的坑：这里**不能**用 HEAD 探测来判断文件是否存在 —— GitCode 的下载域名对 HEAD
 * 请求一律返回 401，GET 却正常（实测 200，且文件字节数与 GitHub/R2 完全一致）。
 * 因此以 Release 接口返回的资产清单为权威来源，缺失时才退回按历史命名拼地址，
 * 拼错的后果也只是下载阶段拿到 404，那时的提示语已经足够明确。
 */
function resolveGitCodeInstallerUrl(release: GitCodeRelease, version: string): string | null {
  const assets = release.assets || [];
  const isInstaller = (name: string) => /^JSecProbe[ -]Setup[ -].*\.exe$/.test(name) && !name.endsWith('.blockmap');
  // 精确版本优先：镜像同步中途可能出现"latest.yml 已到新版、安装包还是旧的"，
  // 此时宁可不匹配，也不要挑到别的版本的安装包
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = assets.find((a) => new RegExp(`^JSecProbe[ -]Setup[ -]${escaped}\\.exe$`).test(a.name));
  if (exact) return exact.browser_download_url;
  const fallbackAsset = assets.find((a) => isInstaller(a.name));
  if (fallbackAsset) {
    log.warn(`[更新-GitCode] 清单中没有 ${version} 的安装包，退而使用 ${fallbackAsset.name}（后续由 SHA512 兜底校验）`);
    return fallbackAsset.browser_download_url;
  }
  log.warn('[更新-GitCode] Release 清单中未列出安装包，按历史命名拼下载地址');
  const base = `${GITCODE_CONFIG.baseUrl}/${GITCODE_CONFIG.owner}/${GITCODE_CONFIG.repo}/releases/download/${encodeURIComponent(release.tag_name || version)}`;
  return `${base}/${encodeURIComponent(`JSecProbe Setup ${version}.exe`)}`;
}

/**
 * 检查 GitCode（国内源）是否有新版本。
 * 返回 null 表示"不可达"或"没有比当前更高的版本"，由调用方决定是否降级。
 *
 * deadline 约束整个 GitCode 阶段的总耗时：一次检查会串行访问 Release 接口与 latest.yml
 * 两个地址，若各自用满单次超时，"国内快速命中"就可能变成"比其他源更慢"。
 * 这里是"快速试、快速退"——超过预算即认定国内源不适用，让位给 GitHub。
 */
async function checkGitCodeForUpdates(deadline: number = Date.now() + GITCODE_PHASE_TIMEOUT): Promise<ManualUpdateInfo | null> {
  const remaining = () => Math.max(1500, deadline - Date.now());
  try {
    log.info('[更新-GitCode] 正在检查 GitCode 更新源...');
    const apiUrl = `${GITCODE_CONFIG.apiBaseUrl}/repos/${GITCODE_CONFIG.owner}/${GITCODE_CONFIG.repo}/releases/latest`;
    const response = await fetchWithTimeout(apiUrl, remaining());
    if (!response.ok) {
      log.warn(`[更新-GitCode] 获取 Release 信息失败: HTTP ${response.status}`);
      return null;
    }
    const release = (await response.json()) as GitCodeRelease;
    if (!release.tag_name) {
      log.warn('[更新-GitCode] Release 缺少 tag_name');
      return null;
    }

    const ymlUrl = release.assets?.find((a) => a.name === 'latest.yml')?.browser_download_url
      || `${GITCODE_CONFIG.baseUrl}/${GITCODE_CONFIG.owner}/${GITCODE_CONFIG.repo}/releases/download/${encodeURIComponent(release.tag_name)}/latest.yml`;
    const ymlResponse = await fetchWithTimeout(ymlUrl, remaining());
    if (!ymlResponse.ok) {
      log.warn(`[更新-GitCode] 获取 latest.yml 失败: HTTP ${ymlResponse.status}`);
      return null;
    }
    const info = parseLatestYml(await ymlResponse.text());
    if (!info) {
      log.warn('[更新-GitCode] 解析 latest.yml 失败');
      return null;
    }

    const currentVersion = app.getVersion();
    log.info(`[更新-GitCode] 当前版本: ${currentVersion}, GitCode 版本: ${info.version}`);
    if (compareVersions(info.version, currentVersion) <= 0) {
      log.info('[更新-GitCode] GitCode 上无新版本');
      return null;
    }

    const installerUrl = resolveGitCodeInstallerUrl(release, info.version);
    if (!installerUrl) {
      log.warn('[更新-GitCode] 未找到可用的安装包资产');
      return null;
    }
    return { ...info, installerUrl };
  } catch (error: any) {
    log.warn('[更新-GitCode] 检查失败:', error.message);
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

interface InstallerDownloadOptions {
  url: string;
  version: string;
  expectedSha512: string;
  /** 日志前缀，用于区分下载来源 */
  label: string;
  /** 404 时的补充说明，帮助定位"该源没同步此版本"还是"文件名写错" */
  notFoundHint?: string;
}

/**
 * 自管理更新源的通用下载流程：流式落盘 → 进度上报 → SHA512 校验。
 * GitCode 与 R2 共用，差别只在 URL、日志标签和 404 提示语。
 */
async function downloadInstallerFile(opts: InstallerDownloadOptions): Promise<string> {
  const { url, version, expectedSha512, label, notFoundHint } = opts;
  // 落盘名称恒定用连字符格式：GitCode 历史 Release 的资产名带空格，
  // 若沿用原文件名会让临时目录里出现两种命名，排障与清理都很别扭
  const installerName = `JSecProbe-Setup-${version}.exe`;
  const tempDir = getSafeTempDir();
  const destPath = path.join(tempDir, installerName);

  log.info(`${label} 开始下载: ${url}`);
  const response = await net.fetch(url, { method: 'GET' });
  if (!response.ok) {
    // 404 绝大多数是"该版本尚未同步到此源"或对象名不一致，给出可诊断的提示而非裸抛错
    const detail = response.status === 404
      ? notFoundHint || `该源上不存在对应版本的安装包（HTTP 404）`
      : `HTTP ${response.status}`;
    throw new Error(`下载失败: ${detail}`);
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

  log.info(`${label} 校验文件完整性...`);
  const fileBuffer = fs.readFileSync(destPath);
  const actualSha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
  if (actualSha512 !== expectedSha512) {
    fs.unlinkSync(destPath);
    throw new Error('SHA512 校验失败，下载文件可能已损坏');
  }
  log.info(`${label} SHA512 校验通过`);

  return destPath;
}

/**
 * 按当前选中的自管理源下载安装包并持久化路径。
 * GitCode 与 R2 的差异已收敛到 manualUpdateInfo.installerUrl 与 URL 本身。
 */
async function downloadManualUpdate(): Promise<void> {
  if (!manualUpdateInfo) throw new Error('无法获取更新信息，请重新检查更新');
  const isGitCode = updateSource === 'gitcode';
  const destPath = await downloadInstallerFile({
    url: manualUpdateInfo.installerUrl,
    version: manualUpdateInfo.version,
    expectedSha512: manualUpdateInfo.sha512,
    label: isGitCode ? '[更新-GitCode]' : '[更新-R2]',
    notFoundHint: isGitCode
      ? `GitCode 上找不到 ${manualUpdateInfo.version} 的安装包（该源由外部同步，可能尚未完成）`
      : undefined,
  });
  manualInstallerPath = destPath;
  saveInstallerPaths();
  sendStatusToWindow({ status: 'downloaded', version: manualUpdateInfo.version });
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
    manualUpdateInfo = null;
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
    // 检查会话已结束（如超时切换备用源后残留请求迟到的网络错误），
    // 不再打扰用户、不污染 UI 状态，仅记录日志
    if (!activeDownload) {
      log.warn('[更新] 忽略迟到的更新错误（无进行中的下载会话）:', error.message);
      return;
    }
    log.error('[更新] 下载更新出错:', error);
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
 * 回落到 Cloudflare R2 兜底源。返回 true 表示已命中可用更新。
 */
async function tryR2Fallback(): Promise<boolean> {
  const r2Info = await checkR2ForUpdates();
  if (!r2Info) return false;
  updateSource = 'r2';
  // 必须与 scripts/upload-to-r2.js 上传的对象名一致（连字符）。
  // 此前此处用 "JSecProbe Setup ${version}.exe"（空格），与实际上传对象不匹配，
  // 导致 R2 兜底源必然 404 —— 主源不可达时用户看到"有更新"却永远下载失败。
  manualUpdateInfo = {
    ...r2Info,
    installerUrl: `${R2_CONFIG.baseUrl}/${encodeURIComponent(`JSecProbe-Setup-${r2Info.version}.exe`)}`,
  };
  sendStatusToWindow({
    status: 'available',
    version: r2Info.version,
    releaseDate: r2Info.releaseDate,
    releaseNotes: r2Info.releaseNotes,
  });
  return true;
}

/**
 * 统一的更新检查流程（GitCode 国内源 → GitHub 原生通道 → Cloudflare R2 兜底）。
 *
 * 为什么 GitCode 在最前：国内直连 GitHub Release 经常超时或极慢，而 GitCode 上的
 * Release 一直有自动同步。用"可达性"代替地理判定 —— 8 秒内拿不到结果就降级，
 * 既省掉一次 GeoIP 请求，也天然覆盖"人在国外但能连 GitCode"这类情况。
 *
 * 供启动自动检查、托盘手动检查、IPC 手动检查三处复用。
 * 检查结果通过 autoUpdater 事件或 sendStatusToWindow 推送到渲染进程。
 */
async function performUpdateCheck(context: string): Promise<void> {
  if (pendingCheckFallback) return;

  pendingCheckFallback = true;
  try {
    // 1) 国内优先：GitCode
    const gitcodeInfo = await checkGitCodeForUpdates();
    if (gitcodeInfo) {
      updateSource = 'gitcode';
      manualUpdateInfo = gitcodeInfo;
      log.info(`[更新-GitCode] ${context}检查发现新版本: ${gitcodeInfo.version}`);
      sendStatusToWindow({
        status: 'available',
        version: gitcodeInfo.version,
        releaseDate: gitcodeInfo.releaseDate,
        releaseNotes: gitcodeInfo.releaseNotes,
      });
      return;
    }

    // 2) electron-updater 托管的 GitHub 通道（事件回调负责推送状态）
    try {
      await checkWithTimeout();
      return;
    } catch (error: any) {
      const reason = error.message === 'GITHUB_TIMEOUT'
        ? 'GitHub 连接超时'
        : `GitHub 检查失败（${error.message}）`;

      if (error.message === 'GITHUB_TIMEOUT') {
        log.warn(`[更新] ${context}检查超时，尝试 Cloudflare R2 备用更新源...`);
      } else {
        log.error(`[更新] ${context}检查更新失败:`, error.message);
      }

      const shouldFallback = error.message === 'GITHUB_TIMEOUT' || isNetworkError(error);
      if (shouldFallback) {
        if (await tryR2Fallback()) return;
        log.info('[更新-R2] 备用源也无更新可用');
        if (error.message === 'GITHUB_TIMEOUT') {
          sendStatusToWindow({ status: 'error', error: 'GitHub 连接超时，请检查网络后重试' });
          return;
        }
      }
      log.warn(`[更新] ${reason}`);
      sendStatusToWindow({ status: 'error', error: error.message || '检查更新失败' });
      // 保持原有契约：非超时类的失败继续向上抛，渲染进程据此弹一次错误提示
      throw error;
    }
  } finally {
    pendingCheckFallback = false;
  }
}

export function triggerUpdateCheck(): void {
  if (process.env.VITE_DEV_SERVER_URL) return;
  performUpdateCheck('手动').catch(() => {});
}

/**
 * 校验安装包的 Authenticode 数字签名（P1-5）。
 *
 * 背景：更新包的 sha512 与安装包**同源**获取（同一个 latest.yml / R2 对象），
 * 服务端被控或证书被劫持时，攻击者可以同时替换摘要与安装包 —— 校验 sha512 形同虚设。
 * 数字签名是唯一能脱离传输通道独立验证发布者身份的手段，必须在执行前完成校验。
 *
 * 说明：仅在 Windows 上校验；非 Windows 或无 PowerShell 时按"无法校验"处理并明确告警。
 * 自签测试包场景可用环境变量 `JSECPROBE_SKIP_SIGNATURE_CHECK=1` 跳过（会留痕）。
 */
async function verifyInstallerSignature(installerPath: string): Promise<{ ok: boolean; reason: string }> {
  if (process.env.JSECPROBE_SKIP_SIGNATURE_CHECK === '1') {
    log.warn('[更新] 已按 JSECPROBE_SKIP_SIGNATURE_CHECK=1 跳过安装包签名校验（仅限自测场景）');
    return { ok: true, reason: '已跳过' };
  }
  if (process.platform !== 'win32') {
    return { ok: false, reason: '非 Windows 平台，无法校验 Authenticode 签名' };
  }

  // 路径以单引号包裹并转义内部单引号，避免路径拼接破坏命令
  const escaped = installerPath.replace(/'/g, "''");
  const script = `(Get-AuthenticodeSignature -FilePath '${escaped}').Status`;

  return new Promise((resolve) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    // 超时保护：PowerShell 冷启动可能较慢，但不应无限等待
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } resolve({ ok: false, reason: '签名校验超时' }); }, 30000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: '无法执行签名校验（PowerShell 不可用）' });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const status = stdout.trim();
      if (status === 'Valid') {
        resolve({ ok: true, reason: '签名有效' });
      } else if (status === 'ValidButExpired') {
        // 证书过期但签名本身有效：企业环境常见，放行但明确告警
        log.warn('[更新] 安装包签名有效但证书已过期，仍允许安装');
        resolve({ ok: true, reason: '签名有效（证书已过期）' });
      } else {
        resolve({
          ok: false,
          reason: `安装包签名校验未通过（状态：${status || '未知'}${stderr ? `，${stderr.trim()}` : ''}）`,
        });
      }
    });
  });
}

/**
 * 启动已下载的自管理源（GitCode / R2）安装包执行静默安装。
 * 返回 true 表示安装进程已成功启动；false 表示启动失败（原因已记录日志）。
 * 注意：shell.openPath 失败时 resolve 错误描述字符串（空串代表成功）而非 reject，
 * 必须通过返回值判断成败；spawn 的 error 事件必须监听，否则会变成未捕获异常。
 */
async function launchManualInstaller(installerPath: string): Promise<boolean> {
  // 执行前必须校验签名：否则服务端/传输通道被劫持即可向所有测评终端推送并执行任意安装包
  const sig = await verifyInstallerSignature(installerPath);
  if (!sig.ok) {
    log.error(`[更新] 拒绝执行安装包：${sig.reason}`);
    return false;
  }
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
    manualUpdateInfo = null;
    manualInstallerPath = null;
    clearInstallerPaths();

    await performUpdateCheck('手动');
  }, 'update'));

  ipcMain.handle('update:download', wrap(async () => {
    if (updateSource === 'gitcode' || updateSource === 'r2') {
      log.info(`[更新] 开始从 ${updateSource === 'gitcode' ? 'GitCode' : 'Cloudflare R2'} 下载更新`);
      await downloadManualUpdate();
      return;
    }

    log.info('[更新] 开始下载更新');
    // 标记下载会话进行中：期间 autoUpdater 的 error 事件需要真实上报给用户，
    // 会话结束后迟到的 error 仅记日志，避免污染 UI 状态
    activeDownload = true;
    try {
      await autoUpdater.downloadUpdate();
    } finally {
      activeDownload = false;
    }
  }, 'update'));

  ipcMain.handle('update:install', wrap(async () => {
    const installerPath = manualInstallerPath;
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
      const launched = await launchManualInstaller(installerPath);
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