import { ipcMain, dialog, app } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, like, and, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { getRowMaxHeight } from '../utils/excel-helper';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { writeOperationLog } from '../utils/operation-log';

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('Asset IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

function detectCategoryFromFileName(filePath: string): string {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('机房') || lowerPath.includes('physical') || lowerPath.includes('machine_room')) return 'machine_room';
  if (lowerPath.includes('边界') || lowerPath.includes('boundary') || lowerPath.includes('区域')) return 'network_boundary';
  if (lowerPath.includes('网络设备') || lowerPath.includes('network') || lowerPath.includes('交换机') || lowerPath.includes('路由器')) return 'network_device';
  if (lowerPath.includes('安全设备') || lowerPath.includes('security') || lowerPath.includes('防火墙')) return 'security_device';
  if (lowerPath.includes('服务器') || lowerPath.includes('server') || lowerPath.includes('存储')) return 'server_storage';
  if (lowerPath.includes('数据库') || lowerPath.includes('dbms') || lowerPath.includes('database')) return 'dbms';
  if (lowerPath.includes('管理平台') || lowerPath.includes('management') || lowerPath.includes('平台')) return 'management_platform';
  if (lowerPath.includes('应用') || lowerPath.includes('app') || lowerPath.includes('业务系统')) return 'business_app';
  if (lowerPath.includes('终端') || lowerPath.includes('terminal') || lowerPath.includes('运维')) return 'terminal';
  if (lowerPath.includes('数据资源') || lowerPath.includes('data')) return 'data_resource';
  return 'server_storage';
}

const ASSET_CATEGORY_SHEET_MAP: Record<string, string[]> = {
  network_device: ['安全计算环境-XX网络设备', '安全计算环境-网络设备'],
  security_device: ['安全计算环境-XX安全设备', '安全计算环境-安全设备'],
  server_storage: ['安全计算环境-XX服务器', '安全计算环境-服务器'],
  dbms: ['安全计算环境-XX数据库', '安全计算环境-数据库'],
  management_platform: ['安全计算环境-XX管理平台', '安全计算环境-管理平台'],
  business_app: ['安全计算环境-XX应用系统', '安全计算环境-应用系统'],
  terminal: ['安全计算环境-XX终端', '安全计算环境-终端'],
  data_resource: [
    '安全计算环境-鉴别数据',
    '安全计算环境-重要业务数据',
    '安全计算环境-重要审计数据',
    '安全计算环境-重要配置数据',
    '安全计算环境-重要视频数据',
    '安全计算环境-重要个人信息',
    '数据类别-鉴别数据',
    '数据类别-重要业务数据',
    '数据类别-重要审计数据',
    '数据类别-重要配置数据',
    '数据类别-重要视频数据',
    '数据类别-重要个人信息',
  ],
};

const RESULT_MAP: Record<string, string> = {
  '符合': 'conform',
  '部分符合': 'partial',
  '不符合': 'nonconform',
  '不适用': 'na',
  '待判定': 'untested',
  '': 'untested',
};

function findAssetSheetName(asset: any, workbook: any): string | null {
  const category = asset.category;
  const name = asset.name || '';
  
  if (category === 'data_resource') {
    const dataSheets = ASSET_CATEGORY_SHEET_MAP['data_resource'] || [];
    for (const sheetName of dataSheets) {
      if (workbook.SheetNames.includes(sheetName)) {
        const dataType = sheetName.replace(/^(安全计算环境-|数据类别-)/, '');
        if (name === dataType || name.includes(dataType) || dataType.includes(name)) {
          return sheetName;
        }
      }
    }
    // 兜底：遍历工作簿中所有数据类别sheet
    for (const sheetName of workbook.SheetNames) {
      const match = sheetName.match(/^(?:安全计算环境-|数据类别-)(.+)$/);
      if (match) {
        const dataType = match[1];
        if (name === dataType || name.includes(dataType) || dataType.includes(name)) {
          return sheetName;
        }
      }
    }
    return null;
  }
  
  const possibleSheets = ASSET_CATEGORY_SHEET_MAP[category] || [];
  for (const sheetName of possibleSheets) {
    if (workbook.SheetNames.includes(sheetName)) {
      return sheetName;
    }
  }
  
  for (const sheetName of workbook.SheetNames) {
    if (sheetName.includes(name)) {
      return sheetName;
    }
  }
  
  return null;
}

async function importAssetPresetRecords(asset: any): Promise<number> {
  try {
    const db = getDb();
    
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, asset.projectId),
    });
    if (!project) return 0;
    
    const level = project.level || 3;
    let templateFileName = level === 2 ? 'S2A2G2.xlsx' : 'S3A3G3.xlsx';
    
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
      return 0;
    }
    
    const workbook = XLSX.readFile(templatePath);
    const sheetName = findAssetSheetName(asset, workbook);
    
    if (!sheetName) {
      log.info(`未找到资产 ${asset.name} (${asset.category}) 对应的预置sheet`);
      return 0;
    }
    
    log.info(`为资产 ${asset.name} 使用预置sheet: ${sheetName}`);
    
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (rows.length === 0) return 0;
    
    const domainKey = 'secure_computing';
    const allItems = await db.query.assessmentItems.findMany({
      where: and(
        eq(schema.assessmentItems.domain, domainKey),
        eq(schema.assessmentItems.standardId, project.standardId)
      ),
    });
    
    const itemMap = new Map<string, any>();
    for (const item of allItems) {
      const key = `${item.controlPoint}||${item.requirement}`;
      itemMap.set(key, item);
    }
    
    const now = new Date().toISOString();
    let importedCount = 0;
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      
      const colA = row[0] ? String(row[0]).trim() : '';
      const colB = row[1] ? String(row[1]).trim() : '';
      const colC = row[2] ? String(row[2]).trim() : '';
      const colD = row[3] ? String(row[3]).trim() : '';
      const colE = row[4] ? String(row[4]).trim() : '';
      
      if (!colA || isNaN(parseInt(colA))) continue;
      if (!colC) continue;
      
      if (!colD && (!colE || colE === '待判定')) continue;
      
      const controlPoint = colB;
      const requirement = colC;
      const resultRecord = colD;
      const compliance = colE;
      
      const key = `${controlPoint}||${requirement}`;
      let item = itemMap.get(key);
      
      if (!item) {
        for (const [k, v] of itemMap) {
          if (k.startsWith(`${controlPoint}||`) && v.requirement.includes(requirement.substring(0, 20))) {
            item = v;
            break;
          }
        }
      }
      
      if (!item) continue;
      
      const existing = await db.query.assessmentRecords.findFirst({
        where: and(
          eq(schema.assessmentRecords.projectId, asset.projectId),
          eq(schema.assessmentRecords.itemId, item.id),
          eq(schema.assessmentRecords.assetId, asset.id)
        ),
      });
      
      const resultValue = RESULT_MAP[compliance] || 'untested';
      
      const recordData = {
        projectId: asset.projectId,
        itemId: item.id,
        assetId: asset.id,
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
    
    log.info(`资产 ${asset.name} 导入预置测评记录: ${importedCount} 条`);
    return importedCount;
  } catch (error) {
    log.error('导入资产预置测评记录失败:', error);
    return 0;
  }
}

export function registerAssetHandlers(): void {
  ipcMain.handle('asset:list', (_event, params: { projectId: string; category?: string; keyword?: string; page?: number; pageSize?: number }) =>
    wrap(async () => {
      const db = getDb();
      const { projectId, category, keyword, page = 1, pageSize = 50 } = params;

      const conditions = [eq(schema.assets.projectId, projectId)];
      if (category) {
        conditions.push(eq(schema.assets.category, category));
      }
      if (keyword) {
        conditions.push(like(schema.assets.name, `%${keyword}%`));
      }

      const totalResult = await db
        .select({ value: count() })
        .from(schema.assets)
        .where(and(...conditions));
      const total = totalResult[0]?.value || 0;

      const assets = await db.query.assets.findMany({
        where: and(...conditions),
        orderBy: schema.assets.sortOrder,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

      const categoryStats = await db
        .select({
          category: schema.assets.category,
          count: count(),
        })
        .from(schema.assets)
        .where(eq(schema.assets.projectId, projectId))
        .groupBy(schema.assets.category);

      const ASSET_CATEGORIES = [
        { id: 'machine_room', name: '管理机房', icon: 'Server' },
        { id: 'network_boundary', name: '区域边界', icon: 'Network' },
        { id: 'network_device', name: '网络设备', icon: 'Router' },
        { id: 'security_device', name: '安全设备', icon: 'Shield' },
        { id: 'server_storage', name: '服务器/存储设备', icon: 'Database' },
        { id: 'dbms', name: '数据库管理系统', icon: 'HardDrive' },
        { id: 'management_platform', name: '系统管理平台', icon: 'Settings' },
        { id: 'business_app', name: '业务应用系统', icon: 'Layers' },
        { id: 'terminal', name: '业务终端/运维终端', icon: 'Monitor' },
        { id: 'data_resource', name: '数据资源', icon: 'FileData' },
      ];

      const categoryWithStats = ASSET_CATEGORIES.map((cat) => {
        const stat = categoryStats.find((s) => s.category === cat.id);
        return {
          id: cat.id,
          name: cat.name,
          icon: cat.icon,
          count: stat?.count || 0,
        };
      });

      return {
        list: assets.map((a) => ({
          id: a.id,
          projectId: a.projectId,
          category: a.category,
          name: a.name,
          os: a.os || undefined,
          version: a.version || undefined,
          deviceUsage: a.deviceUsage || undefined,
          description: a.description || undefined,
          quantity: a.quantity,
          ip: a.ip || undefined,
          position: a.position || undefined,
          importance: (a.importance || 'medium') as 'high' | 'medium' | 'low',
          isVirtual: !!a.isVirtual,
          dbSystem: a.dbSystem || undefined,
          middleware: a.middleware || undefined,
          isAssessmentTarget: !!a.isAssessmentTarget,
          responsiblePerson: a.responsiblePerson || undefined,
          sortOrder: a.sortOrder,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
        total,
        categoryStats: categoryWithStats,
      };
    })
  );

  ipcMain.handle('asset:create', (_event, data: any) =>
    wrap(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      const id = randomUUID();

      await db.insert(schema.assets).values({
        id,
        projectId: data.projectId,
        category: data.category,
        name: data.name,
        os: data.os,
        version: data.version,
        deviceUsage: data.deviceUsage,
        description: data.description,
        quantity: data.quantity || 1,
        ip: data.ip,
        position: data.position,
        importance: data.importance || 'medium',
        isVirtual: data.isVirtual ? 1 : 0,
        dbSystem: data.dbSystem || null,
        middleware: data.middleware || null,
        isAssessmentTarget: data.isAssessmentTarget !== false ? 1 : 0,
        responsiblePerson: data.responsiblePerson,
        sortOrder: data.sortOrder || 0,
        createdAt: now,
        updatedAt: now,
      });

      const asset = await db.query.assets.findFirst({
        where: eq(schema.assets.id, id),
      });

      importAssetPresetRecords(asset).catch((err) => {
        log.error('导入资产预置测评记录失败:', err);
      });

      return asset;
    })
  );

  ipcMain.handle('asset:update', (_event, id: string, data: any) =>
    wrap(async () => {
      const db = getDb();
      const now = new Date().toISOString();

      const updateData: any = { ...data, updatedAt: now };
      if ('isVirtual' in updateData) updateData.isVirtual = updateData.isVirtual ? 1 : 0;
      if ('dbSystem' in updateData) updateData.dbSystem = updateData.dbSystem || null;
      if ('middleware' in updateData) updateData.middleware = updateData.middleware || null;
      if ('isAssessmentTarget' in updateData) updateData.isAssessmentTarget = updateData.isAssessmentTarget ? 1 : 0;

      await db.update(schema.assets)
        .set(updateData)
        .where(eq(schema.assets.id, id));

      const asset = await db.query.assets.findFirst({
        where: eq(schema.assets.id, id),
      });

      await writeOperationLog({
        action: 'update',
        module: 'asset',
        targetId: id,
        targetName: asset?.name || data.name,
        description: `更新资产: ${asset?.name || data.name}`,
      });

      return asset;
    })
  );

  ipcMain.handle('asset:remove', (_event, id: string) =>
    wrap<void>(async () => {
      const db = getDb();
      const asset = await db.query.assets.findFirst({
        where: eq(schema.assets.id, id),
      });
      await db.delete(schema.assets).where(eq(schema.assets.id, id));
      await writeOperationLog({
        action: 'delete',
        module: 'asset',
        targetId: id,
        targetName: asset?.name,
        description: `删除资产: ${asset?.name || id}`,
      });
    })
  );

  ipcMain.handle('asset:batchRemove', (_event, ids: string[]) =>
    wrap<void>(async () => {
      const db = getDb();
      for (const id of ids) {
        await db.delete(schema.assets).where(eq(schema.assets.id, id));
      }
    })
  );

  ipcMain.handle('asset:importExcel', (_event, projectId: string, filePath: string) =>
    wrap(async () => {
      const db = getDb();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new Error('Excel文件中没有工作表');
      }

      const headers: string[] = [];
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value?.toString() || '';
      });

      const nameCol = headers.findIndex(h => h.includes('名称') || h.includes('设备名')) + 1;
      const osCol = headers.findIndex(h => h.includes('操作系统') || h.includes('系统')) + 1;
      const versionCol = headers.findIndex(h => h.includes('版本')) + 1;
      const ipCol = headers.findIndex(h => h.includes('IP') || h.includes('地址')) + 1;
      const quantityCol = headers.findIndex(h => h.includes('数量')) + 1;
      const descriptionCol = headers.findIndex(h => h.includes('备注') || h.includes('描述')) + 1;

      if (nameCol === 0) {
        throw new Error('未找到设备名称列');
      }

      let importCount = 0;
      const now = new Date().toISOString();
      const category = detectCategoryFromFileName(filePath);

      for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
        const row = worksheet.getRow(rowNum);
        const name = row.getCell(nameCol).value?.toString().trim();

        if (!name) continue;

        const id = randomUUID();
        await db.insert(schema.assets).values({
          id,
          projectId,
          category,
          name,
          os: osCol > 0 ? row.getCell(osCol).value?.toString() : undefined,
          version: versionCol > 0 ? row.getCell(versionCol).value?.toString() : undefined,
          ip: ipCol > 0 ? row.getCell(ipCol).value?.toString() : undefined,
          quantity: quantityCol > 0 ? parseInt(row.getCell(quantityCol).value?.toString() || '1') : 1,
          description: descriptionCol > 0 ? row.getCell(descriptionCol).value?.toString() : undefined,
          importance: 'medium',
          isVirtual: 0,
          isAssessmentTarget: 1,
          sortOrder: rowNum - 1,
          createdAt: now,
          updatedAt: now,
        });

        importCount++;
      }

      return { count: importCount, category };
    })
  );

  ipcMain.handle('asset:exportExcel', (_event, projectId: string, category: string) =>
    wrap(async () => {
      const db = getDb();
      const CATEGORY_NAMES: Record<string, string> = {
        machine_room: '管理机房',
        network_boundary: '区域边界',
        network_device: '网络设备',
        security_device: '安全设备',
        server_storage: '服务器/存储设备',
        dbms: '数据库管理系统',
        management_platform: '系统管理平台',
        business_app: '业务应用系统',
        terminal: '业务终端/运维终端',
        data_resource: '数据资源',
      };

      const IMPORTANCE_MAP: Record<string, string> = {
        high: '关键',
        medium: '重要',
        low: '一般',
      };

      const COLUMNS_MAP: Record<string, { header: string; key: string; width: number }[]> = {
        machine_room: [
          { header: '序号', key: 'index', width: 8 },
          { header: '机房名称', key: 'name', width: 25 },
          { header: '机房位置', key: 'os', width: 30 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        network_boundary: [
          { header: '序号', key: 'index', width: 8 },
          { header: '边界名称', key: 'name', width: 25 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        network_device: [
          { header: '序号', key: 'index', width: 8 },
          { header: '设备名称', key: 'name', width: 25 },
          { header: '虚拟设备', key: 'isVirtual', width: 10 },
          { header: '系统及版本', key: 'os', width: 25 },
          { header: '品牌及型号', key: 'version', width: 20 },
          { header: '设备用途', key: 'deviceUsage', width: 20 },
          { header: '数量', key: 'quantity', width: 8 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        security_device: [
          { header: '序号', key: 'index', width: 8 },
          { header: '设备名称', key: 'name', width: 25 },
          { header: '虚拟设备', key: 'isVirtual', width: 10 },
          { header: '系统及版本', key: 'os', width: 25 },
          { header: '品牌及型号', key: 'version', width: 20 },
          { header: '设备用途', key: 'deviceUsage', width: 20 },
          { header: '数量', key: 'quantity', width: 8 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        server_storage: [
          { header: '序号', key: 'index', width: 8 },
          { header: '设备名称', key: 'name', width: 25 },
          { header: '虚拟设备', key: 'isVirtual', width: 10 },
          { header: '操作系统及版本', key: 'os', width: 25 },
          { header: '数据库系统及版本', key: 'dbSystem', width: 22 },
          { header: '中间件及版本', key: 'middleware', width: 22 },
          { header: '数量', key: 'quantity', width: 8 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        dbms: [
          { header: '序号', key: 'index', width: 8 },
          { header: '数据库名称', key: 'name', width: 25 },
          { header: '所在设备名称', key: 'os', width: 25 },
          { header: '类型/版本', key: 'deviceUsage', width: 20 },
          { header: '数量', key: 'quantity', width: 8 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        management_platform: [
          { header: '序号', key: 'index', width: 8 },
          { header: '平台名称', key: 'name', width: 25 },
          { header: '所在设备名称', key: 'os', width: 25 },
          { header: '类型/版本', key: 'deviceUsage', width: 20 },
          { header: '数量', key: 'quantity', width: 8 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        business_app: [
          { header: '序号', key: 'index', width: 8 },
          { header: '应用系统名称', key: 'name', width: 25 },
          { header: '软件及版本', key: 'os', width: 25 },
          { header: '主要功能', key: 'deviceUsage', width: 25 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        terminal: [
          { header: '序号', key: 'index', width: 8 },
          { header: '设备名称', key: 'name', width: 25 },
          { header: '虚拟设备', key: 'isVirtual', width: 10 },
          { header: '操作系统及版本', key: 'os', width: 25 },
          { header: '设备类别/用途', key: 'deviceUsage', width: 20 },
          { header: '数量', key: 'quantity', width: 8 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        data_resource: [
          { header: '序号', key: 'index', width: 8 },
          { header: '数据类别', key: 'name', width: 25 },
          { header: '所属业务应用', key: 'os', width: 25 },
          { header: '安全防护需求', key: 'deviceUsage', width: 25 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
      };

      const CATEGORY_ORDER = [
        'machine_room', 'network_boundary', 'network_device', 'security_device',
        'server_storage', 'dbms', 'management_platform', 'business_app',
        'terminal', 'data_resource',
      ];

      // Excel工作表名称不允许包含: * ? : \ / [ ]
      const sanitizeSheetName = (name: string): string => {
        return name.replace(/[\\*?:\/\[\]]/g, '-').substring(0, 31);
      };

      const exportSingleCategory = async (cat: string) => {
        const assets = await db
          .select()
          .from(schema.assets)
          .where(and(
            eq(schema.assets.projectId, projectId),
            eq(schema.assets.category, cat)
          ))
          .orderBy(schema.assets.sortOrder);
        return assets;
      };

      const buildSheet = async (worksheet: ExcelJS.Worksheet, cat: string, assets: any[]) => {
        const columns = COLUMNS_MAP[cat] || COLUMNS_MAP.network_device;
        worksheet.columns = columns.map(c => ({ key: c.key, width: c.width })) as ExcelJS.Column[];

        const headerRow = worksheet.getRow(1);
        columns.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF409EFF' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.border = {
            top: { style: 'medium', color: { argb: 'FF808080' } },
            left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
            bottom: { style: 'medium', color: { argb: 'FF808080' } },
            right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
          };
        });
        headerRow.height = 28;

        const dataColIndexes = columns.map((_, i) => i + 1);

        assets.forEach((asset: any, index: number) => {
          const rowData: Record<string, any> = { index: index + 1 };
          columns.forEach(col => {
            if (col.key === 'index') return;
            if (col.key === 'importance') {
              rowData[col.key] = IMPORTANCE_MAP[asset.importance || 'medium'] || '重要';
            } else if (col.key === 'isVirtual') {
              rowData[col.key] = asset.isVirtual ? '是' : '否';
            } else if (col.key === 'isAssessmentTarget') {
              rowData[col.key] = asset.isAssessmentTarget ? '是' : '否';
            } else {
              rowData[col.key] = asset[col.key] || '';
            }
          });
          const row = worksheet.addRow(rowData);

          const rowHeight = getRowMaxHeight(row, dataColIndexes, worksheet);
          row.height = rowHeight;

          const isZebra = index % 2 === 1;
          row.eachCell((cell, colNumber) => {
            cell.font = { size: 11 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isZebra ? 'FFF7F9FC' : 'FFFFFFFF' } };
            cell.alignment = { wrapText: true, vertical: 'top', horizontal: colNumber === 1 ? 'center' : 'left' };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
              left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
              bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
              right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
            };
          });
        });
      };

      const workbook = new ExcelJS.Workbook();

      if (category === 'all') {
        let totalAssets = 0;
        for (const cat of CATEGORY_ORDER) {
          const assets = await exportSingleCategory(cat);
          if (assets.length > 0) {
            const catName = sanitizeSheetName(CATEGORY_NAMES[cat] || cat);
            const worksheet = workbook.addWorksheet(catName);
            await buildSheet(worksheet, cat, assets);
            totalAssets += assets.length;
          }
        }

        if (totalAssets === 0) {
          throw new Error('没有可导出的数据');
        }

        const result = await dialog.showSaveDialog({
          defaultPath: `系统构成_全部资产_${Date.now()}.xlsx`,
          filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) {
          throw new Error('用户取消');
        }

        await workbook.xlsx.writeFile(result.filePath);
        return result.filePath;
      } else {
        const assets = await exportSingleCategory(category);

        if (assets.length === 0) {
          throw new Error('没有可导出的数据');
        }

        const categoryName = CATEGORY_NAMES[category] || '资产列表';
        const worksheet = workbook.addWorksheet(sanitizeSheetName(categoryName));
        await buildSheet(worksheet, category, assets);

        const result = await dialog.showSaveDialog({
          defaultPath: `${categoryName}_${Date.now()}.xlsx`,
          filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
        });
        if (result.canceled || !result.filePath) {
          throw new Error('用户取消');
        }

        await workbook.xlsx.writeFile(result.filePath);
        return result.filePath;
      }
    })
  );
}