import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, like, and, desc, count, sql, not, or, lte, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import type { ProjectListParams } from '../../shared/types';
import { writeOperationLog } from '../utils/operation-log';
import { wrap, wrapRaw } from '../utils/ipc-wrapper';

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

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', wrap(async (_event, params: ProjectListParams) => {
      const db = getDb();
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
        tx.delete(schema.assessmentRecords).where(eq(schema.assessmentRecords.projectId, id)).run();
        tx.delete(schema.issues).where(eq(schema.issues.projectId, id)).run();
        tx.delete(schema.projectMembers).where(eq(schema.projectMembers.projectId, id)).run();
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

  ipcMain.handle('project:exportAll', wrapRaw(async () => {
    try {
      const db = getDb();
      const projects = await db.select().from(schema.projects);

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('项目列表');

      ws.columns = [
        { header: '项目名称', key: 'name', width: 20 },
        { header: '项目编号', key: 'projectNo', width: 18 },
        { header: '系统名称', key: 'systemName', width: 20 },
        { header: '被测单位', key: 'assessedUnit', width: 20 },
        { header: '保护等级', key: 'level', width: 10 },
        { header: '等级组合', key: 'levelCombo', width: 12 },
        { header: '标准体系', key: 'standardSystem', width: 16 },
        { header: '扩展类型', key: 'extensionType', width: 20 },
        { header: '状态', key: 'status', width: 12 },
        { header: '进度', key: 'progress', width: 10 },
      ];

      for (const p of projects) {
        ws.addRow({
          name: p.name,
          projectNo: p.projectNo,
          systemName: p.systemName,
          assessedUnit: p.assessedUnit,
          level: `第${p.level}级`,
          levelCombo: p.levelCombo,
          standardSystem: p.standardSystem,
          extensionType: p.extensionType,
          status: p.status,
          progress: `${p.progress}%`,
        });
      }

      const result = await dialog.showSaveDialog({
        defaultPath: `全部项目列表.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (result.canceled) return { success: false, error: new Error('用户取消') };

      await workbook.xlsx.writeFile(result.filePath!);
      return { success: true, data: { path: result.filePath } };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));

  ipcMain.handle('project:import', wrapRaw(async () => {
    try {
      const result = await dialog.showOpenDialog({
        filters: [{ name: 'Excel文件', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: new Error('用户取消') };
      }

      const db = getDb();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(result.filePaths[0]);
      const ws = workbook.getWorksheet(1);
      if (!ws) return { success: false, error: new Error('工作表为空') };

      let imported = 0;
      const now = new Date().toISOString();

      for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++) {
        const row = ws.getRow(rowNumber);
        const name = row.getCell(1).text;
        const systemName = row.getCell(3).text;
        if (!name || !systemName) continue;

        try {
          await db.insert(schema.projects).values({
            id: randomUUID(),
            name,
            projectNo: row.getCell(2).text || undefined,
            systemName,
            assessedUnit: row.getCell(4).text || undefined,
            level: parseInt(row.getCell(5).text.replace(/[^\d]/g, '')) || 3,
            levelCombo: row.getCell(6).text || undefined,
            standardSystem: row.getCell(7).text || undefined,
            extensionType: row.getCell(8).text || undefined,
            standardId: 'gb-t-22239-2019-l3',
            status: 'draft',
            progress: 0,
            createdAt: now,
            updatedAt: now,
          });
          imported++;
        } catch {
          // 跳过重复或错误行
        }
      }

      return { success: true, data: { imported } };
    } catch (error: any) {
      return { success: false, error };
    }
  }, { moduleName: 'project', requireSession: true }));
}