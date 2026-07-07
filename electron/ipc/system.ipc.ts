import { ipcMain, app, shell, dialog } from 'electron';
import log from 'electron-log';
import { getDb, closeDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import type { SystemInfo, FileFilter } from '../../shared/types';
import { getAppDataPath, setAppDataPath } from '../main/paths';

function restartApp(): void {
  try {
    if (process.env.VITE_DEV_SERVER_URL) {
      // 开发模式下由 vite-plugin-electron 重新启动进程，
      // app.relaunch() 会丢失 VITE_DEV_SERVER_URL 环境变量
      app.exit(0);
    } else {
      app.relaunch();
      app.exit(0);
    }
  } catch (error) {
    log.error('应用重启失败:', error);
  }
}

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('System IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

async function getDbPath(): Promise<string> {
  const dataPath = await getAppDataPath();
  return path.join(dataPath, 'data', 'mlps.db');
}

async function getAllowedBasePaths(): Promise<string[]> {
  const dataPath = await getAppDataPath();
  return [
    dataPath,
    path.join(dataPath, 'screenshots'),
    path.join(dataPath, 'evidence'),
    path.join(dataPath, 'backups'),
    path.join(dataPath, 'knowledge'),
    path.join(dataPath, 'temp'),
  ];
}

async function validatePath(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const allowedPaths = await getAllowedBasePaths();
  const isAllowed = allowedPaths.some(base => {
    const resolvedBase = path.resolve(base);
    return resolved === resolvedBase || resolved.startsWith(resolvedBase + path.sep);
  });
  if (!isAllowed) {
    throw new Error(`路径访问被拒绝: ${inputPath} (仅允许访问应用数据目录)`);
  }
  return resolved;
}

const SAFE_PATH_NAMES = ['userData', 'documents', 'downloads', 'desktop', 'temp'];

function validatePathName(name: string): string {
  if (!SAFE_PATH_NAMES.includes(name)) {
    throw new Error(`路径名称不被允许: ${name}`);
  }
  return name;
}

export function registerSystemHandlers(): void {
  ipcMain.handle('system:getInfo', () =>
    wrap<SystemInfo>(async () => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
      dataPath: await getAppDataPath(),
    }))
  );

  ipcMain.handle('system:openDataFolder', () =>
    wrap<void>(async () => {
      const dataPath = await getAppDataPath();
      shell.openPath(dataPath);
    })
  );

  ipcMain.handle('system:changeDataPath', (_event, newPath: string) =>
    wrap<string>(async () => {
      log.info(`开始更改数据存储路径，目标路径: ${newPath}`);
      const resolvedPath = path.resolve(newPath);
      log.info(`解析后的目标路径: ${resolvedPath}`);

      if (!fs.existsSync(resolvedPath)) {
        log.info('目标目录不存在，创建目录');
        fs.mkdirSync(resolvedPath, { recursive: true });
      }

      if (!fs.statSync(resolvedPath).isDirectory()) {
        throw new Error('指定的路径不是有效目录');
      }

      const oldPath = await getAppDataPath();
      const oldDbPath = path.join(oldPath, 'data', 'mlps.db');
      const newDbPath = path.join(resolvedPath, 'data', 'mlps.db');
      log.info(`旧数据路径: ${oldPath}, 旧数据库: ${oldDbPath}, 新数据库: ${newDbPath}`);

      if (fs.existsSync(oldDbPath)) {
        if (!fs.existsSync(path.join(resolvedPath, 'data'))) {
          fs.mkdirSync(path.join(resolvedPath, 'data'), { recursive: true });
        }
        log.info('关闭数据库连接并复制数据库文件');
        closeDb();
        fs.copyFileSync(oldDbPath, newDbPath);
        log.info(`数据库已从 ${oldDbPath} 复制到 ${newDbPath}`);
      } else {
        log.warn(`旧数据库不存在: ${oldDbPath}`);
      }

      log.info('写入新数据路径配置');
      setAppDataPath(resolvedPath);
      log.info('数据路径配置写入完成');

      setTimeout(() => {
        restartApp();
      }, 500);

      return resolvedPath;
    })
  );

  ipcMain.handle('shell:openPath', (_event, filePath: string) =>
    wrap<void>(async () => {
      const safePath = await validatePath(filePath);
      shell.openPath(safePath);
    })
  );

  ipcMain.handle('shell:openExternal', (_event, filePath: string) =>
    wrap<void>(async () => {
      const safePath = await validatePath(filePath);
      shell.openPath(safePath);
    })
  );

  ipcMain.handle('system:selectFile', (_event, filters?: FileFilter[]) =>
    wrap<string | null>(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: filters || [],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    })
  );

  ipcMain.handle('system:saveFile', (_event, defaultPath?: string, filters?: FileFilter[]) =>
    wrap<string | null>(async () => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultPath || '',
        filters: filters || [],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    })
  );

  ipcMain.handle('system:backupData', (_event, customPath?: string) =>
    wrap<string>(async () => {
      const dbPath = await getDbPath();
      let backupPath: string;

      if (customPath) {
        const resolvedPath = path.resolve(customPath);
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        backupPath = resolvedPath;
      } else {
        const dataPath = await getAppDataPath();
        const backupDir = path.join(dataPath, 'backups');

        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = path.join(backupDir, `mlps_backup_${timestamp}.db`);
      }

      fs.copyFileSync(dbPath, backupPath);

      return backupPath;
    })
  );

  ipcMain.handle('system:restoreData', (_event, backupPath: string) =>
    wrap<void>(async () => {
      if (!fs.existsSync(backupPath)) {
        throw new Error('备份文件不存在');
      }
      
      const stats = fs.statSync(backupPath);
      if (!stats.isFile()) {
        throw new Error('备份路径不是文件');
      }
      if (stats.size > 500 * 1024 * 1024) {
        throw new Error('备份文件过大 (最大500MB)');
      }
      
      if (!backupPath.endsWith('.db')) {
        throw new Error('备份文件必须是.db格式');
      }
      
      const dbPath = await getDbPath();
      const tempPath = dbPath + '.tmp';
      fs.copyFileSync(backupPath, tempPath);
      
      const fd = fs.openSync(tempPath, 'r');
      const buffer = Buffer.alloc(16);
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);
      if (!buffer.toString('utf8').startsWith('SQLite format 3')) {
        fs.unlinkSync(tempPath);
        throw new Error('无效的备份文件：不是SQLite数据库格式');
      }
      
      closeDb();
      fs.copyFileSync(tempPath, dbPath);
      fs.unlinkSync(tempPath);

      setTimeout(() => {
        restartApp();
      }, 500);
    })
  );

  ipcMain.handle('log:list', (_event, params: { page?: number; pageSize?: number; module?: string; action?: string }) =>
    wrap(async () => {
      const db = getDb();
      const page = params.page || 1;
      const pageSize = params.pageSize || 50;
      const conditions: any[] = [];
      if (params.module) conditions.push(eq(schema.operationLogs.module, params.module));
      if (params.action) conditions.push(eq(schema.operationLogs.action, params.action));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const totalResult = await db
        .select({ value: count() })
        .from(schema.operationLogs)
        .where(whereClause || undefined);
      const total = totalResult[0]?.value || 0;

      const logs = await db
        .select()
        .from(schema.operationLogs)
        .where(whereClause || undefined)
        .orderBy(desc(schema.operationLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return { list: logs, total };
    })
  );

  // Dialog handlers
  ipcMain.handle('dialog:showOpenDialog', (_event, options) =>
    wrap(async () => {
      const result = await dialog.showOpenDialog(options);
      return result;
    })
  );

  ipcMain.handle('dialog:showSaveDialog', (_event, options) =>
    wrap(async () => {
      const result = await dialog.showSaveDialog(options);
      return result;
    })
  );

  ipcMain.handle('dialog:showMessageBox', (_event, options) =>
    wrap(async () => {
      const result = await dialog.showMessageBox(options);
      return result;
    })
  );

  // 文件系统操作
  ipcMain.handle('system:getPath', (_event, name: string) =>
    wrap<string>(() => {
      const safeName = validatePathName(name);
      return app.getPath(safeName as any);
    })
  );

  ipcMain.handle('fs:ensureDir', (_event, dirPath: string) =>
    wrap<void>(async () => {
      const safePath = await validatePath(dirPath);
      if (!fs.existsSync(safePath)) {
        fs.mkdirSync(safePath, { recursive: true });
      }
    })
  );

  ipcMain.handle('fs:writeFile', (_event, filePath: string, data: string | Buffer) =>
    wrap<void>(async () => {
      const safePath = await validatePath(filePath);
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (typeof data === 'string') {
        const buffer = Buffer.from(data, 'base64');
        fs.writeFileSync(safePath, buffer);
      } else {
        fs.writeFileSync(safePath, data);
      }
    })
  );
}