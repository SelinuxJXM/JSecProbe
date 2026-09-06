import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const compressing = require('compressing');
const AdmZip = require('adm-zip');
import Database from 'better-sqlite3';
import { getDbPath, getAppDataPath } from '../main/paths';
import { join } from 'path';
import { closeDb, getDb, walCheckpoint, initDatabase } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import log from 'electron-log';

export interface BackupManifest {
  version: string;
  timestamp: string;
  contents: {
    database: boolean;
    screenshots: boolean;
    evidence: boolean;
    attachments: boolean;
    standards: boolean;
    templates: boolean;
    knowledge: boolean;
    logs: boolean;
  };
  totalSize: number;
}

export interface BackupResult {
  success: boolean;
  path?: string;
  size?: number;
  error?: string;
  mode?: 'full' | 'incremental';
  restoredProjectIds?: string[];
}

export interface BackupProjectInfo {
  id: string;
  name: string;
  level: number;
  status: string;
  createdAt: string;
  memberCount: number;
  recordCount: number;
  assetCount: number;
}

export interface BackupPreview {
  manifest: BackupManifest;
  projects: BackupProjectInfo[];
  totalRecords: number;
  totalAssets: number;
}

type ContentKey = 'screenshots' | 'evidence' | 'attachments' | 'standards' | 'templates' | 'knowledge' | 'logs';
const BACKUP_DIRS: ContentKey[] = ['screenshots', 'evidence', 'attachments', 'standards', 'templates', 'knowledge', 'logs'];

function getBackupRootPath(): Promise<string> {
  return getAppDataPath().then(p => path.join(p, 'backups'));
}

function validateExtractedPaths(extractDir: string): void {
  const resolvedBase = path.resolve(extractDir);
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
        throw new Error(`非法的 zip 条目路径: ${entry.name}`);
      }
      if (entry.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(fullPath);
        const resolvedTarget = path.resolve(path.dirname(fullPath), linkTarget);
        if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
          throw new Error(`非法的符号链接: ${entry.name} -> ${linkTarget}`);
        }
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  };
  walk(extractDir);
}

export async function createFullBackup(customPath?: string): Promise<BackupResult> {
  try {
    const dataPath = await getAppDataPath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    let backupFilePath: string;
    if (customPath) {
      backupFilePath = customPath.endsWith('.zip') ? customPath : customPath + '.zip';
    } else {
      const backupDir = await getBackupRootPath();
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      backupFilePath = path.join(backupDir, `backup_${timestamp}.zip`);
    }

    const dir = path.dirname(backupFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const manifest: BackupManifest = {
      version: '3.0',
      timestamp: new Date().toISOString(),
      contents: {
        database: false,
        screenshots: false,
        evidence: false,
        attachments: false,
        standards: false,
        templates: false,
        knowledge: false,
        logs: false,
      },
      totalSize: 0,
    };

    const tempBackupDir = path.join(dataPath, '.backup_staging');
    if (fs.existsSync(tempBackupDir)) {
      fs.rmSync(tempBackupDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempBackupDir, { recursive: true });

    const dbPath = await getDbPath();
    if (fs.existsSync(dbPath)) {
      // 强制将 WAL 中的更改写入主数据库文件，保证备份数据的完整性
      walCheckpoint();
      const backupDbPath = path.join(tempBackupDir, 'mlps.db');
      fs.copyFileSync(dbPath, backupDbPath);
      // 验证备份文件头，确保备份有效
      const fd = fs.openSync(backupDbPath, 'r');
      const buffer = Buffer.alloc(16);
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);
      if (!buffer.toString('utf8').startsWith('SQLite format 3')) {
        throw new Error('备份数据库文件头验证失败，备份可能不完整');
      }
      manifest.contents.database = true;
    }

    for (const dirName of BACKUP_DIRS) {
      const srcDir = path.join(dataPath, dirName);
      if (fs.existsSync(srcDir)) {
        const entries = fs.readdirSync(srcDir);
        if (entries.length > 0) {
          const destDir = path.join(tempBackupDir, dirName);
          fs.mkdirSync(destDir, { recursive: true });
          const dirEntries = fs.readdirSync(srcDir, { withFileTypes: true });
          for (const entry of dirEntries) {
            const srcEntry = path.join(srcDir, entry.name);
            const destEntry = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
              fs.cpSync(srcEntry, destEntry, { recursive: true });
            } else {
              fs.copyFileSync(srcEntry, destEntry);
            }
          }
          manifest.contents[dirName] = true;
        }
      }
    }

    fs.writeFileSync(
      path.join(tempBackupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    await compressing.zip.compressDir(tempBackupDir, backupFilePath);

    fs.rmSync(tempBackupDir, { recursive: true, force: true });

    const totalSize = fs.statSync(backupFilePath).size;
    manifest.totalSize = totalSize;

    log.info(`[备份] 完整备份完成: ${backupFilePath}, 大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

    return { success: true, path: backupFilePath, size: totalSize };
  } catch (error: any) {
    log.error('[备份] 完整备份失败:', error);
    return { success: false, error: error.message || '备份失败' };
  }
}

export async function restoreFromZipBackup(backupPath: string): Promise<BackupResult> {
  try {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: '备份文件不存在' };
    }

    if (!backupPath.endsWith('.zip')) {
      return { success: false, error: '备份文件必须是.zip格式' };
    }

    const dataPath = await getAppDataPath();
    const tempExtractPath = path.join(dataPath, '.restore_temp');

    if (fs.existsSync(tempExtractPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractPath, { recursive: true });

    try {
      await compressing.zip.uncompress(backupPath, tempExtractPath);
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: '备份文件解压失败，文件可能已损坏' };
    }

    try {
      validateExtractedPaths(tempExtractPath);
    } catch (e: any) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: e.message || '备份文件包含非法路径' };
    }

    let manifestPath = path.join(tempExtractPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const subDirs = fs.readdirSync(tempExtractPath, { withFileTypes: true })
        .filter((e: any) => e.isDirectory())
        .map((e: any) => e.name);
      if (subDirs.length === 1) {
        const nestedManifest = path.join(tempExtractPath, subDirs[0], 'manifest.json');
        if (fs.existsSync(nestedManifest)) {
          const nestedDir = path.join(tempExtractPath, subDirs[0]);
          const entries = fs.readdirSync(nestedDir, { withFileTypes: true });
          for (const entry of entries) {
            const srcEntry = path.join(nestedDir, entry.name);
            const destEntry = path.join(tempExtractPath, entry.name);
            if (entry.isDirectory()) {
              fs.cpSync(srcEntry, destEntry, { recursive: true });
            } else {
              fs.copyFileSync(srcEntry, destEntry);
            }
          }
          fs.rmSync(nestedDir, { recursive: true, force: true });
          manifestPath = path.join(tempExtractPath, 'manifest.json');
        }
      }
    }

    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: '备份文件中缺少 manifest.json，不是有效的备份' };
    }

    let manifest: BackupManifest;
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: 'manifest.json 解析失败，备份可能已损坏' };
    }

    if (!manifest.version || !manifest.contents) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: '备份清单格式无效' };
    }

    const dbBackupPath = path.join(tempExtractPath, 'mlps.db');
    if (fs.existsSync(dbBackupPath)) {
      const fd = fs.openSync(dbBackupPath, 'r');
      const buffer = Buffer.alloc(16);
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);
      if (!buffer.toString('utf8').startsWith('SQLite format 3')) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
        return { success: false, error: '备份数据库文件格式无效' };
      }
    }

    // 预校验：清单声明的内容必须真实存在于备份中
    // 否则恢复中途才发现缺失会导致"数据库已替换但目录缺失"或反向的数据不一致，甚至永久丢失线上数据
    if (manifest.contents.database && !fs.existsSync(dbBackupPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: '备份内容不完整：清单声明包含数据库但缺少 mlps.db，已取消恢复' };
    }
    for (const dirName of BACKUP_DIRS) {
      if (manifest.contents[dirName] && !fs.existsSync(path.join(tempExtractPath, dirName))) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
        return { success: false, error: `备份内容不完整：缺少 ${dirName} 目录，已取消恢复` };
      }
    }

    const dbPath = await getDbPath();
    const rollbackDbPath = dbPath + '.rollback';
    let dbReplaced = false;
    let originalDbExisted = false;
    let dbClosed = false;
    // 目录回滚记录：original 为线上目录，backup 为换名保留的原目录（*.restore_bak）
    // 声明在 try 之外，供 catch 回滚使用
    const backedUpDirs: Array<{ original: string; backup: string }> = [];
    // 已成功移入位的新目录，回滚时需先移除
    const restoredDirs: string[] = [];

    try {
      if (fs.existsSync(dbPath)) {
        originalDbExisted = true;
        closeDb();
        dbClosed = true;
        // 创建回滚点：将当前数据库复制到安全位置，恢复失败时可回滚
        if (fs.existsSync(rollbackDbPath)) {
          fs.unlinkSync(rollbackDbPath);
        }
        fs.copyFileSync(dbPath, rollbackDbPath);
      }

      if (fs.existsSync(dbBackupPath)) {
        const tempNewPath = dbPath + '.new';
        fs.copyFileSync(dbBackupPath, tempNewPath);
        if (fs.existsSync(dbPath)) {
          const bakPath = dbPath + '.bak';
          if (fs.existsSync(bakPath)) {
            fs.unlinkSync(bakPath);
          }
          fs.renameSync(dbPath, bakPath);
        }
        fs.renameSync(tempNewPath, dbPath);
        dbReplaced = true;
      }

      // 目录替换采用 rename 原子换位：先把线上目录改名保留为 *.restore_bak，再把备份目录整体移入位
      // 任一环节失败都可按记录反向回滚，不会出现"已删除旧数据但新数据不完整"的窗口
      for (const dirName of BACKUP_DIRS) {
        if (!manifest.contents[dirName]) continue;

        const srcDir = path.join(tempExtractPath, dirName);
        const destDir = path.join(dataPath, dirName);

        if (fs.existsSync(destDir)) {
          const backupDirPath = destDir + '.restore_bak';
          if (fs.existsSync(backupDirPath)) {
            fs.rmSync(backupDirPath, { recursive: true, force: true });
          }
          fs.renameSync(destDir, backupDirPath);
          backedUpDirs.push({ original: destDir, backup: backupDirPath });
        }
        fs.renameSync(srcDir, destDir);
        restoredDirs.push(destDir);
      }

      // 恢复成功，清理回滚文件
      if (fs.existsSync(rollbackDbPath)) {
        fs.unlinkSync(rollbackDbPath);
      }

      fs.rmSync(tempExtractPath, { recursive: true, force: true });

      log.info(`[恢复] 完整恢复完成: ${backupPath}`);

      await initDatabase();

      return { success: true };
    } catch (restoreError: any) {
      // 恢复失败，尝试回滚：先撤销目录换位，再回滚数据库，最后重新打开数据库连接
      log.error(`[恢复] 恢复失败，尝试回滚: ${restoreError.message}`);

      // 反向回滚目录：先移除已换入的新目录，再把 *.restore_bak 改名回原位
      for (const restored of restoredDirs.slice().reverse()) {
        try {
          fs.rmSync(restored, { recursive: true, force: true });
        } catch (rmErr: any) {
          log.error(`[恢复] 回滚时移除新目录失败: ${restored}, ${rmErr.message}`);
        }
      }
      for (const item of backedUpDirs.slice().reverse()) {
        try {
          if (fs.existsSync(item.original)) {
            // 原位已被占用（极少见），先移除再回滚
            fs.rmSync(item.original, { recursive: true, force: true });
          }
          if (fs.existsSync(item.backup)) {
            fs.renameSync(item.backup, item.original);
            log.info(`[恢复] 目录已回滚: ${item.original}`);
          }
        } catch (dirRollbackErr: any) {
          log.error(`[恢复] 目录回滚失败: ${item.original}, ${dirRollbackErr.message}`);
        }
      }

      if (dbReplaced && originalDbExisted && fs.existsSync(rollbackDbPath)) {
        try {
          if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
          }
          fs.copyFileSync(rollbackDbPath, dbPath);
          log.info('[恢复] 数据库已回滚到恢复前状态');
        } catch (rollbackErr: any) {
          log.error(`[恢复] 回滚失败: ${rollbackErr.message}`);
        }
      }

      // 清理回滚文件
      if (fs.existsSync(rollbackDbPath)) {
        fs.unlinkSync(rollbackDbPath);
      }

      // 数据库连接已在此前 closeDb 时关闭，必须重新初始化，否则恢复失败后应用将无法访问数据库
      if (dbClosed) {
        try {
          await initDatabase();
          log.info('[恢复] 数据库连接已重新初始化');
        } catch (initErr: any) {
          log.error(`[恢复] 数据库重新初始化失败: ${initErr.message}`);
        }
      }

      throw restoreError;
    }
  } catch (error: any) {
    log.error('[恢复] 完整恢复失败:', error);
    return { success: false, error: error.message || '恢复失败' };
  }
}

export async function restoreFromLegacyBackup(backupPath: string): Promise<BackupResult> {
  try {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: '备份文件不存在' };
    }

    const stats = fs.statSync(backupPath);
    if (!stats.isFile()) {
      return { success: false, error: '备份路径不是文件' };
    }

    if (backupPath.endsWith('.db') && stats.size > 2 * 1024 * 1024 * 1024) {
      return { success: false, error: '备份文件过大 (最大2GB)' };
    }

    const dbPath = await getDbPath();
    const tempPath = dbPath + '.tmp';
    const rollbackPath = dbPath + '.rollback';
    fs.copyFileSync(backupPath, tempPath);

    const fd = fs.openSync(tempPath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    if (!buffer.toString('utf8').startsWith('SQLite format 3')) {
      fs.unlinkSync(tempPath);
      return { success: false, error: '无效的备份文件：不是SQLite数据库格式' };
    }

    // 创建回滚点：替换前先保留当前数据库，失败时可恢复
    if (fs.existsSync(rollbackPath)) {
      fs.unlinkSync(rollbackPath);
    }
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, rollbackPath);
    }

    closeDb();

    try {
      // tempPath 与 dbPath 同目录，直接原子换名替换，避免 copyFileSync 中途失败把原库覆盖成半成品
      fs.renameSync(tempPath, dbPath);

      if (fs.existsSync(rollbackPath)) {
        fs.unlinkSync(rollbackPath);
      }

      await initDatabase();

      return { success: true };
    } catch (restoreError: any) {
      log.error(`[恢复] 旧版恢复失败，尝试回滚: ${restoreError.message}`);

      if (fs.existsSync(rollbackPath)) {
        try {
          if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
          }
          fs.copyFileSync(rollbackPath, dbPath);
          log.info('[恢复] 数据库已回滚到恢复前状态');
        } catch (rollbackErr: any) {
          log.error(`[恢复] 回滚失败: ${rollbackErr.message}`);
        }
        try { fs.unlinkSync(rollbackPath); } catch { /* 忽略 */ }
      }

      try { fs.unlinkSync(tempPath); } catch { /* 忽略 */ }

      // closeDb 之后必须重新初始化数据库连接，否则应用后续所有数据库操作都会抛错
      try {
        await initDatabase();
      } catch (initErr: any) {
        log.error(`[恢复] 恢复失败后重新初始化数据库失败: ${initErr.message}`);
      }

      throw restoreError;
    }
  } catch (error: any) {
    return { success: false, error: error.message || '恢复失败' };
  }
}

export async function listBackups(): Promise<Array<{ name: string; path: string; size: number; timestamp: string }>> {
  try {
    const backupDir = await getBackupRootPath();
    if (!fs.existsSync(backupDir)) {
      return [];
    }

    const entries = fs.readdirSync(backupDir, { withFileTypes: true });
    const backups = entries
      .filter((e: any) => e.isFile() && e.name.startsWith('backup_') && e.name.endsWith('.zip'))
      .map((e: any) => {
        const filePath = path.join(backupDir, e.name);
        let timestamp = '';
        try {
          const zip = new AdmZip(filePath);
          let manifestEntry = zip.getEntry('manifest.json');
          if (!manifestEntry) {
            manifestEntry = zip.getEntry('.backup_staging/manifest.json');
          }
          if (manifestEntry) {
            const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
            timestamp = manifest.timestamp || '';
          }
        } catch {
        }
        if (!timestamp) {
          const m = e.name.match(/^backup_(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.zip$/);
          if (m) {
            const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
            if (!Number.isNaN(d.getTime())) {
              timestamp = d.toISOString();
            }
          }
        }
        return {
          name: e.name,
          path: filePath,
          size: fs.statSync(filePath).size,
          timestamp,
        };
      })
      .sort((a: any, b: any) => b.name.localeCompare(a.name));

    return backups;
  } catch {
    return [];
  }
}

export async function previewZipBackup(backupPath: string): Promise<BackupPreview | null> {
  try {
    if (!fs.existsSync(backupPath) || !backupPath.endsWith('.zip')) {
      return null;
    }

    const dataPath = await getAppDataPath();
    const tempExtractPath = path.join(dataPath, '.preview_temp');

    if (fs.existsSync(tempExtractPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractPath, { recursive: true });

    try {
      await compressing.zip.uncompress(backupPath, tempExtractPath);
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return null;
    }

    try {
      validateExtractedPaths(tempExtractPath);
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return null;
    }

    let manifestPath = path.join(tempExtractPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const subDirs = fs.readdirSync(tempExtractPath, { withFileTypes: true })
        .filter((e: any) => e.isDirectory())
        .map((e: any) => e.name);
      if (subDirs.length === 1) {
        const nestedManifest = path.join(tempExtractPath, subDirs[0], 'manifest.json');
        if (fs.existsSync(nestedManifest)) {
          const nestedDir = path.join(tempExtractPath, subDirs[0]);
          const entries = fs.readdirSync(nestedDir, { withFileTypes: true });
          for (const entry of entries) {
            const srcEntry = path.join(nestedDir, entry.name);
            const destEntry = path.join(tempExtractPath, entry.name);
            if (entry.isDirectory()) {
              fs.cpSync(srcEntry, destEntry, { recursive: true });
            } else {
              fs.copyFileSync(srcEntry, destEntry);
            }
          }
          fs.rmSync(nestedDir, { recursive: true, force: true });
          manifestPath = path.join(tempExtractPath, 'manifest.json');
        }
      }
    }

    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return null;
    }

    let manifest: BackupManifest;
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return null;
    }

    const dbBackupPath = path.join(tempExtractPath, 'mlps.db');
    if (!fs.existsSync(dbBackupPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return null;
    }

    let backupDb: Database.Database | null = null;
    try {
      backupDb = new Database(dbBackupPath, { readonly: true });

      const projects = backupDb.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[];
      const projectInfos: BackupProjectInfo[] = projects.map((p: any) => {
        const counts = backupDb!.prepare(`
          SELECT
            (SELECT COUNT(*) FROM project_members WHERE project_id = ?) as member_count,
            (SELECT COUNT(*) FROM assessment_records WHERE project_id = ?) as record_count,
            (SELECT COUNT(*) FROM assets WHERE project_id = ?) as asset_count
        `).get(p.id, p.id, p.id) as any;
        return {
          id: p.id,
          name: p.name,
          level: p.level,
          status: p.status,
          createdAt: p.created_at,
          memberCount: counts?.member_count || 0,
          recordCount: counts?.record_count || 0,
          assetCount: counts?.asset_count || 0,
        };
      });

      const totalRecords = backupDb.prepare('SELECT COUNT(*) as cnt FROM assessment_records').get() as any;
      const totalAssets = backupDb.prepare('SELECT COUNT(*) as cnt FROM assets').get() as any;

      backupDb.close();
      backupDb = null;

      fs.rmSync(tempExtractPath, { recursive: true, force: true });

      return {
        manifest,
        projects: projectInfos,
        totalRecords: totalRecords?.cnt || 0,
        totalAssets: totalAssets?.cnt || 0,
      };
    } catch {
      if (backupDb) {
        try {
          backupDb.close();
        } catch (closeErr) {
          log.warn('预览备份时关闭数据库连接失败:', closeErr);
        }
      }
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return null;
    }
  } catch {
    return null;
  }
}

export async function restoreFromZipBackupIncremental(
  backupPath: string,
  projectIds?: string[]
): Promise<BackupResult> {
  // 声明在函数作用域，供 try 与 catch 共用：恢复失败时 catch 需要清理临时目录并关闭备份库句柄
  // （try 块内声明的变量在 catch 中不可见，因此回滚相关变量必须提升到函数作用域，与全量恢复一致）
  let tempExtractPath = '';
  try {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: '备份文件不存在' };
    }

    if (!backupPath.endsWith('.zip')) {
      return { success: false, error: '备份文件必须是.zip格式' };
    }

    const dataPath = await getAppDataPath();
    tempExtractPath = path.join(dataPath, '.restore_temp');

    if (fs.existsSync(tempExtractPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractPath, { recursive: true });

    try {
      await compressing.zip.uncompress(backupPath, tempExtractPath);
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: '备份文件解压失败，文件可能已损坏' };
    }

    try {
      validateExtractedPaths(tempExtractPath);
    } catch (e: any) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: e.message || '备份文件包含非法路径' };
    }

    let manifestPath = path.join(tempExtractPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const subDirs = fs.readdirSync(tempExtractPath, { withFileTypes: true })
        .filter((e: any) => e.isDirectory())
        .map((e: any) => e.name);
      if (subDirs.length === 1) {
        const nestedManifest = path.join(tempExtractPath, subDirs[0], 'manifest.json');
        if (fs.existsSync(nestedManifest)) {
          const nestedDir = path.join(tempExtractPath, subDirs[0]);
          const entries = fs.readdirSync(nestedDir, { withFileTypes: true });
          for (const entry of entries) {
            const srcEntry = path.join(nestedDir, entry.name);
            const destEntry = path.join(tempExtractPath, entry.name);
            if (entry.isDirectory()) {
              fs.cpSync(srcEntry, destEntry, { recursive: true });
            } else {
              fs.copyFileSync(srcEntry, destEntry);
            }
          }
          fs.rmSync(nestedDir, { recursive: true, force: true });
          manifestPath = path.join(tempExtractPath, 'manifest.json');
        }
      }
    }

    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: '备份文件中缺少 manifest.json，不是有效的备份' };
    }

    let manifest: BackupManifest;
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: 'manifest.json 解析失败，备份可能已损坏' };
    }

    if (!manifest.version || !manifest.contents) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return { success: false, error: '备份清单格式无效' };
    }

    const dbBackupPath = path.join(tempExtractPath, 'mlps.db');
    let restoredProjectIds: string[] = [];

    if (fs.existsSync(dbBackupPath)) {
      const fd = fs.openSync(dbBackupPath, 'r');
      const buffer = Buffer.alloc(16);
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);
      if (!buffer.toString('utf8').startsWith('SQLite format 3')) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
        return { success: false, error: '备份数据库文件格式无效' };
      }

      let backupDb: Database.Database;
      try {
        backupDb = new Database(dbBackupPath, { readonly: true });
      } catch {
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
        return { success: false, error: '无法打开备份数据库' };
      }

      try {
        const db = getDb();

      let projectsToRestore: any[];
      if (projectIds && projectIds.length > 0) {
        const placeholders = projectIds.map(() => '?').join(',');
        projectsToRestore = backupDb.prepare(`SELECT * FROM projects WHERE id IN (${placeholders})`).all(...projectIds) as any[];
      } else {
        projectsToRestore = backupDb.prepare('SELECT * FROM projects').all() as any[];
      }

      if (projectsToRestore.length === 0) {
        backupDb.close();
        fs.rmSync(tempExtractPath, { recursive: true, force: true });
        return { success: false, error: '备份中没有找到要恢复的项目' };
      }

      const backupProjectIds = projectsToRestore.map((p: any) => p.id);

      // 所有数据库恢复操作包裹在事务中，保证原子性（中途失败自动回滚）
      db.transaction((tx) => {
        for (const project of projectsToRestore) {
          const existing = tx.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get();
          if (existing) {
            tx.update(schema.projects)
              .set({
                name: project.name,
                projectNo: project.project_no,
                systemName: project.system_name,
                assessedUnit: project.assessed_unit,
                standardSystem: project.standard_system,
                levelCombo: project.level_combo,
                extensionType: project.extension_type,
                customerName: project.customer_name,
                assessor: project.assessor,
                startDate: project.start_date,
                endDate: project.end_date,
                description: project.description,
                level: project.level,
                status: project.status,
                standardId: project.standard_id,
                progress: project.progress,
                complianceRate: project.compliance_rate,
                assetCount: project.asset_count,
                updatedAt: project.updated_at,
              })
              .where(eq(schema.projects.id, project.id))
              .run();
          } else {
            tx.insert(schema.projects)
              .values({
                id: project.id,
                name: project.name,
                projectNo: project.project_no,
                systemName: project.system_name,
                assessedUnit: project.assessed_unit,
                standardSystem: project.standard_system,
                levelCombo: project.level_combo,
                extensionType: project.extension_type,
                customerName: project.customer_name,
                assessor: project.assessor,
                startDate: project.start_date,
                endDate: project.end_date,
                description: project.description,
                level: project.level,
                status: project.status,
                standardId: project.standard_id,
                progress: project.progress || 0,
                complianceRate: project.compliance_rate,
                assetCount: project.asset_count || 0,
                createdAt: project.created_at,
                updatedAt: project.updated_at,
              })
              .run();
          }
          restoredProjectIds.push(project.id);
        }

        const members = backupDb.prepare(`SELECT * FROM project_members WHERE project_id IN (${backupProjectIds.map(() => '?').join(',')})`).all(...backupProjectIds) as any[];
        for (const member of members) {
          const existing = tx.select().from(schema.projectMembers).where(eq(schema.projectMembers.id, member.id)).get();
          if (!existing) {
            tx.insert(schema.projectMembers)
              .values({
                id: member.id,
                projectId: member.project_id,
                userId: member.user_id,
                role: member.role,
                createdAt: member.created_at,
              })
              .run();
          }
        }

        const assets = backupDb.prepare(`SELECT * FROM assets WHERE project_id IN (${backupProjectIds.map(() => '?').join(',')})`).all(...backupProjectIds) as any[];
        for (const asset of assets) {
          const existing = tx.select().from(schema.assets).where(eq(schema.assets.id, asset.id)).get();
          if (existing) {
            tx.update(schema.assets)
              .set({
                name: asset.name,
                category: asset.category,
                os: asset.os,
                version: asset.version,
                deviceUsage: asset.device_usage,
                description: asset.description,
                quantity: asset.quantity,
                ip: asset.ip,
                importance: asset.importance,
                isVirtual: asset.is_virtual,
                dbSystem: asset.db_system,
                middleware: asset.middleware,
                isAssessmentTarget: asset.is_assessment_target,
                position: asset.position,
                responsiblePerson: asset.responsible_person,
                sortOrder: asset.sort_order,
                updatedAt: asset.updated_at,
              })
              .where(eq(schema.assets.id, asset.id))
              .run();
          } else {
            tx.insert(schema.assets)
              .values({
                id: asset.id,
                projectId: asset.project_id,
                name: asset.name,
                category: asset.category,
                os: asset.os,
                version: asset.version,
                deviceUsage: asset.device_usage,
                description: asset.description,
                quantity: asset.quantity || 1,
                ip: asset.ip,
                importance: asset.importance || 'medium',
                isVirtual: asset.is_virtual || 0,
                dbSystem: asset.db_system,
                middleware: asset.middleware,
                isAssessmentTarget: asset.is_assessment_target || 1,
                position: asset.position,
                responsiblePerson: asset.responsible_person,
                sortOrder: asset.sort_order || 0,
                createdAt: asset.created_at,
                updatedAt: asset.updated_at,
              })
              .run();
          }
        }

        const records = backupDb.prepare(`SELECT * FROM assessment_records WHERE project_id IN (${backupProjectIds.map(() => '?').join(',')})`).all(...backupProjectIds) as any[];
        for (const record of records) {
          const existing = tx.select().from(schema.assessmentRecords).where(eq(schema.assessmentRecords.id, record.id)).get();
          if (existing) {
            tx.update(schema.assessmentRecords)
              .set({
                result: record.result,
                evidence: record.evidence,
                findings: record.findings,
                method: record.method,
                commandOutput: record.command_output,
                screenshotPaths: record.screenshot_paths,
                assessmentDate: record.assessment_date,
                updatedAt: record.updated_at,
              })
              .where(eq(schema.assessmentRecords.id, record.id))
              .run();
          } else {
            tx.insert(schema.assessmentRecords)
              .values({
                id: record.id,
                projectId: record.project_id,
                itemId: record.item_id,
                assetId: record.asset_id || null,
                result: record.result,
                evidence: record.evidence,
                findings: record.findings,
                method: record.method,
                commandOutput: record.command_output,
                screenshotPaths: record.screenshot_paths,
                assessmentDate: record.assessment_date,
                createdAt: record.created_at,
                updatedAt: record.updated_at,
              })
              .run();
          }
        }

        const issues = backupDb.prepare(`SELECT * FROM issues WHERE project_id IN (${backupProjectIds.map(() => '?').join(',')})`).all(...backupProjectIds) as any[];
        for (const issue of issues) {
          const existing = tx.select().from(schema.issues).where(eq(schema.issues.id, issue.id)).get();
          if (existing) {
            tx.update(schema.issues)
              .set({
                issueTitle: issue.issue_title,
                issueDescription: issue.issue_description,
                riskLevel: issue.risk_level,
                status: issue.status,
                rectificationSuggestion: issue.rectification_suggestion,
                rectificationDeadline: issue.rectification_deadline,
                responsiblePerson: issue.responsible_person,
                fixedDescription: issue.fixed_description,
                fixedDate: issue.fixed_date,
                assessor: issue.assessor,
                evidenceFiles: issue.evidence_files,
                updatedAt: issue.updated_at,
              })
              .where(eq(schema.issues.id, issue.id))
              .run();
          } else {
            tx.insert(schema.issues)
              .values({
                id: issue.id,
                projectId: issue.project_id,
                assetId: issue.asset_id,
                itemId: issue.item_id,
                securityDomain: issue.security_domain,
                controlPoint: issue.control_point,
                controlName: issue.control_name,
                issueTitle: issue.issue_title,
                issueDescription: issue.issue_description,
                riskLevel: issue.risk_level || 'medium',
                status: issue.status || 'pending',
                rectificationSuggestion: issue.rectification_suggestion,
                rectificationDeadline: issue.rectification_deadline,
                responsiblePerson: issue.responsible_person,
                fixedDescription: issue.fixed_description,
                fixedDate: issue.fixed_date,
                assessor: issue.assessor,
                evidenceFiles: issue.evidence_files,
                createdAt: issue.created_at,
                updatedAt: issue.updated_at,
              })
              .run();
          }
        }
      });
      } finally {
        backupDb.close();
      }

      log.info(`[增量恢复] 数据库恢复完成，共恢复 ${restoredProjectIds.length} 个项目`);
    }

    for (const dirName of BACKUP_DIRS) {
      if (!manifest.contents[dirName]) continue;

      const srcDir = path.join(tempExtractPath, dirName);
      const destDir = path.join(dataPath, dirName);

      if (fs.existsSync(srcDir)) {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const entry of entries) {
          const srcEntry = path.join(srcDir, entry.name);
          const destEntry = path.join(destDir, entry.name);
          if (entry.isDirectory()) {
            if (!fs.existsSync(destEntry)) {
              fs.cpSync(srcEntry, destEntry, { recursive: true });
            } else {
              const subEntries = fs.readdirSync(srcEntry, { withFileTypes: true });
              for (const subEntry of subEntries) {
                const srcSub = path.join(srcEntry, subEntry.name);
                const destSub = path.join(destEntry, subEntry.name);
                if (subEntry.isDirectory()) {
                  if (!fs.existsSync(destSub)) {
                    fs.cpSync(srcSub, destSub, { recursive: true });
                  }
                } else {
                  fs.copyFileSync(srcSub, destSub);
                }
              }
            }
          } else {
            fs.copyFileSync(srcEntry, destEntry);
          }
        }
      }
    }

    fs.rmSync(tempExtractPath, { recursive: true, force: true });

    log.info(`[增量恢复] 完整恢复完成: ${backupPath}`);

    return { success: true, mode: 'incremental', restoredProjectIds };
  } catch (error: any) {
    log.error('[增量恢复] 失败:', error);
    // 清理解压临时目录，避免残留的 .restore_temp 污染数据目录
    // （备份数据库句柄已在上方 try/finally 中关闭，无需在此处理）
    if (fs.existsSync(tempExtractPath)) {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
    }
    return { success: false, error: error.message || '恢复失败' };
  }
}

export async function checkAndPerformAutoBackup(): Promise<void> {
  try {
    const db = getDb();
    const settings = await db.query.systemSettings.findFirst();
    if (!settings || settings.autoBackupEnabled !== 1) {
      return;
    }

    const backupPath = await getBackupRootPath();
    if (!fs.existsSync(backupPath)) {
      fs.mkdirSync(backupPath, { recursive: true });
    }

    const files = fs.readdirSync(backupPath)
      .filter((f: string) => f.endsWith('.db') || f.endsWith('.zip'))
      .map((f: string) => {
        const stat = fs.statSync(join(backupPath, f));
        return { name: f, mtime: stat.mtime.getTime() };
      })
      .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);

    if (files.length > 0) {
      const lastBackupTime = files[0].mtime;
      const now = Date.now();
      const daysSinceLast = (now - lastBackupTime) / (1000 * 60 * 60 * 24);
      if (daysSinceLast < (settings.autoBackupDays || 7)) {
        return;
      }
    }

    const result = await createFullBackup();
    if (result.success) {
      log.info('自动备份完成');
    }
  } catch (error) {
    log.error('自动备份失败:', error);
  }
}
