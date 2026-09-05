import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { resolvePathSync, validateDataPath } from '../utils/path-resolver';
import { wrap } from '../utils/ipc-wrapper';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { getAppDataPathSync } from '../main/paths';
import { eq } from 'drizzle-orm';

// === 方案 §九.496 孤儿截图清理（可选）===
// 扫描目录：
//   - {appData}/screenshots/{projectId}/{itemId}/*（含 screenshots/temp 下的过期临时文件）
//   - {appData}/evidence/{projectId}/{itemId}/*（证据材料目录）
// 引用来源：
//   - assessment_records.screenshotPaths（JSON 字符串数组，每个元素可能是相对 appData 的路径或绝对路径）
// 算法：
//   1) 递归枚举所有文件 → 规范化绝对路径
//   2) 扫 DB 全部 screenshotPaths JSON 数组，解析后 resolve 成绝对路径集合 referenced
//   3) orphan = scanSet - referenced
//   4) dryRun=true 只返回数量/列表/总字节；dryRun=false 真正删除（已删除集合 + 失败项日志）
const SCAN_IMAGE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.md', '.rtf',
]);

function walkDirSync(root: string, result: Array<{ absPath: string; size: number; mtime: number }> = []): typeof result {
  if (!fs.existsSync(root)) return result;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    try {
      if (entry.isDirectory()) {
        walkDirSync(full, result);
      } else if (entry.isFile()) {
        const st = fs.statSync(full);
        result.push({ absPath: path.resolve(full), size: st.size, mtime: st.mtimeMs });
      }
    } catch { /* 单个文件错误不影响整体扫描 */ }
  }
  return result;
}

interface CleanupScreenshotsResult {
  dryRun: boolean;
  scannedDirs: string[];
  totalScanned: number;
  totalReferenced: number;
  orphanCount: number;
  orphanSizeBytes: number;
  orphans: Array<{ absPath: string; size: number; mtime: number }>;
  deleted: Array<{ absPath: string; size: number }>;
  failed: Array<{ absPath: string; error: string }>;
  emptyDirsRemoved: number;
  tempCleanupCount: number;
}

async function cleanupScreenshots(dryRun: boolean, projectId?: string): Promise<CleanupScreenshotsResult> {
  const db = getDb();
  const appData = path.resolve(getAppDataPathSync());
  const dirs: string[] = [
    projectId ? path.join(appData, 'screenshots', projectId) : path.join(appData, 'screenshots'),
    projectId ? path.join(appData, 'evidence', projectId) : path.join(appData, 'evidence'),
  ];

  // 1. 扫描文件（仅保留常见图片/证据扩展名，避免扫到 db/缓存）
  const scanned: Array<{ absPath: string; size: number; mtime: number }> = [];
  for (const d of dirs) {
    const all = walkDirSync(d, []);
    for (const f of all) {
      const ext = path.extname(f.absPath).toLowerCase();
      if (SCAN_IMAGE_EXT.has(ext)) scanned.push(f);
    }
  }
  // screenshots/temp 下的临时文件：跨进程保存中转，超过 24h 才认作过期（避免删正在上传用的 temp）
  const tempDir = path.join(appData, 'screenshots', 'temp');
  const tempFiles = walkDirSync(tempDir, []);
  const tempAbsSet = new Set(tempFiles.map(f => f.absPath));
  // 注意：当 projectId 限定且 tempDir 不在 dirs 下时，上面扫描可能遗漏 temp，这里做一次 temp 的额外补充
  if (projectId) {
    for (const f of tempFiles) {
      const ext = path.extname(f.absPath).toLowerCase();
      if (SCAN_IMAGE_EXT.has(ext)) scanned.push(f);
    }
  }

  // 2. 收集 DB 中所有被引用的截图绝对路径（所有 project 或指定 project）
  const referenced = new Set<string>();
  const recs: Array<{ screenshotPaths: string | null }> = projectId
    ? await db
        .select({ screenshotPaths: schema.assessmentRecords.screenshotPaths })
        .from(schema.assessmentRecords)
        .where(eq(schema.assessmentRecords.projectId, projectId))
    : await db
        .select({ screenshotPaths: schema.assessmentRecords.screenshotPaths })
        .from(schema.assessmentRecords);

  for (const r of recs) {
    if (!r?.screenshotPaths) continue;
    let arr: any[] = [];
    try {
      const p = JSON.parse(r.screenshotPaths);
      if (Array.isArray(p)) arr = p;
    } catch {
      // 遗留：单路径字符串
      arr = [r.screenshotPaths];
    }
    for (const raw of arr) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      try {
        const abs = path.resolve(resolvePathSync(raw));
        referenced.add(abs);
      } catch { /* 单个路径解析失败不影响整体 */ }
    }
  }

  // 3. 计算孤儿 = scanned - referenced（temp 下的按 24h 过期算）
  const now = Date.now();
  const TEMP_EXPIRE_MS = 24 * 3600 * 1000;
  const orphans: Array<{ absPath: string; size: number; mtime: number }> = [];
  const seen = new Set<string>();
  for (const f of scanned) {
    if (seen.has(f.absPath)) continue;
    seen.add(f.absPath);
    if (tempAbsSet.has(f.absPath)) {
      // temp 目录：超过 24h 算过期
      if (now - f.mtime > TEMP_EXPIRE_MS) orphans.push(f);
      continue;
    }
    if (!referenced.has(f.absPath)) orphans.push(f);
  }
  orphans.sort((a, b) => b.size - a.size); // 大文件在前，便于预览
  const orphanSizeBytes = orphans.reduce((s, f) => s + f.size, 0);

  // 4. 删除（非 dryRun）
  const deleted: Array<{ absPath: string; size: number }> = [];
  const failed: Array<{ absPath: string; error: string }> = [];
  let emptyDirsRemoved = 0;
  if (!dryRun) {
    for (const f of orphans) {
      try {
        fs.unlinkSync(f.absPath);
        deleted.push({ absPath: f.absPath, size: f.size });
      } catch (e: any) {
        failed.push({ absPath: f.absPath, error: e?.message || String(e) });
      }
    }
    // 清理空目录（screenshots/{projectId}/{itemId} 叶子空文件夹）
    for (const base of dirs) {
      if (!fs.existsSync(base)) continue;
      // 自底向上：先扫一级 projectId，再扫 itemId
      try {
        for (const p of fs.readdirSync(base)) {
          const pDir = path.join(base, p);
          if (!fs.statSync(pDir).isDirectory()) continue;
          try {
            for (const i of fs.readdirSync(pDir)) {
              const iDir = path.join(pDir, i);
              if (!fs.statSync(iDir).isDirectory()) continue;
              try {
                const sub = fs.readdirSync(iDir);
                if (sub.length === 0) { fs.rmdirSync(iDir); emptyDirsRemoved += 1; }
              } catch { /* */ }
            }
            const projectSubs = fs.readdirSync(pDir);
            if (projectSubs.length === 0) { fs.rmdirSync(pDir); emptyDirsRemoved += 1; }
          } catch { /* */ }
        }
      } catch { /* */ }
      // temp 目录清理（只删空）
      try {
        if (fs.existsSync(tempDir)) {
          const items = fs.readdirSync(tempDir);
          if (items.length === 0) { fs.rmdirSync(tempDir); emptyDirsRemoved += 1; }
        }
      } catch { /* */ }
    }
  }

  return {
    dryRun,
    scannedDirs: dirs,
    totalScanned: scanned.length,
    totalReferenced: referenced.size,
    orphanCount: orphans.length,
    orphanSizeBytes,
    orphans: orphans.slice(0, 500), // 预览最多返回 500 条（避免 IPC 过大），统计用 orphanCount/orphanSizeBytes
    deleted,
    failed,
    emptyDirsRemoved,
    tempCleanupCount: orphans.filter(f => tempAbsSet.has(f.absPath)).length,
  };
}

export function registerFileHandlers(): void {
  ipcMain.handle('file:exists', wrap(async (_event, filePath: string) => {
    const safePath = await validateDataPath(filePath);
    return fs.existsSync(safePath);
  }, 'file'));

  ipcMain.handle('file:readAsArrayBuffer', wrap(async (_event, filePath: string) => {
    const safePath = await validateDataPath(filePath);
    const buf = fs.readFileSync(safePath);
    return Array.from(buf);
  }, 'file'));

  ipcMain.handle('file:readAsText', wrap(async (_event, filePath: string, encoding?: string) => {
    const safePath = await validateDataPath(filePath);
    return fs.readFileSync(safePath, (encoding as BufferEncoding) || 'utf-8');
  }, 'file'));

  // === Phase 4 可选：孤儿截图清理（支持 dryRun 预览；projectId 可选，不传=全局）===
  ipcMain.handle('file:cleanupScreenshots', wrap(async (_event, opts?: { dryRun?: boolean; projectId?: string }) => {
    const dryRun = opts?.dryRun !== false; // 缺省 true，确保默认安全（不直接删）
    const projectId = typeof opts?.projectId === 'string' && opts.projectId.trim() ? opts.projectId.trim() : undefined;
    return await cleanupScreenshots(dryRun, projectId);
  }, 'file'));
}
