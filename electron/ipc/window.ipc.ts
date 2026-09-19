import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { wrap } from '../utils/ipc-wrapper';

function getWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/**
 * 窗口控制通道：仅操作当前窗口的显隐状态，不读写任何业务数据。
 * 显式关闭会话校验，避免登录页/会话过期时窗口按钮失效。
 */
const WINDOW_OPTS = { moduleName: 'window', requireSession: false } as const;

export function registerWindowHandlers(): void {
  ipcMain.handle('window:minimize', wrap(async (event) => {
    getWindow(event)?.minimize();
  }, WINDOW_OPTS));

  ipcMain.handle('window:maximizeToggle', wrap(async (event) => {
    const win = getWindow(event);
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  }, WINDOW_OPTS));

  ipcMain.handle('window:isMaximized', wrap(async (event) => {
    return getWindow(event)?.isMaximized() ?? false;
  }, WINDOW_OPTS));

  ipcMain.handle('window:close', wrap(async (event) => {
    getWindow(event)?.close();
  }, WINDOW_OPTS));
}
