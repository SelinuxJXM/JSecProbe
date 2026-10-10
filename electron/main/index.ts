import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { logger } from '../utils/logger';
import { registerIpcHandlers } from './ipc';
import { terminateOCRWorker } from '../services/ocr.service';
import { initDatabase, closeDb, walCheckpoint } from '../db';
import { getDefaultBasePath } from './paths';
import { AuthService } from '../services/auth.service';
import { cleanupOperationLogs } from '../utils/operation-log';
import { checkAndPerformAutoBackup } from '../services/backup.service';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater } from '../services/update.service';
import { migrateAllPaths } from '../utils/path-migration';
import { stopOllama } from '../services/ollama.service';
import { stopHerdsman } from '../services/herdsman.service';

logger.setProductionMode(app.isPackaged);

let mainWindow: BrowserWindow | null = null;
let backupIntervalId: NodeJS.Timeout | null = null;
let isQuitting = false;

function showErrorAndQuit(title: string, message: string, detail?: string) {
  dialog.showErrorBox(title, `${message}\n\n${detail || ''}`);
  app.quit();
}

/**
 * 判断异常是否「致命」——即应用已无法继续运行，必须退出。
 *
 * 背景：此前 uncaughtException 一律弹窗杀死进程。而主进程里大量异常其实是环境暂态
 * 问题（文件被占用、某个回调里的 fs 报错、IPC 通道已关闭），杀掉进程会让用户
 * 正在填写的测评内容直接丢失，代价远大于异常本身。
 * 现在只有明确不可恢复的情况才退出，其余仅记日志。
 */
function isFatalError(error: unknown): boolean {
  const err = error as { code?: unknown; name?: unknown } | null;
  const code = typeof err?.code === 'string' ? err.code : '';
  const name = typeof err?.name === 'string' ? err.name : '';

  // 资源耗尽：继续跑只会越错越多
  if (name === 'OutOfMemoryError' || code === 'ERR_OUT_OF_MEMORY') return true;

  // SQLite 只有「打不开/损坏/不是数据库」这类才算致命；SQLITE_BUSY 等属并发暂态
  if (code.startsWith('SQLITE_')) {
    return ['SQLITE_CANTOPEN', 'SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_NOMEM', 'SQLITE_IOERR'].includes(code);
  }

  // 句柄失效、IPC 通道关闭多为窗口/渲染进程已销毁的伴随现象，主进程本身仍然健康
  if (code === 'ERR_INVALID_HANDLE' || code === 'ERR_IPC_CHANNEL_CLOSED') return false;

  return false;
}

// 崩溃风暴保护：短窗口内反复抛异常说明应用真处于病态，这时才弹窗退出。
// 单次非致命异常只记日志，绝不打扰正在填写数据的用户。
const ERROR_BURST_LIMIT = 5;
const ERROR_BURST_WINDOW_MS = 60_000;
let errorBurstCount = 0;
let errorBurstWindowStart = Date.now();

/**
 * 非致命异常的统一处理：记日志，并统计频率。
 * 达到风暴阈值才真正退出，返回 true 表示已触发退出流程。
 */
function handleNonFatalError(kind: string, error: unknown): boolean {
  const now = Date.now();
  if (now - errorBurstWindowStart > ERROR_BURST_WINDOW_MS) {
    errorBurstWindowStart = now;
    errorBurstCount = 0;
  }
  errorBurstCount++;
  log.error(`[${kind}] 非致命异常已记录（${errorBurstCount}/${ERROR_BURST_LIMIT}）:`, error);

  if (errorBurstCount >= ERROR_BURST_LIMIT) {
    const message = String((error as { message?: unknown })?.message ?? error ?? '未知异常');
    showErrorAndQuit('应用异常', `短时间内反复出错（${kind}），为防止数据损坏已退出`, message);
    return true;
  }
  return false;
}

// 判断未处理的 Promise 拒绝是否为网络抖动等暂态外部错误。
// 此类错误不应杀死正在使用的应用，仅记录日志即可。
// 注意：只认 error.code / error.name 这类结构化标识，不再对 message 做模糊关键词匹配 ——
// 此前匹配 'network'/'certificate' 等宽泛词，容易把真实 bug 的消息一起吞掉。
function isTransientRejection(reason: unknown): boolean {
  const err = reason as { code?: unknown; name?: unknown } | null;
  const code = typeof err?.code === 'string' ? err.code.toUpperCase() : '';
  const name = typeof err?.name === 'string' ? err.name : '';

  const transientCodes = [
    'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT',
    'EAI_AGAIN', 'EPIPE', 'EADDRINUSE', 'ENOENT', 'EACCES', 'EBUSY',
    'ERR_NETWORK', 'ERR_INTERNET_DISCONNECTED', 'ERR_INSUFFICIENT_RESOURCES',
  ];
  if (transientCodes.includes(code)) return true;
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'CommandTimeoutError') return true;

  // Chromium 网络错误（net::ERR_xxx）本身不带 code，只能从 message 前缀判断
  const msg = String((reason as { message?: unknown })?.message ?? reason ?? '');
  return msg.includes('net::ERR_');
}

const USER_DATA_BASE = getDefaultBasePath();
const LOCK_DIR = join(USER_DATA_BASE, 'locks');

function cleanupLockFile() {
  try {
    const lockFile = join(LOCK_DIR, 'app.lock');
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch (err) {
    log.warn('清理锁文件失败:', err);
  }
}

async function initializeApp() {
  try {
    cleanupLockFile();
    await initDatabase();
    await migrateAllPaths();
    AuthService.restorePersistedSession();
    registerIpcHandlers();
  } catch (error: any) {
    log.error('应用初始化失败:', error);
    showErrorAndQuit('初始化失败', error.message || '应用启动失败', error.stack);
  }
}

function createWindow() {
  const mainWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    backgroundColor: '#F5F7FA',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // sandbox preload 无法访问 app 模块，通过启动参数把 app.isPackaged 传入渲染进程
      additionalArguments: [`--jsecprobe-packaged=${app.isPackaged}`],
    },
  };

  mainWindow = new BrowserWindow(mainWindowOptions);

  // 关闭后台节流：窗口被遮挡或隐藏（最小化到托盘、被其它窗口覆盖）时，Chromium 默认会暂停
  // requestAnimationFrame 与定时器，导致路由过渡动画卡死、离场节点无法回收（表现为内容空白/残留）。
  // 保持常开可确保页面切换动画始终能跑完，后台采集轮询等任务也不被降频。
  mainWindow.webContents.setBackgroundThrottling(false);

  // 外链（http/https）用系统默认浏览器打开，阻止 Electron 内置窗口。
  // 非 http/https 一律 deny：原实现 `action: 'allow'` 会让 file:// 等 scheme 在应用窗口里
  // 打开新的窗口/标签，且该窗口同样加载 preload，等于凭空多出一个能调 IPC 的可控页面。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    log.warn('已阻止非 http(s) 的窗口打开请求:', url);
    return { action: 'deny' };
  });

  // 页面导航限制：本应用是 hash 路由的 SPA，加载完成后不应再发生任何文档级导航。
  // 缺了这层拦截时，渲染层一个 <a href="file:///..."> 或意外跳转就能把窗口内容换成外部页面，
  // 而该页面仍持有 preload 注入的全部 API。
  const handleNavigation = (event: Electron.Event, url: string): void => {
    // dev 态放行 Vite 开发服务器（HMR 整页刷新会触发一次真实导航）
    if (process.env.NODE_ENV === 'development' && url.startsWith('http://localhost')) {
      return;
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
      return;
    }
    event.preventDefault();
    log.warn('已阻止非预期的页面导航:', url);
  };
  mainWindow.webContents.on('will-navigate', handleNavigation);
  mainWindow.webContents.on('will-redirect', handleNavigation);

  // 设置日志转发目标，将主进程日志推送到 DevTools Console
  logger.setTargetWindow(mainWindow.webContents);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist-renderer/index.html'));
  }

  // CSP 无条件注入（原先只在打包态注入，dev 态等于裸奔，掩盖了 dev-only 的 XSS/注入问题）。
  // dev 态必须额外放行 Vite：HMR 用 eval + WebSocket，样式靠内联注入。
  const CSP_DIRECTIVES = [
    "default-src 'self'",
    // file: 用于预览本地截图/证据附件；blob: 用于图片预览与导出对象
    "img-src 'self' data: blob: file:",
    // Element Plus 主题变量 + 富文本内联样式依赖内联 <style>
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'" + (app.isPackaged ? '' : " 'unsafe-eval'"),
    // 本地 Ollama / 开发服务器 / 自建 OPML 等均走 127.0.0.1 或 localhost
    "connect-src 'self' http://127.0.0.1:* http://localhost:*" + (app.isPackaged ? '' : ' ws://localhost:* ws://127.0.0.1:*'),
    // 禁止 <object>/<embed>/<applet> 插件与 <base> 劫持
    "object-src 'none'",
    "base-uri 'self'",
    // 禁止被其它站点 iframe 嵌套（点击劫持）
    "frame-ancestors 'none'",
  ].join('; ');

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_DIRECTIVES],
      },
    });
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    logger.setTargetWindow(null);
    mainWindow = null;
    destroyTray();
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', false);
  });

  // 渲染进程崩溃兜底：崩溃后窗口会变成永久白屏（表现为「任何页面都访问为空」），
  // 这里记录崩溃原因并自动重载，避免用户卡在空白界面无从恢复。
  let lastRenderReloadAt = 0;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('渲染进程异常退出:', details.reason, 'exitCode=', details.exitCode);
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    // 防止持续崩溃导致无限重载：10 秒内只允许自动重载一次
    const now = Date.now();
    if (now - lastRenderReloadAt < 10000) return;
    lastRenderReloadAt = now;
    mainWindow.reload();
  });

  // 渲染进程长时间无响应（如同一帧内塞入超大采集输出）时记录，便于定位卡死场景
  mainWindow.webContents.on('unresponsive', () => {
    log.warn('渲染进程无响应');
  });

  // 创建托盘图标
  createTray(mainWindow);

  // 初始化自动更新服务
  initAutoUpdater(mainWindow);

  // 关闭按钮最小化到托盘（真正退出时放行，避免 app.quit() 被 preventDefault 拦截导致无法退出）
  mainWindow.on('close', (event: Electron.Event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

function setupAutoBackup(): void {
  backupIntervalId = setInterval(() => {
    checkAndPerformAutoBackup().catch((err: unknown) => {
      log.error('自动备份失败:', err);
    });
  }, 6 * 60 * 60 * 1000);
}

function cleanupAutoBackup(): void {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
  }
}

let walCheckpointIntervalId: NodeJS.Timeout | null = null;

function setupWalCheckpoint(): void {
  walCheckpointIntervalId = setInterval(() => {
    try {
      walCheckpoint();
    } catch (err) {
      log.warn('WAL checkpoint 失败:', err);
    }
  }, 6 * 60 * 60 * 1000);
}

function cleanupWalCheckpoint(): void {
  if (walCheckpointIntervalId) {
    clearInterval(walCheckpointIntervalId);
    walCheckpointIntervalId = null;
  }
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export { getMainWindow };



// Single instance lock
if (!app.requestSingleInstanceLock()) {
  logger.warn('Another instance is already running, exiting...');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  await initializeApp();
  createWindow();
  setupAutoBackup();
  setupWalCheckpoint();
  AuthService.startSessionCleanupTimer();

  // 启动时执行一次过期操作日志清理（默认保留 90 天）
  cleanupOperationLogs().catch((err) => {
    log.warn('启动时清理操作日志失败:', err);
  });

  // OCR Worker 改为懒加载：原实现在启动时无条件预加载（tesseract  worker 常驻几十~上百 MB
  // 内存并拉起语言包），但多数会话根本用不到 OCR，白占启动时间与常驻内存。
  // ocr.service / ai.ipc 在真正需要时会自行调用 getSharedWorker，首次调用多几百毫秒而已。

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

let cleanupDone = false;
async function gracefulCleanup(): Promise<void> {
  if (cleanupDone) return;
  cleanupDone = true;
  cleanupAutoBackup();
  cleanupWalCheckpoint();
  AuthService.stopSessionCleanupTimer();
  cleanupLockFile();
  try { await stopOllama(); } catch (e) { log.error('退出时停止 Ollama 失败:', e); }
  // Herdsman 是 GUI 程序，由本应用拉起后若不回收会留下孤儿窗口常驻后台
  try { stopHerdsman(); } catch (e) { log.error('退出时停止 Herdsman 失败:', e); }
  try { await terminateOCRWorker(); } catch (e) { log.error('退出时终止 OCR Worker 失败:', e); }
  try { closeDb(); } catch (e) { log.error('退出时关闭数据库失败:', e); }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', async (event) => {
  // before-quit / 旧实现是 async 回调，但 Electron 不 await 事件回调，
  // 会导致 stopOllama/terminateOCRWorker/closeDb 在进程退出前未完成（子进程残留、DB 未正常关闭）。
  // 改用 will-quit + preventDefault + app.exit(0) 标准模式，确保异步清理跑完再退出。
  event.preventDefault();
  await gracefulCleanup();
  app.exit(0);
});

process.on('SIGINT', async () => {
  await gracefulCleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await gracefulCleanup();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  log.error('未捕获的异常:', error);
  if (!isFatalError(error)) {
    // 非致命：只记日志 + 风暴计数，保住用户正在填写的数据
    handleNonFatalError('uncaughtException', error);
    return;
  }
  showErrorAndQuit('应用异常', error.message || '未知异常', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('未处理的 Promise 拒绝:', reason);
  log.error('Promise:', promise);
  // 网络抖动等暂态错误：仅记录日志，不打断正在使用的应用
  if (isTransientRejection(reason)) {
    return;
  }
  // 与 uncaughtException 同口径：非致命的只计数，达到风暴阈值才退出
  if (!isFatalError(reason)) {
    handleNonFatalError('unhandledRejection', reason);
    return;
  }
  setTimeout(() => {
    try { closeDb(); } catch (e) { log.error('崩溃退出前关闭数据库失败:', e); }
    try { showErrorAndQuit('应用异常', '未处理的 Promise 拒绝', String(reason)); } catch (e) { log.error('显示错误对话框失败:', e); }
    app.quit();
  }, 200);
});
