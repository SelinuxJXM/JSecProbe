import { app, BrowserWindow, shell, dialog } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { registerIpcHandlers } from './ipc';
import { initDatabase, getDb } from '../db';
import * as schema from '../db/schema';
import { getAppDataPath, getBackupPath, getDefaultBasePath } from './paths';
import { initAutoUpdater } from '../services/update.service';
import { createTray, destroyTray } from './tray';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let backupIntervalId: NodeJS.Timeout | null = null;

function showErrorAndQuit(title: string, message: string, detail?: string) {
  dialog.showErrorBox(title, `${message}\n\n${detail || ''}`);
  app.quit();
}

process.on('uncaughtException', (error) => {
  log.error('未捕获异常:', error);
  dialog.showErrorBox('程序启动错误', `错误信息: ${error.message}\n\n堆栈: ${error.stack}`);
});

process.on('unhandledRejection', (reason) => {
  log.error('未处理的Promise拒绝:', reason);
});

const USER_DATA_BASE = getDefaultBasePath();
const LOCK_DIR = join(USER_DATA_BASE, 'locks');

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getActiveInstancePids(): number[] {
  if (!fs.existsSync(LOCK_DIR)) return [];
  const files = fs.readdirSync(LOCK_DIR).filter((f: string) => f.endsWith('.lock'));
  const pids: number[] = [];
  for (const file of files) {
    const pid = parseInt(file.replace('.lock', ''), 10);
    if (pid && isProcessRunning(pid)) {
      pids.push(pid);
    } else {
      try { fs.unlinkSync(join(LOCK_DIR, file)); } catch {}
    }
  }
  return pids;
}

function setupMultiInstanceSupport() {
  if (getActiveInstancePids().length === 0) return;
  
  const instanceNum = getActiveInstancePids().length + 1;
  const newPath = `${USER_DATA_BASE}_实例${instanceNum}`;
  app.setPath('userData', newPath);
  log.info(`检测到已有实例运行，使用独立数据目录: ${newPath}`);
}

setupMultiInstanceSupport();

const LOCK_FILE = join(LOCK_DIR, `${process.pid}.lock`);
(function createLockFile() {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
  fs.writeFileSync(LOCK_FILE, '');
})();

function cleanupLockFile() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}
app.on('quit', cleanupLockFile);
process.on('exit', cleanupLockFile);
process.on('SIGINT', () => { cleanupLockFile(); process.exit(0); });
process.on('SIGTERM', () => { cleanupLockFile(); process.exit(0); });

process.on('uncaughtException', (error) => {
  log.error('未捕获的异常:', error);
  showErrorAndQuit('应用异常', error.message || '未知异常', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('未处理的 Promise 拒绝:', reason);
  log.error('Promise:', promise);
});

function createWindow() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../build/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    title: 'JSecProbe - 等级保护现场测评系统',
    icon: iconPath,
    backgroundColor: '#f5f7fa',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist-renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log.error('页面加载失败:', errorCode, errorDescription);
    dialog.showErrorBox(
      '页面加载失败',
      `错误码: ${errorCode}\n错误描述: ${errorDescription}\n\n路径: ${join(__dirname, '../../dist-renderer/index.html')}`
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

async function initApp() {
  try {
    log.info('应用启动中...');
    log.info('应用版本:', app.getVersion());
    log.info('用户数据目录:', app.getPath('userData'));
    
    await getAppDataPath();
    log.info('数据路径初始化完成');
    
    await initDatabase();
    log.info('数据库初始化完成');
    
    registerIpcHandlers();
    log.info('IPC处理器注册完成');
    
    createWindow();
    log.info('主窗口创建完成');
    
    if (mainWindow) {
      initAutoUpdater(mainWindow);
      log.info('自动更新服务初始化完成');
      createTray(mainWindow);
      log.info('系统托盘创建完成');
    }
    
    // 启动自动备份定时器
    setupAutoBackup();
    
    log.info('应用启动成功');
  } catch (error: any) {
    log.error('应用启动失败:', error);
    showErrorAndQuit(
      '应用启动失败',
      error?.message || '未知错误',
      error?.stack
    );
  }
}

async function checkAndPerformAutoBackup(): Promise<void> {
  try {
    const db = getDb();
    const settings = await db.select().from(schema.systemSettings).limit(1);
    if (settings.length === 0) return;

    const setting = settings[0];
    if (!setting.autoBackupEnabled) {
      log.info('自动备份已禁用');
      return;
    }

    const backupDays = setting.autoBackupDays || 7;
    const backupDir = getBackupPath();

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.db'))
      .map(f => ({
        name: f,
        time: fs.statSync(join(backupDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 0) {
      const latestBackupTime = files[0].time;
      const elapsedMs = Date.now() - latestBackupTime;
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
      if (elapsedDays < backupDays) {
        log.info(`最近备份在 ${elapsedDays.toFixed(1)} 天前，未超过 ${backupDays} 天，跳过自动备份`);
        return;
      }
      log.info(`最近备份在 ${elapsedDays.toFixed(1)} 天前，已超过 ${backupDays} 天，执行自动备份`);
    } else {
      log.info('未找到备份文件，执行首次自动备份');
    }

    const { getDbPath } = await import('./paths');
    const dbPath = getDbPath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(backupDir, `auto_backup_${timestamp}.db`);
    
    fs.copyFileSync(dbPath, backupPath);
    log.info(`自动备份完成: ${backupPath}`);
  } catch (error: any) {
    log.error('自动备份失败:', error);
  }
}

function setupAutoBackup(): void {
  setTimeout(() => {
    checkAndPerformAutoBackup();
  }, 10000);

  backupIntervalId = setInterval(() => {
    checkAndPerformAutoBackup();
  }, 6 * 60 * 60 * 1000);

  log.info('自动备份定时器已启动，每6小时检查一次');
}

function cleanupAutoBackup(): void {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    log.info('自动备份定时器已清理');
  }
}

app.whenReady().then(initApp).catch((err) => {
  log.error('app.whenReady 失败:', err);
  dialog.showErrorBox('应用启动错误', err?.message || '未知错误');
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    destroyTray();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  cleanupAutoBackup();
});
