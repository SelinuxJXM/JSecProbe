import { app, BrowserWindow, shell, dialog } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { registerIpcHandlers } from './ipc';
import { initDatabase, getDb } from '../db';
import * as schema from '../db/schema';
import { getAppDataPath, getBackupPath } from './paths';
import { initAutoUpdater } from '../services/update.service';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    title: 'JSecProbe - 等级保护现场测评系统',
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
  // 启动后立即检查一次
  setTimeout(() => {
    checkAndPerformAutoBackup();
  }, 10000);

  // 每6小时检查一次
  setInterval(() => {
    checkAndPerformAutoBackup();
  }, 6 * 60 * 60 * 1000);

  log.info('自动备份定时器已启动，每6小时检查一次');
}

app.whenReady().then(initApp).catch((err) => {
  log.error('app.whenReady 失败:', err);
  dialog.showErrorBox('应用启动错误', err?.message || '未知错误');
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
