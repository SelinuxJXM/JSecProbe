import { getDb } from '../db';
import { operationLogs } from '../db/schema';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import log from 'electron-log';

export interface LogEntry {
  userId?: string;
  username?: string;
  action: string;
  module: string;
  targetId?: string;
  targetName?: string;
  description?: string;
  ipAddress?: string;
  detailJson?: string; // JSON 字符串形式的详细审计信息
}

export async function writeOperationLog(entry: LogEntry): Promise<void> {
  try {
    const db = getDb();
    await db.insert(operationLogs).values({
      id: randomUUID(),
      userId: entry.userId,
      username: entry.username,
      action: entry.action,
      module: entry.module,
      targetId: entry.targetId,
      targetName: entry.targetName,
      description: entry.description,
      ipAddress: entry.ipAddress,
      detailJson: entry.detailJson,
      createdAt: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('[操作日志] 写入失败:', error.message);
  }
}

/**
 * 清理过期操作日志（默认保留最近 90 天）
 */
export async function cleanupOperationLogs(daysToKeep: number = 90): Promise<number> {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const cutoffStr = cutoff.toISOString();

  try {
    const result = await db.delete(operationLogs).where(sql`"created_at" < ${cutoffStr}`);
    const deletedCount = (result as any)?.changes ?? 0;
    if (deletedCount > 0) {
      log.info(`[操作日志] 清理过期日志 ${deletedCount} 条（保留最近 ${daysToKeep} 天）`);
    }
    return deletedCount;
  } catch (error: any) {
    log.error('[操作日志] 清理失败:', error.message);
    return 0;
  }
}
