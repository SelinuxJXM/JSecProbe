import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

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

function sendStatusToWindow(status: UpdateStatus) {
  currentStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
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
      // 开发模式或未配置更新服务器时跳过
      if (process.env.VITE_DEV_SERVER_URL) {
        log.info('[更新] 开发模式下跳过更新检查');
        sendStatusToWindow({
          status: 'notavailable',
          version: app.getVersion(),
        });
        return { success: true, message: '开发模式下不检查更新' };
      }

      log.info('[更新] 手动检查更新');
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (error: any) {
      log.error('[更新] 检查更新失败:', error);
      sendStatusToWindow({
        status: 'error',
        error: error.message || '检查更新失败',
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      log.info('[更新] 开始下载更新');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error: any) {
      log.error('[更新] 下载更新失败:', error);
      sendStatusToWindow({
        status: 'error',
        error: error.message || '下载更新失败',
      });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update:install', async () => {
    try {
      log.info('[更新] 安装更新并重启');
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error: any) {
      log.error('[更新] 安装更新失败:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update:getStatus', () => {
    return currentStatus;
  });

  ipcMain.handle('update:getCurrentVersion', () => {
    return app.getVersion();
  });
}
