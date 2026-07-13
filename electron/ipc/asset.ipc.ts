import { ipcMain, dialog, app } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, like, and, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { getRowMaxHeight, styleCell } from '../utils/excel-helper';
import { ASSET_CATEGORY_NAMES, ASSET_IMPORTANCE_MAP, ASSET_COLUMNS_MAP, ASSET_CATEGORY_ORDER, ASSET_EXAMPLE_DATA, sanitizeSheetName } from '../utils/excel-config';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import { writeOperationLog } from '../utils/operation-log';
import { wrap } from '../utils/ipc-wrapper';

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
      path.join(process.cwd(), 'resources', templateFileName),
      path.join(app.getAppPath(), templateFileName),
      path.join(path.dirname(app.getAppPath()), templateFileName),
      path.join(path.dirname(app.getAppPath()), 'resources', templateFileName),
      path.join(process.resourcesPath || '', templateFileName),
      path.join(process.resourcesPath || '', 'resources', templateFileName),
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
  ipcMain.handle('asset:list', wrap(async (_event, params: { projectId: string; category?: string; keyword?: string; page?: number; pageSize?: number }) => {
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

  ipcMain.handle('asset:create', wrap(async (_event, data: any) => {
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

  ipcMain.handle('asset:update', wrap(async (_event, id: string, data: any) => {
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

  ipcMain.handle('asset:remove', wrap(async (_event, id: string) => {
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

  ipcMain.handle('asset:batchRemove', wrap(async (_event, ids: string[]) => {
      const db = getDb();
      for (const id of ids) {
        await db.delete(schema.assets).where(eq(schema.assets.id, id));
      }
    })
  );

  ipcMain.handle('asset:importExcel', wrap(async (_event, projectId: string, filePath: string) => {
      const db = getDb();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const CATEGORY_NAME_TO_KEY: Record<string, string> = {
        '管理机房': 'machine_room',
        '区域边界': 'network_boundary',
        '网络设备': 'network_device',
        '安全设备': 'security_device',
        '服务器/存储设备': 'server_storage',
        '服务器存储设备': 'server_storage',
        '服务器-存储设备': 'server_storage',
        '数据库管理系统': 'dbms',
        '数据库管理': 'dbms',
        '系统管理平台': 'management_platform',
        '业务应用系统': 'business_app',
        '业务应用': 'business_app',
        '业务终端/运维终端': 'terminal',
        '业务终端运维终端': 'terminal',
        '业务终端-运维终端': 'terminal',
        '运维终端': 'terminal',
        '业务终端': 'terminal',
        '终端': 'terminal',
        '数据资源': 'data_resource',
      };

      const COLUMNS_MAP: Record<string, { header: string; key: string; width: number }[]> = {
        machine_room: [
          { header: '机房名称', key: 'name', width: 25 },
          { header: '机房位置', key: 'os', width: 30 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        network_boundary: [
          { header: '边界名称', key: 'name', width: 25 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        network_device: [
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
          { header: '数据库名称', key: 'name', width: 25 },
          { header: '所在设备名称', key: 'os', width: 25 },
          { header: '类型/版本', key: 'deviceUsage', width: 20 },
          { header: '数量', key: 'quantity', width: 8 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        management_platform: [
          { header: '平台名称', key: 'name', width: 25 },
          { header: '所在设备名称', key: 'os', width: 25 },
          { header: '版本', key: 'version', width: 20 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '主要功能', key: 'deviceUsage', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        business_app: [
          { header: '应用系统名称', key: 'name', width: 25 },
          { header: '软件及版本', key: 'os', width: 25 },
          { header: '主要功能', key: 'deviceUsage', width: 25 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '备注', key: 'description', width: 40 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        terminal: [
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
          { header: '数据类别', key: 'name', width: 25 },
          { header: '所属业务应用', key: 'os', width: 25 },
          { header: '安全防护需求', key: 'deviceUsage', width: 25 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
      };

      const importFromSheet = async (worksheet: ExcelJS.Worksheet, category: string) => {
        const columns = COLUMNS_MAP[category] || COLUMNS_MAP.network_device;

        // 构建表头到列号的映射
        const headerMap: Record<string, number> = {};
        const headerRow = worksheet.getRow(1);
        // 使用 worksheet.columnCount 确保遍历所有列
        const maxCol = Math.max(headerRow.cellCount || 0, worksheet.columnCount || 0);
        for (let colNum = 1; colNum <= maxCol; colNum++) {
          const cell = headerRow.getCell(colNum);
          const val = (cell.value?.toString() || '').trim();
          if (val) {
            headerMap[val] = colNum;
          }
        }

        const colPositions: Record<string, number> = {};
        for (const col of columns) {
          if (headerMap[col.header]) {
            colPositions[col.key] = headerMap[col.header];
          }
        }

        // 如果没有精确匹配到预定义列，尝试模糊匹配
        if (!colPositions['name']) {
          const nameKeywords = ['名称', '设备名', '数据库', '平台', '应用', '边界', '数据类'];
          for (const [header, colNum] of Object.entries(headerMap)) {
            if (nameKeywords.some(kw => header.includes(kw))) {
              colPositions['name'] = colNum;
              break;
            }
          }
        }

        if (!colPositions['name']) {
          return 0;
        }

        // 如果重要程度列未匹配，尝试关键词匹配
        if (!colPositions['importance']) {
          for (const [header, colNum] of Object.entries(headerMap)) {
            if (header.includes('重要') || header.includes('程度')) {
              colPositions['importance'] = colNum;
              break;
            }
          }
        }

        // 如果测评对象列未匹配，尝试关键词匹配
        if (!colPositions['isAssessmentTarget']) {
          for (const [header, colNum] of Object.entries(headerMap)) {
            if (header.includes('测评') || header.includes('对象')) {
              colPositions['isAssessmentTarget'] = colNum;
              break;
            }
          }
        }

        // 如果虚拟设备列未匹配，尝试关键词匹配
        if (!colPositions['isVirtual']) {
          for (const [header, colNum] of Object.entries(headerMap)) {
            if (header.includes('虚拟')) {
              colPositions['isVirtual'] = colNum;
              break;
            }
          }
        }

        const IMPORTANCE_MAP: Record<string, string> = {
          '关键': 'high',
          '重要': 'medium',
          '一般': 'low',
        };

        const getCellString = (row: ExcelJS.Row, colKey: string): string | undefined => {
          const colIdx = colPositions[colKey];
          if (!colIdx) return undefined;
          const val = row.getCell(colIdx).value?.toString()?.trim();
          return val || undefined;
        };

        const getCellBool = (row: ExcelJS.Row, colKey: string): number => {
          const colIdx = colPositions[colKey];
          if (!colIdx) return 0;
          const val = row.getCell(colIdx).value?.toString()?.trim();
          return val === '是' ? 1 : 0;
        };

        let importCount = 0;
        const now = new Date().toISOString();
        let skippedRows = 0;

        for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
          const row = worksheet.getRow(rowNum);
          const name = getCellString(row, 'name');
          
          if (!name) {
            skippedRows++;
            continue;
          }

          const id = randomUUID();
          const importanceStr = getCellString(row, 'importance');
          const importance = importanceStr ? (IMPORTANCE_MAP[importanceStr] || 'medium') : 'medium';

          await db.insert(schema.assets).values({
            id,
            projectId,
            category,
            name,
            os: getCellString(row, 'os'),
            version: getCellString(row, 'version'),
            deviceUsage: getCellString(row, 'deviceUsage'),
            ip: getCellString(row, 'ip'),
            quantity: parseInt(getCellString(row, 'quantity') || '1', 10),
            description: getCellString(row, 'description'),
            importance,
            isVirtual: getCellBool(row, 'isVirtual'),
            dbSystem: getCellString(row, 'dbSystem'),
            middleware: getCellString(row, 'middleware'),
            isAssessmentTarget: getCellBool(row, 'isAssessmentTarget'),
            sortOrder: rowNum - 1,
            createdAt: now,
            updatedAt: now,
          });

          importCount++;
        }

        console.log(`[AssetImport] Sheet "${worksheet.name}": imported ${importCount} rows, skipped ${skippedRows} rows, total rows in sheet: ${worksheet.rowCount}`);
        return importCount;
      };

      let totalCount = 0;
      const results: Array<{ sheet: string; count: number }> = [];

      for (const worksheet of workbook.worksheets) {
        const sheetName = worksheet.name;
        let category = CATEGORY_NAME_TO_KEY[sheetName];
        
        if (!category) {
          const lowerSheetName = sheetName.toLowerCase();
          if (lowerSheetName.includes('机房') || lowerSheetName.includes('管理机房')) {
            category = 'machine_room';
          } else if (lowerSheetName.includes('边界')) {
            category = 'network_boundary';
          } else if (lowerSheetName.includes('网络设备') || lowerSheetName.includes('网络')) {
            category = 'network_device';
          } else if (lowerSheetName.includes('安全设备') || lowerSheetName.includes('安全')) {
            category = 'security_device';
          } else if (lowerSheetName.includes('服务器') || lowerSheetName.includes('存储')) {
            category = 'server_storage';
          } else if (lowerSheetName.includes('数据库')) {
            category = 'dbms';
          } else if (lowerSheetName.includes('平台') || lowerSheetName.includes('管理')) {
            category = 'management_platform';
          } else if (lowerSheetName.includes('应用') || lowerSheetName.includes('业务')) {
            category = 'business_app';
          } else if (lowerSheetName.includes('终端') || lowerSheetName.includes('运维')) {
            category = 'terminal';
          } else if (lowerSheetName.includes('数据')) {
            category = 'data_resource';
          } else {
            category = detectCategoryFromFileName(filePath);
          }
        }
        
        const count = await importFromSheet(worksheet, category);
        if (count > 0) {
          results.push({ sheet: sheetName, count });
          totalCount += count;
        }
      }

      if (totalCount === 0) {
        throw new Error('没有找到可导入的数据（请确保sheet名称与导出时一致，且包含名称列）');
      }

      return { count: totalCount, results };
    })
  );

  ipcMain.handle('asset:exportExcel', wrap(async (_event, projectId: string, category: string) => {
      const db = getDb();
      const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      const projectName = project?.name || '未知项目';

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
        const columns = ASSET_COLUMNS_MAP[cat] || ASSET_COLUMNS_MAP.network_device;
        worksheet.columns = columns.map(c => ({ key: c.key, width: c.width })) as ExcelJS.Column[];

        const headerRow = worksheet.getRow(1);
        columns.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
        });
        headerRow.height = 28;

        const dataColIndexes = columns.map((_, i) => i + 1);

        assets.forEach((asset: any, index: number) => {
          const rowData: Record<string, any> = { index: index + 1 };
          columns.forEach(col => {
            if (col.key === 'index') return;
            if (col.key === 'importance') {
              rowData[col.key] = ASSET_IMPORTANCE_MAP[asset.importance || 'medium'] || '重要';
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
            styleCell(cell, {
              bgColor: isZebra ? 'FFF7F9FC' : undefined,
              alignH: colNumber === 1 ? 'center' : 'left',
              alignV: 'middle',
              border: 'thin',
            });
          });
        });
      };

      const workbook = new ExcelJS.Workbook();

      if (category === 'all') {
        let totalAssets = 0;
        for (const cat of ASSET_CATEGORY_ORDER) {
          const assets = await exportSingleCategory(cat);
          if (assets.length > 0) {
            const catName = sanitizeSheetName(ASSET_CATEGORY_NAMES[cat] || cat);
            const worksheet = workbook.addWorksheet(catName);
            await buildSheet(worksheet, cat, assets);
            totalAssets += assets.length;
          }
        }

        if (totalAssets === 0) {
          throw new Error('没有可导出的数据');
        }

        const result = await dialog.showSaveDialog({
          defaultPath: `${projectName}_系统构成_全部资产_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`,
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

        const categoryName = ASSET_CATEGORY_NAMES[category] || '资产列表';
        const worksheet = workbook.addWorksheet(sanitizeSheetName(categoryName));
        await buildSheet(worksheet, category, assets);

        const result = await dialog.showSaveDialog({
          defaultPath: `${projectName}_系统构成_${categoryName}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`,
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

  ipcMain.handle('asset:downloadTemplate', wrap(async (_event, _projectId: string) => {
      const workbook = new ExcelJS.Workbook();

      for (const cat of ASSET_CATEGORY_ORDER) {
        const catName = sanitizeSheetName(ASSET_CATEGORY_NAMES[cat] || cat);
        const worksheet = workbook.addWorksheet(catName);
        const columns = ASSET_COLUMNS_MAP[cat] || ASSET_COLUMNS_MAP.network_device;

        worksheet.columns = columns.map(c => ({ key: c.key, width: c.width })) as ExcelJS.Column[];

        const headerRow = worksheet.getRow(1);
        columns.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
        });
        headerRow.height = 28;

        const examples = ASSET_EXAMPLE_DATA[cat] || [];
        examples.forEach((example: any, index: number) => {
          const rowData: Record<string, any> = { index: index + 1 };
          columns.forEach(col => {
            if (col.key === 'index') return;
            rowData[col.key] = example[col.key] || '';
          });
          const row = worksheet.addRow(rowData);

          const isZebra = index % 2 === 1;
          row.eachCell((cell, colNumber) => {
            styleCell(cell, {
              bgColor: isZebra ? 'FFF7F9FC' : undefined,
              alignH: colNumber === 1 ? 'center' : 'left',
              alignV: 'middle',
              border: 'thin',
            });
          });
          row.height = 22;
        });
      }

      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const result = await dialog.showSaveDialog({
        defaultPath: `系统构成导入模板_${timestamp}.xlsx`,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) {
        throw new Error('用户取消');
      }

      await workbook.xlsx.writeFile(result.filePath);
      return result.filePath;
    })
  );
}