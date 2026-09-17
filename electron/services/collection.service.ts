import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { join, dirname } from 'path';
import log from 'electron-log';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { getDbPath } from '../main/paths';
import { writeOperationLog } from '../utils/operation-log';
import * as schema from '../db/schema';
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  CollectionTask,
  CollectionResult,
  CollectionProgress,
  CollectionCommandState,
  CollectionDocument,
} from '../../shared/types';
import { encryptSecret } from './credential.util';
import { createConnector } from './connectors/factory';
import { CommandTimeoutError } from './connectors/connector';

// ============ 多资产并发调度 ============
// 单资产任务内串行执行命令，多个资产任务并发执行，默认并发上限 3（可通过环境变量 COLLECTION_MAX_CONCURRENT 调整）
const DEFAULT_MAX_CONCURRENT = 3;
let activeTaskCount = 0;
const taskQueue: Array<() => Promise<void>> = [];

function getMaxConcurrent(): number {
  const v = Number(process.env.COLLECTION_MAX_CONCURRENT);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_CONCURRENT;
}

function pumpTaskQueue(): void {
  const max = getMaxConcurrent();
  while (activeTaskCount < max && taskQueue.length > 0) {
    const next = taskQueue.shift();
    if (next) void next();
  }
}

async function runWithConcurrency(task: () => Promise<void>): Promise<void> {
  const max = getMaxConcurrent();
  if (activeTaskCount < max) {
    activeTaskCount++;
    try {
      await task();
    } finally {
      activeTaskCount--;
      pumpTaskQueue();
    }
    return;
  }
  await new Promise<void>((resolve) => {
    taskQueue.push(async () => {
      activeTaskCount++;
      try {
        await task();
      } finally {
        activeTaskCount--;
        pumpTaskQueue();
      }
      resolve();
    });
  });
}
import { parseCommandOutput } from './parsers';
import { validateComplianceStatus, sanitizeInput } from '../utils/validation';
import { generateCollectionMarkdown, formatTimestamp } from './markdown.util';

function nowIso(): string {
  return new Date().toISOString();
}

function toProfile(r: typeof schema.connectionProfiles.$inferSelect): ConnectionProfile {
  return {
    id: r.id,
    name: r.name,
    connType: r.connType as ConnectionProfile['connType'],
    host: r.host,
    port: r.port,
    username: r.username,
    authMethod: r.authMethod as ConnectionProfile['authMethod'],
    passwordEncrypted: r.passwordEncrypted,
    privateKeyPath: r.privateKeyPath,
    timeoutMs: r.timeoutMs,
    extraConfig: r.extraConfig,
    assetId: r.assetId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toTask(r: typeof schema.collectionTasks.$inferSelect): CollectionTask {
  return {
    id: r.id,
    projectId: r.projectId,
    assetId: r.assetId,
    connectionId: r.connectionId,
    status: r.status as CollectionTask['status'],
    totalCommands: r.totalCommands,
    completedCommands: r.completedCommands,
    progress: r.progress,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toResult(r: typeof schema.collectionResults.$inferSelect): CollectionResult {
  return {
    id: r.id,
    taskId: r.taskId,
    commandId: r.commandId,
    command: r.command,
    status: r.status as CollectionResult['status'],
    exitCode: r.exitCode,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    durationMs: r.durationMs,
    parsedData: r.parsedData,
    createdAt: r.createdAt,
  };
}

// ============ 连接配置管理 ============

export async function listProfiles(): Promise<ConnectionProfile[]> {
  const db = getDb();
  const rows = await db.select().from(schema.connectionProfiles).orderBy(desc(schema.connectionProfiles.createdAt));
  return rows.map(toProfile);
}

export async function saveProfile(input: ConnectionProfileInput): Promise<ConnectionProfile> {
  const db = getDb();
  const now = nowIso();
  const passwordEncrypted = input.password ? encryptSecret(input.password) : undefined;

  if (input.id) {
    const updateData: Partial<typeof schema.connectionProfiles.$inferInsert> = {
      name: input.name,
      connType: input.connType,
      host: input.host,
      port: input.port ?? null,
      username: input.username ?? null,
      authMethod: input.authMethod ?? 'password',
      privateKeyPath: input.privateKeyPath ?? null,
      timeoutMs: input.timeoutMs ?? 10000,
      extraConfig: input.extraConfig ?? null,
      assetId: input.assetId ?? null,
      updatedAt: now,
    };
    if (passwordEncrypted !== undefined) {
      updateData.passwordEncrypted = passwordEncrypted;
    }
    await db.update(schema.connectionProfiles).set(updateData).where(eq(schema.connectionProfiles.id, input.id));
    const [row] = await db.select().from(schema.connectionProfiles).where(eq(schema.connectionProfiles.id, input.id)).limit(1);
    return toProfile(row);
  }

  const id = randomUUID();
  await db.insert(schema.connectionProfiles).values({
    id,
    name: input.name,
    connType: input.connType,
    host: input.host,
    port: input.port ?? null,
    username: input.username ?? null,
    authMethod: input.authMethod ?? 'password',
    passwordEncrypted: passwordEncrypted ?? '',
    privateKeyPath: input.privateKeyPath ?? null,
    timeoutMs: input.timeoutMs ?? 10000,
    extraConfig: input.extraConfig ?? null,
    assetId: input.assetId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(schema.connectionProfiles).where(eq(schema.connectionProfiles.id, id)).limit(1);
  return toProfile(row);
}

export async function deleteProfile(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.connectionProfiles).where(eq(schema.connectionProfiles.id, id));
}

export async function batchDeleteProfiles(ids: string[]): Promise<{ deleted: number }> {
  const db = getDb();
  if (!ids || ids.length === 0) return { deleted: 0 };
  const validIds = ids.filter((id) => typeof id === 'string' && id.length > 0);
  if (validIds.length === 0) return { deleted: 0 };
  let deleted = 0;
  await db.transaction(async (tx) => {
    const rows = await tx
      .delete(schema.connectionProfiles)
      .where(inArray(schema.connectionProfiles.id, validIds))
      .returning({ id: schema.connectionProfiles.id });
    deleted = rows.length;
  });
  return { deleted };
}

export async function testConnection(id: string): Promise<{ ok: boolean; message?: string }> {
  const db = getDb();
  const [row] = await db.select().from(schema.connectionProfiles).where(eq(schema.connectionProfiles.id, id)).limit(1);
  if (!row) throw new Error('连接配置不存在');
  const profile = toProfile(row);
  const connector = createConnector(profile);
  try {
    const ok = await connector.testConnection(profile);
    return ok ? { ok: true, message: '连接成功' } : { ok: false, message: '连接失败' };
  } catch (err: unknown) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ============ 采集任务 ============

function sendProgress(sender: Electron.WebContents, data: CollectionProgress): void {
  try {
    sender.send('collection:progress', data);
  } catch (err) {
    log.warn('推送采集进度失败:', err);
  }
}

export async function runCollectionTask(
  id: string,
  params: { projectId: string; assetId: string; connectionId: string; commandIds: string[] },
  sender: Electron.WebContents
): Promise<void> {
  const db = getDb();
  const [taskRow] = await db.select().from(schema.collectionTasks).where(eq(schema.collectionTasks.id, id)).limit(1);
  if (!taskRow) return;
  if (taskRow.status === 'canceled' || taskRow.status === 'canceling') {
    return;
  }
  const [profileRow] = await db.select().from(schema.connectionProfiles).where(eq(schema.connectionProfiles.id, params.connectionId)).limit(1);
  if (!profileRow) {
    await db.update(schema.collectionTasks).set({ status: 'failed', finishedAt: nowIso(), updatedAt: nowIso() }).where(eq(schema.collectionTasks.id, id));
    return;
  }
  const profile = toProfile(profileRow);
  const connector = createConnector(profile);

  try {
    try {
      await connector.connect(profile);
    } catch (err) {
      log.warn('首次连接失败，1 秒后重试:', err);
      await new Promise((r) => setTimeout(r, 1000));
      await connector.connect(profile);
    }
    await db.update(schema.collectionTasks).set({ status: 'running', startedAt: nowIso(), updatedAt: nowIso() }).where(eq(schema.collectionTasks.id, id));
  } catch (err: unknown) {
    log.error('连接目标失败:', err);
    await db.update(schema.collectionTasks).set({ status: 'failed', finishedAt: nowIso(), updatedAt: nowIso() }).where(eq(schema.collectionTasks.id, id));
    sendProgress(sender, {
      taskId: id, status: 'failed', stage: 'error',
      message: err instanceof Error ? err.message : String(err),
      percent: 0, completedCommands: 0, totalCommands: params.commandIds.length,
    });
    return;
  }

  try {
    const total = params.commandIds.length;
    let done = 0;
    const commandStates: CollectionCommandState[] = params.commandIds.map((commandId) => ({
      commandId,
      command: '',
      status: 'pending',
    }));
    for (const commandId of params.commandIds) {
      const cur = await db.select().from(schema.collectionTasks).where(eq(schema.collectionTasks.id, id)).limit(1);
      if (!cur[0] || cur[0].status === 'canceled' || cur[0].status === 'canceling') break;
      const [cmd] = await db.select().from(schema.knowledgeCommands).where(eq(schema.knowledgeCommands.id, commandId)).limit(1);
      if (!cmd) continue;
      const state = commandStates.find((s) => s.commandId === commandId);
      if (state) {
        state.command = cmd.command;
        state.status = 'running';
      }
      const cmdStart = Date.now();
      sendProgress(sender, {
        taskId: id,
        status: 'running',
        stage: 'executing',
        message: `正在执行：${cmd.command}`,
        percent: Math.round((done / total) * 100),
        completedCommands: done,
        totalCommands: total,
        commandStates,
      });
      try {
        const exec = await connector.execute(cmd.command);
        const parsedData = parseCommandOutput(cmd.command, exec.stdout, exec.stderr);
        const status = exec.exitCode === 0 ? 'success' : 'failed';
        await db.insert(schema.collectionResults).values({
          id: randomUUID(),
          taskId: id,
          commandId: cmd.id,
          command: cmd.command,
          status,
          exitCode: exec.exitCode,
          stdout: exec.stdout,
          stderr: exec.stderr,
          durationMs: exec.durationMs,
          parsedData,
          createdAt: nowIso(),
        });
        if (state) {
          state.status = status;
          state.durationMs = exec.durationMs;
        }
      } catch (err: unknown) {
        const isTimeout =
          err instanceof CommandTimeoutError ||
          (err && typeof err === 'object' && (err as { name?: string }).name === 'CommandTimeoutError');
        const status = isTimeout ? 'timeout' : 'error';
        const errMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - cmdStart;
        await db.insert(schema.collectionResults).values({
          id: randomUUID(),
          taskId: id,
          commandId: cmd.id,
          command: cmd.command,
          status,
          stderr: errMsg,
          durationMs,
          createdAt: nowIso(),
        });
        if (state) {
          state.status = status;
          state.durationMs = durationMs;
        }
      }
      done++;
      const progress = Math.round((done / total) * 100);
      await db.update(schema.collectionTasks)
        .set({ completedCommands: done, progress, updatedAt: nowIso() })
        .where(eq(schema.collectionTasks.id, id));
      sendProgress(sender, {
        taskId: id,
        status: 'running',
        stage: 'executing',
        message: `已执行：${cmd.command}`,
        percent: progress,
        completedCommands: done,
        totalCommands: total,
        commandStates,
      });
    }

    const cur = await db.select().from(schema.collectionTasks).where(eq(schema.collectionTasks.id, id)).limit(1);
    const canceled = !cur[0] || cur[0].status === 'canceled' || cur[0].status === 'canceling';
    const finalStatus = canceled ? 'canceled' : done < total ? 'partial' : 'success';
    await db.update(schema.collectionTasks)
      .set({ status: finalStatus, progress: canceled ? cur[0]?.progress ?? 0 : 100, finishedAt: nowIso(), updatedAt: nowIso() })
      .where(eq(schema.collectionTasks.id, id));
    sendProgress(sender, {
      taskId: id,
      status: finalStatus,
      stage: 'done',
      message: canceled ? '采集已取消' : '采集完成',
      percent: canceled ? cur[0]?.progress ?? 0 : 100,
      completedCommands: done,
      totalCommands: total,
      commandStates,
    });
  } catch (err: unknown) {
    log.error('采集任务执行失败:', err);
    await db.update(schema.collectionTasks).set({ status: 'failed', finishedAt: nowIso(), updatedAt: nowIso() }).where(eq(schema.collectionTasks.id, id));
    sendProgress(sender, {
      taskId: id,
      status: 'failed',
      stage: 'error',
      message: err instanceof Error ? err.message : String(err),
      percent: 0,
      completedCommands: 0,
      totalCommands: params.commandIds.length,
    });
  } finally {
    try {
      await connector.disconnect();
    } catch (err) {
      log.warn('关闭连接失败:', err);
    }
  }
}

export async function createTask(
  params: { projectId: string; assetId: string; connectionId: string; commandIds: string[] },
  sender: Electron.WebContents
): Promise<CollectionTask> {
  const db = getDb();
  const id = randomUUID();
  const now = nowIso();
  await db.insert(schema.collectionTasks).values({
    id,
    projectId: params.projectId,
    assetId: params.assetId,
    connectionId: params.connectionId,
    status: 'pending',
    totalCommands: params.commandIds.length,
    completedCommands: 0,
    progress: 0,
    createdBy: '',
    createdAt: now,
    updatedAt: now,
  });
  void runWithConcurrency(() => runCollectionTask(id, params, sender));
  const [row] = await db.select().from(schema.collectionTasks).where(eq(schema.collectionTasks.id, id)).limit(1);
  return toTask(row);
}

export async function cancelTask(id: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(schema.collectionTasks).where(eq(schema.collectionTasks.id, id)).limit(1);
  if (!row) return;
  const newStatus = row.status === 'pending' ? 'canceled' : 'canceling';
  await db.update(schema.collectionTasks).set({ status: newStatus, updatedAt: nowIso() }).where(eq(schema.collectionTasks.id, id));
}

export async function listTasks(params: { projectId: string; assetId?: string }): Promise<CollectionTask[]> {
  const db = getDb();
  const conds = [eq(schema.collectionTasks.projectId, params.projectId)];
  if (params.assetId) conds.push(eq(schema.collectionTasks.assetId, params.assetId));
  const rows = await db.select().from(schema.collectionTasks).where(and(...conds)).orderBy(desc(schema.collectionTasks.createdAt));
  return rows.map(toTask);
}

export async function getTask(id: string): Promise<CollectionTask | null> {
  const db = getDb();
  const [row] = await db.select().from(schema.collectionTasks).where(eq(schema.collectionTasks.id, id)).limit(1);
  return row ? toTask(row) : null;
}

export async function listResults(taskId: string): Promise<CollectionResult[]> {
  const db = getDb();
  const rows = await db.select().from(schema.collectionResults)
    .where(eq(schema.collectionResults.taskId, taskId))
    .orderBy(schema.collectionResults.createdAt);
  return rows.map(toResult);
}

// ============ 结果确认回填 ============

export async function confirmResult(params: {
  resultId: string;
  projectId: string;
  itemId: string;
  assetId: string;
  result: string;
  method?: string;
  evidence?: string;
}): Promise<void> {
  validateComplianceStatus(params.result);
  const db = getDb();
  const [res] = await db.select().from(schema.collectionResults).where(eq(schema.collectionResults.id, params.resultId)).limit(1);
  if (!res) throw new Error('采集结果不存在');

  const now = nowIso();
  const commandOutput = [
    `命令: ${res.command}`,
    res.stdout ? `输出:\n${res.stdout}` : '',
    res.stderr ? `[错误输出]\n${res.stderr}` : '',
  ].filter(Boolean).join('\n');
  const evidence = sanitizeInput(params.evidence ?? commandOutput, 5000);

  const [existing] = await db.select().from(schema.assessmentRecords)
    .where(and(
      eq(schema.assessmentRecords.projectId, params.projectId),
      eq(schema.assessmentRecords.itemId, params.itemId),
      eq(schema.assessmentRecords.assetId, params.assetId),
    ))
    .limit(1);

  if (existing) {
    await db.update(schema.assessmentRecords)
      .set({
        result: params.result,
        method: params.method || 'check',
        commandOutput,
        evidence,
        updatedAt: now,
      })
      .where(eq(schema.assessmentRecords.id, existing.id));
  } else {
    await db.insert(schema.assessmentRecords).values({
      id: randomUUID(),
      projectId: params.projectId,
      itemId: params.itemId,
      assetId: params.assetId,
      result: params.result,
      method: params.method || 'check',
      commandOutput,
      evidence,
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    const sessionFile = join(dirname(getDbPath()), 'session.json');
    let operator: { userId?: string; username?: string } | null = null;
    if (fs.existsSync(sessionFile)) {
      const raw = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as { userId?: string; username?: string };
      if (raw?.username) operator = { userId: raw.userId, username: raw.username };
    }
    await writeOperationLog({
      ...(operator || {}),
      action: 'confirmResult',
      module: 'collection',
      targetId: params.resultId,
      targetName: res.command ? res.command.slice(0, 100) : undefined,
      description: `回填采集结果到测评记录：项目 ${params.projectId} / 资产 ${params.assetId} / 测评项 ${params.itemId}，结论 ${params.result}`,
    });
  } catch (err) {
    log.warn('回填审计日志写入失败:', err);
  }
}

// ============ 采集文档（Markdown） ============

function toDocument(r: typeof schema.collectionDocuments.$inferSelect): CollectionDocument {
  return {
    id: r.id,
    taskId: r.taskId,
    projectId: r.projectId,
    assetId: r.assetId,
    assetName: r.assetName,
    host: r.host,
    filePath: r.filePath,
    title: r.title,
    createdAt: r.createdAt,
  };
}

export async function saveDocument(params: {
  taskId: string;
  dirPath: string;
}): Promise<{ filePath: string; title: string }> {
  const db = getDb();
  const [task] = await db.select().from(schema.collectionTasks).where(eq(schema.collectionTasks.id, params.taskId)).limit(1);
  if (!task) throw new Error('采集任务不存在');
  if (!params.dirPath) throw new Error('保存目录不能为空');

  const [profile] = await db.select().from(schema.connectionProfiles).where(eq(schema.connectionProfiles.id, task.connectionId)).limit(1);
  if (!profile) throw new Error('连接配置不存在');

  const results = await db.select().from(schema.collectionResults)
    .where(eq(schema.collectionResults.taskId, task.id))
    .orderBy(schema.collectionResults.createdAt);

  let assetName = '手动目标';
  let assetOs = '';
  let assetId = task.assetId;
  if (!assetId) {
    assetId = profile.assetId || '';
  }
  if (assetId) {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).limit(1);
    if (asset) {
      assetName = asset.name || asset.ip || '未知资产';
      assetOs = asset.os || '';
    }
  }

  const now = new Date().toISOString();
  const title = `自动采集报告_${assetName}_${profile.host}_${formatTimestamp(now)}.md`;
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
  const md = generateCollectionMarkdown({
    assetName,
    host: profile.host,
    os: assetOs,
    username: profile.username || '',
    completedAt: now,
    results: results.map(toResult),
  });

  const filePath = join(params.dirPath, safeTitle);
  await fs.promises.writeFile(filePath, md, 'utf8');

  await db.insert(schema.collectionDocuments).values({
    id: randomUUID(),
    taskId: task.id,
    projectId: task.projectId,
    assetId,
    assetName,
    host: profile.host,
    filePath,
    title: safeTitle,
    createdAt: now,
  });

  log.info(`已生成采集文档: ${filePath}`);
  return { filePath, title: safeTitle };
}

export async function listDocuments(projectId: string): Promise<CollectionDocument[]> {
  const db = getDb();
  const rows = await db.select().from(schema.collectionDocuments)
    .where(eq(schema.collectionDocuments.projectId, projectId))
    .orderBy(desc(schema.collectionDocuments.createdAt));
  return rows.map(toDocument);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.collectionDocuments).where(eq(schema.collectionDocuments.id, id));
}