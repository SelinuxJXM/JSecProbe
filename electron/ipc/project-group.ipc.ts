import { ipcMain } from 'electron';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, like, and, desc, count, sql, not, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { ProjectGroup, ProjectGroupListParams } from '../../shared/types';
import { writeOperationLog } from '../utils/operation-log';
import { wrap } from '../utils/ipc-wrapper';
import { cascadeDeleteProject } from './project.ipc';
import { deriveGroupStatus, syncGroupStatusFromSystems } from '../services/project-status.service';

/**
 * 项目分组（委托 / 合同批次）IPC。
 *
 * 与 `project.ipc.ts` 的分工：一条 projects 记录 = 一个被测系统，
 * 分组只承载项目级台账字段与「系统列表」的归属关系。
 * 因此这里不碰 assets / assessment_records / issues —— 那些仍按 project_id 隔离，
 * 每个系统天然独立。
 */

interface SystemStats {
  systemCount: number;
  progress: number;
  /** 名下系统状态推导出的项目状态；无系统时为 null（保持库里的值） */
  derivedStatus: 'draft' | 'in_progress' | 'completed' | null;
}

/** 下一个项目编号 DJCP-XXX：只在分组内排号，系统行不再生成编号 */
async function nextProjectNo(): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ projectNo: schema.projectGroups.projectNo })
    .from(schema.projectGroups)
    .where(like(schema.projectGroups.projectNo, 'DJCP-%'));
  let maxNum = 0;
  for (const row of rows) {
    const m = row.projectNo?.match(/DJCP-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `DJCP-${String(maxNum + 1).padStart(3, '0')}`;
}

/** 一次聚合出所有分组的系统数、平均测评进度与推导状态，避免列表 N+1 查询 */
async function loadSystemStats(): Promise<Map<string, SystemStats>> {
  const db = getDb();
  const rows = await db
    .select({
      groupId: schema.projects.groupId,
      status: schema.projects.status,
      progress: schema.projects.progress,
    })
    .from(schema.projects);
  const acc = new Map<string, { count: number; progressSum: number; statuses: string[] }>();
  for (const row of rows) {
    if (!row.groupId) continue;
    const a = acc.get(row.groupId) || { count: 0, progressSum: 0, statuses: [] as string[] };
    a.count += 1;
    a.progressSum += row.progress || 0;
    a.statuses.push(row.status);
    acc.set(row.groupId, a);
  }
  const map = new Map<string, SystemStats>();
  for (const [groupId, a] of acc) {
    map.set(groupId, {
      systemCount: a.count,
      progress: a.count ? Math.round(a.progressSum / a.count) : 0,
      derivedStatus: deriveGroupStatus(a.statuses),
    });
  }
  return map;
}

function toGroup(row: any, stats?: SystemStats): ProjectGroup {
  return {
    id: row.id,
    name: row.name,
    projectNo: row.projectNo || undefined,
    assessedUnit: row.assessedUnit || undefined,
    customerName: row.customerName || undefined,
    assessor: row.assessor || undefined,
    startDate: row.startDate || undefined,
    endDate: row.endDate || undefined,
    description: row.description || undefined,
    // 业务状态由名下系统推导（读时兜底，存量数据也立即生效）；手动归档态优先
    status: (row.status === 'archived' || !stats?.derivedStatus
      ? row.status
      : stats.derivedStatus) as ProjectGroup['status'],
    sortOrder: row.sortOrder ?? 0,
    systemCount: stats?.systemCount ?? 0,
    progress: stats?.progress ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerProjectGroupHandlers(): void {
  ipcMain.handle('projectGroup:list', wrap(async (_event, params: ProjectGroupListParams) => {
    const db = getDb();
    const { page = 1, pageSize = 20, keyword, status, excludeArchived } = params || ({} as ProjectGroupListParams);

    const conditions = [];
    if (keyword) {
      const escaped = keyword.replace(/[%_\\]/g, '\\$&');
      const pattern = `%${escaped}%`;
      conditions.push(or(
        sql`${schema.projectGroups.name} LIKE ${pattern} ESCAPE '\\'`,
        sql`${schema.projectGroups.projectNo} LIKE ${pattern} ESCAPE '\\'`,
        sql`${schema.projectGroups.assessedUnit} LIKE ${pattern} ESCAPE '\\'`,
      ));
    }
    if (status) {
      conditions.push(eq(schema.projectGroups.status, status));
    }
    if (excludeArchived) {
      conditions.push(not(eq(schema.projectGroups.status, 'archived')));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const totalResult = await db
      .select({ value: count() })
      .from(schema.projectGroups)
      .where(whereClause);
    const total = totalResult[0]?.value || 0;

    const rows = await db
      .select()
      .from(schema.projectGroups)
      .where(whereClause)
      .orderBy(desc(schema.projectGroups.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const stats = await loadSystemStats();
    return {
      list: rows.map(row => toGroup(row, stats.get(row.id))),
      total,
    };
  }, 'projectGroup'));

  ipcMain.handle('projectGroup:get', wrap(async (_event, id: string) => {
    const db = getDb();
    const row = await db.query.projectGroups.findFirst({ where: eq(schema.projectGroups.id, id) });
    if (!row) throw new Error('项目不存在');
    const stats = await loadSystemStats();
    return toGroup(row, stats.get(id));
  }, 'projectGroup'));

  ipcMain.handle('projectGroup:create', wrap(async (_event, data: any) => {
    const db = getDb();
    const name = String(data?.name || '').trim();
    if (!name) throw new Error('项目名称不能为空');

    const now = new Date().toISOString();
    const id = randomUUID();
    const projectNo = String(data.projectNo || '').trim() || await nextProjectNo();

    await db.insert(schema.projectGroups).values({
      id,
      name,
      projectNo,
      assessedUnit: data.assessedUnit,
      customerName: data.customerName,
      assessor: data.assessor,
      startDate: data.startDate,
      endDate: data.endDate,
      description: data.description,
      status: data.status || 'draft',
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    });

    const row = await db.query.projectGroups.findFirst({ where: eq(schema.projectGroups.id, id) });
    await writeOperationLog({
      action: 'create',
      module: 'projectGroup',
      targetId: id,
      targetName: name,
      description: `创建项目: ${name}`,
    });
    return toGroup(row, { systemCount: 0, progress: 0, derivedStatus: null });
  }, 'projectGroup'));

  ipcMain.handle('projectGroup:update', wrap(async (_event, id: string, data: any) => {
    const db = getDb();
    // 显式字段白名单，防止 Mass Assignment 覆盖 id / createdAt 等内部字段
    const {
      name, projectNo, assessedUnit, customerName, assessor,
      startDate, endDate, description, status, sortOrder,
    } = data || {};
    if (name !== undefined && !String(name).trim()) throw new Error('项目名称不能为空');

    await db.update(schema.projectGroups)
      .set({
        name, projectNo, assessedUnit, customerName, assessor,
        startDate, endDate, description, status, sortOrder,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.projectGroups.id, id));

    // 业务状态由系统状态推导：取消归档（status 传了非 archived 值）时回推真实状态，
    // 归档本身（archived）保持手动语义不动
    if (status !== undefined && status !== 'archived') {
      await syncGroupStatusFromSystems(id);
    }

    const row = await db.query.projectGroups.findFirst({ where: eq(schema.projectGroups.id, id) });
    if (!row) throw new Error('项目不存在');
    await writeOperationLog({
      action: 'update',
      module: 'projectGroup',
      targetId: id,
      targetName: row.name,
      description: `更新项目: ${row.name}`,
    });
    const stats = await loadSystemStats();
    return toGroup(row, stats.get(id));
  }, 'projectGroup'));

  ipcMain.handle('projectGroup:remove', wrap(async (_event, id: string) => {
    const db = getDb();
    const group = await db.query.projectGroups.findFirst({ where: eq(schema.projectGroups.id, id) });
    if (!group) throw new Error('项目不存在');

    // 分组删除必须把名下所有系统连同学测数据一起清掉，否则会留下
    // 挂不上任何分组的孤儿系统（列表里再也点不到，数据却还在）。
    const systems = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.groupId, id));

    db.transaction((tx: any) => {
      for (const system of systems) {
        cascadeDeleteProject(tx, system.id);
      }
      tx.delete(schema.projectGroups).where(eq(schema.projectGroups.id, id)).run();
    });

    await writeOperationLog({
      action: 'delete',
      module: 'projectGroup',
      targetId: id,
      targetName: group.name,
      description: `删除项目: ${group.name}（含 ${systems.length} 个系统）`,
    });
  }, { moduleName: 'projectGroup', requireSession: true }));
}
