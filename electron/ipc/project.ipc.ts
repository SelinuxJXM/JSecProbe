import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, like, and, desc, count, sql, not, or, lte, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import type { ProjectListParams } from '../../shared/types';
import { writeOperationLog } from '../utils/operation-log';
import { wrap, wrapRaw } from '../utils/ipc-wrapper';
import { resolveStandardIdForProject } from '../services/assessment-progress';
import {
  exportProjectArchive,
  previewProjectArchive,
  importProjectArchive,
  isArchiveEncrypted,
} from '../services/project-archive.service';
import { validateFsPath, validateReadablePath, authorizeUserFiles } from '../utils/path-resolver';

async function calcProjectProgress(projectId: string): Promise<number> {
  try {
    const db = getDb();
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });
    if (!project) return 0;

    // 解析项目扩展类型（与 assessment.ipc.ts 保持一致）
    const EXT_TYPE_MAP: Record<string, string> = {
      '安全通用要求': 'general',
      '云计算安全扩展要求': 'cloud',
      '移动互联安全扩展要求': 'mobile',
      '物联网安全扩展要求': 'iot',
      '工业控制系统安全扩展要求': 'industrial',
      '大数据安全扩展要求': 'bigdata',
      '大数据安全扩展要求（国标附录）': 'bigdata',
      '关键信息基础设施安全扩展要求': 'cii',
    };
    const projectExtCodes: string[] = [];
    if (project.extensionType) {
      for (const t of project.extensionType.split(',').filter(Boolean)) {
        const code = EXT_TYPE_MAP[t.trim()] || t.trim();
        if (!projectExtCodes.includes(code)) projectExtCodes.push(code);
      }
    }

    // 构建扩展类型过滤条件
    const extOrConditions = [eq(schema.assessmentItems.extensionType, 'general')];
    for (const ext of projectExtCodes) {
      extOrConditions.push(eq(schema.assessmentItems.extensionType, ext));
    }
    const extOr = or(...extOrConditions);

    // 获取项目所有测评对象
    const allAssets = await db.query.assets.findMany({
      where: and(
        eq(schema.assets.projectId, projectId),
        eq(schema.assets.isAssessmentTarget, 1),
      ),
    });
    // security_personnel 是登记类信息，不参与统计
    const assets = allAssets.filter(a => a.category !== 'security_personnel');

    // 按层面统计资产数量
    const CATEGORY_TO_DOMAIN: Record<string, string> = {
      'server_storage': 'secure_computing',
      'sys_doc': 'secure_computing',
      'network_device': 'secure_computing',
      'security_device': 'secure_computing',
      'business_app': 'secure_computing',
      'terminal': 'secure_computing',
      'management_platform': 'secure_computing',
      'machine_room': 'secure_physical',
      'data_resource': 'secure_computing',
      'network_boundary': 'secure_boundary',
      'data_category': 'secure_computing',
      'other_asset': 'secure_computing',
      'crypto_product': 'secure_computing',
    };
    const domainAssetCounts: Record<string, number> = {};
    for (const asset of assets) {
      const domainId = CATEGORY_TO_DOMAIN[asset.category] || 'secure_computing';
      domainAssetCounts[domainId] = (domainAssetCounts[domainId] || 0) + 1;
    }

    // 获取全局层面的测评项（assetId为空的项）
    const standardId = project.standardId;
    const globalItems = await db.query.assessmentItems.findMany({
      where: and(
        eq(schema.assessmentItems.standardId, standardId),
        extOr,
        ...(project.level ? [lte(schema.assessmentItems.minLevel, project.level)] : [])
      ),
      columns: { domain: true },
    });

    // 按层面统计测评项数量
    const domainItemCounts: Record<string, number> = {};
    for (const item of globalItems) {
      domainItemCounts[item.domain] = (domainItemCounts[item.domain] || 0) + 1;
    }

    // 全局层面列表：动态推导（凡不属于资产映射层面的域均为全局层面），
    // 兼容电力等行业标准的额外安全层面（如 domain-0「总体要求」）；与 report.service / 前端口径一致
    const assetDomainIds = new Set(Object.values(CATEGORY_TO_DOMAIN));
    const GLOBAL_DOMAINS = Object.keys(domainItemCounts).filter(d => !assetDomainIds.has(d));

    // 总项数 = Σ(每个层面的资产数 × 该层面测评项数) + 全局层面测评项数
    let total = 0;
    for (const [domainId, assetCount] of Object.entries(domainAssetCounts)) {
      const itemCount = domainItemCounts[domainId] || 0;
      total += assetCount * itemCount;
    }
    for (const domainId of GLOBAL_DOMAINS) {
      const itemCount = domainItemCounts[domainId] || 0;
      if (itemCount > 0 && !domainAssetCounts[domainId]) {
        total += itemCount;
      }
    }
    if (total === 0) total = 1;

    // 适用范围条件（用于子查询过滤itemId）
    const applicableConditions = [
      eq(schema.assessmentItems.standardId, standardId),
      extOr,
    ];
    if (project.level) {
      applicableConditions.push(lte(schema.assessmentItems.minLevel, project.level));
    }
    const itemIdsSubquery = db
      .select({ id: schema.assessmentItems.id })
      .from(schema.assessmentItems)
      .where(and(...applicableConditions));

    // 有效资产ID集合（防止孤儿记录影响统计）
    const validAssetIds = new Set(assets.map(a => a.id));
    const validAssetIdsArray = Array.from(validAssetIds);

    // 已完成：有判定记录的行数（每个资产的每个测评项是一行）
    const doneRecords = await db
      .select({ value: count() })
      .from(schema.assessmentRecords)
      .where(and(
        eq(schema.assessmentRecords.projectId, projectId),
        inArray(schema.assessmentRecords.itemId, itemIdsSubquery),
        sql`result IN ('compliant', 'conform', 'partial', 'non_compliant', 'nonconform', 'not_applicable')`,
        validAssetIdsArray.length > 0
          ? or(
              sql`(asset_id IS NULL OR asset_id = '')`,
              inArray(schema.assessmentRecords.assetId, validAssetIdsArray)
            )
          : sql`(asset_id IS NULL OR asset_id = '')`
      ));
    const done = doneRecords[0]?.value || 0;

    const progress = Math.min(100, Math.round((done / total) * 100));
    await db.update(schema.projects)
      .set({ progress })
      .where(eq(schema.projects.id, projectId));
    return progress;
  } catch {
    return 0;
  }
}

/**
 * 校准全部项目的 assetCount 冗余字段。
 * 该字段此前仅在备份恢复时写入，日常增删资产从不更新，导致列表/仪表盘统计漂移。
 * 采用单条 UPDATE 子查询按 assets 表实际计数回写，项目列表每次加载时调用一次。
 */
export async function recalculateProjectAssetCounts(): Promise<void> {
  try {
    const db = getDb();
    await db.run(sql`
      UPDATE projects
      SET asset_count = (
        SELECT COUNT(*) FROM assets
        WHERE assets.project_id = projects.id AND assets.is_assessment_target = 1
      )
    `);
  } catch (error) {
    log.warn('校准项目资产数失败:', error);
  }
}

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', wrap(async (_event, params: ProjectListParams) => {
      const db = getDb();
      // 每次列表加载前校准 assetCount 冗余字段，杜绝与 assets 表漂移
      await recalculateProjectAssetCounts();
      const { page = 1, pageSize = 20, keyword, status, level, excludeArchived } = params;

      const conditions = [];
      if (keyword) {
        const escapedKeyword = keyword.replace(/[%_\\]/g, '\\$&');
        conditions.push(sql`${schema.projects.name} LIKE ${`%${escapedKeyword}%`} ESCAPE '\\'`);
      }
      if (status) {
        conditions.push(eq(schema.projects.status, status));
      }
      if (level) {
        conditions.push(eq(schema.projects.level, level));
      }
      if (excludeArchived) {
        conditions.push(not(eq(schema.projects.status, 'archived')));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const totalResult = await db
        .select({ value: count() })
        .from(schema.projects)
        .where(whereClause);
      const total = totalResult[0]?.value || 0;

      const list = await db
        .select()
        .from(schema.projects)
        .where(whereClause)
        .orderBy(desc(schema.projects.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      for (const project of list) {
        await calcProjectProgress(project.id);
      }

      const updatedList = await db
        .select()
        .from(schema.projects)
        .where(whereClause)
        .orderBy(desc(schema.projects.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        list: updatedList.map((p) => ({
          id: p.id,
          name: p.name,
          projectNo: p.projectNo || undefined,
          systemName: p.systemName,
          assessedUnit: p.assessedUnit || undefined,
          standardSystem: p.standardSystem || undefined,
          levelCombo: p.levelCombo || undefined,
          extensionType: p.extensionType || undefined,
          level: p.level,
          standardId: p.standardId,
          status: p.status as any,
          customerName: p.customerName || undefined,
          assessor: p.assessor || undefined,
          startDate: p.startDate || undefined,
          endDate: p.endDate || undefined,
          description: p.description || undefined,
          assetCount: p.assetCount,
          complianceRate: p.complianceRate || undefined,
          progress: p.progress || 0,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        total,
      };
    })
  );

  ipcMain.handle('project:getStatistics', wrap(async () => {
      const db = getDb();

      const totalResult = await db
        .select({ value: count() })
        .from(schema.projects);
      const total = totalResult[0]?.value || 0;

      const statusGroups = await db
        .select({
          status: schema.projects.status,
          count: count(),
        })
        .from(schema.projects)
        .groupBy(schema.projects.status);

      const statusCounts: Record<string, number> = {
        draft: 0,
        in_progress: 0,
        completed: 0,
        archived: 0,
      };
      for (const row of statusGroups) {
        statusCounts[row.status] = row.count;
      }

      const levelGroups = await db
        .select({
          level: schema.projects.level,
          count: count(),
        })
        .from(schema.projects)
        .groupBy(schema.projects.level);

      const levelCounts: Record<number, number> = { 2: 0, 3: 0, 4: 0 };
      let otherLevelCount = 0;
      for (const row of levelGroups) {
        if (row.level >= 2 && row.level <= 4) {
          levelCounts[row.level] = row.count;
        } else {
          otherLevelCount += row.count;
        }
      }

      const assetResult = await db
        .select({ value: sql<number>`coalesce(sum(${schema.projects.assetCount}), 0)` })
        .from(schema.projects);
      const assetTotal = Number(assetResult[0]?.value) || 0;

      return {
        projectCount: total,
        inProgressCount: statusCounts.in_progress,
        completedCount: statusCounts.completed,
        draftCount: statusCounts.draft,
        archivedCount: statusCounts.archived,
        level2Count: levelCounts[2],
        level3Count: levelCounts[3],
        level4Count: levelCounts[4],
        otherLevelCount,
        assetCount: assetTotal,
      };
    })
  );

  ipcMain.handle('project:getTrend', wrap(async () => {
    const db = getDb();
    const rows = await db
      .select({ createdAt: schema.projects.createdAt })
      .from(schema.projects);

    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const createdMap: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
    let beforeBase = 0;
    for (const row of rows) {
      if (!row.createdAt) continue;
      const d = new Date(row.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in createdMap) {
        createdMap[key] += 1;
      } else if ((months[0] ?? '') > key) {
        beforeBase += 1;
      }
    }

    const created = months.map((m) => createdMap[m]);
    const cumulative: number[] = [];
    let running = beforeBase;
    for (const c of created) {
      running += c;
      cumulative.push(running);
    }

    return { months, created, cumulative };
  })
  );

  ipcMain.handle('project:get', wrap(async (_event, id: string) => {
      const db = getDb();
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, id),
      });
      if (!project) throw new Error('项目不存在');
      return project;
    })
  );

  // 解析项目适用的标准 ID（项目绑定值 → 同等级 → 默认 → 首条；绑定值指向已删除标准时自动回落）。
  // 前端 onsite-verification 依赖它避免硬编码标准 ID；此前只有 preload 声明、主进程未注册 → 调用必失败。
  ipcMain.handle('project:resolveStandardId', wrap(async (_event, projectId: string) => {
      return await resolveStandardIdForProject(projectId);
    })
  );

  ipcMain.handle('project:create', wrap(async (_event, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();
      const id = randomUUID();

      // 如果传入了 levelCombo，自动计算 level 值（优先使用前端传入的）
      let level = Number(data.level);
      if (data.levelCombo && !level) {
        const match = data.levelCombo.match(/S(\d)A(\d)G(\d)/);
        if (match) {
          level = Math.max(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
        }
      }
      if (!level) level = 3; // 默认三级

      // 根据等级选择对应的标准库
      const standardId = data.standardId || (level === 2 ? 'gb-t-22239-2019-l2' : 'gb-t-22239-2019-l3');

      // 自动生成项目编号 DJCP-XXX
      let projectNo = data.projectNo;
      if (!projectNo) {
        const allProjects = await db.select({ projectNo: schema.projects.projectNo })
          .from(schema.projects)
          .where(like(schema.projects.projectNo, 'DJCP-%'));
        
        let maxNum = 0;
        for (const p of allProjects) {
          const match = p.projectNo?.match(/DJCP-(\d+)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
          }
        }
        const nextNum = maxNum + 1;
        projectNo = `DJCP-${String(nextNum).padStart(3, '0')}`;
      }

      await db.insert(schema.projects).values({
        id,
        name: data.name,
        projectNo,
        systemName: data.systemName,
        assessedUnit: data.assessedUnit,
        standardSystem: data.standardSystem,
        levelCombo: data.levelCombo,
        extensionType: data.extensionType,
        level,
        standardId,
        status: data.status || 'draft',
        customerName: data.customerName,
        assessor: data.assessor,
        startDate: data.startDate,
        endDate: data.endDate,
        description: data.description,
        progress: data.progress || 0,
        createdAt: now,
        updatedAt: now,
      });

      calcProjectProgress(id).catch((err) => {
        log.error('[project:create] 进度计算失败:', err);
      });

      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, id),
      });
      if (!project) return;
      await writeOperationLog({
        action: 'create',
        module: 'project',
        targetId: id,
        targetName: project?.name || data.name,
        description: `创建项目: ${project?.name || data.name}`,
      });

      return project;
    })
  );


  ipcMain.handle('project:update', wrap(async (_event, id: string, data: any) => {
      const db = getDb();
      const now = new Date().toISOString();

      // 如果传入了 levelCombo，自动计算 level 值
      let level = data.level;
      if (data.levelCombo) {
        const match = data.levelCombo.match(/S(\d)A(\d)G(\d)/);
        if (match) {
          level = Math.max(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
        }
      }

      // 显式字段白名单，防止 Mass Assignment 覆盖 id/createdAt/standardId/projectNo 等内部字段
      const {
        name, systemName, assessedUnit, standardSystem, levelCombo,
        extensionType, status, customerName, assessor, startDate, endDate,
        description, progress,
      } = data;

      await db.update(schema.projects)
        .set({
          name, systemName, assessedUnit, standardSystem, levelCombo,
          extensionType, level, status, customerName, assessor, startDate,
          endDate, description, progress, updatedAt: now,
        })
        .where(eq(schema.projects.id, id));

      calcProjectProgress(id).catch((err) => {
        log.error('[project:update] 进度计算失败:', err);
      });

      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, id),
      });
      if (!project) return;
      await writeOperationLog({
        action: 'update',
        module: 'project',
        targetId: id,
        targetName: project?.name || data.name,
        description: `更新项目: ${project?.name || data.name}`,
      });

      return project;
    })
  );

  ipcMain.handle('project:remove', wrap(async (_event, id: string) => {
      const db = getDb();
      const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
      db.transaction((tx) => {
        // 先收集关联 id，再级联删除，避免遗留孤儿数据
        const assetRows = tx.select({ id: schema.assets.id }).from(schema.assets).where(eq(schema.assets.projectId, id)).all();
        const assetIds = assetRows.map(a => a.id);
        const taskRows = tx.select({ id: schema.collectionTasks.id, connectionId: schema.collectionTasks.connectionId }).from(schema.collectionTasks).where(eq(schema.collectionTasks.projectId, id)).all();
        const taskIds = taskRows.map(t => t.id);
        // 采集任务引用的连接配置 id（去重、排除本地兜底的空串）
        const taskConnIds = [...new Set(taskRows.map(t => t.connectionId).filter(Boolean))] as string[];

        tx.delete(schema.assessmentRecords).where(eq(schema.assessmentRecords.projectId, id)).run();
        tx.delete(schema.issues).where(eq(schema.issues.projectId, id)).run();
        tx.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, id)).run();
        if (taskIds.length > 0) {
          tx.delete(schema.collectionResults).where(inArray(schema.collectionResults.taskId, taskIds)).run();
        }
        tx.delete(schema.collectionTasks).where(eq(schema.collectionTasks.projectId, id)).run();
        tx.delete(schema.collectionDocuments).where(eq(schema.collectionDocuments.projectId, id)).run();
        // P1-14：清理「无资产归属」的孤儿连接配置。
        // connection_profiles.asset_id 允许为空（手动投放的采集目标），这类行无法随资产级联删除，
        // 项目删掉后仍留在库里 —— 而它携带 password_encrypted，等同于凭据残留。
        // 只清理已不被任何采集任务引用的配置，避免误删仍在其他项目中使用的共用配置。
        if (taskConnIds.length > 0) {
          const stillUsedRows = tx
            .select({ connectionId: schema.collectionTasks.connectionId })
            .from(schema.collectionTasks)
            .where(inArray(schema.collectionTasks.connectionId, taskConnIds))
            .all();
          const stillUsed = new Set(stillUsedRows.map(r => r.connectionId));
          const orphanConnIds = taskConnIds.filter(cid => !stillUsed.has(cid));
          if (orphanConnIds.length > 0) {
            const res = tx.delete(schema.connectionProfiles).where(
              and(
                inArray(schema.connectionProfiles.id, orphanConnIds),
                or(
                  isNull(schema.connectionProfiles.assetId),
                  eq(schema.connectionProfiles.assetId, '')
                )
              )
            ).run();
            if (res.changes > 0) {
              log.info(`[project:remove] 已清理 ${res.changes} 条无资产归属的孤儿连接配置（含加密凭据）`);
            }
          }
        }
        if (assetIds.length > 0) {
          tx.delete(schema.assetConnections).where(inArray(schema.assetConnections.assetId, assetIds)).run();
          tx.delete(schema.connectionProfiles).where(inArray(schema.connectionProfiles.assetId, assetIds)).run();
        }
        tx.delete(schema.assets).where(eq(schema.assets.projectId, id)).run();
        tx.delete(schema.projects).where(eq(schema.projects.id, id)).run();
      });
      writeOperationLog({
        action: 'delete',
        module: 'project',
        targetId: id,
        targetName: project?.name,
        description: `删除项目: ${project?.name || id}`,
      });
    }, { moduleName: 'project', requireSession: true })
  );

  ipcMain.handle('project:export', wrapRaw(async (_event, projectId: string) => {
    try {
      const db = getDb();
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });
      if (!project) return { success: false, error: new Error('项目不存在') };

      const assets = await db.query.assets.findMany({
        where: eq(schema.assets.projectId, projectId),
      });

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('项目信息');

      ws.columns = [
        { header: '项目名称', key: 'name', width: 20 },
        { header: '项目编号', key: 'projectNo', width: 18 },
        { header: '系统名称', key: 'systemName', width: 20 },
        { header: '被测单位', key: 'assessedUnit', width: 20 },
        { header: '保护等级', key: 'level', width: 10 },
        { header: '等级组合', key: 'levelCombo', width: 12 },
        { header: '标准体系', key: 'standardSystem', width: 16 },
        { header: '扩展类型', key: 'extensionType', width: 20 },
        { header: '资产数', key: 'assetCount', width: 10 },
        { header: '状态', key: 'status', width: 12 },
      ];

      ws.addRow({
        name: project.name,
        projectNo: project.projectNo,
        systemName: project.systemName,
        assessedUnit: project.assessedUnit,
        level: `第${project.level}级`,
        levelCombo: project.levelCombo,
        standardSystem: project.standardSystem,
        extensionType: project.extensionType,
        assetCount: assets.length,
        status: project.status,
      });

      ws.addRow([]);
      ws.addRow(['资产列表']);
      ws.addRow(['资产名称', 'IP地址', '类型', '操作系统', '说明']);
      for (const asset of assets) {
        ws.addRow([asset.name, asset.ip, asset.category, asset.os, asset.description]);
      }

      const result = await dialog.showSaveDialog({
        defaultPath: `${project.name}_导出数据.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (result.canceled) return { success: false, error: new Error('用户取消') };

      await workbook.xlsx.writeFile(result.filePath!);
      return { success: true, data: { path: result.filePath } };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));

  ipcMain.handle('project:exportAll', wrapRaw(async (_event, projectIds?: string[]) => {
    try {
      const db = getDb();
      const projects = (projectIds && projectIds.length
        ? await db.select().from(schema.projects).where(inArray(schema.projects.id, projectIds))
        : await db.select().from(schema.projects)) as Array<typeof schema.projects.$inferSelect>;

      const STATUS_LABEL: Record<string, string> = {
        draft: '草稿',
        in_progress: '进行中',
        completed: '已完成',
        archived: '已归档',
      };

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('项目列表');

      ws.columns = [
        { header: '项目名称', key: 'name', width: 20 },
        { header: '项目编号', key: 'projectNo', width: 18 },
        { header: '系统名称', key: 'systemName', width: 20 },
        { header: '被测单位', key: 'assessedUnit', width: 20 },
        { header: '客户名称', key: 'customerName', width: 20 },
        { header: '保护等级', key: 'level', width: 10 },
        { header: '等级组合', key: 'levelCombo', width: 12 },
        { header: '标准体系', key: 'standardSystem', width: 16 },
        { header: '扩展类型', key: 'extensionType', width: 20 },
        { header: '测评师', key: 'assessor', width: 14 },
        { header: '开始日期', key: 'startDate', width: 14 },
        { header: '结束日期', key: 'endDate', width: 14 },
        { header: '说明', key: 'description', width: 30 },
        { header: '资产数', key: 'assetCount', width: 10 },
        { header: '状态', key: 'status', width: 12 },
        { header: '进度', key: 'progress', width: 10 },
      ];

      for (const p of projects) {
        ws.addRow({
          name: p.name,
          projectNo: p.projectNo ?? '',
          systemName: p.systemName,
          assessedUnit: p.assessedUnit ?? '',
          customerName: p.customerName ?? '',
          level: `第${p.level}级`,
          levelCombo: p.levelCombo ?? '',
          standardSystem: p.standardSystem ?? '',
          extensionType: p.extensionType ?? '',
          assessor: p.assessor ?? '',
          startDate: p.startDate ?? '',
          endDate: p.endDate ?? '',
          description: p.description ?? '',
          assetCount: p.assetCount ?? 0,
          status: STATUS_LABEL[p.status] ?? p.status,
          progress: `${p.progress}%`,
        });
      }

      const result = await dialog.showSaveDialog({
        defaultPath: projects.length === 1 ? `${projects[0].name}_项目清单.xlsx` : `项目清单_${projects.length}个.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, error: new Error('用户取消') };
      const safePath = await validateFsPath(result.filePath);

      await workbook.xlsx.writeFile(safePath);
      return { success: true, data: { path: safePath } };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));

  // ============ 项目归档：把项目的全部数据（含附件与依赖标准）整体导出 / 还原 ============
  //
  // 与上面 Excel 清单导出的分工：
  //  - Excel 清单 = 给人看/给台账用的表格，只含项目字段，不可回导；
  //  - 项目归档   = 含资产、测评记录、问题、采集结果、附件、依赖标准的完整数据包，可原样还原。

  /** 选择待导入的归档包，返回路径与是否加密（加密时前端需先要口令再预览） */
  ipcMain.handle('project:selectArchive', wrapRaw(async () => {
    try {
      const result = await dialog.showOpenDialog({
        filters: [{ name: '项目归档包', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: new Error('用户取消') };
      }
      authorizeUserFiles(result.filePaths);
      const safePath = await validateReadablePath(result.filePaths[0], '归档文件');
      return { success: true, data: { path: safePath, encrypted: isArchiveEncrypted(safePath) } };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));

  ipcMain.handle('project:exportArchive', wrapRaw(async (
    _event,
    payload: { projectIds: string[]; password?: string; includeStandards?: boolean; includeCredentials?: boolean },
  ) => {
    try {
      const projectIds = payload?.projectIds || [];
      if (!projectIds.length) return { success: false, error: new Error('请至少选择一个项目') };

      const db = getDb();
      const rows = (await db
        .select({ id: schema.projects.id, name: schema.projects.name })
        .from(schema.projects)
        .where(inArray(schema.projects.id, projectIds))) as Array<{ id: string; name: string }>;
      if (!rows.length) return { success: false, error: new Error('所选项目不存在') };

      const stamp = new Date().toISOString().slice(0, 10);
      const defaultName = rows.length === 1
        ? `${rows[0].name}_项目归档_${stamp}.zip`
        : `项目归档_${rows.length}个项目_${stamp}.zip`;

      const result = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: '项目归档包', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, error: new Error('用户取消') };
      const safePath = await validateFsPath(result.filePath);

      const res = await exportProjectArchive({
        projectIds,
        destPath: safePath,
        password: payload?.password,
        includeStandards: payload?.includeStandards !== false,
        includeCredentials: payload?.includeCredentials === true,
      });
      if (!res.success) return { success: false, error: new Error(res.error || '导出失败') };

      await writeOperationLog({
        action: 'export',
        module: 'project',
        targetId: projectIds.join(','),
        targetName: rows.map(r => r.name).join('、'),
        description: `导出项目归档: ${rows.length} 个项目 / ${res.fileCount || 0} 个附件`,
      });
      return { success: true, data: res };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));

  ipcMain.handle('project:previewArchive', wrapRaw(async (
    _event,
    payload: { archivePath: string; password?: string },
  ) => {
    try {
      if (!payload?.archivePath) return { success: false, error: new Error('未选择归档文件') };
      const safePath = await validateReadablePath(payload.archivePath, '归档文件');
      const res = await previewProjectArchive(safePath, payload?.password);
      if (!res.success) return { success: false, error: new Error(res.error || '无法读取归档') };
      return { success: true, data: res };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));

  ipcMain.handle('project:importArchive', wrapRaw(async (
    _event,
    payload: { archivePath: string; password?: string; strategy: 'skip' | 'overwrite' | 'copy' },
  ) => {
    try {
      if (!payload?.archivePath) return { success: false, error: new Error('未选择归档文件') };
      const safePath = await validateReadablePath(payload.archivePath, '归档文件');
      const res = await importProjectArchive({
        archivePath: safePath,
        password: payload?.password,
        strategy: payload?.strategy || 'skip',
      });
      if (!res.success) return { success: false, error: new Error(res.error || '导入失败') };

      // 冗余字段回写：assetCount / progress 都是快照值，归档带来的是导出当时的数字，
      // 按本机真实的资产数与测评记录重算，避免列表页显示与点进去看到的不一致
      await recalculateProjectAssetCounts();
      const db = getDb();
      for (const item of res.imported) {
        try {
          const progress = await calcProjectProgress(item.id);
          await db
            .update(schema.projects)
            .set({ progress, updatedAt: new Date().toISOString() })
            .where(eq(schema.projects.id, item.id));
        } catch (e) {
          log.warn(`[项目归档] 进度重算失败（沿用归档值）: ${item.id}`, e);
        }
      }

      await writeOperationLog({
        action: 'import',
        module: 'project',
        targetId: res.imported.map(i => i.id).join(','),
        targetName: res.imported.map(i => i.name).join('、'),
        description: `导入项目归档: ${res.imported.length} 个项目 / ${res.restoredFiles} 个附件（冲突策略: ${payload?.strategy || 'skip'}）`,
        detailJson: JSON.stringify({ warnings: res.warnings, skipped: res.skipped }),
      });
      return { success: true, data: res };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));
}