import { ipcMain, app, shell, dialog } from 'electron';
import log from 'electron-log';
import { getDb, closeDb, initDatabase } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import type { FileFilter } from '../../shared/types';
import { getAppDataPath, setAppDataPath } from '../main/paths';
import {
  validateReadablePath,
  validateFsPath,
  assertOpenablePath,
  authorizeUserFiles,
} from '../utils/path-resolver';
import { createFullBackup, restoreFromZipBackup, restoreFromLegacyBackup, restoreFromZipBackupIncremental, previewZipBackup, listBackups, isBackupEncrypted } from '../services/backup.service';
import { wrap } from '../utils/ipc-wrapper';

function restartApp(): void {
  try {
    if (process.env.VITE_DEV_SERVER_URL) {
      app.exit(0);
    } else {
      app.relaunch();
      app.exit(0);
    }
  } catch (error) {
    log.error('应用重启失败:', error);
  }
}

/**
 * 可通过 shell 打开的可执行/脚本类扩展名黑名单。
 *
 * shell:openPath 会调用系统默认关联程序打开文件，若允许传入 .exe/.bat/.ps1 等，
 * 渲染层一旦被挟持即可直接启动任意程序（等价于任意代码执行）。
 * 业务上该通道只用于打开目录、报告(docx/xlsx/pdf)与知识库文档，因此直接拒绝这些扩展名。
 */
const SAFE_PATH_NAMES = ['userData', 'documents', 'downloads', 'desktop', 'temp'];

function validatePathName(name: string): string {
  if (!SAFE_PATH_NAMES.includes(name)) {
    throw new Error(`路径名称不被允许: ${name}`);
  }
  return name;
}

export function registerSystemHandlers(): void {
  ipcMain.handle('system:getInfo', wrap(async () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    dataPath: await getAppDataPath(),
  }), 'system'));

  ipcMain.handle('system:openDataFolder', wrap(async () => {
    const dataPath = await getAppDataPath();
    shell.openPath(dataPath);
  }, 'system'));

  ipcMain.handle('system:changeDataPath', wrap(async (_event, newPath: string) => {
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

    if (path.resolve(oldPath) === resolvedPath) {
      return resolvedPath;
    }

    // 防止把数据目录迁移到其自身子目录（或反之），避免复制无限递归
    const oldWithSep = path.resolve(oldPath) + path.sep;
    const newWithSep = resolvedPath + path.sep;
    if (resolvedPath.startsWith(oldWithSep) || path.resolve(oldPath).startsWith(newWithSep)) {
      throw new Error('新路径不能是当前数据目录的子目录（或父目录）');
    }

    // 需要迁移的数据子目录（与 paths.ts 的 subDirs 一致，temp 不迁移）
    const MIGRATE_DIRS = ['data', 'attachments', 'standards', 'templates', 'logs', 'backup', 'screenshots', 'evidence', 'knowledge', 'backups'];

    const oldDbPath = path.join(oldPath, 'data', 'mlps.db');
    log.info(`旧数据路径: ${oldPath}, 旧数据库: ${oldDbPath}`);

    // 第一阶段：先复制到目标（不动旧目录），全部成功后才切换配置
    const preExistingDirs = new Set<string>(MIGRATE_DIRS.filter(d => fs.existsSync(path.join(resolvedPath, d))));
    try {
      closeDb();
      for (const dir of MIGRATE_DIRS) {
        const srcDir = path.join(oldPath, dir);
        const destDir = path.join(resolvedPath, dir);
        if (fs.existsSync(srcDir)) {
          log.info(`迁移目录: ${srcDir} -> ${destDir}`);
          fs.cpSync(srcDir, destDir, { recursive: true });
        } else if (dir === 'data') {
          fs.mkdirSync(destDir, { recursive: true });
        }
      }
      if (fs.existsSync(oldDbPath) && !fs.existsSync(path.join(resolvedPath, 'data', 'mlps.db'))) {
        throw new Error('数据库复制失败');
      }
    } catch (copyError) {
      log.error('数据目录迁移失败，回退到旧路径:', copyError);
      // 回滚：仅删除本次迁移新建的目录（不动目标处原有内容），并重建数据库连接
      try {
        for (const dir of MIGRATE_DIRS) {
          if (preExistingDirs.has(dir)) continue;
          const destDir = path.join(resolvedPath, dir);
          if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
      await initDatabase();
      throw new Error(`数据迁移失败，已回退到原路径: ${copyError instanceof Error ? copyError.message : String(copyError)}`);
    }

    // 第二阶段：复制全部成功后才写入新路径配置并重启
    log.info('写入新数据路径配置');
    setAppDataPath(resolvedPath);
    log.info('数据路径配置写入完成');

    setTimeout(() => {
      restartApp();
    }, 500);

    return resolvedPath;
  }, { moduleName: 'system', requireSession: true }));

  ipcMain.handle('shell:openPath', wrap(async (_event, filePath: string) => {
    const safePath = await validateFsPath(filePath);
    // 拒绝可执行/脚本类文件：防止渲染层借本通道启动任意程序
    assertOpenablePath(safePath);
    const result = await shell.openPath(safePath);
    if (result) {
      throw new Error(result);
    }
  }, { moduleName: 'system', requireSession: true }));

  ipcMain.handle('shell:openExternal', wrap(async (_event, url: string) => {
    // 仅允许 http/https：此前 else 分支会把任意本地路径交给 shell.openPath，
    // 等于对外暴露"打开任意文件"原语（可执行任意程序）。外部链接一律走浏览器。
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('只允许打开 http/https 链接');
    }
    await shell.openExternal(url);
  }, { moduleName: 'system', requireSession: true }));

  ipcMain.handle('system:selectFile', wrap(async (_event, filters?: FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    // 同 dialog:showOpenDialog：登记用户亲手挑选的文件，供后续免拷贝读取
    authorizeUserFiles(result.filePaths);
    return result.filePaths[0];
  }, 'system'));

  ipcMain.handle('system:saveFile', wrap(async (_event, defaultPath?: string, filters?: FileFilter[]) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultPath || '',
      filters: filters || [],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath;
  }, 'system'));

  ipcMain.handle('system:backupData', wrap(async (_event, customPath?: string, password?: string) => {
    let backupPath: string;

    if (customPath) {
      const resolvedPath = path.resolve(customPath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      backupPath = resolvedPath.endsWith('.zip') ? resolvedPath : resolvedPath + '.zip';
    } else {
      const dataPath = await getAppDataPath();
      const backupDir = path.join(dataPath, 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      backupPath = path.join(backupDir, `backup_${timestamp}.zip`);
    }

    const result = await createFullBackup(backupPath, password);
    if (!result.success) {
      throw new Error(result.error || '备份失败');
    }

    return result.path || backupPath;
  }, { moduleName: 'system', requireSession: true }));

  ipcMain.handle('system:restoreData', wrap(async (_event, backupPath: string, options?: { incremental?: boolean; projectIds?: string[]; password?: string }) => {
    if (!fs.existsSync(backupPath)) {
      throw new Error('备份文件不存在');
    }
    
    const stats = fs.statSync(backupPath);
    if (!stats.isFile()) {
      throw new Error('备份路径不是文件');
    }

    const isZip = backupPath.endsWith('.zip');
    const isDb = backupPath.endsWith('.db') || backupPath.endsWith('.sqlite') || backupPath.endsWith('.sqlite3');

    if (!isZip && !isDb) {
      throw new Error('不支持的备份文件格式，请选择 .zip 或 .db 文件');
    }

    let result;

    if (isZip) {
      if (options?.incremental) {
        result = await restoreFromZipBackupIncremental(backupPath, options.projectIds, options.password);
      } else {
        result = await restoreFromZipBackup(backupPath, options?.password);
      }
    } else {
      result = await restoreFromLegacyBackup(backupPath);
    }

    if (!result.success) {
      throw new Error(result.error || '恢复失败');
    }

    setTimeout(() => {
      restartApp();
    }, 500);
  }, { moduleName: 'system', requireSession: true }));

  ipcMain.handle('system:previewBackup', wrap(async (_event, backupPath: string, password?: string) => {
    const preview = await previewZipBackup(backupPath, password);
    if (!preview) {
      return { success: false, error: '无法预览备份文件' };
    }
    return JSON.parse(JSON.stringify(preview));
  }, 'system'));

  /** 备份是否已加密：UI 用它决定恢复前是否需要弹口令输入 */
  ipcMain.handle('system:isBackupEncrypted', wrap(async (_event, backupPath: string) => {
    if (!fs.existsSync(backupPath)) {
      throw new Error('备份文件不存在');
    }
    return isBackupEncrypted(backupPath);
  }, { moduleName: 'system', requireSession: true }));

  ipcMain.handle('system:listBackups', wrap(async () => {
    const backups = await listBackups();
    return JSON.parse(JSON.stringify(backups));
  }, 'system'));

  ipcMain.handle('log:list', wrap(async (_event, params: { page?: number; pageSize?: number; module?: string; action?: string }) => {
    const db = getDb();
    const page = params.page || 1;
    const pageSize = params.pageSize || 50;
    const conditions = [];
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
  }, 'system'));

  // Dialog handlers
  ipcMain.handle('dialog:showOpenDialog', wrap(async (_event, options) => {
    const result = await dialog.showOpenDialog(options);
    // 登记「用户本次会话亲手挑选的文件」：后续读取这些文件（AI 分析附件等）
    // 不必拷贝进数据目录，也就不会让数据目录随使用不断增长。登记表由主进程写入，
    // 渲染层无法伪造，因此不构成「可读任意文件」的口子。
    if (!result.canceled && result.filePaths.length > 0) {
      authorizeUserFiles(result.filePaths);
    }
    return result;
  }, 'system'));

  ipcMain.handle('dialog:showSaveDialog', wrap(async (_event, options) => {
    const result = await dialog.showSaveDialog(options);
    return result;
  }, 'system'));

  ipcMain.handle('dialog:showMessageBox', wrap(async (_event, options) => {
    const result = await dialog.showMessageBox(options);
    return result;
  }, 'system'));

  // 文件系统操作
  ipcMain.handle('system:getPath', wrap((_event, name: string) => {
    const safeName = validatePathName(name);
    return app.getPath(safeName as Parameters<typeof app.getPath>[0]);
  }, 'system'));

  ipcMain.handle('fs:ensureDir', wrap(async (_event, dirPath: string) => {
    const safePath = await validateFsPath(dirPath, { forWrite: true });
    if (!fs.existsSync(safePath)) {
      fs.mkdirSync(safePath, { recursive: true });
    }
  }, 'system'));

  ipcMain.handle('fs:writeFile', wrap(async (_event, filePath: string, data: string | Uint8Array | Buffer) => {
    const safePath = await validateFsPath(filePath, { forWrite: true });
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (typeof data === 'string') {
      // 字符串：如果是纯二进制字节（UTF-16 码元 ≤ 0xFF）直接按 byte→byte 写；否则按 base64 解析
      // 此前历史：只做 Buffer.from(data,'base64')，当传入 Uint8Array 无法走 base64 时写出全空文件；
      // 现在新增 Uint8Array/Buffer 直接写分支。
      const isLikelyBase64 = /^[A-Za-z0-9+/=\s]+$/.test(data) && data.length % 4 === 0;
      if (isLikelyBase64) {
        const buffer = Buffer.from(data, 'base64');
        fs.writeFileSync(safePath, buffer);
      } else {
        // 非 base64 的字符串：按 UTF-8 文本落盘（安全兜底：避免写 base64 失败时误写为纯文本 "data:image..."）
        fs.writeFileSync(safePath, data, 'utf-8');
      }
    } else {
      // Uint8Array / Buffer：直接写
      fs.writeFileSync(safePath, Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array));
    }
  }, 'system'));

  // 读取文本文件（用于标准 JSON 导入等场景）
  ipcMain.handle('fs:readFile', wrap(async (_event, filePath: string) => {
    // 「读文件内容」的语义明确：只接受受管数据目录内的文件，或用户亲手挑选过（已登记）的文件。
    // 与 AI 附件、截图预览等通道保持同一套口径；调用方三条链路均为 dialog:showOpenDialog 返回值。
    const safePath = await validateReadablePath(filePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = fs.statSync(safePath);
    const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;
    if (stat.size > IMPORT_MAX_FILE_BYTES) {
      throw new Error(`文件过大（最大 ${(IMPORT_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB），请检查是否选错了文件`);
    }
    return fs.readFileSync(safePath, 'utf-8');
  }, 'system'));

  // 读取二进制文件为 base64（用于 Excel 标准导入等场景）
  ipcMain.handle('fs:readFileBase64', wrap(async (_event, filePath: string) => {
    const safePath = await validateReadablePath(filePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const stat = fs.statSync(safePath);
    const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;
    if (stat.size > IMPORT_MAX_FILE_BYTES) {
      throw new Error(`文件过大（最大 ${(IMPORT_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB），请检查是否选错了文件`);
    }
    return fs.readFileSync(safePath, 'base64');
  }, 'system'));

  // 写文本文件（utf-8，用于标准 JSON 导出等场景）
  ipcMain.handle('fs:writeTextFile', wrap(async (_event, filePath: string, data: string) => {
    const safePath = await validateFsPath(filePath, { forWrite: true });
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safePath, data, 'utf-8');
  }, 'system'));
}
