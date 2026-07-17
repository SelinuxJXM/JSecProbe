import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const compressing = require('compressing');
const AdmZip = require('adm-zip');
import Database from 'better-sqlite3';
import { getDbPath, getAppDataPath } from '../main/paths';
import { closeDb, getDb, walCheckpoint } from '../db';
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
      fs.copyFileSync(dbPath, path.join(tempBackupDir, 'mlps.db'));
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

    const dbPath = await getDbPath();

    if (fs.existsSync(dbPath)) {
      closeDb();
    }

    if (fs.existsSync(dbBackupPath)) {
      const tempPath = dbPath + '.restore_tmp';
      fs.copyFileSync(dbBackupPath, tempPath);
      fs.copyFileSync(tempPath, dbPath);
      fs.unlinkSync(tempPath);
    }

    for (const dirName of BACKUP_DIRS) {
      if (!manifest.contents[dirName]) continue;

      const srcDir = path.join(tempExtractPath, dirName);
      const destDir = path.join(dataPath, dirName);

      if (fs.existsSync(srcDir)) {
        if (fs.existsSync(destDir)) {
          fs.rmSync(destDir, { recursive: true, force: true });
        }
        fs.mkdirSync(destDir, { recursive: true });
        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const entry of entries) {
          const srcEntry = path.join(srcDir, entry.name);
          const destEntry = path.join(destDir, entry.name);
          if (entry.isDirectory()) {
            fs.cpSync(srcEntry, destEntry, { recursive: true });
          } else {
            fs.copyFileSync(srcEntry, destEntry);
          }
        }
      }
    }

    fs.rmSync(tempExtractPath, { recursive: true, force: true });

    log.info(`[恢复] 完整恢复完成: ${backupPath}`);

    return { success: true };
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
    fs.copyFileSync(backupPath, tempPath);

    const fd = fs.openSync(tempPath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    if (!buffer.toString('utf8').startsWith('SQLite format 3')) {
      fs.unlinkSync(tempPath);
      return { success: false, error: '无效的备份文件：不是SQLite数据库格式' };
    }

    closeDb();
    fs.copyFileSync(tempPath, dbPath);
    fs.unlinkSync(tempPath);

    return { success: true };
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
          const manifestEntry = zip.getEntry('manifest.json');
          if (manifestEntry) {
            const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
            timestamp = manifest.timestamp || '';
          }
        } catch {
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

    let backupDb: Database.Database;
    try {
      backupDb = new Database(dbBackupPath, { readonly: true });
    } catch {
      fs.rmSync(tempExtractPath, { recursive: true, force: true });
      return null;
    }

    const projects = backupDb.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[];
    const projectInfos: BackupProjectInfo[] = projects.map((p: any) => {
      const memberCount = backupDb.prepare('SELECT COUNT(*) as cnt FROM project_members WHERE project_id = ?').get(p.id) as any;
      const recordCount = backupDb.prepare('SELECT COUNT(*) as cnt FROM assessment_records WHERE project_id = ?').get(p.id) as any;
      const assetCount = backupDb.prepare('SELECT COUNT(*) as cnt FROM assets WHERE project_id = ?').get(p.id) as any;
      return {
        id: p.id,
        name: p.name,
        level: p.level,
        status: p.status,
        createdAt: p.created_at,
        memberCount: memberCount?.cnt || 0,
        recordCount: recordCount?.cnt || 0,
        assetCount: assetCount?.cnt || 0,
      };
    });

    const totalRecords = backupDb.prepare('SELECT COUNT(*) as cnt FROM assessment_records').get() as any;
    const totalAssets = backupDb.prepare('SELECT COUNT(*) as cnt FROM assets').get() as any;

    backupDb.close();
    fs.rmSync(tempExtractPath, { recursive: true, force: true });

    return {
      manifest,
      projects: projectInfos,
      totalRecords: totalRecords?.cnt || 0,
      totalAssets: totalAssets?.cnt || 0,
    };
  } catch {
    return null;
  }
}

export async function restoreFromZipBackupIncremental(
  backupPath: string,
  projectIds?: string[]
): Promise<BackupResult> {
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

      for (const project of projectsToRestore) {
        const existing = db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get();
        if (existing) {
          db.update(schema.projects)
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
          db.insert(schema.projects)
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
        const existing = db.select().from(schema.projectMembers).where(eq(schema.projectMembers.id, member.id)).get();
        if (!existing) {
          db.insert(schema.projectMembers)
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
        const existing = db.select().from(schema.assets).where(eq(schema.assets.id, asset.id)).get();
        if (existing) {
          db.update(schema.assets)
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
          db.insert(schema.assets)
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
        const existing = db.select().from(schema.assessmentRecords).where(eq(schema.assessmentRecords.id, record.id)).get();
        if (existing) {
          db.update(schema.assessmentRecords)
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
          db.insert(schema.assessmentRecords)
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
        const existing = db.select().from(schema.issues).where(eq(schema.issues.id, issue.id)).get();
        if (existing) {
          db.update(schema.issues)
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
          db.insert(schema.issues)
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

      backupDb.close();
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
    return { success: false, error: error.message || '恢复失败' };
  }
}
