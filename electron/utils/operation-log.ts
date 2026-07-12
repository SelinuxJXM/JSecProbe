import { getDb } from '../db';
import { operationLogs } from '../db/schema';
import { randomUUID } from 'crypto';
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
      createdAt: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('[操作日志] 写入失败:', error.message);
  }
}
