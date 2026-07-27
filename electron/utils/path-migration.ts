import * as path from 'path';
import log from 'electron-log';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { assessmentRecords, issues, knowledgeDocuments } from '../db/schema';
import { toRelativePath } from './path-resolver';
import { getAppDataPath } from '../main/paths';

/**
 * 检查路径是否为绝对路径（在 appDataPath 下）
 */
async function isAbsolutePathUnderAppData(inputPath: string): Promise<boolean> {
  if (!inputPath) return false;
  try {
    const appDataPath = await getAppDataPath();
    const resolvedBase = path.resolve(appDataPath);
    const resolved = path.resolve(inputPath);
    return resolved.startsWith(resolvedBase + path.sep) || resolved === resolvedBase;
  } catch {
    return false;
  }
}

/**
 * 迁移测评记录中的截图路径（screenshotPaths 字段）
 */
async function migrateAssessmentRecordPaths(): Promise<number> {
  const db = getDb();
  const records = await db.select().from(assessmentRecords);
  let migratedCount = 0;

  for (const record of records) {
    if (!record.screenshotPaths) continue;

    try {
      const parsed = JSON.parse(record.screenshotPaths);
      if (!Array.isArray(parsed)) continue;

      let hasChanges = false;
      const newPaths: string[] = [];

      for (const p of parsed) {
        if (await isAbsolutePathUnderAppData(p)) {
          const relativePath = await toRelativePath(p);
          newPaths.push(relativePath);
          hasChanges = true;
        } else {
          newPaths.push(p);
        }
      }

      if (hasChanges) {
        await db.update(assessmentRecords)
          .set({ screenshotPaths: JSON.stringify(newPaths) })
          .where(eq(assessmentRecords.id, record.id));
        migratedCount++;
      }
    } catch (err) {
      log.warn(`迁移测评记录路径失败 [${record.id}]:`, err);
    }
  }

  return migratedCount;
}

/**
 * 迁移问题中的证据文件路径（evidenceFiles 字段）
 */
async function migrateIssueEvidencePaths(): Promise<number> {
  const db = getDb();
  const issueList = await db.select().from(issues);
  let migratedCount = 0;

  for (const issue of issueList) {
    if (!issue.evidenceFiles) continue;

    try {
      const parsed = JSON.parse(issue.evidenceFiles);
      if (!Array.isArray(parsed)) continue;

      let hasChanges = false;
      const newPaths: string[] = [];

      for (const p of parsed) {
        if (await isAbsolutePathUnderAppData(p)) {
          const relativePath = await toRelativePath(p);
          newPaths.push(relativePath);
          hasChanges = true;
        } else {
          newPaths.push(p);
        }
      }

      if (hasChanges) {
        await db.update(issues)
          .set({ evidenceFiles: JSON.stringify(newPaths) })
          .where(eq(issues.id, issue.id));
        migratedCount++;
      }
    } catch (err) {
      log.warn(`迁移问题证据路径失败 [${issue.id}]:`, err);
    }
  }

  return migratedCount;
}

/**
 * 迁移知识库文档的文件路径（filePath 字段）
 */
async function migrateKnowledgeDocumentPaths(): Promise<number> {
  const db = getDb();
  const docs = await db.select().from(knowledgeDocuments);
  let migratedCount = 0;

  for (const doc of docs) {
    if (!doc.filePath) continue;

    if (await isAbsolutePathUnderAppData(doc.filePath)) {
      try {
        const relativePath = await toRelativePath(doc.filePath);
        await db.update(knowledgeDocuments)
          .set({ filePath: relativePath })
          .where(eq(knowledgeDocuments.id, doc.id));
        migratedCount++;
      } catch (err) {
        log.warn(`迁移知识库文档路径失败 [${doc.id}]:`, err);
      }
    }
  }

  return migratedCount;
}

/**
 * 执行所有路径迁移
 * 将数据库中存储的绝对路径转换为相对路径
 */
export async function migrateAllPaths(): Promise<{
  assessmentRecords: number;
  issues: number;
  knowledgeDocuments: number;
}> {
  log.info('开始执行路径数据迁移...');

  const assessmentCount = await migrateAssessmentRecordPaths();
  const issueCount = await migrateIssueEvidencePaths();
  const knowledgeCount = await migrateKnowledgeDocumentPaths();

  log.info(`路径迁移完成: 测评记录 ${assessmentCount} 条, 问题 ${issueCount} 条, 知识库文档 ${knowledgeCount} 条`);

  return {
    assessmentRecords: assessmentCount,
    issues: issueCount,
    knowledgeDocuments: knowledgeCount,
  };
}
