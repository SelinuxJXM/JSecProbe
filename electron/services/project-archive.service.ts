/**
 * 项目归档服务：把「一个项目相关的全部数据」打包带走 / 完整还原。
 *
 * 与系统级备份（`backup.service.ts`）的区别：
 * - 系统备份 = 整库文件 + 整个数据目录，用于整机迁移/灾备；
 * - 项目归档 = **按项目维度**挑选数据行 + 该项目真正引用到的附件文件，
 *   用于"把某个项目交给同事"、"换台机器继续做这一个项目"、"误删后单项目恢复"。
 *
 * 归档包结构（zip，可选 AES-256-GCM 整体加密）：
 *   manifest.json  —— 包类型/版本/项目摘要/附件数
 *   data.json      —— 全部数据行 + fileMap（原路径字段值 → 包内相对路径）
 *   files/         —— 附件（按 screenshots / evidence / attachments… 分子目录）
 *
 * 两个刻意的取舍：
 * 1. **连接配置口令默认不带走**：凭据经 safeStorage（Windows DPAPI / 系统钥匙串）加密，
 *    与机器和用户绑定，换机后密文本身就解不开；而归档包常被外发给他人，
 *    带着密文出包只会给人虚假的安全感。需要同机恢复口令时显式传 includeCredentials。
 * 2. **依赖标准随包带走**：测评记录的 item_id 指向 assessment_items，
 *    若目标库没有对应标准，恢复出来的记录会变成"没有题干的孤儿"，测评页直接空白。
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { app } from 'electron';
import log from 'electron-log';
import { eq, inArray } from 'drizzle-orm';

const require = createRequire(import.meta.url);
const compressing = require('compressing');
const AdmZip = require('adm-zip');

import { getDb } from '../db';
import * as schema from '../db/schema';
import { getAppDataPath } from '../main/paths';
import { resolvePath } from '../utils/path-resolver';
import { openBackupZip, sealZipFile, isEncryptedBackupFile, MIN_BACKUP_PASSWORD_LENGTH } from './backup-crypto';

const ARCHIVE_KIND = 'jsec-project-archive';
const ARCHIVE_VERSION = '1.0';
const SUPPORTED_ARCHIVE_VERSIONS = ['1.0'];

/** 附件可落入的数据子目录白名单（防止归档包内的目录名把文件写到任意位置） */
const ALLOWED_FILE_DIRS = ['screenshots', 'evidence', 'attachments', 'templates', 'knowledge', 'standards'];

type Row = Record<string, any>;

export interface ArchiveProjectSummary {
  id: string;
  name: string;
  systemName: string;
  level: number;
  status: string;
  createdAt: string;
  assetCount: number;
  recordCount: number;
  issueCount: number;
  taskCount: number;
}

export interface ProjectArchiveManifest {
  kind: string;
  version: string;
  appVersion: string;
  createdAt: string;
  projects: ArchiveProjectSummary[];
  counts: {
    assets: number;
    records: number;
    issues: number;
    tasks: number;
    results: number;
    documents: number;
    members: number;
    connections: number;
    standards: number;
    items: number;
    files: number;
  };
  includeStandards: boolean;
  credentialsIncluded: boolean;
  encrypted: boolean;
}

export interface ProjectArchiveData {
  projects: Row[];
  projectMembers: Row[];
  assets: Row[];
  connectionProfiles: Row[];
  assetConnections: Row[];
  assessmentRecords: Row[];
  issues: Row[];
  collectionTasks: Row[];
  collectionResults: Row[];
  collectionDocuments: Row[];
  standards: Row[];
  assessmentItems: Row[];
  /** 原始路径字段值 → 包内相对路径（files/…）。导入时据此还原并重写引用 */
  fileMap: Record<string, string>;
}

export interface ExportArchiveOptions {
  projectIds: string[];
  destPath: string;
  password?: string;
  includeStandards?: boolean;
  includeCredentials?: boolean;
}

export interface ExportArchiveResult {
  success: boolean;
  path?: string;
  size?: number;
  fileCount?: number;
  /** 引用了但磁盘上已不存在的附件（数据行仍会导出，仅提示） */
  missingFiles?: string[];
  error?: string;
}

export interface ArchivePreviewProject extends ArchiveProjectSummary {
  existsLocally: boolean;
  /** 本地同名项目的名称（用于提示"会覆盖谁"） */
  localName?: string;
}

export interface PreviewArchiveResult {
  success: boolean;
  manifest?: ProjectArchiveManifest;
  projects?: ArchivePreviewProject[];
  encrypted?: boolean;
  warnings?: string[];
  error?: string;
}

export type ImportConflictStrategy = 'skip' | 'overwrite' | 'copy';

export interface ImportArchiveOptions {
  archivePath: string;
  password?: string;
  strategy: ImportConflictStrategy;
}

export interface ImportArchiveResult {
  success: boolean;
  imported: Array<{ id: string; name: string; mode: 'new' | 'overwrite' | 'copy' }>;
  skipped: string[];
  restoredFiles: number;
  missingFiles: number;
  warnings: string[];
  error?: string;
}

// ============ 通用小工具 ============

function parsePathList(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string' && !!x);
  } catch {
    // 非 JSON（单个路径字符串）：按单元素处理
  }
  return [raw];
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 为附件分配包内路径：files/<白名单子目录>/<文件名>，重名自动加后缀 */
function allocateArchivePath(
  usedPaths: Set<string>,
  topDir: string,
  baseName: string,
): string {
  let candidate = `files/${topDir}/${baseName}`;
  if (!usedPaths.has(candidate)) {
    usedPaths.add(candidate);
    return candidate;
  }
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let n = 1;
  do {
    candidate = `files/${topDir}/${stem}_${n}${ext}`;
    n++;
  } while (usedPaths.has(candidate));
  usedPaths.add(candidate);
  return candidate;
}

/**
 * 按文件名在包内查找条目。
 * 有些压缩工具会把最外层目录名一起打进包（如 `<dirname>/manifest.json`），
 * 直接按路径取会取不到 —— 这里退化到"按文件名匹配"，保证这类包也能读。
 */
function findZipEntry(zip: any, fileName: string): any {
  const direct = zip.getEntry(fileName);
  if (direct) return direct;
  return (zip.getEntries?.() || []).find((e: any) => toPosix(e.entryName || '').split('/').pop() === fileName);
}

/** 目标位置已被占用时换一个不冲突的文件名（name_1.png、name_2.png…） */
function uniqueTargetPath(dir: string, baseName: string): string {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let n = 1;
  let candidate: string;
  do {
    candidate = path.join(dir, `${stem}_${n}${ext}`);
    n++;
  } while (fs.existsSync(candidate));
  return candidate;
}

/** 定位解压后的附件（同样兼容包内多一层顶层目录的情况） */
function locateExtractedFile(extractDir: string, archiveRel: string): string | null {
  const parts = toPosix(archiveRel).split('/');
  const direct = path.join(extractDir, ...parts);
  if (fs.existsSync(direct)) return direct;
  try {
    for (const top of fs.readdirSync(extractDir, { withFileTypes: true })) {
      if (!top.isDirectory()) continue;
      const alt = path.join(extractDir, top.name, ...parts);
      if (fs.existsSync(alt)) return alt;
    }
  } catch {
    /* 目录不可读时按缺失处理 */
  }
  return null;
}

function assertSafeZipEntries(zip: any): void {
  const entries = (zip.getEntries?.() || []) as Array<{ entryName: string }>;
  for (const entry of entries) {
    const name = toPosix(entry.entryName || '');
    if (!name || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`归档包含非法条目路径: ${name || '(空)'}`);
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ============ 导出 ============

export async function exportProjectArchive(options: ExportArchiveOptions): Promise<ExportArchiveResult> {
  const { projectIds, destPath, password, includeStandards = true, includeCredentials = false } = options;

  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    return { success: false, error: '请至少选择一个项目' };
  }
  if (!destPath) {
    return { success: false, error: '未指定导出路径' };
  }
  if (password && password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    return { success: false, error: `归档密码至少需要 ${MIN_BACKUP_PASSWORD_LENGTH} 位` };
  }

  let stagingDir = '';
  try {
    const db = getDb();
    const dataPath = path.resolve(await getAppDataPath());

    const projectRows = (await db
      .select()
      .from(schema.projects)
      .where(inArray(schema.projects.id, projectIds))) as Row[];
    if (projectRows.length === 0) {
      return { success: false, error: '所选项目不存在' };
    }
    const foundIds = projectRows.map(p => p.id as string);

    const members = (await db
      .select()
      .from(schema.projectMembers)
      .where(inArray(schema.projectMembers.projectId, foundIds))) as Row[];

    const assets = (await db
      .select()
      .from(schema.assets)
      .where(inArray(schema.assets.projectId, foundIds))) as Row[];
    const assetIds = assets.map(a => a.id as string);

    const records = (await db
      .select()
      .from(schema.assessmentRecords)
      .where(inArray(schema.assessmentRecords.projectId, foundIds))) as Row[];

    const issues = (await db
      .select()
      .from(schema.issues)
      .where(inArray(schema.issues.projectId, foundIds))) as Row[];

    const tasks = (await db
      .select()
      .from(schema.collectionTasks)
      .where(inArray(schema.collectionTasks.projectId, foundIds))) as Row[];
    const taskIds = tasks.map(t => t.id as string);

    const documents = (await db
      .select()
      .from(schema.collectionDocuments)
      .where(inArray(schema.collectionDocuments.projectId, foundIds))) as Row[];

    const results = taskIds.length
      ? ((await db
          .select()
          .from(schema.collectionResults)
          .where(inArray(schema.collectionResults.taskId, taskIds))) as Row[])
      : [];

    // 连接配置：资产自带 + 采集任务直接引用（无资产归属的手动目标）
    const connFromAssets = assetIds.length
      ? ((await db
          .select()
          .from(schema.connectionProfiles)
          .where(inArray(schema.connectionProfiles.assetId, assetIds))) as Row[])
      : [];
    const taskConnIds = [...new Set(tasks.map(t => t.connectionId).filter(Boolean))] as string[];
    const connFromTasks = taskConnIds.length
      ? ((await db
          .select()
          .from(schema.connectionProfiles)
          .where(inArray(schema.connectionProfiles.id, taskConnIds))) as Row[])
      : [];
    const connectionMap = new Map<string, Row>();
    for (const c of [...connFromAssets, ...connFromTasks]) {
      connectionMap.set(c.id as string, includeCredentials ? c : { ...c, passwordEncrypted: null });
    }

    const assetConnections = assetIds.length
      ? ((await db
          .select()
          .from(schema.assetConnections)
          .where(inArray(schema.assetConnections.assetId, assetIds))) as Row[])
      : [];

    // 依赖标准：随包带走，避免恢复后测评记录失去题干
    let standards: Row[] = [];
    let items: Row[] = [];
    if (includeStandards) {
      const standardIds = [...new Set(projectRows.map(p => p.standardId).filter(Boolean))] as string[];
      if (standardIds.length) {
        standards = (await db
          .select()
          .from(schema.standards)
          .where(inArray(schema.standards.id, standardIds))) as Row[];
        items = (await db
          .select()
          .from(schema.assessmentItems)
          .where(inArray(schema.assessmentItems.standardId, standardIds))) as Row[];
      }
    }

    // ---- 收集附件 ----
    const usedPaths = new Set<string>();
    const fileMap: Record<string, string> = {};
    const missingFiles: string[] = [];

    const collect = async (rawValues: string[]) => {
      for (const raw of rawValues) {
        if (!raw || fileMap[raw]) continue;
        const abs = path.resolve(await resolvePath(raw));
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          if (!missingFiles.includes(raw)) missingFiles.push(raw);
          continue;
        }
        let topDir = 'attachments';
        if (abs.toLowerCase().startsWith(dataPath.toLowerCase() + path.sep)) {
          const rel = toPosix(path.relative(dataPath, abs));
          const first = rel.split('/')[0];
          if (ALLOWED_FILE_DIRS.includes(first)) topDir = first;
        }
        const archiveRel = allocateArchivePath(usedPaths, topDir, path.basename(abs));
        fileMap[raw] = archiveRel;
        const dest = path.join(stagingDir, ...archiveRel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(abs, dest);
      }
    };

    stagingDir = path.join(dataPath, 'temp', `.archive_${randomUUID()}`);
    fs.mkdirSync(stagingDir, { recursive: true });

    // 先建目录再收集（collect 依赖 stagingDir）
    for (const r of records) await collect(parsePathList(r.screenshotPaths));
    for (const i of issues) await collect(parsePathList(i.evidenceFiles));
    for (const d of documents) await collect([d.filePath].filter(Boolean));

    const summaries: ArchiveProjectSummary[] = projectRows.map(p => ({
      id: p.id,
      name: p.name,
      systemName: p.systemName,
      level: p.level ?? 3,
      status: p.status,
      createdAt: p.createdAt,
      assetCount: assets.filter(a => a.projectId === p.id).length,
      recordCount: records.filter(r => r.projectId === p.id).length,
      issueCount: issues.filter(i => i.projectId === p.id).length,
      taskCount: tasks.filter(t => t.projectId === p.id).length,
    }));

    const manifest: ProjectArchiveManifest = {
      kind: ARCHIVE_KIND,
      version: ARCHIVE_VERSION,
      appVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
      projects: summaries,
      counts: {
        assets: assets.length,
        records: records.length,
        issues: issues.length,
        tasks: tasks.length,
        results: results.length,
        documents: documents.length,
        members: members.length,
        connections: connectionMap.size,
        standards: standards.length,
        items: items.length,
        files: Object.keys(fileMap).length,
      },
      includeStandards,
      credentialsIncluded: includeCredentials,
      encrypted: !!password,
    };

    const data: ProjectArchiveData = {
      projects: projectRows,
      projectMembers: members,
      assets,
      connectionProfiles: Array.from(connectionMap.values()),
      assetConnections,
      assessmentRecords: records,
      issues,
      collectionTasks: tasks,
      collectionResults: results,
      collectionDocuments: documents,
      standards,
      assessmentItems: items,
      fileMap,
    };

    fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    fs.writeFileSync(path.join(stagingDir, 'data.json'), JSON.stringify(data), 'utf-8');

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    // ignoreBase: 不加会把暂存目录名（.archive_<uuid>）也打进包，manifest.json 就不在根上了
    await compressing.zip.compressDir(stagingDir, destPath, { ignoreBase: true });
    if (password) {
      sealZipFile(destPath, destPath, password);
    }

    const size = fs.statSync(destPath).size;
    log.info(
      `[项目归档] 导出完成: ${destPath}（${(size / 1024 / 1024).toFixed(2)} MB，` +
        `${summaries.length} 个项目 / ${manifest.counts.files} 个附件${missingFiles.length ? ` / ${missingFiles.length} 个附件缺失` : ''}）`
    );

    return {
      success: true,
      path: destPath,
      size,
      fileCount: manifest.counts.files,
      missingFiles: missingFiles.length ? missingFiles : undefined,
    };
  } catch (error: any) {
    log.error('[项目归档] 导出失败:', error);
    return { success: false, error: error?.message || '导出失败' };
  } finally {
    if (stagingDir && fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        /* 暂存目录清理失败不影响结果 */
      }
    }
  }
}

// ============ 打开 / 预览 ============

interface OpenedArchive {
  zipPath: string;
  cleanup: () => void;
}

async function openArchiveForRead(archivePath: string, password?: string): Promise<OpenedArchive> {
  const dataPath = await getAppDataPath();
  const opened = openBackupZip(archivePath, password, path.join(dataPath, 'temp', '.archive_decrypt'));
  return { zipPath: opened.zipPath, cleanup: opened.cleanup };
}

export function isArchiveEncrypted(archivePath: string): boolean {
  return isEncryptedBackupFile(archivePath);
}

export async function previewProjectArchive(
  archivePath: string,
  password?: string,
): Promise<PreviewArchiveResult> {
  if (!archivePath || !fs.existsSync(archivePath)) {
    return { success: false, error: '归档文件不存在' };
  }
  let opened: OpenedArchive | undefined;
  try {
    opened = await openArchiveForRead(archivePath, password);
    const zip = new AdmZip(opened.zipPath);
    assertSafeZipEntries(zip);

    const manifestEntry = findZipEntry(zip, 'manifest.json');
    const dataEntry = findZipEntry(zip, 'data.json');
    if (!manifestEntry || !dataEntry) {
      return { success: false, error: '这不是有效的项目归档包（缺少 manifest.json / data.json）' };
    }
    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as ProjectArchiveManifest;
    if (manifest?.kind !== ARCHIVE_KIND) {
      return { success: false, error: '该文件不是项目归档包（可能是系统备份文件，请在系统设置中恢复）' };
    }
    if (!SUPPORTED_ARCHIVE_VERSIONS.includes(manifest.version)) {
      return {
        success: false,
        error: `归档版本 ${manifest.version} 与当前程序不兼容（支持 ${SUPPORTED_ARCHIVE_VERSIONS.join('、')}）`,
      };
    }

    const data = JSON.parse(dataEntry.getData().toString('utf-8')) as ProjectArchiveData;
    const db = getDb();
    const localRows = (await db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects)) as Array<{ id: string; name: string }>;
    const localById = new Map(localRows.map(r => [r.id, r.name]));

    const warnings: string[] = [];
    if (manifest.credentialsIncluded === false && manifest.counts.connections > 0) {
      warnings.push(`归档不含连接配置口令（${manifest.counts.connections} 条），恢复后需重新录入`);
    }
    if (!manifest.includeStandards) {
      warnings.push('归档不含测评标准，若本机没有对应标准，测评记录将缺少题干');
    }
    if (manifest.appVersion && manifest.appVersion !== app.getVersion()) {
      warnings.push(`归档由 v${manifest.appVersion} 生成，当前程序为 v${app.getVersion()}`);
    }
    const missingFiles = Object.keys(data.fileMap || {}).filter(
      k => !findZipEntry(zip, path.basename(toPosix(data.fileMap[k]))),
    );
    if (missingFiles.length) {
      warnings.push(`归档中缺少 ${missingFiles.length} 个附件文件，对应引用将保持原样`);
    }

    const projects: ArchivePreviewProject[] = (manifest.projects || []).map(p => ({
      ...p,
      existsLocally: localById.has(p.id),
      localName: localById.get(p.id),
    }));
    const unknownStandardIds = (data.projects || [])
      .map(p => p.standardId)
      .filter(Boolean)
      .filter(sid => !(data.standards || []).some(s => s.id === sid));
    if (unknownStandardIds.length && !manifest.includeStandards) {
      warnings.push('归档未携带项目使用的测评标准');
    }

    return { success: true, manifest, projects, encrypted: isArchiveEncrypted(archivePath), warnings };
  } catch (error: any) {
    log.error('[项目归档] 预览失败:', error);
    return { success: false, error: error?.message || '无法读取归档文件' };
  } finally {
    opened?.cleanup();
  }
}

// ============ 导入 ============

/**
 * 级联删除一个项目的全部数据（事务内调用）。
 * 顺序与 `project:remove` 保持一致：子表 → 父表。
 */
function deleteProjectCascade(tx: any, projectId: string): void {
  const assetRows = tx.select({ id: schema.assets.id }).from(schema.assets).where(eq(schema.assets.projectId, projectId)).all();
  const assetIds = assetRows.map((a: any) => a.id as string);
  const taskRows = tx.select({ id: schema.collectionTasks.id }).from(schema.collectionTasks).where(eq(schema.collectionTasks.projectId, projectId)).all();
  const taskIds = taskRows.map((t: any) => t.id as string);

  tx.delete(schema.assessmentRecords).where(eq(schema.assessmentRecords.projectId, projectId)).run();
  tx.delete(schema.issues).where(eq(schema.issues.projectId, projectId)).run();
  tx.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, projectId)).run();
  if (taskIds.length) {
    tx.delete(schema.collectionResults).where(inArray(schema.collectionResults.taskId, taskIds)).run();
  }
  tx.delete(schema.collectionTasks).where(eq(schema.collectionTasks.projectId, projectId)).run();
  tx.delete(schema.collectionDocuments).where(eq(schema.collectionDocuments.projectId, projectId)).run();
  if (assetIds.length) {
    tx.delete(schema.assetConnections).where(inArray(schema.assetConnections.assetId, assetIds)).run();
    tx.delete(schema.connectionProfiles).where(inArray(schema.connectionProfiles.assetId, assetIds)).run();
    tx.delete(schema.assets).where(eq(schema.assets.projectId, projectId)).run();
  }
  tx.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
}

function insertAll(tx: any, table: any, rows: Row[], batchSize = 200): void {
  for (const batch of chunk(rows, batchSize)) {
    if (batch.length) tx.insert(table).values(batch).run();
  }
}

export async function importProjectArchive(options: ImportArchiveOptions): Promise<ImportArchiveResult> {
  const { archivePath, password, strategy } = options;
  if (!archivePath || !fs.existsSync(archivePath)) {
    return { success: false, imported: [], skipped: [], restoredFiles: 0, missingFiles: 0, warnings: [], error: '归档文件不存在' };
  }

  let opened: OpenedArchive | undefined;
  let extractDir = '';
  try {
    opened = await openArchiveForRead(archivePath, password);
    const zip = new AdmZip(opened.zipPath);
    assertSafeZipEntries(zip);

    const manifestEntry = findZipEntry(zip, 'manifest.json');
    const dataEntry = findZipEntry(zip, 'data.json');
    if (!manifestEntry || !dataEntry) {
      return { success: false, imported: [], skipped: [], restoredFiles: 0, missingFiles: 0, warnings: [], error: '这不是有效的项目归档包' };
    }
    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as ProjectArchiveManifest;
    if (manifest?.kind !== ARCHIVE_KIND) {
      return { success: false, imported: [], skipped: [], restoredFiles: 0, missingFiles: 0, warnings: [], error: '该文件不是项目归档包' };
    }
    if (!SUPPORTED_ARCHIVE_VERSIONS.includes(manifest.version)) {
      return {
        success: false,
        imported: [],
        skipped: [],
        restoredFiles: 0,
        missingFiles: 0,
        warnings: [],
        error: `归档版本 ${manifest.version} 与当前程序不兼容（支持 ${SUPPORTED_ARCHIVE_VERSIONS.join('、')}）`,
      };
    }

    const data = JSON.parse(dataEntry.getData().toString('utf-8')) as ProjectArchiveData;
    const dataPath = path.resolve(await getAppDataPath());
    const db = getDb();

    extractDir = path.join(dataPath, 'temp', `.archive_${randomUUID()}`);
    fs.mkdirSync(extractDir, { recursive: true });
    zip.extractAllTo(extractDir, true);

    const warnings: string[] = [];
    const imported: Array<{ id: string; name: string; mode: 'new' | 'overwrite' | 'copy' }> = [];
    const skipped: string[] = [];

    // ---- 1) 还原附件，并生成「原路径值 → 本机新路径值」重写表 ----
    const rewrite = new Map<string, string>();
    let restoredFiles = 0;
    let missingFiles = 0;
    for (const [original, archiveRel] of Object.entries(data.fileMap || {})) {
      const src = locateExtractedFile(extractDir, archiveRel);
      if (!src) {
        missingFiles++;
        continue;
      }
      const rel = toPosix(archiveRel).replace(/^files\//, '');
      let topDir = rel.split('/')[0];
      if (!ALLOWED_FILE_DIRS.includes(topDir)) topDir = 'attachments';
      const baseName = path.basename(rel);
      const targetDir = path.join(dataPath, topDir);
      fs.mkdirSync(targetDir, { recursive: true });
      let target = path.join(targetDir, baseName);
      if (fs.existsSync(target)) {
        // 同名文件已存在：内容一致就沿用（引用天然对齐），
        // 内容不同则改名另存 —— 否则新记录会指向一个"名字相同但不是它"的旧文件
        const sameSize = fs.statSync(target).size === fs.statSync(src).size;
        if (!sameSize) {
          target = uniqueTargetPath(targetDir, baseName);
          fs.copyFileSync(src, target);
          restoredFiles++;
        }
      } else {
        fs.copyFileSync(src, target);
        restoredFiles++;
      }
      rewrite.set(original, `${topDir}/${path.basename(target)}`);
    }
    if (missingFiles > 0) warnings.push(`${missingFiles} 个附件在归档中缺失，对应引用保持原样`);

    const rewriteList = (raw: unknown): string | null => {
      const list = parsePathList(raw);
      if (!list.length) return (typeof raw === 'string' ? raw : null);
      const mapped = list.map(v => rewrite.get(v) ?? v);
      return JSON.stringify(mapped);
    };
    const rewriteOne = (raw: unknown): string | null => {
      if (!raw || typeof raw !== 'string') return null;
      return rewrite.get(raw) ?? raw;
    };

    // ---- 2) 标准与测评项：本机已有则跳过（不覆盖现有标准库） ----
    const existingStandardRows = (await db.select({ id: schema.standards.id }).from(schema.standards)) as Array<{ id: string }>;
    const existingStandardIds = new Set(existingStandardRows.map(r => r.id));
    const newStandards = (data.standards || []).filter(s => !existingStandardIds.has(s.id));
    const newItemStandardIds = new Set(newStandards.map(s => s.id));
    const newItems = (data.assessmentItems || []).filter(i => newItemStandardIds.has(i.standardId));
    const skippedStandards = (data.standards || []).length - newStandards.length;
    if (skippedStandards > 0) {
      warnings.push(`${skippedStandards} 个标准本机已存在，沿用现有标准库`);
    }

    // ---- 3) 成员引用校验：用户不存在则不带入，避免产生悬空成员 ----
    const existingUserRows = (await db.select({ id: schema.users.id }).from(schema.users)) as Array<{ id: string }>;
    const existingUserIds = new Set(existingUserRows.map(r => r.id));
    // 显式标注 Row[]：对象展开会丢掉索引签名，后续访问 m.userId 会被 TS 判为不存在
    const memberRows: Row[] = (data.projectMembers || []).map(m => ({ ...m }));

    // ---- 4) 冲突处理：为每个待导入项目决定最终 id ----
    const localRows = (await db.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects)) as Array<{ id: string; name: string }>;
    const localById = new Map(localRows.map(r => [r.id, r]));

    type Plan = { source: Row; targetId: string; mode: 'new' | 'overwrite' | 'copy' };
    const plans: Plan[] = [];
    for (const p of data.projects || []) {
      const exists = localById.has(p.id);
      if (!exists) {
        plans.push({ source: p, targetId: p.id, mode: 'new' });
      } else if (strategy === 'copy') {
        plans.push({ source: { ...p, name: `${p.name}（导入副本）` }, targetId: randomUUID(), mode: 'copy' });
      } else if (strategy === 'overwrite') {
        plans.push({ source: p, targetId: p.id, mode: 'overwrite' });
      } else {
        skipped.push(p.name);
      }
    }
    if (skipped.length) {
      warnings.push(`${skipped.length} 个项目已存在且选择跳过：${skipped.join('、')}`);
    }
    if (plans.length === 0) {
      return { success: true, imported: [], skipped, restoredFiles, missingFiles, warnings, error: '没有需要导入的项目' };
    }

    const idRemap = new Map<string, string>();
    for (const plan of plans) idRemap.set(plan.source.id, plan.targetId);

    // ---- 5) 事务写入 ----
    //
    // 除标准/测评项必须保留原 id（测评记录的 item_id 直接指向它们）外，
    // **其余所有行都重新生成主键**：归档里的资产/记录/任务 id 完全可能与本机现有行撞车
    // （尤其是"另存副本"场景——原项目还在，子表 id 却是同一批），
    // 若沿用原 id 会直接主键冲突、整包导入失败。引用字段按映射表同步改写。
    db.transaction((tx: any) => {
      insertAll(tx, schema.standards, newStandards, 50);
      insertAll(tx, schema.assessmentItems, newItems, 100);

      for (const plan of plans) {
        if (plan.mode === 'overwrite') {
          deleteProjectCascade(tx, plan.targetId);
        }
        insertAll(tx, schema.projects, [{ ...plan.source, id: plan.targetId }], 1);
      }

      // 先按 Row 过滤（用户不存在则丢弃），再生成新 id —— 展开后索引签名会丢失，
      // 若先 map 再 filter，TS 就认不出 m.userId 了
      const membersToInsert = memberRows
        .filter(m => idRemap.has(m.projectId) && existingUserIds.has(m.userId))
        .map(m => ({ ...m, id: randomUUID(), projectId: idRemap.get(m.projectId)! }));
      const droppedMembers = memberRows.filter(m => idRemap.has(m.projectId) && !existingUserIds.has(m.userId)).length;
      if (droppedMembers > 0) {
        warnings.push(`${droppedMembers} 条成员记录对应的用户在本机不存在，已跳过`);
      }
      insertAll(tx, schema.projectMembers, membersToInsert);

      const assetIdMap = new Map<string, string>();
      const assets = (data.assets || [])
        .filter(a => idRemap.has(a.projectId))
        .map(a => {
          const newId = randomUUID();
          assetIdMap.set(a.id, newId);
          return { ...a, id: newId, projectId: idRemap.get(a.projectId)! };
        });
      insertAll(tx, schema.assets, assets);

      const connIdMap = new Map<string, string>();
      const connections = (data.connectionProfiles || []).map(c => {
        const newId = randomUUID();
        connIdMap.set(c.id, newId);
        return { ...c, id: newId };
      });
      insertAll(tx, schema.connectionProfiles, connections);

      const taskIdMap = new Map<string, string>();
      const tasks = (data.collectionTasks || [])
        .filter(t => idRemap.has(t.projectId))
        .map(t => {
          const newId = randomUUID();
          taskIdMap.set(t.id, newId);
          return {
            ...t,
            id: newId,
            projectId: idRemap.get(t.projectId)!,
            assetId: assetIdMap.get(t.assetId) ?? t.assetId,
            connectionId: connIdMap.get(t.connectionId) ?? t.connectionId,
          };
        });
      insertAll(tx, schema.collectionTasks, tasks);

      insertAll(
        tx,
        schema.assetConnections,
        (data.assetConnections || [])
          .filter(ac => assetIdMap.has(ac.assetId))
          .map(ac => ({
            ...ac,
            id: randomUUID(),
            assetId: assetIdMap.get(ac.assetId)!,
            connectionId: connIdMap.get(ac.connectionId) ?? ac.connectionId,
          })),
      );

      const records = (data.assessmentRecords || [])
        .filter(r => idRemap.has(r.projectId))
        .map(r => ({
          ...r,
          id: randomUUID(),
          projectId: idRemap.get(r.projectId)!,
          assetId: r.assetId ? (assetIdMap.get(r.assetId) ?? r.assetId) : r.assetId,
          screenshotPaths: rewriteList(r.screenshotPaths),
        }));
      insertAll(tx, schema.assessmentRecords, records);

      const issues = (data.issues || [])
        .filter(i => idRemap.has(i.projectId))
        .map(i => ({
          ...i,
          id: randomUUID(),
          projectId: idRemap.get(i.projectId)!,
          assetId: i.assetId ? (assetIdMap.get(i.assetId) ?? i.assetId) : i.assetId,
          evidenceFiles: rewriteList(i.evidenceFiles),
        }));
      insertAll(tx, schema.issues, issues);

      insertAll(
        tx,
        schema.collectionResults,
        (data.collectionResults || [])
          .filter(r => taskIdMap.has(r.taskId))
          .map(r => ({ ...r, id: randomUUID(), taskId: taskIdMap.get(r.taskId)! })),
      );

      insertAll(
        tx,
        schema.collectionDocuments,
        (data.collectionDocuments || [])
          .filter(d => idRemap.has(d.projectId))
          .map(d => ({
            ...d,
            id: randomUUID(),
            projectId: idRemap.get(d.projectId)!,
            assetId: d.assetId ? (assetIdMap.get(d.assetId) ?? d.assetId) : d.assetId,
            taskId: taskIdMap.get(d.taskId) ?? d.taskId,
            filePath: rewriteOne(d.filePath),
          })),
      );
    });

    for (const plan of plans) {
      imported.push({ id: plan.targetId, name: plan.source.name, mode: plan.mode });
    }

    log.info(`[项目归档] 导入完成: ${imported.length} 个项目，${restoredFiles} 个附件`);
    return { success: true, imported, skipped, restoredFiles, missingFiles, warnings };
  } catch (error: any) {
    log.error('[项目归档] 导入失败:', error);
    return {
      success: false,
      imported: [],
      skipped: [],
      restoredFiles: 0,
      missingFiles: 0,
      warnings: [],
      error: error?.message || '导入失败',
    };
  } finally {
    if (extractDir && fs.existsSync(extractDir)) {
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch {
        /* 解压目录清理失败不影响结果 */
      }
    }
    opened?.cleanup();
  }
}
