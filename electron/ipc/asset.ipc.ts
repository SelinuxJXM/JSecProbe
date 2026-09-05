import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { logger } from '../utils/logger';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, or, isNull, lte, count, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { getRowMaxHeight, styleCell } from '../utils/excel-helper';
import { ASSET_CATEGORY_NAMES, ASSET_IMPORTANCE_MAP, ASSET_COLUMNS_MAP, ASSET_CATEGORY_ORDER, ASSET_EXAMPLE_DATA, sanitizeSheetName } from '../utils/excel-config';
import { writeOperationLog } from '../utils/operation-log';
import { wrap } from '../utils/ipc-wrapper';
import { ASSET_CATEGORIES } from '../../shared/asset-categories';

// 默认不作为测评对象的分类
const NON_ASSESSMENT_CATEGORIES = ['sys_doc', 'other_asset', 'crypto_product', 'security_personnel'];

// 根据分类判断是否默认为测评对象
function getDefaultIsAssessmentTarget(category: string): number {
  return NON_ASSESSMENT_CATEGORIES.includes(category) ? 0 : 1;
}

function detectCategoryFromFileName(filePath: string): string {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('机房') || lowerPath.includes('physical') || lowerPath.includes('machine_room')) return 'machine_room';
  if (lowerPath.includes('边界') || lowerPath.includes('boundary') || lowerPath.includes('区域')) return 'network_boundary';
  if (lowerPath.includes('网络设备') || lowerPath.includes('network') || lowerPath.includes('交换机') || lowerPath.includes('路由器')) return 'network_device';
  if (lowerPath.includes('安全设备') || lowerPath.includes('security') || lowerPath.includes('防火墙')) return 'security_device';
  if (lowerPath.includes('服务器') || lowerPath.includes('server') || lowerPath.includes('存储')) return 'server_storage';
  if (lowerPath.includes('数据库') || lowerPath.includes('sys_doc') || lowerPath.includes('document')) return 'sys_doc';
  if (lowerPath.includes('管理平台') || lowerPath.includes('management') || lowerPath.includes('平台')) return 'management_platform';
  if (lowerPath.includes('应用') || lowerPath.includes('app') || lowerPath.includes('业务系统')) return 'business_app';
  if (lowerPath.includes('终端') || lowerPath.includes('terminal') || lowerPath.includes('运维')) return 'terminal';
  if (lowerPath.includes('数据资源') || lowerPath.includes('data')) return 'data_resource';
  if (lowerPath.includes('其他系统') || lowerPath.includes('other_asset') || lowerPath.includes('其他设备')) return 'other_asset';
  if (lowerPath.includes('密码产品') || lowerPath.includes('crypto') || lowerPath.includes('加密')) return 'crypto_product';
  if (lowerPath.includes('安全相关人员') || lowerPath.includes('security_personnel') || lowerPath.includes('安全人员')) return 'security_personnel';
  return 'server_storage';
}

const RESULT_MAP: Record<string, string> = {
  '符合': 'compliant',
  '部分符合': 'partial',
  '不符合': 'non_compliant',
  '不适用': 'not_applicable',
  '待判定': 'untested',
  '': 'untested',
};

// 项目扩展类型解析（与 assessment:getProgress / getItems 统计口径一致）
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

// 资产分类 -> 测评层面映射（与 assessment:getProgress 的 CATEGORY_TO_DOMAIN 保持一致）
const PRESET_CATEGORY_TO_DOMAIN: Record<string, string> = {
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

// 解析预置测评记录所需的共享上下文：每个项目/标准只解析一次，供批量导入复用
async function resolvePresetContext(db: any, projectId: string): Promise<{
  standardId: string;
  std: any;
  presetMethod: string;
  assetItems: any[];
  globalItems: any[];
} | null> {
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });
  if (!project) return null;

  // 查询标准信息：优先项目绑定 standardId，缺失时按「同等级 → 默认 → 第一条」fallback
  let standardId: string = typeof project.standardId === 'string' ? project.standardId.trim() : '';
  if (!standardId) {
    const normalized = Number.isFinite(Number(project.level)) && Number(project.level) >= 2 && Number(project.level) <= 4 ? Number(project.level) : 3;
    const all = await db
      .select({ id: schema.standards.id, grade: schema.standards.grade, isDefault: schema.standards.isDefault })
      .from(schema.standards);
    const sameGrade = all.find((s: any) => Number(s.grade) === normalized);
    const def = all.find((s: any) => Number(s.isDefault) === 1);
    standardId = (sameGrade || def || all[0])?.id || '';
    log.warn(`[presetImport] 项目 ${projectId} 缺失 standardId，已 fallback 到标准 ${standardId}`);
  }
  const std = standardId ? await db.query.standards.findFirst({ where: eq(schema.standards.id, standardId) }) : null;
  if (!std) {
    log.warn(`[presetImport] 标准 ${standardId} 不存在，跳过资产预置导入`);
    return null;
  }

  const presetMethod = std.presetMethod || 'check';

  // 与统计口径一致：只取项目等级 + 扩展类型适用的测评项（通用要求 + 项目扩展要求）
  const extCodes: string[] = [];
  if (project.extensionType) {
    for (const t of project.extensionType.split(',').filter(Boolean)) {
      const code = EXT_TYPE_MAP[t.trim()] || t.trim();
      if (!extCodes.includes(code)) extCodes.push(code);
    }
  }
  const itemConditions = [
    eq(schema.assessmentItems.standardId, standardId),
    extCodes.length > 0
      ? inArray(schema.assessmentItems.extensionType, ['general', ...extCodes])
      : eq(schema.assessmentItems.extensionType, 'general'),
  ];
  if (project.level) {
    itemConditions.push(lte(schema.assessmentItems.minLevel, project.level));
  }
  const allItems = await db.query.assessmentItems.findMany({
    where: and(...itemConditions),
  });
  if (allItems.length === 0) {
    log.warn(`[presetImport] 标准 ${standardId} 无适用测评项，跳过预置导入`);
    return null;
  }

  // 分组：凡不属于资产映射层面的域（含电力标准 domain-0「总体要求」等行业额外层面）均为全局层面，
  // 只生成 assetId 为空的记录；与统计侧（assessment:getProgress / project / report.service）动态口径一致
  const assetDomainIds = new Set(Object.values(PRESET_CATEGORY_TO_DOMAIN));
  const assetItems: any[] = [];
  const globalItems: any[] = [];
  for (const item of allItems) {
    if (assetDomainIds.has(item.domain)) {
      assetItems.push(item);
    } else {
      globalItems.push(item);
    }
  }

  return { standardId, std, presetMethod, assetItems, globalItems };
}

// 纯内存计算单条预置测评记录，不产生任何 DB 查询
function computePresetRecordData(item: any, assetCategory: string, now: string, presetMethod: string, projectId: string, assetId: string): any {
  let presetRecord = item.presetRecord || '';
  let presetResultRaw = item.presetResult || '';
  // 安全计算环境域：优先取按资产类型区分的预置；解析失败或缺失则回退默认预置
  if (item.domain === 'secure_computing' && item.presetByType) {
    try {
      const byType = JSON.parse(item.presetByType) as Record<string, { result: string; record: string }>;
      const typePreset = byType[assetCategory];
      if (typePreset) {
        presetResultRaw = typePreset.result || '';
        presetRecord = typePreset.record || '';
      }
    } catch {
      log.warn(`[presetImport] assessment_item ${item.id} 的 preset_by_type 解析失败，回退默认预置`);
    }
  }
  let resultValue: string = RESULT_MAP[presetResultRaw] || 'untested';
  if (resultValue === 'untested' && presetRecord && presetRecord.indexOf('不适用') >= 0) {
    resultValue = 'not_applicable';
  }
  return {
    projectId,
    itemId: item.id,
    assetId,
    result: resultValue,
    method: presetMethod,
    commandOutput: '',
    evidence: '',
    findings: presetRecord,
    assessor: '',
    assessmentDate: now,
  };
}

// 批量生成资产预置测评记录：
// - 共享上下文只解析一次（项目/标准/测评项）
// - 已有记录一次性查出，避免逐资产 N+1 判重
// - 分片批量插入 / 更新，替代逐一 await
async function importPresetRecordsBatch(assets: any[]): Promise<number> {
  try {
    if (!assets || assets.length === 0) return 0;
    const db = getDb();
    const projectId = assets[0].projectId;
    const ctx = await resolvePresetContext(db, projectId);
    if (!ctx) return 0;
    const { std, presetMethod, assetItems, globalItems } = ctx;

    const now = new Date().toISOString();

    // 一次性查出本批资产在该项目下已有的测评记录（含 assetId 为空的全局记录，防止重复插入）
    const assetIds = assets.map(a => a.id);
    const existingRecords = await db.query.assessmentRecords.findMany({
      where: and(
        eq(schema.assessmentRecords.projectId, projectId),
        or(
          isNull(schema.assessmentRecords.assetId),
          inArray(schema.assessmentRecords.assetId, [...assetIds, '']),
        ),
      ),
    });
    const existingMap = new Map<string, string>(); // key: `${itemId}||${assetId}` -> recordId
    for (const r of existingRecords) {
      existingMap.set(`${r.itemId}||${r.assetId || ''}`, r.id);
    }

    const toInsert: any[] = [];
    const toUpdate: Array<{ id: string; data: any }> = [];
    let total = 0;

    // 全局层面（管理类/安全通信/总体技术要求）记录只生成一次，assetId 置空
    for (const item of globalItems) {
      const recordData = computePresetRecordData(item, '', now, presetMethod, projectId, '');
      const existingId = existingMap.get(`${item.id}||`);
      if (existingId) {
        toUpdate.push({ id: existingId, data: { ...recordData, updatedAt: now } });
      } else {
        toInsert.push({ ...recordData, id: randomUUID(), createdAt: now, updatedAt: now });
      }
      total++;
    }

    // 资产记录：只与资产所属层面的测评项配对，杜绝跨层面笛卡尔积
    // security_personnel 为登记类信息、非测评对象资产不参与统计，均不生成预置记录
    for (const asset of assets) {
      if (asset.category === 'security_personnel') continue;
      if (Number(asset.isAssessmentTarget) === 0) continue;
      const domainId = PRESET_CATEGORY_TO_DOMAIN[asset.category] || 'secure_computing';
      for (const item of assetItems) {
        if (item.domain !== domainId) continue;
        const recordData = computePresetRecordData(item, asset.category, now, presetMethod, projectId, asset.id);
        const existingId = existingMap.get(`${item.id}||${asset.id}`);
        if (existingId) {
          toUpdate.push({ id: existingId, data: { ...recordData, updatedAt: now } });
        } else {
          toInsert.push({ ...recordData, id: randomUUID(), createdAt: now, updatedAt: now });
        }
        total++;
      }
    }

    // 分片批量插入，避免单条 values 过大
    const insertChunk = 200;
    for (let i = 0; i < toInsert.length; i += insertChunk) {
      const chunk = toInsert.slice(i, i + insertChunk);
      if (chunk.length > 0) await db.insert(schema.assessmentRecords).values(chunk);
    }
    // 分片批量更新
    const updateChunk = 200;
    for (let i = 0; i < toUpdate.length; i += updateChunk) {
      const chunk = toUpdate.slice(i, i + updateChunk);
      for (const u of chunk) {
        await db.update(schema.assessmentRecords).set(u.data).where(eq(schema.assessmentRecords.id, u.id));
      }
    }

    log.info(`批量预置测评记录: 资产 ${assets.length} 个, 资产层面项 ${assetItems.length} + 全局项 ${globalItems.length} 个, 共 ${total} 条 (新增 ${toInsert.length}, 更新 ${toUpdate.length}), 标准 ${std.code || ctx.standardId}`);
    return total;
  } catch (error) {
    log.error('批量导入资产预置测评记录失败:', error);
    return 0;
  }
}

// 单资产路径（asset:create 使用），复用批量逻辑
async function importAssetPresetRecords(asset: any): Promise<number> {
  return importPresetRecordsBatch([asset]);
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
        const escapedKeyword = keyword.replace(/[%_\\]/g, '\\$&');
        conditions.push(sql`${schema.assets.name} LIKE ${`%${escapedKeyword}%`} ESCAPE '\\'`);
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
        isAssessmentTarget: data.isAssessmentTarget === undefined
          ? getDefaultIsAssessmentTarget(data.category)
          : (data.isAssessmentTarget ? 1 : 0),
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

      // 显式字段白名单，防止 Mass Assignment 覆盖 id/projectId/createdAt 等内部字段
      const {
        category, name, os, version, deviceUsage, description, quantity, ip,
        importance, isVirtual, dbSystem, middleware, isAssessmentTarget,
        position, responsiblePerson, sortOrder,
      } = data;

      const updateData: any = {
        category, name, os, version, deviceUsage, description, quantity, ip,
        importance, position, responsiblePerson, sortOrder,
        updatedAt: now,
      };
      if (isVirtual !== undefined) updateData.isVirtual = isVirtual ? 1 : 0;
      if (dbSystem !== undefined) updateData.dbSystem = dbSystem || null;
      if (middleware !== undefined) updateData.middleware = middleware || null;
      if (isAssessmentTarget !== undefined) updateData.isAssessmentTarget = isAssessmentTarget ? 1 : 0;

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
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
      db.transaction((tx) => {
        tx.delete(schema.assessmentRecords).where(eq(schema.assessmentRecords.assetId, id)).run();
        tx.delete(schema.assets).where(eq(schema.assets.id, id)).run();
      });
      // 操作日志为异步写入，必须 await 以确保删除成功后再记录，避免日志丢失或被吞掉
      await writeOperationLog({
        action: 'delete',
        module: 'asset',
        targetId: id,
        targetName: asset?.name,
        description: `删除资产: ${asset?.name || id}`,
      });
    })
  );

  ipcMain.handle('asset:batchRemove', wrap((_event, ids: string[]) => {
      const db = getDb();
      db.transaction((tx) => {
        for (const id of ids) {
          tx.delete(schema.assessmentRecords).where(eq(schema.assessmentRecords.assetId, id)).run();
          tx.delete(schema.assets).where(eq(schema.assets.id, id)).run();
        }
      });
    })
  );

  // 校验导入文件路径：仅拒绝空路径与 '..' 路径穿越；用户通过对话框选择的任意绝对路径（含 appData 之外）均放行
  function validateImportPath(inputPath: string): string {
    if (!inputPath) {
      throw new Error('路径不能为空');
    }
    const segments = inputPath.split(/[\\/]/);
    if (segments.includes('..')) {
      throw new Error('路径访问被拒绝: 非法的路径格式');
    }
    return path.resolve(inputPath);
  }

  ipcMain.handle('asset:importExcel', wrap(async (_event, projectId: string, filePath: string) => {
      const resolvedPath = validateImportPath(filePath);
      const db = getDb();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(resolvedPath);

      const CATEGORY_NAME_TO_KEY: Record<string, string> = {
        '管理机房': 'machine_room',
        '区域边界': 'network_boundary',
        '网络设备': 'network_device',
        '安全设备': 'security_device',
        '服务器/存储设备': 'server_storage',
        '服务器存储设备': 'server_storage',
        '服务器-存储设备': 'server_storage',
        '系统管理文档': 'sys_doc',
        '数据库管理': 'sys_doc',
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
        '其他系统或设备': 'other_asset',
        '其他系统设备': 'other_asset',
        '密码产品': 'crypto_product',
        '安全相关人员': 'security_personnel',
        '安全人员': 'security_personnel',
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
        sys_doc: [
          { header: '文档名称', key: 'name', width: 25 },
          { header: '文档主要内容', key: 'os', width: 30 },
          { header: '备注', key: 'description', width: 40 },
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
        other_asset: [
          { header: '设备名称', key: 'name', width: 25 },
          { header: '虚拟设备', key: 'isVirtual', width: 10 },
          { header: '系统及版本', key: 'os', width: 25 },
          { header: '设备类别/用途', key: 'deviceUsage', width: 20 },
          { header: '备注', key: 'description', width: 40 },
          { header: 'IP地址', key: 'ip', width: 18 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        crypto_product: [
          { header: '产品/模块名称', key: 'name', width: 25 },
          { header: '生产厂商', key: 'version', width: 20 },
          { header: '证书编号', key: 'dbSystem', width: 22 },
          { header: '密码算法', key: 'middleware', width: 20 },
          { header: '用途', key: 'deviceUsage', width: 25 },
          { header: '重要程度', key: 'importance', width: 12 },
          { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
        ],
        security_personnel: [
          { header: '姓名', key: 'name', width: 20 },
          { header: '岗位/角色', key: 'deviceUsage', width: 20 },
          { header: '联系方式', key: 'ip', width: 18 },
          { header: '所属单位', key: 'os', width: 25 },
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

        const getCellBool = (row: ExcelJS.Row, colKey: string, defaultValue: number = 0): number => {
          const colIdx = colPositions[colKey];
          if (!colIdx) return defaultValue;
          const val = row.getCell(colIdx).value?.toString()?.trim();
          return val === '是' ? 1 : 0;
        };

        let importCount = 0;
        const now = new Date().toISOString();
        let skippedRows = 0;
        const rowsToInsert: Array<typeof schema.assets.$inferInsert> = [];

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

          rowsToInsert.push({
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
            isAssessmentTarget: getCellBool(row, 'isAssessmentTarget', getDefaultIsAssessmentTarget(category)),
            sortOrder: rowNum - 1,
            createdAt: now,
            updatedAt: now,
          });

          importCount++;
        }

        // 批量插入资产（避免 N+1 单条插入）
        if (rowsToInsert.length > 0) {
          const batchSize = 50;
          for (let i = 0; i < rowsToInsert.length; i += batchSize) {
            const batch = rowsToInsert.slice(i, i + batchSize);
            await db.insert(schema.assets).values(batch);
          }
        }
        // 批量导入预置测评记录（异步，fire-and-forget，不影响主流程）
        // 一次性批量处理本批资产，共享上下文只解析一次，避免逐资产 N+1 查询
        importPresetRecordsBatch(rowsToInsert).catch((err) => {
          log.error('批量导入资产预置测评记录失败:', err);
        });

        logger.info(`[AssetImport] Sheet "${worksheet.name}": imported ${importCount} rows, skipped ${skippedRows} rows, total rows in sheet: ${worksheet.rowCount}`);
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
          } else if (lowerSheetName.includes('文档') || lowerSheetName.includes('系统管理')) {
            category = 'sys_doc';
          } else if (lowerSheetName.includes('平台') || lowerSheetName.includes('管理')) {
            category = 'management_platform';
          } else if (lowerSheetName.includes('应用') || lowerSheetName.includes('业务')) {
            category = 'business_app';
          } else if (lowerSheetName.includes('终端') || lowerSheetName.includes('运维')) {
            category = 'terminal';
          } else if (lowerSheetName.includes('数据')) {
            category = 'data_resource';
          } else if (lowerSheetName.includes('其他系统') || lowerSheetName.includes('其他设备')) {
            category = 'other_asset';
          } else if (lowerSheetName.includes('密码') || lowerSheetName.includes('加密')) {
            category = 'crypto_product';
          } else if (lowerSheetName.includes('安全人员') || lowerSheetName.includes('相关人员') || lowerSheetName.includes('人员')) {
            category = 'security_personnel';
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