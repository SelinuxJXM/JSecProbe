import { app, Tray, Menu, nativeImage, BrowserWindow, dialog } from 'electron';
import { join } from 'path';
import { triggerUpdateCheck } from '../services/update.service';

let tray: Tray | null = null;

function getIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../build/icon.ico');
}

function createTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(getIconPath());
  return icon.resize({ width: 16, height: 16 });
}

function showAboutDialog() {
  dialog.showMessageBox({
    type: 'info',
    title: '关于 JSecProbe',
    message: 'JSecProbe - 等级保护现场测评系统',
    detail: `版本: ${app.getVersion()}\n\n一款专业的等级保护现场测评辅助工具，帮助测评人员高效完成现场测评工作。\n\n© 2025 景景`,
    buttons: ['确定'],
  });
}

function checkForUpdates(_window: BrowserWindow) {
  dialog.showMessageBox({
    type: 'info',
    title: '检查更新',
    message: '正在检查更新...',
    detail: '请稍候，正在连接服务器检查新版本',
    buttons: ['确定'],
  });
  triggerUpdateCheck();
}

function buildContextMenu(window: BrowserWindow): Menu {
  return Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        window.show();
        window.focus();
      },
    },
    { type: 'separator' },
    {
      label: '关于 JSecProbe',
      click: () => showAboutDialog(),
    },
    {
      label: '检查更新',
      click: () => checkForUpdates(window),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.exit(0);
      },
    },
  ]);
}

export function createTray(window: BrowserWindow): Tray {
  if (tray) {
    tray.destroy();
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip('JSecProbe - 等级保护现场测评系统');
  tray.setContextMenu(buildContextMenu(window));

  tray.on('double-click', () => {
    window.show();
    window.focus();
  });

  return tray;
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}