import { ipcMain, dialog, app } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, like, and, desc, count, sql, not } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import type { ProjectListParams, ProjectListResult } from '../../shared/types';
import { writeOperationLog } from '../utils/operation-log';

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('Project IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

async function calcProjectProgress(projectId: string): Promise<number> {
  try {
    const db = getDb();
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });
    if (!project) return 0;

    const totalResult = await db
      .select({ value: count() })
      .from(schema.assessmentItems)
      .where(eq(schema.assessmentItems.standardId, project.standardId));
    const total = totalResult[0]?.value || 1;

    const doneResult = await db
      .select({ value: count() })
      .from(schema.assessmentRecords)
      .where(and(
        eq(schema.assessmentRecords.projectId, projectId),
        sql`${schema.assessmentRecords.result} != 'untested'`
      ));
    const done = doneResult[0]?.value || 0;

    const progress = Math.round((done / total) * 100);
    await db.update(schema.projects)
      .set({ progress })
      .where(eq(schema.projects.id, projectId));
    return progress;
  } catch {
    return 0;
  }
}

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', (_event, params: ProjectListParams) =>
    wrap<ProjectListResult>(async () => {
      const db = getDb();
      const { page = 1, pageSize = 20, keyword, status, level, excludeArchived } = params;

      const conditions = [];
      if (keyword) {
        conditions.push(like(schema.projects.name, `%${keyword}%`));
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

      return {
        list: list.map((p) => ({
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

  ipcMain.handle('project:get', (_event, id: string) =>
    wrap(async () => {
      const db = getDb();
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, id),
      });
      if (!project) throw new Error('项目不存在');
      return project;
    })
  );

  ipcMain.handle('project:create', (_event, data: any) =>
    wrap(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      const id = randomUUID();

      // 如果传入了 levelCombo，自动计算 level 值（优先使用前端传入的）
      let level = data.level;
      if (data.levelCombo && !level) {
        const match = data.levelCombo.match(/S(\d)A(\d)G(\d)/);
        if (match) {
          level = Math.max(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
        }
      }
      if (!level) level = 3; // 默认三级

      // 根据等级选择对应的标准库
      const standardId = data.standardId || (level === 2 ? 'gb-t-22239-2019-l2' : 'gb-t-22239-2019');

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

      importPresetRecords(id, level).catch((err) => {
        log.error('导入预置测评记录失败:', err);
      });

      calcProjectProgress(id).catch(() => {});

      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, id),
      });

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

  // 从Excel模板导入预置测评记录
  async function importPresetRecords(projectId: string, level: number) {
    try {
      const db = getDb();
      
      // 根据等级选择对应的Excel模板
      let templateFileName = '';
      if (level === 2) {
        templateFileName = 'S2A2G2.xlsx';
      } else if (level === 3) {
        templateFileName = 'S3A3G3.xlsx';
      } else {
        return;
      }
      
      // 尝试从多个位置查找模板文件
      const possiblePaths = [
        path.join(process.cwd(), templateFileName),
        path.join(app.getAppPath(), templateFileName),
        path.join(path.dirname(app.getAppPath()), templateFileName),
      ];
      
      let templatePath = '';
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          templatePath = p;
          break;
        }
      }
      
      if (!templatePath) {
        log.warn(`未找到模板文件: ${templateFileName}`);
        return;
      }
      
      const workbook = XLSX.readFile(templatePath);
      
      const SHEET_TO_DOMAIN: Record<string, string> = {
        '安全物理环境': 'secure_physical',
        '安全通信网络': 'secure_communication',
        '安全区域边界-XX边界': 'secure_boundary',
        '安全区域边界': 'secure_boundary',
        '安全计算环境-XX服务器': 'secure_computing',
        '安全计算环境-XX网络设备': 'secure_computing',
        '安全计算环境-XX安全设备': 'secure_computing',
        '安全计算环境-XX应用系统': 'secure_computing',
        '安全计算环境-XX管理平台': 'secure_computing',
        '安全计算环境-XX数据库': 'secure_computing',
        '安全计算环境-XX终端': 'secure_computing',
        '安全管理中心': 'secure_management',
        '安全管理制度': 'security_management',
        '安全管理机构': 'security_organization',
        '安全管理人员': 'security_personnel',
        '安全建设管理': 'security_construction',
        '安全运维管理': 'security_maintenance',
      };
      
      const resultMap: Record<string, string> = {
        '符合': 'conform',
        '部分符合': 'partial',
        '不符合': 'nonconform',
        '不适用': 'na',
        '待判定': 'untested',
        '': 'untested',
      };
      
      // 获取该项目的标准库测评项并建立索引
      const projectRecord = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      const projectStandardId = projectRecord?.standardId || 'gb-t-22239-2019';
      const allItems = await db.query.assessmentItems.findMany({
        where: eq(schema.assessmentItems.standardId, projectStandardId)
      });
      const itemMap = new Map<string, any>();
      for (const item of allItems) {
        const key = `${item.domain}||${item.controlPoint}||${item.requirement}`;
        itemMap.set(key, item);
      }
      
      const now = new Date().toISOString();
      let importedCount = 0;
      
      for (const sheetName of workbook.SheetNames) {
        const domainKey = SHEET_TO_DOMAIN[sheetName];
        if (!domainKey) continue;
        
        const worksheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (rows.length === 0) continue;
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          
          const colA = row[0] ? String(row[0]).trim() : '';
          const colB = row[1] ? String(row[1]).trim() : '';
          const colC = row[2] ? String(row[2]).trim() : '';
          const colD = row[3] ? String(row[3]).trim() : '';
          const colE = row[4] ? String(row[4]).trim() : '';
          
          if (!colA || isNaN(parseInt(colA))) continue;
          
          const controlPoint = colB;
          const requirement = colC;
          const resultRecord = colD;
          const compliance = colE;
          
          if (!requirement) continue;
          
          const key = `${domainKey}||${controlPoint}||${requirement}`;
          let item = itemMap.get(key);
          
          if (!item) {
            for (const [k, v] of itemMap) {
              if (k.startsWith(`${domainKey}||${controlPoint}||`) && v.requirement.includes(requirement.substring(0, 20))) {
                item = v;
                break;
              }
            }
          }
          
          if (!item) continue;
          
          // 检查是否已存在记录
          const existing = await db.query.assessmentRecords.findFirst({
            where: and(
              eq(schema.assessmentRecords.projectId, projectId),
              eq(schema.assessmentRecords.itemId, item.id),
              sql`(${schema.assessmentRecords.assetId} IS NULL OR ${schema.assessmentRecords.assetId} = '')`
            ),
          });
          
          const resultValue = resultMap[compliance] || 'untested';
          
          const recordData = {
            projectId,
            itemId: item.id,
            assetId: null,
            result: resultValue,
            method: 'check',
            commandOutput: '',
            evidence: resultRecord,
            findings: resultRecord,
            assessor: '',
            assessmentDate: now,
          };
          
          if (existing) {
            await db.update(schema.assessmentRecords)
              .set({ ...recordData, updatedAt: now })
              .where(eq(schema.assessmentRecords.id, existing.id));
          } else {
            await db.insert(schema.assessmentRecords).values({
              ...recordData,
              id: randomUUID(),
              createdAt: now,
              updatedAt: now,
            });
          }
          importedCount++;
        }
      }
      
      log.info(`项目 ${projectId} 导入预置测评记录: ${importedCount} 条`);
    } catch (error) {
      log.error('导入预置测评记录失败:', error);
    }
  }

  ipcMain.handle('project:update', (_event, id: string, data: any) =>
    wrap(async () => {
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

      await db.update(schema.projects)
        .set({ ...data, level, updatedAt: now })
        .where(eq(schema.projects.id, id));

      calcProjectProgress(id).catch(() => {});

      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, id),
      });

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

  ipcMain.handle('project:remove', (_event, id: string) =>
    wrap<void>(async () => {
      const db = getDb();
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, id),
      });
      await db.delete(schema.projects).where(eq(schema.projects.id, id));
      await writeOperationLog({
        action: 'delete',
        module: 'project',
        targetId: id,
        targetName: project?.name,
        description: `删除项目: ${project?.name || id}`,
      });
    })
  );

  ipcMain.handle('project:export', async (_event, projectId: string) => {
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
  });

  ipcMain.handle('project:exportAll', async () => {
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
  });

  ipcMain.handle('project:import', async () => {
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
            standardId: 'gb-t-22239-2019',
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
  });
}