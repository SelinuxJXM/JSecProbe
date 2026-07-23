import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { logger } from '../utils/logger';
import { registerIpcHandlers } from './ipc';
import { getSharedOcrWorker, terminateSharedOcrWorker } from '../ipc/ai.ipc';
import { initDatabase, closeDb, walCheckpoint } from '../db';
import { getDefaultBasePath } from './paths';
import { checkAndPerformAutoBackup } from '../services/backup.service';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater } from '../services/update.service';

logger.setProductionMode(app.isPackaged);
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
let backupIntervalId: NodeJS.Timeout | null = null;

function showErrorAndQuit(title: string, message: string, detail?: string) {
  dialog.showErrorBox(title, `${message}\n\n${detail || ''}`);
  app.quit();
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
    frame: true,
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  mainWindow = new BrowserWindow(mainWindowOptions);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist-renderer/index.html'));
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    destroyTray();
  });

  // 创建托盘图标
  createTray(mainWindow);

  // 初始化自动更新服务
  initAutoUpdater(mainWindow);

  // 关闭按钮最小化到托盘
  mainWindow.on('close', (event: Electron.Event) => {
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

app.whenReady().then(async () => {
  await initializeApp();
  createWindow();
  setupAutoBackup();
  setupWalCheckpoint();

  getSharedOcrWorker().catch((err) => {
    log.warn('OCR Worker 预加载失败:', err);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupAutoBackup();
  cleanupWalCheckpoint();
  cleanupLockFile();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  cleanupAutoBackup();
  cleanupWalCheckpoint();
  cleanupLockFile();
  await terminateSharedOcrWorker();
  closeDb();
});

process.on('SIGINT', async () => {
  cleanupLockFile();
  await terminateSharedOcrWorker();
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  cleanupLockFile();
  await terminateSharedOcrWorker();
  closeDb();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  log.error('未捕获的异常:', error);
  showErrorAndQuit('应用异常', error.message || '未知异常', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('未处理的 Promise 拒绝:', reason);
  log.error('Promise:', promise);
});
