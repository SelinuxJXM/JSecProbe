import { ipcMain } from 'electron';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, sql, count, and, inArray, asc } from 'drizzle-orm';
import { wrap } from '../utils/ipc-wrapper';
import { ASSET_CATEGORIES, SECURE_COMPUTING_ASSET_KEYS } from '../../shared/asset-categories';
import { writeOperationLog } from '../utils/operation-log';
import { randomUUID } from 'crypto';
import fs from 'node:fs';
import log from 'electron-log';
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import {
  PROBE_THEME,
  BORDER_MUTED,
  addTitleBanner,
  addSectionHeader,
  styleHeaderRow,
  stripeRow,
  infoKeyValueRows,
  autoFitSheet,
  getCellText,
} from '../utils/excel-helper';

// 国标域名 fallback 字典（行标域优先从 standards.domains_meta 读取）
const DOMAIN_NAMES: Record<string, { name: string; icon: string }> = {
  secure_physical: { name: '安全物理环境', icon: 'OfficeBuilding' },
  secure_communication: { name: '安全通信网络', icon: 'Connection' },
  secure_boundary: { name: '安全区域边界', icon: 'Grid' },
  secure_computing: { name: '安全计算环境', icon: 'Monitor' },
  secure_management: { name: '安全管理中心', icon: 'Setting' },
  security_management: { name: '安全管理制度', icon: 'Document' },
  security_organization: { name: '安全管理机构', icon: 'Briefcase' },
  security_personnel: { name: '安全管理人员', icon: 'User' },
  security_construction: { name: '安全建设管理', icon: 'Tools' },
  security_maintenance: { name: '安全运维管理', icon: 'Box' },
};
// 中文域名 → domainId 反向映射（导入解析时按 Sheet 名反查；模板类 Sheet1 域清单表头为「编号」而非「域 ID」，sheetDomainMap 为空时回退到此）
const DOMAIN_NAME_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(DOMAIN_NAMES).map(([id, v]) => [v.name, id]),
);

// 资产类型定义（与 src/views/onsite-verification/system-composition.vue CATEGORY_NAMES 对齐）
// - key：落库键名（assessment_items.preset_by_type 的键、asset.category 的取值）
// 预置明细按「安全计算环境」域的资产类型生成，作为共享资产分类的子集派生（见 asset-categories.ts）。
// - label：界面/表头展示用显示名
// - sheetLabel：Excel 工作表名安全写法（不含 / ? * [ ] : 等非法字符），用于「安全计算环境-预置明细-<sheetLabel>」子表
// 个别类型覆盖更贴合预置语义的 label / sheetLabel（如 management_platform 特指数据库相关）。
const ASSET_TYPE_OVERRIDES: Record<string, { label?: string; sheetLabel?: string }> = {
  server_storage: { sheetLabel: '服务器、存储设备' },
  management_platform: { label: '系统管理平台（数据库）', sheetLabel: '系统管理平台（数据库）' },
  terminal: { sheetLabel: '业务终端、运维终端' },
};
const ASSET_TYPE_DEFS: Array<{ key: string; label: string; sheetLabel: string }> = SECURE_COMPUTING_ASSET_KEYS.map((key) => {
  const cat = ASSET_CATEGORIES.find((c) => c.id === key)!;
  const ov = ASSET_TYPE_OVERRIDES[key] ?? {};
  return {
    key,
    label: ov.label ?? cat.name,
    sheetLabel: ov.sheetLabel ?? cat.name.replace(/\//g, '、'),
  };
});
// 资产类型显示名(表名安全写法) -> 键名（导入解析子表时反查）
const ASSET_SHEET_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(ASSET_TYPE_DEFS.map((d) => [d.sheetLabel, d.key]));
// 键名 -> 显示名（导出子表时展示）
const CATEGORY_KEY_TO_LABEL: Record<string, string> = Object.fromEntries(ASSET_TYPE_DEFS.map((d) => [d.key, d.label]));
// 键名 -> 工作表名安全写法（导出子表时使用，避免 / ? * [ ] : 等非法字符；须与导入端 ASSET_SHEET_LABEL_TO_KEY 对齐以保证回灌）
const CATEGORY_KEY_TO_SHEET_LABEL: Record<string, string> = Object.fromEntries(ASSET_TYPE_DEFS.map((d) => [d.key, d.sheetLabel]));

// === 导入/导出 常量与 helper（Phase 4 校验增强 + 方案 8.16 强校验）===
export const IMPORT_MAX_FILE_BYTES = 50 * 1024 * 1024;    // 50MB 文件大小上限（与 fs:readFile 同步）
const IMPORT_MAX_ITEMS = 10000;                      // 单标准最大条目数（防超大 JSON 攻击）
const IMPORT_MAX_DOMAINS = 100;                      // 最大域数
const IMPORT_FIELD_MAX_LEN: Record<string, number> = {
  id: 128, name: 256, code: 128, version: 32, industry: 32,
  description: 2000, presetTemplate: 512, domainId: 128,
  domainName: 256, controlPoint: 128, controlName: 256, requirement: 4000,
};
// 方案 8.20：standardId 命名规范（同时支持「国标/行标前缀」与「自定义前缀」，避免与 gb-t-22239-* 冲突）
const STANDARD_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/;
const STANDARD_CODE_REGEX = /^[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9 \/\-_.:（）()]{1,127}$/;
const GRADE_RANGE = [1, 2, 3, 4, 5];
const VALID_PRESET_METHODS = new Set(['interview', 'check', 'test', 'checklist']);
const VALID_STANDARD_TYPES = new Set(['national', 'industry', 'local', 'enterprise']);
// 标准类型：精确匹配表（key 为中文标签，value 为存储枚举）
const STANDARD_TYPE_MAP: Record<string, string> = {
  '国家标准': 'national',
  '等保国家标准': 'national',
  '等保国家标准（GB/T）': 'national',
  '行业标准': 'industry',
  '地方标准': 'local',
  '企业标准': 'enterprise',
};
// 模糊匹配关键词：输入包含任一关键词即判定为该类型（用于兼容用户简写）
const STANDARD_TYPE_KEYWORDS: Array<[string, string[]]> = [
  ['national', ['国标', '国家', '等保', 'GB/T', 'GB']],
  ['industry', ['行标', '行业', '部标']],
  ['local', ['地标', '地方', '省标']],
  ['enterprise', ['企标', '企业']],
];
// 解析标准类型：精确匹配 → 英文枚举直填 → 关键词模糊匹配 → 原值透传（交由校验拦截）
function resolveStandardType(raw?: string | null): string {
  const v = (raw ?? '').trim();
  if (!v) return 'custom';
  if (STANDARD_TYPE_MAP[v]) return STANDARD_TYPE_MAP[v];
  if (VALID_STANDARD_TYPES.has(v)) return v;
  for (const [code, keywords] of STANDARD_TYPE_KEYWORDS) {
    if (keywords.some((k) => v.includes(k))) return code;
  }
  return v;
}
// === Phase 4 新增：columnMap 合法键集合（与方案 §九.24 "Excel 列映射"一致）===
//   - 标准级 columnMap：键为 {序号, 控制点, 要求, 记录, 合规, 方法, 证据}（后 2 个按需扩展）
//   - 域级 columnMap：可额外携带该域模板特有的列名，只要值为合法 >=0 整数、键非空字符串即允许
const STANDARD_COLUMN_KEYS = new Set([
  '序号', '控制点', '控制名称', 'controlPoint', 'controlName',
  '要求', '记录', '合规', '测评结果', '等级', '层面', '方法', '核查方法',
  '证据', '说明', '备注', '扩展信息', 'control', 'requirement', 'record', 'result',
]);

// === 简化模板常量（参考 S3A3G3.xlsx 的 5 列布局：序号/控制点/控制项/结果记录/符合情况）===
// 扩展类型 → 中文标记（写入各域 Sheet 的第 2 行作为「扩展类型标记」，默认通用）
const EXTENSION_META: Record<string, { label: string; short: string }> = {
  general:     { label: '安全通用要求',               short: '' },
  cloud:       { label: '云计算安全扩展要求',         short: '云计算' },
  mobile:      { label: '移动互联安全扩展要求',       short: '移动互联' },
  iot:         { label: '物联网安全扩展要求',         short: '物联网' },
  industrial:  { label: '工业控制系统安全扩展要求',   short: '工控' },
  bigdata:     { label: '大数据安全扩展要求',         short: '大数据' },
  cii:         { label: '关键信息基础设施安全扩展要求', short: '关键信息' },
};
// 简化模板统一 6 列（参考文件 5 列 + 逐条扩展类型标注列）
const SIMPLE_HEADERS: TemplateHeader[] = [
  { key: 'seq',          label: '序号',     width: 8,  required: true },
  { key: 'controlPoint', label: '控制点',   width: 20, required: true },
  { key: 'requirement',  label: '控制项',   width: 80, required: true },
  { key: 'presetRecord', label: '结果记录', width: 60 },
  { key: 'presetResult', label: '符合情况', width: 16 },
  { key: 'extensionType', label: '扩展类型', width: 22 },
];
// 根据中文标记反查扩展类型；无法识别时回退为通用
function extensionLabelToType(label: string): string {
  const s = String(label || '');
  if (/关键信息基础设施/.test(s)) return 'cii';
  if (/云|计算/.test(s)) return 'cloud';
  if (/移动|互联/.test(s)) return 'mobile';
  if (/物联|iot/i.test(s)) return 'iot';
  if (/工业|工控|控制/.test(s)) return 'industrial';
  if (/大数据|big\s*data/i.test(s)) return 'bigdata';
  return 'general';
}

interface ImportValidationReport {
  warnings: string[];
  details: {
    domainCount: number;
    itemCount: number;
    nationalDomains: number;
    industryDomains: number;
    highRiskCount: number;
    standardColumnMap?: Record<string, number> | null;
    domainColumnMapCount?: number;
    uniqueDomains: Set<string>;
    duplicateItemIds: string[];
  };
}

/**
 * 标准导入完整校验（字段正则、长度、范围、唯一性、值域）
 * - 失败抛 Error，失败前写 operationLogs + electron-log
 * - 成功返回校验报告（警告/统计）
 */
function validateStandardImportData(data: any): ImportValidationReport {
  const warnings: string[] = [];
  const duplicateItemIds: string[] = [];
  const uniqueDomains = new Set<string>();
  let nationalDomains = 0;
  let industryDomains = 0;
  let highRiskCount = 0;
  let totalItemCount = 0;
  const seenItemIds = new Set<string>();
  let parsedStdColumnMap: Record<string, number> | null = null;
  let domainWithColumnMapCount = 0;

  // 基础类型
  if (!data || typeof data !== 'object') {
    throw new Error('标准数据为空或不是对象');
  }

  // 必填字符串
  const requiredStrFields: Array<keyof typeof IMPORT_FIELD_MAX_LEN> = ['id', 'name', 'code', 'version'];
  for (const k of requiredStrFields) {
    const v = data[k];
    if (!v || typeof v !== 'string' || !v.trim()) {
      throw new Error(`标准数据缺少必填字符串字段：${k}`);
    }
    if (v.length > IMPORT_FIELD_MAX_LEN[k]) {
      throw new Error(`字段 ${k} 过长（最大 ${IMPORT_FIELD_MAX_LEN[k]} 字符）`);
    }
  }

  // id 正则
  if (!STANDARD_ID_REGEX.test(data.id)) {
    throw new Error('标准 ID 格式非法：仅允许字母、数字、短横线、下划线（2~128 位）');
  }
  // code 正则
  if (!STANDARD_CODE_REGEX.test(data.code)) {
    throw new Error('标准代号格式非法：包含非法字符');
  }

  // grade
  if (typeof data.grade !== 'number' || Number.isNaN(data.grade) || !GRADE_RANGE.includes(data.grade)) {
    throw new Error(`grade 必须是 ${GRADE_RANGE.join('/')} 的整数`);
  }

  // domains
  if (!Array.isArray(data.domains)) {
    throw new Error('domains 必须为数组');
  }
  if (data.domains.length === 0) {
    throw new Error('domains 不能为空');
  }
  if (data.domains.length > IMPORT_MAX_DOMAINS) {
    throw new Error(`domains 超过上限（${IMPORT_MAX_DOMAINS}）`);
  }

  // 标准可选项值域
  if (data.standardType !== undefined && !VALID_STANDARD_TYPES.has(data.standardType)) {
    throw new Error(`standardType 非法，允许：${[...VALID_STANDARD_TYPES].join('/')}`);
  }
  if (data.industry !== undefined && typeof data.industry === 'string' && data.industry.length > IMPORT_FIELD_MAX_LEN.industry) {
    throw new Error(`industry 过长（最大 ${IMPORT_FIELD_MAX_LEN.industry} 字符）`);
  }
  if (data.presetMethod !== undefined && !VALID_PRESET_METHODS.has(data.presetMethod)) {
    throw new Error(`presetMethod 非法，允许：${[...VALID_PRESET_METHODS].join('/')}`);
  }
  if (data.columnMap !== undefined) {
    if (typeof data.columnMap !== 'object' || data.columnMap === null || Array.isArray(data.columnMap)) {
      throw new Error('columnMap 必须是对象 {列名: 0-based 列索引}');
    }
    parsedStdColumnMap = {};
    for (const [k, v] of Object.entries(data.columnMap)) {
      if (!k || !String(k).trim()) throw new Error('columnMap 存在空列名键');
      if (!STANDARD_COLUMN_KEYS.has(k)) {
        warnings.push(`columnMap 键名「${k}」不属预置模板常用列集合，导入后作为自定义键保留（预置读取需显式引用）`);
      }
      const num = typeof v === 'number' ? v : Number(v);
      if (!Number.isInteger(num) || num < 0 || num > 1000) {
        throw new Error(`columnMap["${k}"] 必须是 0~1000 的整数列索引`);
      }
      parsedStdColumnMap[k] = num;
    }
  }
  if (data.presetTemplate !== undefined && typeof data.presetTemplate === 'string' && data.presetTemplate.length > IMPORT_FIELD_MAX_LEN.presetTemplate) {
    throw new Error(`presetTemplate 过长（最大 ${IMPORT_FIELD_MAX_LEN.presetTemplate} 字符）`);
  }
  if (data.description !== undefined && typeof data.description === 'string' && data.description.length > IMPORT_FIELD_MAX_LEN.description) {
    throw new Error(`description 过长（最大 ${IMPORT_FIELD_MAX_LEN.description} 字符）`);
  }

  // domains[*] + items[*]
  for (const domain of data.domains) {
    if (!domain || typeof domain !== 'object') {
      throw new Error('domain 必须是对象');
    }
    if (!domain.id || typeof domain.id !== 'string' || !STANDARD_ID_REGEX.test(domain.id)) {
      throw new Error(`domain.id 非法：${domain.id || '(空)'}`);
    }
    if (domain.id.length > IMPORT_FIELD_MAX_LEN.domainId) {
      throw new Error(`domain.id 过长：${domain.id}`);
    }
    if (!domain.name || typeof domain.name !== 'string' || !domain.name.trim()) {
      warnings.push(`域 ${domain.id} 缺少 name，将用 id 替代`);
    } else if (domain.name.length > IMPORT_FIELD_MAX_LEN.domainName) {
      throw new Error(`domain.name 过长：${domain.id}`);
    }
    if (uniqueDomains.has(domain.id)) {
      throw new Error(`domain.id 重复：${domain.id}`);
    }
    uniqueDomains.add(domain.id);
    if (domain.domainType === 'industry') industryDomains += 1;
    else nationalDomains += 1;

    // domain.columnMap 校验（方案 §九.24 行标模板列序差异）
    if (domain.columnMap !== undefined) {
      if (typeof domain.columnMap !== 'object' || domain.columnMap === null || Array.isArray(domain.columnMap)) {
        throw new Error(`域 ${domain.id} 的 columnMap 必须是对象`);
      }
      for (const [k, v] of Object.entries(domain.columnMap as Record<string, any>)) {
        if (!k || !String(k).trim()) throw new Error(`域 ${domain.id} columnMap 存在空列名`);
        const num = typeof v === 'number' ? v : Number(v);
        if (!Number.isInteger(num) || num < 0 || num > 1000) {
          throw new Error(`域 ${domain.id} columnMap["${k}"] 必须是 0~1000 的整数列索引`);
        }
      }
      domainWithColumnMapCount += 1;
    }

    if (!Array.isArray(domain.items)) continue;
    totalItemCount += domain.items.length;
    if (totalItemCount > IMPORT_MAX_ITEMS) {
      throw new Error(`测评项总数超过上限 ${IMPORT_MAX_ITEMS}`);
    }

    for (const item of domain.items) {
      if (!item || typeof item !== 'object') throw new Error(`域 ${domain.id} 下存在非对象测评项`);
      if (item.id !== undefined && !STANDARD_ID_REGEX.test(String(item.id))) {
        throw new Error(`测评项 ID 非法：${item.id}（域 ${domain.id}）`);
      }
      if (item.id !== undefined) {
        if (seenItemIds.has(String(item.id))) duplicateItemIds.push(String(item.id));
        seenItemIds.add(String(item.id));
      }
      if (!item.controlPoint || typeof item.controlPoint !== 'string' || !item.controlPoint.trim()) {
        throw new Error(`测评项缺少 controlPoint：${domain.id} / ${item.id || '(无 id)'}`);
      }
      if (String(item.controlPoint).length > IMPORT_FIELD_MAX_LEN.controlPoint) {
        throw new Error(`controlPoint 过长：${item.controlPoint}`);
      }
      if (item.controlName !== undefined && String(item.controlName).length > IMPORT_FIELD_MAX_LEN.controlName) {
        throw new Error(`controlName 过长：域 ${domain.id} 项 ${item.id || ''}`);
      }
      if (!item.requirement || typeof item.requirement !== 'string' || !item.requirement.trim()) {
        throw new Error(`测评项缺少 requirement：${domain.id} / ${item.id || '(无 id)'}`);
      }
      if (item.requirement.length > IMPORT_FIELD_MAX_LEN.requirement) {
        throw new Error(`requirement 过长：域 ${domain.id} 项 ${item.id || ''}`);
      }
      if (item.minLevel !== undefined && (typeof item.minLevel !== 'number' || !GRADE_RANGE.includes(item.minLevel))) {
        throw new Error(`minLevel 非法：${item.minLevel}（域 ${domain.id}）`);
      }
      if (item.maxLevel !== undefined && (typeof item.maxLevel !== 'number' || !GRADE_RANGE.includes(item.maxLevel))) {
        throw new Error(`maxLevel 非法：${item.maxLevel}（域 ${domain.id}）`);
      }
      if (item.isHighRisk === true || item.isHighRisk === 1) highRiskCount += 1;
    }
  }

  if (totalItemCount === 0) {
    throw new Error('标准数据无任何测评项');
  }
  if (duplicateItemIds.length > 0) {
    warnings.push(`测评项 ID 重复（共 ${duplicateItemIds.length} 处），导入后将以最后一项为准`);
  }
  if (parsedStdColumnMap) {
    const preview = Object.entries(parsedStdColumnMap)
      .map(([k, v]) => `${k}→${['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'][v] || `col${v}`}`)
      .join('，');
    warnings.push(`将使用标准级列映射：${preview}（缺省会采用 A=序号,B=控制点,C=要求,D=记录,E=合规 的国标默认列）`);
  }
  if (domainWithColumnMapCount > 0) {
    warnings.push(`${domainWithColumnMapCount} 个安全域定义了自定义列序 columnMap，导入对应 Excel 模板时会覆盖标准级默认映射`);
  }

  return {
    warnings,
    details: {
      domainCount: data.domains.length,
      itemCount: totalItemCount,
      nationalDomains,
      industryDomains,
      highRiskCount,
      standardColumnMap: parsedStdColumnMap,
      domainColumnMapCount: domainWithColumnMapCount,
      uniqueDomains,
      duplicateItemIds,
    },
  };
}

// 解析标准域元信息 JSON
function parseDomainsMeta(raw?: string | null): Record<string, { name: string; icon?: string; domainType?: string }> {
  if (!raw) return {};
  try {
    const arr = JSON.parse(raw);
    const map: Record<string, { name: string; icon?: string; domainType?: string }> = {};
    if (Array.isArray(arr)) {
      for (const d of arr) {
        if (d?.id) map[d.id] = { name: d.name || d.id, icon: d.icon, domainType: d.domainType };
      }
    }
    return map;
  } catch {
    return {};
  }
}

export function registerStandardHandlers(): void {
  // 标准列表（新增 standardType/industry/source/presetTemplate 返回）
  ipcMain.handle('standard:list', wrap(async () => {
    const db = getDb();
    const standards = await db.select().from(schema.standards).orderBy(schema.standards.name);
    return standards.map(s => ({
      id: s.id,
      name: s.name,
      code: s.code,
      version: s.version,
      description: s.description || undefined,
      level: s.grade,
      levelCombo: s.levelCombo || '',
      domainCount: s.domainCount,
      itemCount: s.itemCount,
      isDefault: !!s.isDefault,
      standardType: s.standardType,
      industry: s.industry || '',
      source: s.source,
      presetTemplate: s.presetTemplate || '',
      createdAt: s.createdAt,
    }));
  }));

  // 获取标准的安全域列表（优先 domains_meta，fallback DOMAIN_NAMES）
  ipcMain.handle('standard:getDomains', wrap(async (_e, standardId: string) => {
    const db = getDb();
    const std = await db.query.standards.findFirst({ where: eq(schema.standards.id, standardId) });
    const metaMap = parseDomainsMeta(std?.domainsMeta);
    // domainsMeta 中数组的自然顺序（权威排序来源）：行业域排末尾，国标十域按国标顺序
    const metaOrder: Array<{ id: string; domainType?: string }> = [];
    try {
      const raw = std?.domainsMeta ? JSON.parse(std.domainsMeta) : [];
      if (Array.isArray(raw)) {
        for (const d of raw) if (d && d.id) metaOrder.push({ id: d.id, domainType: d.domainType });
      }
    } catch { /* 解析失败则用默认顺序 */ }
    const orderIndex = new Map<string, number>();
    metaOrder.forEach((d, i) => orderIndex.set(d.id, i));

    const items = await db
      .select({ domain: schema.assessmentItems.domain, count: count() })
      .from(schema.assessmentItems)
      .where(eq(schema.assessmentItems.standardId, standardId))
      .groupBy(schema.assessmentItems.domain)
      .orderBy(schema.assessmentItems.domain);

    const rows = items.map(item => {
      const domainType = metaMap[item.domain]?.domainType || 'national';
      return {
        id: item.domain,
        name: metaMap[item.domain]?.name || DOMAIN_NAMES[item.domain]?.name || item.domain,
        icon: metaMap[item.domain]?.icon || DOMAIN_NAMES[item.domain]?.icon || 'Document',
        domainType,
        count: item.count,
      };
    });

    // 排序：行业域置顶（多个行业域沿用 domainsMeta 顺序），其后国标十域按 domainsMeta 自然顺序
    rows.sort((a, b) => {
      const ga = a.domainType === 'industry' ? 0 : 1;
      const gb = b.domainType === 'industry' ? 0 : 1;
      if (ga !== gb) return ga - gb;
      const oa = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const ob = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.id.localeCompare(b.id);
    });

    return rows;
  }));

  // 获取标准测评项（按域过滤）
  ipcMain.handle('standard:getItems', wrap(async (_event, standardId: string, domain?: string) => {
    const db = getDb();
    const conditions = [eq(schema.assessmentItems.standardId, standardId)];
    if (domain) {
      conditions.push(eq(schema.assessmentItems.domain, domain));
    }

    const items = await db
      .select()
      .from(schema.assessmentItems)
      .where(and(...conditions))
      .orderBy(schema.assessmentItems.sortOrder);

    return items.map(item => ({
      id: item.id,
      standardId: item.standardId,
      domain: item.domain,
      controlPoint: item.controlPoint,
      controlName: item.controlName,
      requirement: item.requirement,
      minLevel: item.minLevel,
      maxLevel: item.maxLevel,
      extensionType: item.extensionType,
      isHighRisk: !!item.isHighRisk,
      sortOrder: item.sortOrder,
      parentId: item.parentId || undefined,
    }));
  }));

  // 设为默认标准（同步 systemSettings.defaultStandard）
  ipcMain.handle('standard:setDefault', wrap(async (_event, standardId: string) => {
    const db = getDb();
    db.transaction((tx) => {
      tx.update(schema.standards).set({ isDefault: 0 }).where(sql`1=1`).run();
      tx.update(schema.standards).set({ isDefault: 1 }).where(eq(schema.standards.id, standardId)).run();
      tx.update(schema.systemSettings).set({ defaultStandard: standardId, updatedAt: new Date().toISOString() }).where(eq(schema.systemSettings.id, 'default')).run();
    });
    await writeOperationLog({ action: 'setDefault', module: 'standard', targetId: standardId, description: '设为默认标准' });
  }));

  // 从 Excel 解析标准数据（xlsx base64 → StandardImportData JSON 对象）
  // 解析后前端可直接走 standard:import 流程入库
  ipcMain.handle('standard:parseExcel', wrap(async (_event, content: string) => {
    const buf = Buffer.from(content, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf as any);

    const sheets = workbook.worksheets;
    if (sheets.length < 2) throw new Error('Excel 至少需要 2 个 Sheet（标准信息 + 至少 1 个域）');

    // 将任意字符串转为合法的 domainId/itemId：只保留 a-z A-Z 0-9 - _，其他替换为 -
    // 若原始串无合法字符，则 fallback 为 "domain-N" 格式
    const slugify = (raw: string, fallback: string): string => {
      const s = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!s) return fallback;
      // 首字符必须是字母或数字
      if (!/^[a-zA-Z0-9]/.test(s)) return fallback + '-' + s;
      return s.slice(0, 128);
    };

    // ---- Sheet 1: 标准信息 ----
    const infoSheet = sheets[0];
    const meta: Record<string, string> = {};
    const domainList: Array<{ id: string; name: string }> = [];

    // 遍历 Sheet 1 所有行，提取键值对和域清单
    let inDomainTable = false;
    infoSheet.eachRow((row) => {
      const c1 = String(row.getCell(1).value || '').trim();
      const c2 = String(row.getCell(2).value || '').trim();

      // 检测域清单表头行
      if (c1 === '域 ID' || c1 === '域ID') { inDomainTable = true; return; }
      // 域清单数据行
      if (inDomainTable && c1 && c2) {
        domainList.push({ id: c1, name: c2 });
        return;
      }
      // 键值对：第一列是标签，第二列是值
      if (c1 && c2) {
        const key = c1.replace(/[（(].*?[)）]/g, '').trim();
        if (key.includes('标准名称')) meta.name = c2;
        else if (key.includes('标准代号')) meta.code = c2;
        else if (key.includes('标准版本')) meta.version = c2;
        else if (key.includes('保护等级')) {
          const m = c2.match(/\d+/);
          if (m) meta.grade = m[0];
        }
        else if (key.includes('适用等级组合') || key.includes('等级组合')) {
          const v = String(c2).trim();
          if (v) meta.levelCombo = v;
        }
        else if (key.includes('标准类型')) {
          meta.standardType = resolveStandardType(c2);
        }
        else if (key.includes('适用行业')) meta.industry = c2 === '通用' ? '' : c2;
        else if (key.includes('预设鉴定方法')) {
          const methodMap: Record<string, string> = { '核查法': 'check', '访谈法': 'interview', '测试法': 'test' };
          meta.presetMethod = methodMap[c2] || 'check';
        }
        else if (key.includes('描述')) meta.description = c2;
      }
    });

    if (!meta.name || !meta.code) throw new Error('未从 Sheet 1 解析到标准名称或代号，请确认 Excel 文件格式正确');

    // ---- Sheet 2: 列序映射（跳过，解析时用默认列序） ----
    // 列序映射 Sheet 在导入时不需要——解析域 Sheet 时直接按 header 文字匹配列

    // ---- Sheet 2+: 各域测评项 ----
    // 注意：某些模板没有单独的「列序映射」Sheet，第一个域紧跟在元信息 Sheet 后（sheets[1]），所以从 si=1 开始扫。
    // 跳过规则：不含「序号+控制点」header 的 Sheet 会被自然 continue（不解析）。
    const domains: any[] = [];
    // 构建 sheet 名 → domainId 的映射（优先用域清单中的 name，但 sheet 名可能被截断）
    const sheetDomainMap = new Map<string, string>();
    for (const d of domainList) {
      sheetDomainMap.set(d.name, d.id);
      sheetDomainMap.set(d.id, d.id);
    }

    // 安全计算环境「预置明细」收集器：{ 控制点, 控制项, 资产类型键, 结果记录, 符合情况 }
    const presetDetailRows: Array<{ controlPoint: string; controlName: string; categoryKey: string; result: string; record: string }> = [];

    for (let si = 1; si < sheets.length; si++) {
      const ws = sheets[si];
      const sheetName = ws.name;

      // 解析「安全计算环境-预置明细·<资产类型>」子表：每种资产类型一张表，表内行=控制点/控制项、列=结果记录/符合情况
      // 表名形如「安全计算环境-预置明细-服务器、存储设备」，取「预置明细」之后的部分提取资产类型并映射到键名；无法识别则跳过该表
      if (sheetName.includes('预置明细')) {
        const idx = sheetName.indexOf('预置明细');
        const typeLabel = idx >= 0 ? sheetName.slice(idx + '预置明细'.length).replace(/^[\s\-·•:：]+/, '').trim() : '';
        const categoryKey = ASSET_SHEET_LABEL_TO_KEY[typeLabel];
        if (!categoryKey) {
          log.warn(`[标准导入] 子表「${sheetName}」无法识别资产类型（应为 7 类之一），跳过`);
          continue;
        }
        let hdr = -1;
        const cmap: Record<string, number> = {};
        ws.eachRow((row, r) => {
          if (hdr !== -1) return;
          const vals = Array.from({ length: row.cellCount }, (_, i) => String(row.getCell(i + 1).value || '').trim());
          // 跳过标题/说明行（如「本表为「网络设备」类型的完整预置底稿…」）：该合并单元格同时包含
          // 「控制点」「控制项」「符合情况」等关键词，会被误判为表头，导致真正的 R3 表头被忽略、列索引错位。
          const rowText = vals.join(' ');
          if (rowText.includes('本表为') || rowText.includes('预置底稿') || rowText.includes('须与「安全计算环境」')) return;
          // 表头需含「控制点」+「符合情况/结果记录」+「测评项/控制名称」（精确到测评项级）
          if (!vals.some(v => v.includes('控制点') || v.includes('控制点编号'))) return;
          if (!vals.some(v => v.includes('符合情况') || v.includes('合规结果') || v.includes('合规'))) return;
          if (!vals.some(v => v.includes('测评项') || v.includes('控制名称') || v.includes('控制项'))) return;
          hdr = r;
          vals.forEach((v, i) => {
            if (v.includes('控制点') || v.includes('控制点编号')) cmap.controlPoint = i;
            else if (v.includes('测评项') || v.includes('控制名称') || v.includes('控制项')) cmap.controlName = i;
            else if (v.includes('符合情况') || v.includes('合规结果') || v.includes('合规')) cmap.result = i;
            else if (v.includes('结果记录') || v.includes('记录')) cmap.record = i;
          });
        });
        if (hdr !== -1) {
          for (let r = hdr + 1; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            const get = (k: string) => cmap[k] !== undefined ? String(row.getCell(cmap[k] + 1).value || '').trim() : '';
            const cp = get('controlPoint');
            if (!cp) continue;
            presetDetailRows.push({ controlPoint: cp, controlName: get('controlName'), categoryKey, result: get('result'), record: get('record') });
          }
        }
        continue;
      }

      // 跳过列序映射 sheet
      if (sheetName.includes('列序映射') || sheetName.includes('columnMap')) continue;

      // 确定域 ID：优先从域清单匹配（导出 Excel 的 Sheet1 域清单含「域 ID」），其次按中文域名反查
      let domainId = sheetDomainMap.get(sheetName) || sheetName;
      if (!sheetDomainMap.has(sheetName)) {
        for (const [dName, dId] of sheetDomainMap) {
          if (dName.includes(sheetName) || sheetName.includes(dName)) { domainId = dId; break; }
        }
      }
      // 模板类 Sheet1 域清单表头为「编号」而非「域 ID」→ sheetDomainMap 为空，按中文域名反查 DOMAIN_NAMES
      if (domainId === sheetName && DOMAIN_NAME_TO_ID[sheetName]) {
        domainId = DOMAIN_NAME_TO_ID[sheetName];
      } else if (domainId === sheetName) {
        for (const [zhName, dId] of Object.entries(DOMAIN_NAME_TO_ID)) {
          if (zhName.includes(sheetName) || sheetName.includes(zhName)) { domainId = dId; break; }
        }
      }

      // 找到 header 行：包含「序号」+（「控制点」或「控制点编号」），且不包含「扩展」「核心」（避免把分组横幅误判）
      let headerRowNum = -1;
      const colMap: Record<string, number> = {};
      // 逻辑列名（parse 内部用）→ 对应的所有中文别名（新老模板都兼容）
      const HEADER_ALIASES: Record<string, string[]> = {
        '序号':       ['★ 序号', '序号'],
        '控制点':     ['控制点编号', '控制点'],
        '控制名称':   ['控制名称'],
        '要求':       ['控制要求（测评要求）', '控制要求', '要求', '测评要求', '控制项'],
        '最低等级':   ['最低等级（默认3）', '最低等级', '最低等级(默认3)'],
        '最高等级':   ['最高等级（默认4）', '最高等级', '最高等级(默认4)'],
        '扩展类型':   ['扩展类型（留空=通用）', '扩展类型(留空=通用)', '扩展类型'],
        '高风险':     ['是否高风险？', '高风险(是/否或1/0)', '高风险', '是否高风险'],
        '父控制点ID': ['父控制点编号（留空=根项）', '父控制点编号(留空=根项)', '父控制点编号', '父控制点ID(可选)', '父控制点ID'],
        '测评项ID':   ['测评项ID（留空自动生成）', '测评项ID(留空自动生成)', '测评项ID'],
        '排序号':     ['显示排序号', '排序号'],
        '备注':       ['备注 / 自定义说明', '备注/说明', '备注 / 说明', '备注', '说明'],
        '预置符合情况': ['预置符合情况', '预置·符合情况', '符合情况', '合规'],
        '预置结果记录': ['预置结果记录', '预置·结果记录', '结果记录', '记录', '执行结果'],
      };
      ws.eachRow((row, rNum) => {
        if (headerRowNum !== -1) return;
        const vals = Array.from({ length: row.cellCount }, (_, i) => getCellText(row.getCell(i + 1)));
        // 去掉富文本 star 前缀：★ 序号
        const cleaned = vals.map(v => v.replace(/^[★☆🟥🟦🟨🟩]\s*/, '').trim());
        // 整词精确匹配：单元格内容须"恰好等于"某表头别名（横幅是合并单格长串，不会精确命中，避免误判为表头）
        const tokens = new Set(cleaned);
        const hit = (logicalKey: string) => HEADER_ALIASES[logicalKey].some(a => tokens.has(a));
        if (!hit('序号') || !hit('控制点')) return;
        // 不包含分组横幅词
        if (cleaned.join('').includes('核心列') || cleaned.join('').includes('扩展列') || cleaned.join('').includes('行业扩展')) return;

        headerRowNum = rNum;
        const candidates: Array<{ col: number; key: string; exact: boolean; len: number }> = [];
        cleaned.forEach((v, i) => {
          for (const [logicalKey, aliases] of Object.entries(HEADER_ALIASES)) {
            for (const a of aliases) {
              const exact = v === a;
              const fuzzy = !exact && (v.includes(a) || a.includes(v));
              if (exact || fuzzy) candidates.push({ col: i, key: logicalKey, exact, len: a.length });
            }
          }
        });
        candidates.sort((x, y) => {
          if (x.exact !== y.exact) return x.exact ? -1 : 1;
          if (x.len !== y.len) return y.len - x.len;
          return x.col - y.col;
        });
        const usedCols = new Set<number>();
        for (const c of candidates) {
          if (colMap[c.key] !== undefined) continue;
          if (usedCols.has(c.col)) continue;
          colMap[c.key] = c.col;
          usedCols.add(c.col);
        }
      });

      if (headerRowNum === -1) continue; // 没找到 header，跳过

      // 检测「扩展类型标记行」：紧跟表头下方的整行合并单元格，内容为「安全通用要求 / 云计算安全扩展要求」等
      // 简化模板无「扩展类型」列，依赖此标记将该域统一标记为某扩展类型；该行为可选，旧模板无此行则按列解析
      let domainExtensionType: string | undefined;
      const markerRowNum = headerRowNum + 1;
      const markerRow = ws.getRow(markerRowNum);
      const markerValues = Array.from({ length: 8 }, (_, i) =>
        String(markerRow.getCell(i + 1).value || '').trim(),
      ).filter(Boolean);
      if (markerValues.length > 0) {
        const distinct = Array.from(new Set(markerValues));
        const isExtLabel = (s: string) =>
          Object.values(EXTENSION_META).some(m => m.label === s) || extensionLabelToType(s) !== 'general';
        // 标记行特征：合并单元格整行写入同一扩展标记，读取时所有非空单元格去重后仅 1 个值且该值为扩展标记（文本较短，排除长正文/普通数据行误判）
        if (distinct.length === 1 && isExtLabel(distinct[0]) && distinct[0].length <= 24) {
          domainExtensionType = extensionLabelToType(distinct[0]);
        }
      }
      const dataStartRow = domainExtensionType !== undefined ? markerRowNum + 1 : headerRowNum + 1;

      // 读取数据行
      const items: any[] = [];
      for (let r = dataStartRow; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const getCol = (logicalKey: string) => colMap[logicalKey] !== undefined ? String(row.getCell(colMap[logicalKey] + 1).value || '').trim() : '';

        const controlPoint = getCol('控制点');
        const requirement = getCol('要求');
        // 跳过：空行、示例行（橙色底色在后端无法判断，但可以通过「控制要求」里含示例关键字判断）、提示条行（首列是 emoji 绿条）
        if (!controlPoint && !requirement) continue;
        // 跳过绿色提示条：整行合并的提示条首列带 emoji 符号（合并后控制点列也会被填充 emoji，故仅以首列判断即可）
        const firstCell = String(row.getCell(1).value || '');
        if (/^[💡✅🟩⚠🟧]/.test(firstCell)) continue;

        const rawMin = getCol('最低等级');
        const rawMax = getCol('最高等级');
        const rawSort = getCol('排序号');
        const rawItemId = getCol('测评项ID');
        const rawParentId = getCol('父控制点ID');
        const item: any = {
          controlPoint,
          controlName: getCol('控制名称'),
          requirement,
          minLevel: rawMin ? Number(rawMin) : undefined,
          maxLevel: rawMax ? Number(rawMax) : undefined,
          // 扩展类型：逐条「扩展类型」列优先（下标文本反查 type），为空则退回域级扩展标记（Row3，兼容旧模板）
          extensionType: (() => {
            const colExt = getCol('扩展类型');
            if (colExt) return extensionLabelToType(colExt);
            return domainExtensionType;
          })(),
          isHighRisk: ['是', 'true', '1', 'yes', 'Y'].includes(getCol('高风险')),
          parentId: rawParentId ? slugify(rawParentId, '') || undefined : undefined,
          itemId: rawItemId ? slugify(rawItemId, '') || undefined : undefined,
          sortOrder: rawSort ? Number(rawSort) : undefined,
          remark: getCol('备注') || undefined,
          presetResult: getCol('预置符合情况') || undefined,
          presetRecord: getCol('预置结果记录') || undefined,
        };
        items.push(item);
      }

      if (items.length > 0) {
        const fallbackId = `domain-${si - 1}`;
        domains.push({
          id: slugify(domainId, fallbackId),
          name: sheetName,
          domainType: 'national',
          items,
        });
      }
    }

    if (domains.length === 0) throw new Error('未从 Excel 解析到任何域测评项数据，请确认各域 Sheet 包含 header 行和数据行');

    // 将「预置明细」按 (控制点, 测评项) 聚合为 { [资产类型键]: { result, record } }，仅挂到安全计算环境域
    // - 测评项非空：精确覆盖该测评项（控制点+测评项 双键）
    // - 测评项为空：作为该控制点的通用覆盖，套用到其下所有测评项（兜底）
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const presetByItemMap = new Map<string, Record<string, { result: string; record: string }>>();
    const presetByCpMap = new Map<string, Record<string, { result: string; record: string }>>();
    for (const row of presetDetailRows) {
      const cp = norm(row.controlPoint);
      if (!cp) continue;
      const value = { result: row.result, record: row.record };
      if (row.controlName && row.controlName.trim()) {
        const key = `${cp}|${norm(row.controlName)}`;
        if (!presetByItemMap.has(key)) presetByItemMap.set(key, {});
        presetByItemMap.get(key)![row.categoryKey] = value;
      } else {
        if (!presetByCpMap.has(cp)) presetByCpMap.set(cp, {});
        presetByCpMap.get(cp)![row.categoryKey] = value;
      }
    }
    for (const domain of domains) {
        if (domain.id !== 'secure_computing') continue;
        for (const item of domain.items) {
          // 主表「安全计算环境」往往没有独立的「控制名称」列，其"控制项"文本落在 requirement 上；
          // 而预置明细子表的"控制项"被解析进 controlName。两者须按同一份"控制项/测评项"文本关联，
          // 因此查找键优先用 controlName，缺失时回退到 requirement，避免 presetByType 始终为空。
          const itemKey = norm(item.controlName) || norm(item.requirement);
          const key = `${norm(item.controlPoint)}|${itemKey}`;
          const byType = presetByItemMap.get(key) || presetByCpMap.get(norm(item.controlPoint));
        if (byType && Object.keys(byType).length > 0) {
          item.presetByType = JSON.stringify(byType);
        }
      }
    }

    // 组装标准对象
    const standardData = {
      id: meta.code ? `${meta.code}-L${meta.grade || 3}`.toLowerCase().replace(/[^a-z0-9-]/g, '-') : `custom-${Date.now()}`,
      name: meta.name,
      code: meta.code,
      version: meta.version || '1',
      grade: Number(meta.grade) || 3,
      // 与导入/创建分支保持一致：standardType 未指定时统一回退为 'industry'
      standardType: meta.standardType || 'industry',
      industry: meta.industry || '',
      presetMethod: meta.presetMethod || 'check',
      description: meta.description || '',
      levelCombo: meta.levelCombo || `S${Number(meta.grade) || 3}A${Number(meta.grade) || 3}G${Number(meta.grade) || 3}`,
      domains,
    };

    log.info(`[standard:parseExcel] 解析完成: ${standardData.name} (${standardData.code}), ${domains.length} 域, ${domains.reduce((a: number, d: any) => a + d.items.length, 0)} 项`);
    return standardData;
  }));

  // 导入标准（事务 + 完整校验 + 幂等，支持国标/行标 JSON）- Phase 4 增强
  ipcMain.handle('standard:import', wrap(async (_event, data: any, opts?: { overwrite?: boolean; dryRun?: boolean }) => {
    const db = getDb();
    const t0 = Date.now();
    let report: ImportValidationReport | undefined;
    const overwrite = !!opts?.overwrite;
    const dryRun = !!opts?.dryRun;

    try {
      // Step 1: 深度结构校验（字段正则/长度/唯一性/值域）
      report = validateStandardImportData(data);

      // Step 2: 数据库唯一性 / 幂等
      const existingByCode = await db.select({ id: schema.standards.id, code: schema.standards.code })
        .from(schema.standards).where(eq(schema.standards.code, data.code));
      const existingById = await db.select({ id: schema.standards.id, code: schema.standards.code })
        .from(schema.standards).where(eq(schema.standards.id, data.id));

      if (!overwrite) {
        if (existingByCode.length > 0) {
          throw new Error(`标准代号「${data.code}」已存在（ID=${existingByCode[0].id}），如需覆盖请开启 overwrite 选项`);
        }
        if (existingById.length > 0) {
          throw new Error(`标准 ID「${data.id}」已存在（code=${existingById[0].code}），如需覆盖请开启 overwrite 选项`);
        }
      }

      // Step 3: 构造域元信息
      const domainsMeta = JSON.stringify(data.domains.map((d: any) => {
        const meta: any = {
          id: d.id,
          name: d.name || d.id,
          icon: d.icon,
          domainType: d.domainType || 'national',
          sheetName: d.sheetName,
        };
        if (d.columnMap && typeof d.columnMap === 'object') meta.columnMap = d.columnMap;
        return meta;
      }));

      // dry run: 只校验不入库
      if (dryRun) {
        const msg = `DryRun 通过：${data.code}（${data.name}），${report.details.domainCount} 域 ${report.details.itemCount} 项，高风险 ${report.details.highRiskCount}，行标扩展域 ${report.details.industryDomains}`;
        log.info(`[standard] import dry-run ok – ${msg}`);
        return { dryRun: true, ok: true, warnings: report.warnings, message: msg, details: { ...report.details, duplicateItemIds: undefined, uniqueDomains: undefined } };
      }

      // Step 4: 事务导入（支持幂等 overwrite）
      const totalItemCount = report.details.itemCount;
      db.transaction((tx) => {
        // 覆盖模式：先级联删除旧标准 + 测评项（不做项目引用检查，由 UI 二次确认）
        if (overwrite) {
          if (existingById.length > 0) {
            const oldItems = tx.select({ id: schema.assessmentItems.id })
              .from(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, data.id)).all();
            if (oldItems.length > 0) {
              const oldItemIds = oldItems.map(i => i.id);
              tx.delete(schema.assessmentRecords).where(inArray(schema.assessmentRecords.itemId, oldItemIds)).run();
              tx.delete(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, data.id)).run();
            }
            tx.delete(schema.standards).where(eq(schema.standards.id, data.id)).run();
          }
          if (existingByCode.length > 0 && existingByCode[0].id !== data.id) {
            // 同 code 不同 id：删除 code 冲突的那一条
            const conflictId = existingByCode[0].id;
            const oldItems = tx.select({ id: schema.assessmentItems.id })
              .from(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, conflictId)).all();
            if (oldItems.length > 0) {
              const oldItemIds = oldItems.map(i => i.id);
              tx.delete(schema.assessmentRecords).where(inArray(schema.assessmentRecords.itemId, oldItemIds)).run();
              tx.delete(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, conflictId)).run();
            }
            tx.delete(schema.standards).where(eq(schema.standards.id, conflictId)).run();
          }
        }

        tx.insert(schema.standards).values({
          id: data.id,
          name: data.name,
          code: data.code,
          version: String(data.version),
          description: data.description || '',
          grade: Number(data.grade),
          domainCount: data.domains.length,
          itemCount: totalItemCount,
          isDefault: 0,
          standardType: data.standardType || 'industry',
          industry: data.industry || '',
          source: 'imported',
          levelCombo: data.levelCombo || '',
          presetTemplate: data.presetTemplate || '',
          domainsMeta,
          presetMethod: data.presetMethod || 'check',
          columnMap: data.columnMap ? JSON.stringify(data.columnMap) : null,
          createdAt: new Date().toISOString(),
        }).run();

        // 插入测评项（去重 id）
        const seenItemIds = new Set<string>();
        for (const domain of data.domains) {
          if (!Array.isArray(domain.items)) continue;
          for (const item of domain.items) {
            if (item.id !== undefined) {
              if (seenItemIds.has(String(item.id))) continue; // 同 JSON 内重复项只保留第一个
              seenItemIds.add(String(item.id));
            }
            tx.insert(schema.assessmentItems).values({
              id: item.id || `itm-${randomUUID().slice(0, 10)}`,
              standardId: data.id,
              domain: domain.id,
              controlPoint: item.controlPoint,
              controlName: item.controlName || item.controlPoint,
              requirement: item.requirement,
              minLevel: item.minLevel ?? 2,
              maxLevel: item.maxLevel ?? 4,
              extensionType: item.extensionType || 'general',
              isHighRisk: item.isHighRisk ? 1 : 0,
              sortOrder: item.sortOrder ?? 0,
              parentId: item.parentId || null,
              presetResult: item.presetResult || null,
              presetRecord: item.presetRecord || null,
              presetByType: item.presetByType || null,
            }).run();
          }
        }
      });

      // Step 5: 成功日志
      const duration = Date.now() - t0;
      const baseDesc = `${overwrite ? '覆盖导入' : '导入'}标准 ${data.code}（${data.name}），域 ${report.details.domainCount}，项 ${report.details.itemCount}，高风险 ${report.details.highRiskCount}，行标扩展域 ${report.details.industryDomains}，耗时 ${duration}ms`;
      const fullDesc = report.warnings.length > 0
        ? `${baseDesc}；warnings: ${report.warnings.join(' | ')}`
        : baseDesc;

      await writeOperationLog({
        action: overwrite ? 'importOverwrite' : 'import',
        module: 'standard',
        targetId: data.id,
        targetName: data.name,
        description: fullDesc,
        detailJson: JSON.stringify({
          overwrite,
          code: data.code,
          standardType: data.standardType || 'industry',
          industry: data.industry || '',
          domainCount: report.details.domainCount,
          itemCount: report.details.itemCount,
          highRiskCount: report.details.highRiskCount,
          nationalDomains: report.details.nationalDomains,
          industryDomains: report.details.industryDomains,
          duration,
          warnings: report.warnings,
          duplicateItemIds: report.details.duplicateItemIds.slice(0, 50),
        }),
      });
      log.info(`[standard] import success – ${fullDesc}`);

      return {
        id: data.id,
        domainCount: report.details.domainCount,
        itemCount: report.details.itemCount,
        overwritten: overwrite,
        warnings: report.warnings,
        stats: {
          nationalDomains: report.details.nationalDomains,
          industryDomains: report.details.industryDomains,
          highRiskCount: report.details.highRiskCount,
          duration,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 失败也写日志，便于审计
      try {
        await writeOperationLog({
          action: 'importFail',
          module: 'standard',
          targetId: data?.id,
          targetName: data?.name,
          description: `导入失败：${message}`,
          detailJson: JSON.stringify({
            code: data?.code,
            standardType: data?.standardType,
            industry: data?.industry,
            domainCount: Array.isArray(data?.domains) ? data.domains.length : undefined,
            stack: err instanceof Error ? err.stack : undefined,
          }),
        });
      } catch { /* ignore */ }
      log.warn(`[standard] import fail: ${message}`);
      throw err; // rethrow 给 UI
    }
  }));

  // 手动创建空标准（后续逐条添加测评项）
  ipcMain.handle('standard:create', wrap(async (_event, data: any) => {
    const db = getDb();
    if (!data?.name || !data?.code) throw new Error('名称和代号必填');
    const existing = await db.select({ id: schema.standards.id }).from(schema.standards).where(eq(schema.standards.code, data.code));
    if (existing.length > 0) throw new Error(`标准代号「${data.code}」已存在`);

    const id = data.id || `std-${randomUUID().slice(0, 8)}`;
    await db.insert(schema.standards).values({
      id,
      name: data.name,
      code: data.code,
      version: String(data.version || '1.0'),
      description: data.description || '',
      grade: Number(data.grade || 3),
      domainCount: 0,
      itemCount: 0,
      isDefault: 0,
      standardType: data.standardType || 'industry',
      industry: data.industry || '',
      source: 'custom',
      levelCombo: data.levelCombo || '',
      presetTemplate: data.presetTemplate || '',
      createdAt: new Date().toISOString(),
    });
    await writeOperationLog({ action: 'create', module: 'standard', targetId: id, targetName: data.name, description: '手动创建标准' });
    return { id };
  }));

  // 更新标准元信息（不动测评项，避免 records.itemId 失效）
  ipcMain.handle('standard:update', wrap(async (_event, standardId: string, fields: any) => {
    const db = getDb();
    const updateFields: Record<string, unknown> = {};
    if (fields?.name !== undefined) updateFields.name = fields.name;
    if (fields?.description !== undefined) updateFields.description = fields.description;
    if (fields?.industry !== undefined) updateFields.industry = fields.industry;
    if (fields?.levelCombo !== undefined) updateFields.levelCombo = fields.levelCombo;
    if (fields?.presetTemplate !== undefined) updateFields.presetTemplate = fields.presetTemplate;
    if (fields?.domainsMeta !== undefined) updateFields.domainsMeta = fields.domainsMeta;
    // 改造：支持更新预置导入配置
    if (fields?.presetMethod !== undefined) updateFields.presetMethod = fields.presetMethod;
    if (fields?.columnMap !== undefined) {
      updateFields.columnMap = typeof fields.columnMap === 'string'
        ? fields.columnMap
        : JSON.stringify(fields.columnMap);
    }
    if (Object.keys(updateFields).length === 0) throw new Error('无更新字段');

    await db.update(schema.standards).set(updateFields).where(eq(schema.standards.id, standardId));
    await writeOperationLog({ action: 'update', module: 'standard', targetId: standardId, description: '更新标准元信息' });
    return { success: true };
  }));

  // 导出标准为 JSON（完整性校验 + 日志）- Phase 4 增强
  ipcMain.handle('standard:export', wrap(async (_event, standardId: string) => {
    const db = getDb();
    const t0 = Date.now();

    const [std] = await db.select().from(schema.standards).where(eq(schema.standards.id, standardId));
    if (!std) {
      try {
        await writeOperationLog({ action: 'exportFail', module: 'standard', targetId: standardId, description: '导出失败：标准不存在' });
      } catch { /* ignore */ }
      log.warn(`[standard] export fail: standard not found ${standardId}`);
      throw new Error('标准不存在');
    }

    const items = await db.select().from(schema.assessmentItems)
      .where(eq(schema.assessmentItems.standardId, standardId))
      .orderBy(schema.assessmentItems.sortOrder);

    // === 导出完整性校验（Phase 4）===
    const warnings: string[] = [];
    // 1. item 总数与标准记录一致？
    if (std.itemCount !== undefined && std.itemCount !== items.length) {
      warnings.push(`DB 记录 itemCount=${std.itemCount}，实际导出 ${items.length} 项（不一致）`);
    }
    // 2. 是否有测评项缺 controlPoint / requirement？
    const brokenItems = items.filter(it => !it.controlPoint?.trim() || !it.requirement?.trim()).slice(0, 20).map(it => it.id);
    if (brokenItems.length > 0) {
      warnings.push(`发现 ${brokenItems.length} 条测评项 controlPoint/requirement 为空：${brokenItems.join(',')}`);
    }
    // 3. 域是否有缺 name？
    const metaMap = parseDomainsMeta(std.domainsMeta);
    const domainIdsFromItems = Array.from(new Set(items.map(it => it.domain)));
    const domainsMissingMeta = domainIdsFromItems.filter(d => !metaMap[d]?.name);
    if (domainsMissingMeta.length > 0) {
      warnings.push(`以下域未配置 domainsMeta.name（将 fallback 为 id）：${domainsMissingMeta.join(',')}`);
    }
    // 4. domainCount 与实际域数一致？
    if (std.domainCount !== undefined && std.domainCount !== domainIdsFromItems.length) {
      warnings.push(`DB 记录 domainCount=${std.domainCount}，实际 ${domainIdsFromItems.length} 个域`);
    }
    // 5. 缺失测评项的空域（domainsMeta 中有但无条目）
    const declaredDomains = Object.keys(metaMap);
    const emptyDomains = declaredDomains.filter(d => !domainIdsFromItems.includes(d));
    if (emptyDomains.length > 0) {
      warnings.push(`domainsMeta 声明但无测评项的域（已跳过）：${emptyDomains.join(',')}`);
    }

    const domainMap = new Map<string, any[]>();
    for (const item of items) {
      if (!domainMap.has(item.domain)) domainMap.set(item.domain, []);
      domainMap.get(item.domain)!.push({
        id: item.id,
        controlPoint: item.controlPoint,
        controlName: item.controlName,
        requirement: item.requirement,
        minLevel: item.minLevel,
        maxLevel: item.maxLevel,
        extensionType: item.extensionType,
        isHighRisk: !!item.isHighRisk,
        sortOrder: item.sortOrder,
        parentId: item.parentId || undefined,
      });
    }

    const domains = Array.from(domainMap.entries()).map(([domainId, domainItems]) => ({
      id: domainId,
      name: metaMap[domainId]?.name || domainId,
      icon: metaMap[domainId]?.icon,
      domainType: metaMap[domainId]?.domainType || 'national',
      items: domainItems,
    }));

    // 导出完整性自检：导出对象再过一次 validateStandardImportData 以确保可往返导入
    const exportPayload: any = {
      id: std.id,
      name: std.name,
      code: std.code,
      version: std.version,
      description: std.description,
      grade: std.grade,
      standardType: std.standardType,
      industry: std.industry,
      presetTemplate: std.presetTemplate,
      presetMethod: std.presetMethod || 'check',
      columnMap: std.columnMap ? (() => { try { return JSON.parse(std.columnMap); } catch { return undefined; } })() : undefined,
      domains,
    };
    // 允许 description 为空字符串，但校验 helper 要求长度限制即可；这里不强制抛错，仅记录警告
    try {
      const r = validateStandardImportData(exportPayload);
      if (r.warnings.length > 0) warnings.push(...r.warnings.map(w => `[roundtrip] ${w}`));
    } catch (roundtripErr) {
      warnings.push(`[roundtrip 自检失败] 导出内容后续无法直接导入：${roundtripErr instanceof Error ? roundtripErr.message : String(roundtripErr)}`);
    }

    const duration = Date.now() - t0;
    const industryDomains = domains.filter(d => d.domainType === 'industry').length;
    const nationalDomains = domains.length - industryDomains;
    const highRiskCount = items.filter(i => !!i.isHighRisk).length;
    const baseDesc = `导出标准 ${std.code}（${std.name}），域 ${domains.length}，项 ${items.length}，高风险 ${highRiskCount}，扩展域 ${industryDomains}，耗时 ${duration}ms`;
    const fullDesc = warnings.length > 0 ? `${baseDesc}；warnings: ${warnings.join(' | ')}` : baseDesc;
    await writeOperationLog({
      action: 'export',
      module: 'standard',
      targetId: std.id,
      targetName: std.name,
      description: fullDesc,
      detailJson: JSON.stringify({
        code: std.code,
        standardType: std.standardType,
        industry: std.industry,
        domainCount: domains.length,
        itemCount: items.length,
        highRiskCount,
        nationalDomains,
        industryDomains,
        duration,
        warnings,
      }),
    });
    log.info(`[standard] export ok – ${fullDesc}`);

    return { ...exportPayload, _exportWarnings: warnings };
  }));

  // 删除标准（事务级联 + 引用检查 + 截图孤儿清理）
  ipcMain.handle('standard:remove', wrap(async (_event, standardId: string) => {
    const db = getDb();
    const [std] = await db.select().from(schema.standards).where(eq(schema.standards.id, standardId));
    if (!std) throw new Error('标准不存在');

    // 引用检查：有项目引用则拒绝（避免悬空 standardId）
    const refProjects = await db.select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects).where(eq(schema.projects.standardId, standardId));
    if (refProjects.length > 0) {
      throw new Error(`该标准被 ${refProjects.length} 个项目引用，无法删除：${refProjects.map(p => p.name).join('、')}`);
    }

    // 删除若命中「默认标准」，事务末尾自动推一个新的默认（避免 system_settings.defaultStandard 悬空）
    const wasDefault = Number(std.isDefault) === 1;

    db.transaction((tx) => {
      // 收集该标准所有测评项 ID
      const items = tx.select({ id: schema.assessmentItems.id })
        .from(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, standardId)).all();
      const itemIds = items.map(i => i.id);

      if (itemIds.length > 0) {
        // 截图孤儿清理（best-effort，失败不阻断）
        try {
          const records = tx.select({ sp: schema.assessmentRecords.screenshotPaths })
            .from(schema.assessmentRecords).where(inArray(schema.assessmentRecords.itemId, itemIds)).all();
          for (const r of records) {
            if (!r.sp) continue;
            let paths: string[] = [];
            try { paths = JSON.parse(r.sp); } catch { paths = [r.sp]; }
            for (const p of paths) {
              if (typeof p === 'string' && p) {
                try { fs.unlinkSync(p); } catch { /* 文件可能已不存在，忽略 */ }
              }
            }
          }
        } catch (e) {
          log.warn('[standard:remove] 截图清理异常，跳过', e);
        }

        // 级联删除 records / issues / items
        tx.delete(schema.assessmentRecords).where(inArray(schema.assessmentRecords.itemId, itemIds)).run();
        tx.delete(schema.issues).where(inArray(schema.issues.itemId, itemIds)).run();
        tx.delete(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, standardId)).run();
      }
      tx.delete(schema.standards).where(eq(schema.standards.id, standardId)).run();

      // 默认标准修复：若删的是默认标准，把剩余首个标准设为新默认；并回写 system_settings
      if (wasDefault) {
        const rest = tx.select({ id: schema.standards.id })
          .from(schema.standards)
          .orderBy(asc(schema.standards.id))
          .limit(1).all();
        const newDefaultId = rest[0]?.id;
        if (newDefaultId) {
          tx.update(schema.standards).set({ isDefault: 0 }).where(sql`1=1`).run();
          tx.update(schema.standards).set({ isDefault: 1 }).where(eq(schema.standards.id, newDefaultId)).run();
          tx.update(schema.systemSettings)
            .set({ defaultStandard: newDefaultId, updatedAt: new Date().toISOString() })
            .where(eq(schema.systemSettings.id, 'default')).run();
        } else {
          // 库被全部删光，system_settings.defaultStandard 置空，前端按无标准安全降级
          tx.update(schema.systemSettings)
            .set({ defaultStandard: '', updatedAt: new Date().toISOString() })
            .where(eq(schema.systemSettings.id, 'default')).run();
        }
      }
    });

    await writeOperationLog({ action: 'remove', module: 'standard', targetId: standardId, targetName: std.name, description: `删除标准 ${std.code}${wasDefault ? '（原默认，已自动切换新默认）' : ''}` });
    log.info(`[standard] 删除标准 ${std.code}，级联清理 ${std.itemCount} 项测评项${wasDefault ? '；已自动切换默认标准' : ''}`);
    return { success: true };
  }));

  // === Phase 4 · 任务 27：行标-国标对照（按 controlPoint 合并双标准差异）===
  // 返回：按 controlPoint 分组的差异数据 + 统计信息 + 导出 Markdown 文本
  // 兼容两种调用签名：
  //   1) standard.compare(leftId: string, rightId: string)
  //   2) standard.compare({ standardIdA, standardIdB, includeDomainHeaders? })（保留）
  ipcMain.handle('standard:compare', wrap(async (_event, ...args: any[]) => {
    let standardIdA = '';
    let standardIdB = '';
    // 规范化调用参数（兼容历史签名：standardIdA/standardIdB 对象，或前端双字符串直接传）
    if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
      standardIdA = args[0];
      standardIdB = args[1];
    } else if (args[0] && typeof args[0] === 'object') {
      standardIdA = args[0].standardIdA || '';
      standardIdB = args[0].standardIdB || '';
    }

    const db = getDb();
    const t0 = Date.now();
    if (!standardIdA || !standardIdB) throw new Error('请选择两个标准进行对照');
    if (standardIdA === standardIdB) throw new Error('请选择两个不同的标准');

    const [stdA] = await db.select().from(schema.standards).where(eq(schema.standards.id, standardIdA)).limit(1);
    const [stdB] = await db.select().from(schema.standards).where(eq(schema.standards.id, standardIdB)).limit(1);
    if (!stdA) throw new Error('标准 A 不存在');
    if (!stdB) throw new Error('标准 B 不存在');

    const itemsA = await db.select({
      id: schema.assessmentItems.id,
      domain: schema.assessmentItems.domain,
      controlPoint: schema.assessmentItems.controlPoint,
      controlName: schema.assessmentItems.controlName,
      requirement: schema.assessmentItems.requirement,
      minLevel: schema.assessmentItems.minLevel,
      maxLevel: schema.assessmentItems.maxLevel,
      extensionType: schema.assessmentItems.extensionType,
      isHighRisk: schema.assessmentItems.isHighRisk,
    }).from(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, standardIdA));
    const itemsB = await db.select({
      id: schema.assessmentItems.id,
      domain: schema.assessmentItems.domain,
      controlPoint: schema.assessmentItems.controlPoint,
      controlName: schema.assessmentItems.controlName,
      requirement: schema.assessmentItems.requirement,
      minLevel: schema.assessmentItems.minLevel,
      maxLevel: schema.assessmentItems.maxLevel,
      extensionType: schema.assessmentItems.extensionType,
      isHighRisk: schema.assessmentItems.isHighRisk,
    }).from(schema.assessmentItems).where(eq(schema.assessmentItems.standardId, standardIdB));

    const metaA = parseDomainsMeta(stdA.domainsMeta);
    const metaB = parseDomainsMeta(stdB.domainsMeta);
    const dnA = (d: string) => metaA[d]?.name || d;
    const dnB = (d: string) => metaB[d]?.name || d;

    // 以 controlPoint 为主键（行标与国标相同控制点通常字符串一致；个别差异由用户识别）
    const mapA = new Map<string, typeof itemsA>();
    const mapB = new Map<string, typeof itemsB>();
    for (const it of itemsA) {
      const k = it.controlPoint || '(未命名控制点)';
      if (!mapA.has(k)) mapA.set(k, []);
      (mapA.get(k) as any).push(it);
    }
    for (const it of itemsB) {
      const k = it.controlPoint || '(未命名控制点)';
      if (!mapB.has(k)) mapB.set(k, []);
      (mapB.get(k) as any).push(it);
    }

    const keys = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
    // 按域排序后再按控制点字符串排序
    const domOrder = (k: string) => {
      const a = mapA.get(k); const b = mapB.get(k);
      const sample = (a && a[0]?.domain) || (b && b[0]?.domain) || k;
      return sample;
    };
    keys.sort((x, y) => (domOrder(x) || '').localeCompare(domOrder(y) || '') || x.localeCompare(y));

    type RowItem = { id: string; domain: string; domainName: string; controlName: string; requirement: string; minLevel: number; maxLevel: number; extensionType: string; isHighRisk: number };
    type DiffRow = {
      controlPoint: string;
      domainA: string; domainB: string;
      itemsA: RowItem[]; itemsB: RowItem[];
      status: 'identical' | 'changed' | 'onlyA' | 'onlyB';
      levelChanged: boolean;
      extChanged: boolean;
      industryOnly: 'none' | 'A' | 'B';
    };
    const rows: DiffRow[] = [];
    let changed = 0, onlyA = 0, onlyB = 0, identical = 0;
    let highRiskA = 0, highRiskB = 0;
    let industryOnlyCount = 0;

    for (const k of keys) {
      const aRaw = mapA.get(k) || [];
      const bRaw = mapB.get(k) || [];
      const itemsA2: RowItem[] = (aRaw as any).map((it: any) => ({
        ...it, domainName: dnA(it.domain), controlName: it.controlName || k, isHighRisk: it.isHighRisk ?? 0,
      }));
      const itemsB2: RowItem[] = (bRaw as any).map((it: any) => ({
        ...it, domainName: dnB(it.domain), controlName: it.controlName || k, isHighRisk: it.isHighRisk ?? 0,
      }));
      for (const it of itemsA2) if (it.isHighRisk) highRiskA++;
      for (const it of itemsB2) if (it.isHighRisk) highRiskB++;

      let status: DiffRow['status'] = 'identical';
      let levelChanged = false;
      let extChanged = false;
      if (itemsA2.length === 0) { status = 'onlyB'; onlyB++; }
      else if (itemsB2.length === 0) { status = 'onlyA'; onlyA++; }
      else {
        // 判断是否变化（长度/条数/等级/扩展类型/要求文差异）
        if (itemsA2.length !== itemsB2.length) status = 'changed';
        // 比较控制点下全部测评项的等级范围（取最小/最大等级聚合），避免只比较首条而漏报等级差异
        const aMin = Math.min(...itemsA2.map((i: any) => i.minLevel), Infinity);
        const aMax = Math.max(...itemsA2.map((i: any) => i.maxLevel), -Infinity);
        const bMin = Math.min(...itemsB2.map((i: any) => i.minLevel), Infinity);
        const bMax = Math.max(...itemsB2.map((i: any) => i.maxLevel), -Infinity);
        if (aMin !== bMin || aMax !== bMax) { levelChanged = true; status = 'changed'; }
        const aExt = itemsA2.some(i => i.extensionType === 'industry');
        const bExt = itemsB2.some(i => i.extensionType === 'industry');
        if (aExt !== bExt) { extChanged = true; status = 'changed'; }
        const aReq = itemsA2.map(i => (i.requirement || '').trim()).join('\n');
        const bReq = itemsB2.map(i => (i.requirement || '').trim()).join('\n');
        if (status === 'identical' && aReq !== bReq) status = 'changed';
        if (status === 'changed') changed++; else identical++;
      }

      // 行业专属项：该控制点下全部条目 extensionType==='industry' 的一侧
      const aAllInd = itemsA2.length > 0 && itemsA2.every(i => i.extensionType === 'industry');
      const bAllInd = itemsB2.length > 0 && itemsB2.every(i => i.extensionType === 'industry');
      let industryOnly: DiffRow['industryOnly'] = 'none';
      if (aAllInd && !bAllInd) { industryOnly = 'A'; industryOnlyCount++; }
      else if (bAllInd && !aAllInd) { industryOnly = 'B'; industryOnlyCount++; }

      rows.push({
        controlPoint: k,
        domainA: itemsA2[0]?.domainName || '',
        domainB: itemsB2[0]?.domainName || '',
        itemsA: itemsA2,
        itemsB: itemsB2,
        status, levelChanged, extChanged, industryOnly,
      });
    }

    const stats = {
      total: rows.length,
      identical, changed, onlyA, onlyB,
      itemsA: itemsA.length, itemsB: itemsB.length,
      highRiskA, highRiskB,
      industryOnlyCount,
      duration: Date.now() - t0,
    };

    // 导出 Markdown
    const headerLine = `# 标准对照表：${stdA.code} VS ${stdB.code}\n\n`;
    const metaLine = `- **A**：${stdA.code}《${stdA.name}》（${stdA.standardType || 'standard'}${stdA.industry ? ' · ' + stdA.industry : ''}，共 ${itemsA.length} 项 / ${stdA.domainCount} 域）\n`;
    const metaLine2 = `- **B**：${stdB.code}《${stdB.name}》（${stdB.standardType || 'standard'}${stdB.industry ? ' · ' + stdB.industry : ''}，共 ${itemsB.length} 项 / ${stdB.domainCount} 域）\n`;
    const statLine = `- **差异统计**：共 ${rows.length} 个控制点，相同 ${identical} / 有差异 ${changed} / 仅 A ${onlyA} / 仅 B ${onlyB}，行业专属 ${industryOnlyCount}，高风险 A ${highRiskA}/B ${highRiskB}\n\n`;
    const legend = `> 状态标记：🟩 完全相同 · 🟨 要求/等级/扩展项变化 · 🅰️ 仅在 A 中 · 🅱️ 仅在 B 中 · 🏭 行业专属控制点\n\n`;
    const mdRows: string[] = [headerLine, metaLine, metaLine2, statLine, legend, '## 对照表\n\n| 状态 | 控制点 | A：域 / 等级 / 扩展 | B：域 / 等级 / 扩展 | 备注 |\n| --- | --- | --- | --- | --- |\n'];
    for (const r of rows) {
      const badge = r.status === 'identical' ? '🟩' : r.status === 'changed' ? '🟨' : r.status === 'onlyA' ? '🅰️' : '🅱️';
      const indBadge = r.industryOnly !== 'none' ? ' 🏭' : '';
      const lvl = (x: RowItem[]) => x.length === 0 ? '—' : Array.from(new Set(x.map(i => `${i.minLevel}-${i.maxLevel}`))).join('、');
      const ext = (x: RowItem[]) => {
        if (x.length === 0) return '';
        const set = new Set(x.map(i => i.extensionType || 'general'));
        const tags: string[] = [];
        if (set.has('industry')) tags.push('行标扩展');
        if (set.has('general')) tags.push('通用');
        return tags.length > 0 ? ` ${tags.join('/')}` : '';
      };
      const aSide = r.itemsA.length > 0 ? `${r.domainA} · L${lvl(r.itemsA)}${ext(r.itemsA)}` : '—';
      const bSide = r.itemsB.length > 0 ? `${r.domainB} · L${lvl(r.itemsB)}${ext(r.itemsB)}` : '—';
      const notes: string[] = [];
      if (r.levelChanged) notes.push('等级范围不同');
      if (r.extChanged) notes.push('扩展类型不同');
      if (r.itemsA.length !== r.itemsB.length && r.status === 'changed') notes.push(`条数 A×${r.itemsA.length}/B×${r.itemsB.length}`);
      if (r.industryOnly === 'A') notes.push('A 侧全为行业专属');
      if (r.industryOnly === 'B') notes.push('B 侧全为行业专属');
      mdRows.push(`| ${badge}${indBadge} | ${r.controlPoint.replace(/\|/g, '\\|')} | ${aSide.replace(/\|/g, '\\|')} | ${bSide.replace(/\|/g, '\\|')} | ${notes.join('；') || '-'} |\n`);
    }
    mdRows.push('\n## 详细条款差异（仅列出 changed/onlyA/onlyB）\n\n');
    for (const r of rows) {
      if (r.status === 'identical') continue;
      mdRows.push(`### ${r.controlPoint}\n\n- 状态：**${r.status === 'changed' ? '有差异' : r.status === 'onlyA' ? '仅 A 存在' : '仅 B 存在'}**\n`);
      if (r.itemsA.length > 0) {
        mdRows.push(`- **A · ${stdA.code}（${r.domainA}）**：\n`);
        for (const it of r.itemsA) {
          mdRows.push(`  - L${it.minLevel}-${it.maxLevel}${it.extensionType === 'industry' ? '【行标扩展】' : ''}${it.isHighRisk ? ' ⚠️高风险' : ''}　*${it.controlName || r.controlPoint}*\n    > ${(it.requirement || '').replace(/\n/g, ' ')}\n`);
        }
      }
      if (r.itemsB.length > 0) {
        mdRows.push(`- **B · ${stdB.code}（${r.domainB}）**：\n`);
        for (const it of r.itemsB) {
          mdRows.push(`  - L${it.minLevel}-${it.maxLevel}${it.extensionType === 'industry' ? '【行标扩展】' : ''}${it.isHighRisk ? ' ⚠️高风险' : ''}　*${it.controlName || r.controlPoint}*\n    > ${(it.requirement || '').replace(/\n/g, ' ')}\n`);
        }
      }
      mdRows.push('\n---\n\n');
    }
    const markdown = mdRows.join('');

    // 兼容导出结构 + 前端「对照视图」期望字段
    // 后端内部 DiffRow.status: identical | changed | onlyA | onlyB
    // 前端对照视图对照域 Tag：LEVEL_DIFF / REQ_DIFF / LEFT_ONLY / RIGHT_ONLY / EXTEND_INFO_DIFF / IDENTICAL
    function normalizeTag(r: DiffRow): string {
      if (r.status === 'onlyA') return 'LEFT_ONLY';
      if (r.status === 'onlyB') return 'RIGHT_ONLY';
      if (r.status === 'identical') return 'IDENTICAL';
      // changed：按差异类型拆分
      if (r.levelChanged) return 'LEVEL_DIFF';
      if (r.extChanged) return 'EXTEND_INFO_DIFF';
      return 'REQ_DIFF';
    }

    // 将左右多子项折叠为一条（只取首条）；要求文差异对比则使用 join
    function summarizeItem(arr: RowItem[]): any | null {
      if (arr.length === 0) return null;
      const first = arr[0];
      const reqs = Array.from(new Set(arr.map(i => (i.requirement || '').trim()).filter(Boolean)));
      return {
        itemId: first.id,
        domain: first.domain,
        domainName: first.domainName,
        itemType: first.extensionType || 'general',
        extensionType: first.extensionType || 'general',
        level: first.minLevel,
        minLevel: first.minLevel,
        maxLevel: first.maxLevel,
        levels: Array.from(new Set(arr.map(i => `L${i.minLevel}-${i.maxLevel}`))).join('、'),
        controlName: first.controlName,
        requirement: reqs.join('\n————\n') || first.requirement || '',
        itemCount: arr.length,
        isHighRisk: arr.some(i => !!i.isHighRisk),
      };
    }

    const frontendRows = rows.map((r) => {
      const tag = normalizeTag(r);
      const left = summarizeItem(r.itemsA);
      const right = summarizeItem(r.itemsB);
      return {
        controlPoint: r.controlPoint,
        domainA: r.domainA,
        domainB: r.domainB,
        countA: r.itemsA.length,
        countB: r.itemsB.length,
        status: r.status,
        tag,
        left,
        right,
        levelDiff: r.levelChanged,
        reqDiff: r.status === 'changed' && !r.levelChanged,
        extDiff: r.extChanged,
      };
    });

    const frontendStats = {
      // 统计总览（前端 4 张卡片）
      totalControlPoints: stats.total,
      levelDiffCount: rows.filter(r => r.levelChanged).length,
      requirementDiffCount: rows.filter(r => r.status === 'changed' && !r.levelChanged).length,
      extensionOnlyCount: industryOnlyCount,
      // 为后端详情表格保留的字段
      total: stats.total,
      identical, changed, onlyA, onlyB,
      itemsA: stats.itemsA, itemsB: stats.itemsB,
      highRiskA, highRiskB,
      duration: stats.duration,
    };

    await writeOperationLog({
      action: 'compare',
      module: 'standard',
      targetId: `${stdA.id}__vs__${stdB.id}`,
      targetName: `${stdA.code} VS ${stdB.code}`,
      description: `对照：${stdA.code}(${itemsA.length}项) VS ${stdB.code}(${itemsB.length}项)，相同${identical}，差异${changed}，仅A ${onlyA}，仅B ${onlyB}，行业专属 ${industryOnlyCount}，耗时 ${stats.duration}ms`,
      detailJson: JSON.stringify({
        standardA: { id: stdA.id, code: stdA.code, standardType: stdA.standardType, industry: stdA.industry, domainCount: stdA.domainCount, itemCount: itemsA.length },
        standardB: { id: stdB.id, code: stdB.code, standardType: stdB.standardType, industry: stdB.industry, domainCount: stdB.domainCount, itemCount: itemsB.length },
        stats: frontendStats,
      }),
    });

    return {
      // 左右完整信息（前端筛选提示 + 导出文件名用）
      left: { id: stdA.id, code: stdA.code, name: stdA.name, standardType: stdA.standardType, industry: stdA.industry, grade: stdA.grade, itemCount: itemsA.length, domainCount: stdA.domainCount },
      right: { id: stdB.id, code: stdB.code, name: stdB.name, standardType: stdB.standardType, industry: stdB.industry, grade: stdB.grade, itemCount: itemsB.length, domainCount: stdB.domainCount },
      // 保留后端 key 以便旧客户端（preload shared/types）兼容
      standardA: { id: stdA.id, code: stdA.code, name: stdA.name, standardType: stdA.standardType, industry: stdA.industry, grade: stdA.grade, itemCount: itemsA.length, domainCount: stdA.domainCount },
      standardB: { id: stdB.id, code: stdB.code, name: stdB.name, standardType: stdB.standardType, industry: stdB.industry, grade: stdB.grade, itemCount: itemsB.length, domainCount: stdB.domainCount },
      stats: frontendStats,
      rows: frontendRows,
      // 原始差异行（旧字段），供直接调用方若需 DiffRow
      rawRows: rows,
      markdown,
    };
  }));

  // 批量导出标准 JSON：复用单个导出逻辑，保证 roundtrip 校验一致性
  ipcMain.handle('standard:exportBatch', wrap(async (_event, standardIds: string[]) => {
    if (!Array.isArray(standardIds) || standardIds.length === 0) {
      throw new Error('批量导出需要至少 1 个标准');
    }
    const ids = Array.from(new Set(standardIds.filter(id => typeof id === 'string' && id.trim())));
    if (ids.length === 0) throw new Error('standardIds 为空');
    const out: any[] = [];
    for (const id of ids) {
      // 直接复用单条导出逻辑（避免代码复制两次）
      const singleRes = await getStandardExportPayload(id);
      out.push(singleRes);
    }
    await writeOperationLog({
      action: 'exportBatch', module: 'standard',
      targetId: ids.join(','), description: `批量导出标准 JSON，共 ${ids.length} 个：${ids.join(', ')}`,
      detailJson: JSON.stringify({ ids, count: ids.length }),
    });
    return out;
  }));

  // 导入模板下载（两种 kind）
  //  - json：返回可直接导入的「国标-三级示例」JSON（包含元信息 + 十大安全域演示控制点）
  //  - excel：返回按标准模板结构生成的 xlsx（快速入门 + 元信息 + 十大安全域每个域一个 Sheet + 示例行）
  //  每种导出方式仅保留一个统一模板（等保通用 GB/T 22239 三级），不再区分多套预设
  ipcMain.handle('standard:downloadTemplate', wrap(async (_event, params: any) => {
    const kind = params?.kind === 'excel' ? 'excel' : 'json';

    const meta = buildTemplatePresetMeta();

    if (kind === 'json') {
      const content = JSON.stringify(buildJsonTemplateSample(meta), null, 2);
      await writeOperationLog({
        action: 'downloadTemplate', module: 'standard',
        description: '下载标准导入模板：JSON 示例（等保通用 GB/T 22239-L3）',
      });
      return {
        kind: 'json',
        fileName: meta.jsonFileName,
        content,
        sampleStandardName: meta.standardName,
      };
    }

    // ======= Excel 模板：极简版（说明 + 元信息 + 域 Sheet 分组列） =======
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'JSecProbe';
    workbook.created = new Date();
    workbook.modified = new Date();

    // ---------- Sheet 1：快速入门 & 标准信息（合并使用说明 + 元信息 + 域清单，3 步极简） ----------
    const COVER_COLS = 3; // 标签列 / 值列 / 提示列
    const intro = workbook.addWorksheet('快速入门', { state: 'visible' });
    intro.columns = [
      { key: 'a', width: 24 }, { key: 'b', width: 80 }, { key: 'c', width: 36 },
    ];
    // 标题横幅
    const banner = addTitleBanner(
      intro, 1, COVER_COLS,
      'JSecProbe 标准导入模板',
      undefined,
      { titleSize: 24 },
    );
    let cursor = banner.titleRow + banner.height + 1;

    // === 区块 1：3 步导入（移除了冗余的颜色图例，直接首屏给流程） ===
    cursor = addSectionHeader(intro, cursor, COVER_COLS, '导入只需 3 步', '流程');
    cursor++;
    infoKeyValueRows(intro, cursor, [
      ['第 1 步 · 填元信息', '在下方「标准元信息」区填写标准名称 / 代号（其余可留空）。'],
      ['第 2 步 · 填域数据', `打开下方各域 Sheet（如「安全计算环境」），按表头从左到右填写；带 ★ 的列必填。若需按资产类型区分预置，请分别填写「安全计算环境-预置明细-<类型>」表（如「-服务器、存储设备」）。`],
      ['第 3 步 · 导入系统', '保存关闭本 xlsx → 回到 JSecProbe → 标准库 → 「导入标准」→ 选择本文件。'],
    ], COVER_COLS);
    cursor = intro.rowCount + 2;

    // === 区块 2：标准元信息（可直接填写） ===
    cursor = addSectionHeader(intro, cursor, COVER_COLS, '标准元信息（带 ★ 为必填）', '填写');
    cursor++;
    const stdTypeMap: Record<string, string> = { national: '国家标准', industry: '行业标准', local: '地方标准', enterprise: '企业标准' };
    const metaKeyPairs: Array<[string, string]> = [
      ['标准名称 ★', meta.standardName],
      ['标准代号 ★', meta.standardCode],
      ['保护等级 ★', '三级'],
      ['标准版本', '2026'],
      ['标准类型', stdTypeMap[meta.standardType || 'national'] || '国家标准'],
      ['适用行业', meta.industry || '通用'],
      ['描述 / 备注', '（可选）'],
    ];
    infoKeyValueRows(intro, cursor, metaKeyPairs, COVER_COLS);
    cursor = intro.rowCount + 2;

    // === 区块 3：域清单（表格形式，直观） ===
    cursor = addSectionHeader(intro, cursor, COVER_COLS, `本标准包含 ${meta.domains.length} 个域（点击下面 Sheet 标签填写对应域数据）`, '域');
    cursor++;
    const domH = intro.addRow(['编号', '域名称（Sheet 标签）', '示例行数 · 说明']);
    styleHeaderRow(intro, domH, COVER_COLS, { bg: PROBE_THEME.brandMid, height: 28 });
    meta.domains.forEach((d, i) => {
      const rows = d.sampleRows?.length || 0;
      const isIndustry = d.domainType === 'industry';
      const desc = rows > 0
        ? `示例 ${rows} 行（请替换为真实数据）${isIndustry ? ' · 行业扩展域' : ''}`
        : `空白域（直接从表头下第 1 行开始填即可）${isIndustry ? ' · 行业扩展域' : ''}`;
      const r = intro.addRow([i + 1, d.name || d.id, desc]);
      stripeRow(r, COVER_COLS, i, { alignCenters: [1] });
      if (isIndustry) {
        r.getCell(2).font = { bold: true, size: 11, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
      }
    });
    cursor = intro.rowCount + 1;

    // 底部总提醒（只保留与"3步"不重复的核心提示）
    if (COVER_COLS > 1) intro.mergeCells(cursor, 1, cursor, COVER_COLS);
    const tip = intro.getCell(cursor, 1);
    tip.value = '💡 列顺序随便改，系统按表头文字自动识别；示例行请替换为真实数据后再导入。';
    tip.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgMint } };
    tip.font = { bold: true, size: 11, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
    tip.alignment = { vertical: 'middle', indent: 1, wrapText: true };
    tip.border = BORDER_MUTED;
    intro.getRow(cursor).height = 30;

    // （移除了原「列序映射」Sheet，系统按表头文字自动匹配，不需要用户维护映射）

    // ---------- Sheet 2..N：每域一个 Sheet（简化 5 列，与参考文件 S3A3G3.xlsx 布局一致） ----------
    // 行布局：Row1 域横幅 / Row2 表头(序号·控制点·控制项·结果记录·符合情况) / Row3 扩展类型标记 / Row4+ 数据
    const HEADER_COUNT = meta.excelHeaders.length;          // 5
    const presetHeaders = meta.excelHeaders;
    const reqIdx = presetHeaders.findIndex(h => h.key === 'requirement') + 1;
    const cpIdx = presetHeaders.findIndex(h => h.key === 'controlPoint') + 1;
    const recIdx = presetHeaders.findIndex(h => h.key === 'presetRecord') + 1;
    const resIdx = presetHeaders.findIndex(h => h.key === 'presetResult') + 1;
    const seqIdx = presetHeaders.findIndex(h => h.key === 'seq') + 1;
    const tplColMax: Record<number, number> = {};
    const tplColMin: Record<number, number> = {};
    presetHeaders.forEach((h, i) => {
      const c = i + 1;
      tplColMax[c] = Math.min(108, (h.width || 20) + 36);
      tplColMin[c] = Math.max(10, Math.floor((h.width || 20) * 0.7));
    });
    const wrapColsTemplate = [reqIdx, recIdx].filter(x => x > 0);

    const seenTpl = new Set<string>();
    const tplSheetNames: string[] = meta.domains.map(d => {
      const base = d.name || d.id;
      const s = String(base).replace(/[\\/?*\[\]:]+/g, '_').slice(0, 31);
      if (!seenTpl.has(s)) { seenTpl.add(s); return s; }
      const hint = String(d.id || '').slice(0, 10);
      const withHint = `${s.slice(0, 31 - 2 - hint.length)}(${hint})`;
      if (!seenTpl.has(withHint)) { seenTpl.add(withHint); return withHint; }
      let i = 2; let cand = s;
      while (seenTpl.has(cand)) { const suf = `(${i})`; cand = `${s.slice(0, 31 - suf.length)}${suf}`; i++; }
      seenTpl.add(cand);
      return cand;
    });

    meta.domains.forEach((d, di) => {
      const finalSheet = tplSheetNames[di];
      const ws = workbook.addWorksheet(finalSheet, {
        properties: { defaultRowHeight: 24, tabColor: { argb: d.domainType === 'industry' ? PROBE_THEME.brandDark : PROBE_THEME.brandMid } },
      });
      ws.columns = presetHeaders.map(h => ({ key: h.key, width: h.width }));
      const chineseName = d.name || finalSheet;

      // --- Row 1：域横幅（深蓝标题） ---
      const dBanner = addTitleBanner(
        ws, 1, HEADER_COUNT,
        `${chineseName}`,
        `带 ★ 列为必填`,
        { bgColor: PROBE_THEME.brandDark, titleSize: 18 },
      );
      // --- Row 2：表头（统一蓝底白字，必填列以红色 ★ 标注） ---
      const headerRowNum = dBanner.titleRow + dBanner.height + 1;
      ws.getRow(headerRowNum).values = presetHeaders.map(h => h.label);
      const headerRow = ws.getRow(headerRowNum);
      styleHeaderRow(ws, headerRow, HEADER_COUNT, { withFilter: true, height: 28 });
      presetHeaders.forEach((h, idx) => {
        const c = idx + 1;
        const cell = headerRow.getCell(c);
        if (h.required) {
          cell.value = { richText: [
            { text: '★ ', font: { bold: true, size: 13, color: { argb: PROBE_THEME.textRequired }, name: '微软雅黑' } },
            { text: String(h.label || ''), font: { bold: true, size: 11, color: { argb: PROBE_THEME.white }, name: '微软雅黑' } },
          ]};
        }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      ws.views = [{ state: 'frozen', ySplit: headerRowNum + 1 }];

      // --- Row 3：扩展类型标记（与参考文件一致：整行写入「安全通用要求」等，导入时解析为该域扩展类型） ---
      const markerRowNum = headerRowNum + 1;
      const markerLabel = EXTENSION_META['general'].label;
      if (HEADER_COUNT > 1) ws.mergeCells(markerRowNum, 1, markerRowNum, HEADER_COUNT);
      const markerCell = ws.getCell(markerRowNum, 1);
      markerCell.value = markerLabel;
      markerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgSoft } };
      markerCell.font = { bold: true, size: 10.5, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
      markerCell.alignment = { horizontal: 'center', vertical: 'middle' };
      markerCell.border = BORDER_MUTED;
      ws.getRow(markerRowNum).height = 22;

      // --- Row 4+：示例行（暖橙） ---
      const samples = d.sampleRows || [];
      let dataRowNum = markerRowNum + 1;
      samples.forEach((rowObj, i) => {
        const r = ws.addRow(presetHeaders.map(h => (rowObj[h.key] ?? '') as any));
        for (let c = 1; c <= HEADER_COUNT; c++) {
          const cell = r.getCell(c);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgAmber } };
          cell.border = BORDER_MUTED;
          cell.font = { size: 10.5, color: { argb: PROBE_THEME.textPrimary }, italic: false, name: '微软雅黑' };
          cell.alignment = { vertical: 'top', wrapText: true, horizontal: 'left' };
        }
        if (reqIdx > 0) r.getCell(reqIdx).alignment = { vertical: 'top', wrapText: true };
        if (recIdx > 0) r.getCell(recIdx).alignment = { vertical: 'top', wrapText: true };
        if (cpIdx > 0) r.getCell(cpIdx).alignment = { vertical: 'middle' };
        if (seqIdx > 0) r.getCell(seqIdx).alignment = { horizontal: 'center', vertical: 'middle' };
        if (resIdx > 0) r.getCell(resIdx).alignment = { horizontal: 'center', vertical: 'middle' };
        if (i === 0 && seqIdx > 0) {
          try {
            r.getCell(seqIdx).note =
              `【示例行·请替换或删除】\n` +
              `1. 序号：该域从 1 开始连续递增即可；\n` +
              `2. 控制项：填写该控制点的具体要求（如「a）应…；b）应…」）；\n` +
              `3. 结果记录 / 符合情况：可在此写入预置底稿，录入资产时自动套用；\n` +
              `4. 第 3 行的「安全通用要求」为该域扩展类型标记，可改为云计算/移动互联/物联网/工业控制/大数据/关键信息基础设施等扩展要求。`;
          } catch { /* ignore */ }
        }
        dataRowNum = r.number + 1;
      });

      // 提示条（绿色）
      const tipRowNum = dataRowNum;
      if (HEADER_COUNT > 1) ws.mergeCells(tipRowNum, 1, tipRowNum, HEADER_COUNT);
      const tipCell = ws.getCell(tipRowNum, 1);
      tipCell.value = `✅ 示例行看完了？请先删除或替换上方橙色示例行，然后从第 ${tipRowNum + 1} 行开始填写真实控制点数据。插入行即可，不需要改列顺序。`;
      tipCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgMint } };
      tipCell.font = { bold: true, size: 10.5, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
      tipCell.alignment = { vertical: 'middle', indent: 1, wrapText: true };
      tipCell.border = BORDER_MUTED;
      ws.getRow(tipRowNum).height = 32;

      // 自适应列宽 & 行高
      autoFitSheet(ws, {
        headerRows: tipRowNum,
        wrapColumns: wrapColsTemplate,
        minWidths: tplColMin,
        maxWidths: tplColMax,
        defaultMinWidth: 10,
        defaultMaxWidth: 104,
        minRowHeight: 26,
        maxRowHeight: 420,
      });
    });

    // ---------- Sheet：安全计算环境-预置明细（按资产类型分表，每种资产类型一张） ----------
    // 解析时按 sheet 名含「预置明细」命中，并从表名提取资产类型；每个资产类型一张表，表内行=控制点、列=结果记录/符合情况
    // 维护时按类型分块填写，录入该类资产时整批套用
    const pdSamplesByType: Record<string, Array<[string, string, string, string]>> = {
      '服务器、存储设备': [
        ['身份鉴别', 'a) 应对登录用户进行身份标识和鉴别', '口令复杂度策略已启用，但未配置定期修改', '部分符合'],
        ['安全审计', 'a) 应启用安全审计功能', '已启用审计并留存日志', '符合'],
      ],
      '网络设备': [
        ['身份鉴别', 'a) 应对登录用户进行身份标识和鉴别', '已启用 AAA 认证，关闭 Telnet 明文协议', '符合'],
        ['访问控制', 'a) 应对登录用户进行身份标识和鉴别', '已配置 ACL 并最小化授权', '符合'],
      ],
      '业务终端、运维终端': [
        ['身份鉴别', 'a) 应对登录用户进行身份标识和鉴别', '已启用域账号登录', '符合'],
        ['安全审计', 'a) 应启用安全审计功能', '终端审计由日志平台统一收集', '不适用'],
      ],
    };
    ASSET_TYPE_DEFS.forEach(({ label, sheetLabel }) => {
      const presetDetailSheet = workbook.addWorksheet(`安全计算环境-预置明细-${sheetLabel}`, {
        properties: { defaultRowHeight: 24, tabColor: { argb: PROBE_THEME.brandDark } },
      });
      presetDetailSheet.columns = [
        { key: 'controlPoint', width: 22 },
        { key: 'controlName', width: 54 },
        { key: 'record', width: 66 },
        { key: 'result', width: 14 },
      ];
      const pdBanner = addTitleBanner(
        presetDetailSheet, 1, 4,
        `安全计算环境 · 预置明细（${label}）`,
        `本表为「${label}」类型的完整预置底稿；行=控制点/控制项（须与「安全计算环境」Sheet 一致），列=结果记录/符合情况`,
        { bgColor: PROBE_THEME.brandDark, titleSize: 15 },
      );
      const pdHeaderRowNum = pdBanner.titleRow + pdBanner.height + 1;
      const pdHeader = presetDetailSheet.getRow(pdHeaderRowNum);
      pdHeader.values = ['控制点', '控制项', '结果记录', '符合情况'];
      styleHeaderRow(presetDetailSheet, pdHeader, 4, { withFilter: true, height: 32 });
      const samples = pdSamplesByType[sheetLabel] || [];
      samples.forEach((row, idx) => {
        const r = presetDetailSheet.addRow(row);
        stripeRow(r, 4, idx, { alignCenters: [4] });
        for (const col of [1, 2, 3]) {
          const cell = r.getCell(col);
          cell.alignment = { wrapText: true, vertical: 'top' };
        }
      });
      // 绿色提示条
      const pdTipRowNum = pdHeaderRowNum + samples.length + 1;
      if (4 > 1) presetDetailSheet.mergeCells(pdTipRowNum, 1, pdTipRowNum, 4);
      const pdTip = presetDetailSheet.getCell(pdTipRowNum, 1);
      pdTip.value = `✅ 本表适用于资产类型为「${label}」的资产；录入该类资产时按「控制点+控制项」整批套用。留空的控制项回退到「安全计算环境」Sheet 的通用预置列；控制项列留空表示套用该控制点下全部控制项。`;
      pdTip.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgMint } };
      pdTip.font = { bold: true, size: 10.5, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
      pdTip.alignment = { vertical: 'middle', indent: 1, wrapText: true };
      pdTip.border = BORDER_MUTED;
      presetDetailSheet.getRow(pdTipRowNum).height = 44;
      presetDetailSheet.views = [{ state: 'frozen', ySplit: pdHeaderRowNum + 1 }];
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer as any, 'binary').toString('base64');
    await writeOperationLog({
      action: 'downloadTemplate', module: 'standard',
      description: `下载标准导入模板：Excel（等保通用 GB/T 22239-L3），域数 ${meta.domains.length}`,
    });
    return {
      kind: 'excel',
      fileName: meta.excelFileName,
      content: base64,
      sampleStandardName: meta.standardName,
    };
  }));

  // ====== 标准导出 Excel（导出「真实标准内容」，不同于 downloadTemplate 的"示例模板"）======
  // 单标准：返回 xlsx base64；多标准：打包为 zip（多个 xlsx）返回 zip base64
  ipcMain.handle('standard:exportExcel', wrap(async (_event, standardIds: string[]) => {
    if (!Array.isArray(standardIds)) throw new Error('standardIds 必须是字符串数组');
    const ids = Array.from(new Set(standardIds.filter(id => typeof id === 'string' && id.trim())));
    if (ids.length === 0) throw new Error('需要至少 1 个标准 ID');

    const fileBuffers: Array<{ fileName: string; buffer: Buffer; warnings: string[] }> = [];
    for (const id of ids) {
      const { buffer, fileName, warnings } = await buildStandardExcelBuffer(id);
      fileBuffers.push({ fileName, buffer, warnings });
    }

    let kind: 'xlsx' | 'zip' = fileBuffers.length === 1 ? 'xlsx' : 'zip';
    let outBuffer: Buffer;
    let outFileName: string;
    const mergedWarnings: string[] = [];
    fileBuffers.forEach(f => (f.warnings || []).forEach(w => mergedWarnings.push(`[${f.fileName}] ${w}`)));

    if (fileBuffers.length === 1) {
      outBuffer = fileBuffers[0].buffer;
      outFileName = fileBuffers[0].fileName;
    } else {
      const zip = new AdmZip();
      // ZIP 内文件名避免重复
      const seen = new Set<string>();
      for (const f of fileBuffers) {
        let name = f.fileName;
        let n = 2;
        while (seen.has(name)) { name = f.fileName.replace(/\.xlsx$/, '') + `-${n}.xlsx`; n++; }
        seen.add(name);
        zip.addFile(name, f.buffer);
      }
      // ZIP 摘要 txt
      zip.addFile('README-标准导出清单.txt', Buffer.from(
        'JSecProbe 标准批量导出（Excel）\r\n' +
        '=========================================================\r\n' +
        `导出时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}\r\n` +
        `共 ${fileBuffers.length} 个标准：\r\n\r\n` +
        fileBuffers.map((f, i) => `${i + 1}. ${f.fileName}`).join('\r\n') +
        (mergedWarnings.length ? `\r\n\r\n警告：\r\n${mergedWarnings.map(w => ' - ' + w).join('\r\n')}` : '') +
        '\r\n',
        'utf-8'
      ));
      outBuffer = zip.toBuffer();
      const ts = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      outFileName = `标准批量导出-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.zip`;
    }

    await writeOperationLog({
      action: 'exportExcel', module: 'standard', targetId: ids.join(','),
      description: `导出标准 Excel：${ids.length} 个 → ${kind.toUpperCase()}（${outFileName}）`,
      detailJson: JSON.stringify({ ids, kind, fileName: outFileName, warnings: mergedWarnings.slice(0, 50) }),
    });

    return {
      kind,
      fileName: outFileName,
      content: outBuffer.toString('base64'),
      fileCount: fileBuffers.length,
      warnings: mergedWarnings.length ? mergedWarnings.slice(0, 200) : undefined,
    };
  }));
}

/**
 * 把单个真实标准（数据库里的标准 + 测评项）导出为可回灌 Excel 工作簿 Buffer
 * 与 downloadTemplate（示例模板）区别：
 *   - 读的是数据库真实 assessment_items；
 *   - 封面"标准信息"含标准代号/版本/行业/等级 + 域清单；
 *   - 域 sheet 名优先用 domainsMeta.sheetName、否则用 name；
 *   - 每条控制点实际写入一行，斑马纹 + 高亮高风险行；空域给浅蓝提示
 */
async function buildStandardExcelBuffer(standardId: string): Promise<{ fileName: string; buffer: Buffer; warnings: string[] }> {
  const warnings: string[] = [];
  const payload = await getStandardExportPayload(standardId);
  if (payload._exportWarnings?.length) warnings.push(...payload._exportWarnings);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JSecProbe';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.creator = workbook.creator + `; standard=${payload.code}`;

  // ========== Sheet 1：标准信息（封面 + 概览 + 域清单） ==========
  const INFO_COLS = 3; // A 标签列(宽) / B 值列(宽) / C 统计附信息(中)
  const info = workbook.addWorksheet('标准信息');
  info.columns = [
    { key: 'k', width: 26 }, { key: 'v', width: 80 }, { key: 'x', width: 32 },
  ];
  const infoBanner = addTitleBanner(
    info, 1, INFO_COLS,
    `${payload.name || 'JSecProbe 标准'}`,
    `标准代号：${payload.code || '-'}  ·  版本：${payload.version || 'v1.0'}  ·  导出时间：${new Date().toLocaleString('zh-CN')}`,
    { titleSize: 22 },
  );
  let infoCur = infoBanner.titleRow + infoBanner.height + 1;

  // 区块 1：标准元信息
  infoCur = addSectionHeader(info, infoCur, INFO_COLS, '一、标准元信息', '基本信息');
  infoCur++;
  const totalItems = Array.isArray(payload.domains) ? payload.domains.reduce((a: number, d: any) => a + (Array.isArray(d.items) ? d.items.length : 0), 0) : 0;
  const domainCnt = Array.isArray(payload.domains) ? payload.domains.length : 0;
  const highRiskCnt = Array.isArray(payload.domains) ? payload.domains.reduce((a: number, d: any) => a + (Array.isArray(d.items) ? d.items.filter((it: any) => !!it.isHighRisk).length : 0), 0) : 0;
  infoCur = infoKeyValueRows(info, infoCur, [
    ['标准名称', payload.name],
    ['标准代号(code)', payload.code],
    ['标准版本', payload.version],
    ['保护等级(grade)', payload.grade != null ? `第 ${payload.grade} 级` : '-'],
    ['标准类型(standardType)', { national: '等保国家标准（GB/T）', industry: '行业标准', local: '地方标准', enterprise: '企业标准' }[String(payload.standardType || '')] || payload.standardType || '-'],
    ['适用行业(industry)', payload.industry || '通用'],
    ['预设鉴定方法(presetMethod)', payload.presetMethod === 'check' ? '核查法(Check)' : payload.presetMethod === 'interview' ? '访谈法(Interview)' : payload.presetMethod === 'test' ? '测试法(Test)' : payload.presetMethod || 'check'],
    ['描述 / 说明', payload.description || '（该标准未填写描述）'],
  ], INFO_COLS);
  infoCur = info.rowCount + 2;

  // 区块 2：概览统计（三列并排卡片）
  infoCur = addSectionHeader(info, infoCur, INFO_COLS, '二、标准概览（统计）', '统计');
  infoCur++;
  // 3 个关键指标：测评项数 / 域数量 / 高风险数
  const statRow = info.getRow(infoCur);
  const stats: Array<[string, any, string]> = [
    ['测评项总数', totalItems, '条'],
    ['域数量', domainCnt, '个'],
    ['高风险控制点', highRiskCnt, '项'],
  ];
  stats.forEach((st, i) => {
    const cell = statRow.getCell(i + 1);
    cell.value = {
      richText: [
        { text: `${st[0]}\n`, font: { size: 10, color: { argb: PROBE_THEME.textSecondary }, name: '微软雅黑' } },
        { text: String(st[1]), font: { bold: true, size: 20, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' } },
        { text: ` ${st[2]}`, font: { size: 11, color: { argb: PROBE_THEME.textSecondary }, name: '微软雅黑' } },
      ],
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, indent: 0 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgSoft } };
    cell.border = BORDER_MUTED;
  });
  info.getRow(infoCur).height = 70;
  infoCur++;
  infoCur = info.rowCount + 2;

  // 区块 3：域清单（表格 域ID | 域名 | 项数 | 高风险 | 列序映射覆盖）
  infoCur = addSectionHeader(info, infoCur, INFO_COLS, '三、域与测评项结构（明细表见各域 Sheet）', '域清单');
  infoCur++;
  const domHeader = info.addRow(['域 ID', '域名称（Sheet 名）', '测评项数 / 其中高风险']);
  styleHeaderRow(info, domHeader, INFO_COLS, { bg: PROBE_THEME.brandMid, height: 30, withFilter: true });
  (payload.domains || []).forEach((d: any, i: number) => {
    const items = Array.isArray(d.items) ? d.items : [];
    const hrc = items.filter((it: any) => !!it.isHighRisk).length;
    const row = info.addRow([
      d.id,
      d.name || d.id,
      `${items.length} 条${hrc ? `  ·  其中高风险 ${hrc} 项` : ''}`,
    ]);
    stripeRow(row, INFO_COLS, i, { alignCenters: [3] });
  });
  infoCur = info.rowCount + 2;

  // 区块 4：使用说明
  infoCur = addSectionHeader(info, infoCur, INFO_COLS, '四、使用与回灌说明', '说明');
  infoCur++;
  infoCur = infoKeyValueRows(info, infoCur, [
    ['数据来源', '本文件由 JSecProbe 从本地数据库导出，所有测评项均为系统内真实记录。'],
    ['可回灌导入', '本文件 xlsx 可直接在「标准库列表 → 导入标准」选择导入；系统按表头文字自动识别列（列顺序可任意调整），无需维护列序映射。'],
    ['域 Sheet 结构', '每个域一张表：第 1 行域标题、第 2 行表头（序号/控制点/控制项/结果记录/符合情况/扩展类型）、第 3 行扩展类型标记、第 4 行起为测评项。'],
    ['扩展类型', '「扩展类型」列可逐条标注该测评项属于哪类扩展要求（安全通用/云计算/移动互联/物联网/工业控制/大数据/关键信息基础设施）；留空时退回第 3 行域级标记。'],
    ['预置明细', '「安全计算环境-预置明细-<资产类型>」各表按资产类型存放预置底稿，录入该类资产时自动套用。'],
    ['备份建议', '推荐同步导出 JSON（标准库 → 导出标准 → JSON）；JSON 是最完整无损的迁移/备份格式。'],
  ], INFO_COLS);

  // ========== Sheet 2..N：每个域 1 个 Sheet（简化 5 列，与 downloadTemplate / 参考文件 S3A3G3.xlsx 布局一致） ==========
  // 行布局：Row1 域横幅 / Row2 表头(序号·控制点·控制项·结果记录·符合情况) / Row3 扩展类型标记 / Row4+ 数据
  // 不再单独维护「列序映射」Sheet——系统按表头文字自动匹配列（与标准导入解析逻辑一致）。
  const headers = SIMPLE_HEADERS;
  const HEADER_COUNT = headers.length; // 5
  const seqIdx = headers.findIndex(h => h.key === 'seq') + 1;
  const cpIdx = headers.findIndex(h => h.key === 'controlPoint') + 1;
  const reqIdx = headers.findIndex(h => h.key === 'requirement') + 1;
  const recIdx = headers.findIndex(h => h.key === 'presetRecord') + 1;
  const resIdx = headers.findIndex(h => h.key === 'presetResult') + 1;
  const CENTER_COLS = [seqIdx, resIdx].filter(x => x > 0);
  const DOMAIN_COL_MAX: Record<number, number> = {};
  const DOMAIN_COL_MIN: Record<number, number> = {};
  headers.forEach((h, i) => {
    const c = i + 1;
    DOMAIN_COL_MAX[c] = Math.min(108, (h.width || 20) + 30);
    DOMAIN_COL_MIN[c] = Math.max(10, Math.floor((h.width || 20) * 0.7));
  });

  const domains = (payload.domains || []).filter((d: any) => d && typeof d === 'object');
  const seenNames = new Set<string>();
  const uniqueSheetNames: string[] = domains.map((d: any) => {
    const base = d.name || DOMAIN_NAMES[String(d.id)]?.name || String(d.id).replace(/[\\/?*\[\]:_]+/g, ' ').trim() || String(d.id);
    const baseShort = String(base).replace(/[\\/?*\[\]:]+/g, '_');
    let candidate = baseShort.slice(0, 31);
    if (!seenNames.has(candidate)) { seenNames.add(candidate); return candidate; }
    const hint = String(d.id || '').replace(/[\\/?*\[\]:_]+/g, ' ').trim().slice(0, 10);
    if (hint) {
      const withHint = `${baseShort.slice(0, 31 - 2 - hint.length)}(${hint})`;
      if (!seenNames.has(withHint)) { seenNames.add(withHint); return withHint; }
    }
    let i = 2;
    while (seenNames.has(candidate)) { const suf = `(${i})`; candidate = `${baseShort.slice(0, 31 - suf.length)}${suf}`; i++; }
    seenNames.add(candidate);
    return candidate;
  });

  domains.forEach((d: any, di: number) => {
    const finalSheet = uniqueSheetNames[di];
    const ws = workbook.addWorksheet(finalSheet, {
      properties: { defaultRowHeight: 24, tabColor: { argb: (d.domainType === 'industry') ? PROBE_THEME.brandDark : PROBE_THEME.brandMid } },
    });
    ws.columns = headers.map(h => ({ key: h.key, width: h.width }));

    const items: any[] = Array.isArray(d.items) ? d.items : [];
    const chineseName = d.name || DOMAIN_NAMES[String(d.id)]?.name || finalSheet;

    // 该域的扩展类型（取出现次数最多，回退 general）→ 作为 Row3 扩展类型标记
    const extCount: Record<string, number> = {};
    items.forEach((it: any) => { const e = String(it.extensionType || 'general'); extCount[e] = (extCount[e] || 0) + 1; });
    const domainExt = Object.keys(extCount).sort((a, b) => extCount[b] - extCount[a])[0] || 'general';
    const markerLabel = (EXTENSION_META[domainExt] || EXTENSION_META.general).label;

    // --- Row 1：域横幅 ---
    const dBanner = addTitleBanner(
      ws, 1, HEADER_COUNT,
      `${chineseName}`,
      `域标识(ID)：${d.id || chineseName}  ·  测评项：${items.length} 条  ·  类型：${d.domainType === 'industry' ? '行业专用' : '等保通用'}  ·  扩展：${markerLabel}`,
      { bgColor: PROBE_THEME.brandDark, titleSize: 18 },
    );
    // --- Row 2：表头（统一蓝底白字，必填列以红色 ★ 标注） ---
    const headerRowNum = dBanner.titleRow + dBanner.height + 1;
    ws.getRow(headerRowNum).values = headers.map(h => h.label);
    const headerRow = ws.getRow(headerRowNum);
    styleHeaderRow(ws, headerRow, HEADER_COUNT, { withFilter: true, height: 28 });
    headers.forEach((h, idx) => {
      const c = idx + 1;
      const cell = headerRow.getCell(c);
      if (h.required) {
        cell.value = { richText: [
          { text: '★ ', font: { bold: true, size: 13, color: { argb: PROBE_THEME.textRequired }, name: '微软雅黑' } },
          { text: String(h.label || ''), font: { bold: true, size: 11, color: { argb: PROBE_THEME.white }, name: '微软雅黑' } },
        ]};
      }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.views = [{ state: 'frozen', ySplit: headerRowNum + 1 }];

    // --- Row 3：扩展类型标记（与导入模板 / 参考文件 S3A3G3.xlsx 一致：整行写入扩展要求名称） ---
    const markerRowNum = headerRowNum + 1;
    if (HEADER_COUNT > 1) ws.mergeCells(markerRowNum, 1, markerRowNum, HEADER_COUNT);
    const markerCell = ws.getCell(markerRowNum, 1);
    markerCell.value = markerLabel;
    markerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgSoft } };
    markerCell.font = { bold: true, size: 10.5, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
    markerCell.alignment = { horizontal: 'center', vertical: 'middle' };
    markerCell.border = BORDER_MUTED;
    ws.getRow(markerRowNum).height = 22;

    // --- Row 4+：数据行 ---
    if (items.length === 0) {
      const r = markerRowNum + 1;
      if (HEADER_COUNT > 1) ws.mergeCells(r, 1, r, HEADER_COUNT);
      const cell = ws.getCell(r, 1);
      cell.value = `（${chineseName} 域暂未配置测评项；可在 Excel 中从此行开始按表头填入，导入标准 Excel 即回灌系统。第 3 行的「${markerLabel}」为该域扩展类型标记。）`;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgEmpty } };
      cell.font = { size: 11, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
      cell.alignment = { vertical: 'middle', indent: 2, wrapText: true };
      cell.border = BORDER_MUTED;
      ws.getRow(r).height = 36;
    } else {
      items.forEach((it: any, idx: number) => {
        const seqNum = Number(it.sortOrder);
        // 数据库 sort_order 为 NOT NULL DEFAULT 0：未填序号时落库为 0，
        // 导出不能用 "!= null"（0 会通过），必须显式判断 >0，否则全变成 0
        const seq = Number.isFinite(seqNum) && seqNum > 0 ? seqNum : idx + 1;
        // 逐条扩展类型：type key → 中文标记 label（空/未知则留空，由导入端退回域级标记）
        const extLabel = it.extensionType ? (EXTENSION_META[it.extensionType]?.label ?? '') : '';
        const row = ws.addRow({
          seq,
          controlPoint: it.controlPoint ?? '',
          requirement: it.requirement ?? '',
          presetRecord: it.presetRecord ?? '',
          presetResult: it.presetResult ?? '',
          extensionType: extLabel,
        });
        stripeRow(row, HEADER_COUNT, idx, { alignCenters: CENTER_COLS });
        for (const col of [reqIdx, recIdx].filter(x => x > 0)) {
          const cell = row.getCell(col);
          cell.alignment = { wrapText: true, vertical: 'top' };
        }
        if (cpIdx > 0) row.getCell(cpIdx).alignment = { vertical: 'middle' };
        if (resIdx > 0) row.getCell(resIdx).alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }

    autoFitSheet(ws, {
      headerRows: markerRowNum,
      wrapColumns: [reqIdx, recIdx].filter(x => x > 0),
      minWidths: DOMAIN_COL_MIN,
      maxWidths: DOMAIN_COL_MAX,
      defaultMinWidth: 8,
      defaultMaxWidth: 98,
      minRowHeight: 26,
      maxRowHeight: 420,
    });
  });

  // ========== Sheet N+1..：安全计算环境-预置明细·<资产类型>（导出真实类型化预置，按类型分表，可回灌） ==========
  const scDomain = (payload.domains || []).find((d: any) => d.id === 'secure_computing');
  // 按资产类型聚合：{ [categoryKey]: Array<[controlPoint, requirement, record, result]> }
  // 第 2 列「控制项」取 requirement（与主表「控制项」列同源，须与主表一致；requirement 缺失时才回退 controlName）
  const detailByType: Record<string, Array<[string, string, string, string]>> = {};
  if (scDomain && Array.isArray(scDomain.items)) {
    for (const it of scDomain.items) {
      const byType = it.presetByType ? (() => { try { return JSON.parse(it.presetByType); } catch { return null; } })() : null;
      if (!byType || typeof byType !== 'object') continue;
      for (const key of Object.keys(byType)) {
        const entry = byType[key];
        if (!entry || typeof entry !== 'object') continue;
        if (!detailByType[key]) detailByType[key] = [];
        detailByType[key].push([it.controlPoint || '', it.requirement || it.controlName || '', entry.record || '', entry.result || '']);
      }
    }
  }
  const typeKeys = Object.keys(detailByType);
  if (typeKeys.length === 0) {
    // 无类型化预置：输出一张说明性子表，便于用户了解格式（重新导入时该表会被忽略）
    const emptySheet = workbook.addWorksheet('安全计算环境-预置明细-说明', {
      properties: { defaultRowHeight: 24, tabColor: { argb: PROBE_THEME.brandDark } },
    });
    emptySheet.columns = [{ key: 'controlPoint', width: 24 }, { key: 'result', width: 14 }, { key: 'record', width: 72 }];
    const eb = addTitleBanner(emptySheet, 1, 3, '安全计算环境 · 预置明细（按资产类型分表）', '本表为导出时按资产类型区分的预置；未配置则仅含本说明', { bgColor: PROBE_THEME.brandDark, titleSize: 15 });
    const er = eb.titleRow + eb.height + 2;
    if (3 > 1) emptySheet.mergeCells(er, 1, er, 3);
    const ec = emptySheet.getCell(er, 1);
    ec.value = '（本标准安全计算环境域未配置按资产类型区分的预置；如需启用，请参考导入模板按资产类型填写后重新导入）';
    ec.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgEmpty } };
    ec.font = { size: 11, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
    ec.alignment = { vertical: 'middle', indent: 2, wrapText: true };
    ec.border = BORDER_MUTED;
    emptySheet.getRow(er).height = 36;
  } else {
    typeKeys.forEach((key) => {
      const sheetLabel = CATEGORY_KEY_TO_SHEET_LABEL[key] || key;
      const label = CATEGORY_KEY_TO_LABEL[key] || key;
      const rows = detailByType[key];
      const presetDetailSheet = workbook.addWorksheet(`安全计算环境-预置明细-${sheetLabel}`, {
        properties: { defaultRowHeight: 24, tabColor: { argb: PROBE_THEME.brandDark } },
      });
      presetDetailSheet.columns = [{ key: 'controlPoint', width: 22 }, { key: 'controlName', width: 54 }, { key: 'record', width: 66 }, { key: 'result', width: 14 }];
      const pdBanner = addTitleBanner(
        presetDetailSheet, 1, 4,
        `安全计算环境 · 预置明细（${label}）`,
        '本表为导出时该资产类型的真实预置；行=控制点/控制项，列=结果记录/符合情况',
        { bgColor: PROBE_THEME.brandDark, titleSize: 15 },
      );
      const pdHeaderRowNum = pdBanner.titleRow + pdBanner.height + 1;
      const pdHeader = presetDetailSheet.getRow(pdHeaderRowNum);
      pdHeader.values = ['控制点', '控制项', '结果记录', '符合情况'];
      styleHeaderRow(presetDetailSheet, pdHeader, 4, { withFilter: true, height: 32 });
      rows.forEach((row, idx) => {
        const r = presetDetailSheet.addRow(row);
        stripeRow(r, 4, idx, { alignCenters: [4] });
        for (const col of [1, 2, 3]) {
          const cell = r.getCell(col);
          cell.alignment = { wrapText: true, vertical: 'top' };
        }
      });
      presetDetailSheet.views = [{ state: 'frozen', ySplit: pdHeaderRowNum + 1 }];
    });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as any, 'binary');
  const sanitize = (s: string) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_') || 'standard';
  const fileName = `${sanitize(payload.code || payload.name || payload.id)}.xlsx`;
  return { fileName, buffer, warnings };
}

/**
 * 复用 standard:export 单条逻辑（避免在 exportBatch 里重复写同一份完整性校验 + roundtrip）
 * 这里不二次 IPC，直接复制标准导出过程并返回 payload（函数内同步保持 L612-L734 结构一致）
 */
async function getStandardExportPayload(standardId: string): Promise<any> {
  const db = getDb();
  const [std] = await db.select().from(schema.standards).where(eq(schema.standards.id, standardId));
  if (!std) throw new Error(`标准不存在：${standardId}`);
  const items = await db.select().from(schema.assessmentItems)
    .where(eq(schema.assessmentItems.standardId, standardId))
    .orderBy(schema.assessmentItems.sortOrder);
  const warnings: string[] = [];
  const metaMap = parseDomainsMeta(std.domainsMeta);
  const domainMap = new Map<string, any[]>();
  for (const item of items) {
    if (!domainMap.has(item.domain)) domainMap.set(item.domain, []);
    domainMap.get(item.domain)!.push({
      id: item.id, controlPoint: item.controlPoint, controlName: item.controlName,
      requirement: item.requirement, minLevel: item.minLevel, maxLevel: item.maxLevel,
      extensionType: item.extensionType, isHighRisk: !!item.isHighRisk,
      sortOrder: item.sortOrder, parentId: item.parentId || undefined,
      presetResult: (item as any).presetResult || undefined,
      presetRecord: (item as any).presetRecord || undefined,
      presetByType: (item as any).presetByType || undefined,
    });
  }
  const domains = Array.from(domainMap.entries()).map(([domainId, domainItems]) => ({
    id: domainId,
    name: metaMap[domainId]?.name || domainId,
    icon: metaMap[domainId]?.icon,
    domainType: metaMap[domainId]?.domainType || 'national',
    items: domainItems,
  }));
  const exportPayload: any = {
    id: std.id, name: std.name, code: std.code, version: std.version,
    description: std.description, grade: std.grade,
    levelCombo: std.levelCombo || '',
    standardType: std.standardType, industry: std.industry,
    presetTemplate: std.presetTemplate, presetMethod: std.presetMethod || 'check',
    columnMap: std.columnMap ? (() => { try { return JSON.parse(std.columnMap); } catch { return undefined; } })() : undefined,
    domains,
  };
  try {
    const r = validateStandardImportData(exportPayload);
    if (r.warnings.length > 0) warnings.push(...r.warnings.map(w => `[roundtrip] ${w}`));
  } catch (e: any) {
    warnings.push(`[roundtrip 自检失败] 导出内容后续无法直接导入：${e?.message || String(e)}`);
  }
  return { ...exportPayload, _exportWarnings: warnings };
}

// ======== 构建模板预设（导入模板下载 & JSON 示例共享结构）========
interface TemplateHeader { key: string; label: string; width: number; required?: boolean; }
interface TemplateDomainSample {
  id: string; name: string; icon?: string; domainType?: 'national' | 'industry';
  sheetName?: string;
  sampleRows: Array<Record<string, any>>;
}
interface TemplatePresetMeta {
  preset: 'national' | 'power' | 'finance' | 'custom';
  standardName: string; standardCode: string; industry?: string;
  grade: number; standardType: 'national' | 'industry';
  excelHeaders: TemplateHeader[];
  domains: TemplateDomainSample[];
  jsonFileName: string; excelFileName: string;
}

function buildTemplatePresetMeta(): TemplatePresetMeta {
  // 统一 6 列（序号 / 控制点 / 控制项 / 结果记录 / 符合情况 / 扩展类型），扩展类型可逐条标注
  const excelHeaders = SIMPLE_HEADERS;

  // 十大安全域（GB/T 22239 等保2.0 三级）：每个域一个 Sheet，统一演示「安全通用要求」扩展类型
  // 每域给出 1 条示例控制点，便于理解列含义；导入前请替换为真实数据（删除示例行后从首行填写）
  const domains: TemplateDomainSample[] = [
    { id: 'secure_physical', name: '安全物理环境', icon: 'OfficeBuilding', domainType: 'national', sheetName: '安全物理环境', sampleRows: [{
      seq: 1, controlPoint: '8.1.1.1',
      requirement: '应对机房物理位置的选择进行总体安全规划，并按照机房标准建设，位置应远离强震源、强电磁场源等，具有防震、防风和防雨等能力。',
      presetRecord: '示例：机房选址已完成安全评估', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'secure_communication', name: '安全通信网络', icon: 'Connection', domainType: 'national', sheetName: '安全通信网络', sampleRows: [{
      seq: 1, controlPoint: '8.1.2.1',
      requirement: '应保证网络设备的业务处理能力满足业务高峰期需要，保证网络的带宽满足业务高峰期需要。',
      presetRecord: '示例：核心链路已做冗余', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'secure_boundary', name: '安全区域边界', icon: 'Grid', domainType: 'national', sheetName: '安全区域边界', sampleRows: [{
      seq: 1, controlPoint: '8.1.3.1',
      requirement: '应保证跨越网络边界的访问和数据流通过边界设备提供的受控接口进行通信。',
      presetRecord: '示例：已部署防火墙做访问控制', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'secure_computing', name: '安全计算环境', icon: 'Monitor', domainType: 'national', sheetName: '安全计算环境', sampleRows: [
      {
        seq: 1, controlPoint: '8.1.4.1',
        requirement: '应对登录操作系统和数据库系统的用户进行身份标识和鉴别；操作系统和数据库系统管理用户身份标识应具有不易被冒用的特点，口令应有复杂度要求并定期更换。',
        presetRecord: '示例：已启用口令复杂度策略并定期更换', presetResult: '符合', extensionType: '安全通用要求',
      },
      {
        seq: 2, controlPoint: '8.1.4.2',
        requirement: '应对操作系统和数据库系统的访问控制策略进行配置，确保授权主体只能按其授权访问客体。',
        presetRecord: '', presetResult: '', extensionType: '',
      },
    ] },
    { id: 'secure_management', name: '安全管理中心', icon: 'Setting', domainType: 'national', sheetName: '安全管理中心', sampleRows: [{
      seq: 1, controlPoint: '8.1.5.1',
      requirement: '应对系统管理员进行身份鉴别，只允许其通过特定的命令或操作界面进行系统管理操作，并对这些操作进行审计。',
      presetRecord: '示例：已启用统一运维审计（堡垒机）', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'security_management', name: '安全管理制度', icon: 'Document', domainType: 'national', sheetName: '安全管理制度', sampleRows: [{
      seq: 1, controlPoint: '8.1.6.1',
      requirement: '应对安全管理活动中的各类管理内容建立安全管理制度。',
      presetRecord: '示例：已发布安全管理制度汇编', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'security_organization', name: '安全管理机构', icon: 'Briefcase', domainType: 'national', sheetName: '安全管理机构', sampleRows: [{
      seq: 1, controlPoint: '8.1.7.1',
      requirement: '应成立指导和管理网络安全工作的委员会或领导小组，其最高领导由单位主管领导委任或授权。',
      presetRecord: '示例：已成立网络安全领导小组', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'security_personnel', name: '安全管理人员', icon: 'User', domainType: 'national', sheetName: '安全管理人员', sampleRows: [{
      seq: 1, controlPoint: '8.1.8.1',
      requirement: '应对各类人员进行相应的安全培训，包括网络安全相关的法律法规、标准规范等。',
      presetRecord: '示例：已按计划开展年度安全培训', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'security_construction', name: '安全建设管理', icon: 'Tools', domainType: 'national', sheetName: '安全建设管理', sampleRows: [{
      seq: 1, controlPoint: '8.1.9.1',
      requirement: '应根据保护对象的安全保护等级及与其他级别定级对象的关联情况，组织相关部门和有关安全专家论证其定级合理性。',
      presetRecord: '示例：已完成定级专家评审', presetResult: '符合', extensionType: '安全通用要求',
    }] },
    { id: 'security_maintenance', name: '安全运维管理', icon: 'Box', domainType: 'national', sheetName: '安全运维管理', sampleRows: [{
      seq: 1, controlPoint: '8.1.10.1',
      requirement: '应建立机房安全管理制度，对有关物理访问、物品带进出和环境安全等方面的管理作出规定。',
      presetRecord: '示例：已建立机房进出登记制度', presetResult: '符合', extensionType: '安全通用要求',
    }] },
  ];

  const standardName = '信息安全技术 网络安全等级保护基本要求（三级）示例模板';
  const standardCode = 'GB/T 22239-2019-L3-DEMO';
  const standardType: 'national' | 'industry' = 'national';
  const jsonFileName = '标准导入示例-国标GB22239-三级.json';
  const excelFileName = '标准导入Excel模板-国标GB22239.xlsx';

  return {
    preset: 'national', standardName, standardCode, industry: undefined, grade: 3, standardType,
    excelHeaders, domains, jsonFileName, excelFileName,
  };
}

function buildJsonTemplateSample(meta: TemplatePresetMeta): any {
  const domainHeaderKey = meta.excelHeaders.reduce<Record<string, number>>((acc, h, idx) => {
    acc[h.key] = idx;
    return acc;
  }, {});

  return {
    id: meta.standardCode.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    name: meta.standardName,
    code: meta.standardCode,
    version: '2026',
    description: '【示例模板，请修改后再导入】等保通用 GB/T 22239 三级；删除不需要的演示域/项后再导入即可。',
    grade: meta.grade,
    standardType: meta.standardType,
    industry: meta.industry || '',
    presetMethod: 'check',
    // 简化模板 5 列：序号 / 控制点 / 控制项 / 结果记录 / 符合情况
    columnMap: {
      '序号': domainHeaderKey['seq'] ?? 0,
      '控制点': domainHeaderKey['controlPoint'] ?? 1,
      '控制项': domainHeaderKey['requirement'] ?? 2,
      '结果记录': domainHeaderKey['presetRecord'] ?? 3,
      '符合情况': domainHeaderKey['presetResult'] ?? 4,
    },
    domains: meta.domains.map(d => ({
      id: d.id, name: d.name, icon: d.icon, domainType: d.domainType || 'national', sheetName: d.sheetName,
      items: (d.sampleRows || []).map((r, idx) => ({
        id: `${d.id}-sample-${idx + 1}`,
        controlPoint: String(r['controlPoint'] ?? ''),
        requirement: String(r['requirement'] ?? ''),
        presetRecord: String(r['presetRecord'] ?? ''),
        presetResult: String(r['presetResult'] ?? ''),
        extensionType: 'general',
        sortOrder: idx + 1,
      })),
    })).filter(d => Array.isArray(d.items) && d.items.length > 0 ? true : true), // 保留空域（允许用户填）
  };
}
