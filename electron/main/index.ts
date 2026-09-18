import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { logger } from '../utils/logger';
import { registerIpcHandlers } from './ipc';
import { getSharedWorker, terminateOCRWorker } from '../services/ocr.service';
import { initDatabase, closeDb, walCheckpoint } from '../db';
import { getDefaultBasePath } from './paths';
import { AuthService } from '../services/auth.service';
import { cleanupOperationLogs } from '../utils/operation-log';
import { checkAndPerformAutoBackup } from '../services/backup.service';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater } from '../services/update.service';
import { migrateAllPaths } from '../utils/path-migration';
import { stopOllama } from '../services/ollama.service';

logger.setProductionMode(app.isPackaged);

let mainWindow: BrowserWindow | null = null;
let backupIntervalId: NodeJS.Timeout | null = null;
let isQuitting = false;

function showErrorAndQuit(title: string, message: string, detail?: string) {
  dialog.showErrorBox(title, `${message}\n\n${detail || ''}`);
  app.quit();
}

// 判断未处理的 Promise 拒绝是否为网络抖动等暂态外部错误。
// 此类错误不应杀死正在使用的应用，仅记录日志即可；未知类型的拒绝仍弹窗退出。
function isTransientRejection(reason: unknown): boolean {
  const msg = String((reason as { message?: unknown })?.message ?? reason ?? '').toLowerCase();
  const keywords = [
    'net::', // Chromium 网络错误（如 net::ERR_CONNECTION_CLOSED）
    'enotfound', 'econnrefused', 'econnreset', 'econnaborted', 'etimedout',
    'eai_again', 'socket hang up', 'fetch failed', 'network',
    'timed out', 'certificate', 'dns',
    '超时', // 采集连接器超时（CommandTimeoutError）为中文消息，属暂态错误不应误杀应用
  ];
  return keywords.some((k) => msg.includes(k));
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

  // 外链（http/https）用系统默认浏览器打开，阻止 Electron 内置窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 设置日志转发目标，将主进程日志推送到 DevTools Console
  logger.setTargetWindow(mainWindow.webContents);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist-renderer/index.html'));
  }

  if (app.isPackaged) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": ["default-src 'self'; img-src 'self' data: blob: file:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*;"],
        },
      });
    });
  }

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

  getSharedWorker('chi_sim+eng').catch((err) => {
    log.warn('OCR Worker 预加载失败:', err);
  });

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
  showErrorAndQuit('应用异常', error.message || '未知异常', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('未处理的 Promise 拒绝:', reason);
  log.error('Promise:', promise);
  // 网络抖动等暂态错误：仅记录日志，不打断正在使用的应用
  if (isTransientRejection(reason)) {
    return;
  }
  setTimeout(() => {
    try { closeDb(); } catch (e) {}
    try { showErrorAndQuit('应用异常', '未处理的 Promise 拒绝', String(reason)); } catch (e) {}
    app.quit();
  }, 200);
});
