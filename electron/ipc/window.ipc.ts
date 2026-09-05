import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { wrap } from '../utils/ipc-wrapper';

function getWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowHandlers(): void {
  ipcMain.handle('window:minimize', wrap(async (event) => {
    getWindow(event)?.minimize();
  }, 'window'));

  ipcMain.handle('window:maximizeToggle', wrap(async (event) => {
    const win = getWindow(event);
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  }, 'window'));

  ipcMain.handle('window:isMaximized', wrap(async (event) => {
    return getWindow(event)?.isMaximized() ?? false;
  }, 'window'));

  ipcMain.handle('window:close', wrap(async (event) => {
    getWindow(event)?.close();
  }, 'window'));
}
