/**
 * 测评点知识库核心逻辑（纯函数，可单测）。
 *
 * 来源：赛飞 V2.0 等保测评作业指导书。指导书表头有 4 类且同义异名，
 * 这里把「列识别 / 语义键 / 设备键 / 测评点拆分 / 模糊匹配」收口，
 * service 层只负责读 Excel 与落库。
 */

/** 从一行单元格取纯文本（兼容 richText / formula-result / 普通值） */
export function cellText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((x: any) => String(x?.text ?? '')).join('');
    if (typeof v.text === 'string') return v.text;
    if (v.result !== undefined) return String(v.result);
  }
  return '';
}

/**
 * 要求文本归一化（语义键的第三要素）。
 * 处理：空白、全半角括号、中文/英文标点、序号前缀 a)/a）/(1)、波浪号差异。
 */
export function normalizeRequirement(text: string): string {
  return String(text || '')
    // M3：全角数字/字母先转半角（如 １）、ａ））
    .replace(/[\uFF10-\uFF19]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\uFF21-\uFF3A\uFF41-\uFF5A]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s\u3000]/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，,]/g, ',')
    .replace(/[；;]/g, ',') // 分号统一为逗号（指导书里两种混用）
    .replace(/[：:]/g, ',')
    .replace(/[。．]/g, '.')
    .replace(/[、]/g, ',')
    .replace(/[“”"'‘’]/g, '')
    .replace(/[~～]/g, '~') // M3：波浪号归一
    // M3：序号前缀统一处理——a) / a. / a、 / （1） / 1) / 1、
    .replace(/^[a-zA-Z]\s*[\)\.,、]\s*/, '')
    .replace(/^\(?\d+\s*[\)\.,、]\s*/, '')
    // M3：结尾标点剥除（。/；/，/，指导书与标准库结尾习惯不同）
    .replace(/[\.,;，。；、]+$/, '')
    .toLowerCase();
}

/** 安全层面中文名 → 域 id（指导书里叫「安全层面」或「类别」） */
const DOMAIN_NAME_MAP: Record<string, string> = {
  '安全物理环境': 'secure_physical',
  '物理环境': 'secure_physical',
  '安全通信网络': 'secure_communication',
  '通信网络': 'secure_communication',
  '安全区域边界': 'secure_boundary',
  '区域边界': 'secure_boundary',
  '安全计算环境': 'secure_computing',
  '计算环境': 'secure_computing',
  '安全管理中心': 'secure_management',
  '管理中心': 'secure_management',
  '安全管理制度': 'security_management',
  '安全管理机构': 'security_organization',
  '安全人员管理': 'security_personnel',
  '安全管理人员': 'security_personnel',
  '系统建设管理': 'security_construction',
  '系统运维管理': 'security_maintenance',
  // M3：2019 版命名（标准种子库用的是这两个）
  '安全建设管理': 'security_construction',
  '安全运维管理': 'security_maintenance',
  '建设管理': 'security_construction',
  '运维管理': 'security_maintenance',
};
/** 合法的域 id 白名单（未知值降级为通用，避免把"访谈/核查/7.1.4"当域塞进语义键） */
const VALID_DOMAIN_KEYS: ReadonlySet<string> = new Set([
  'secure_physical', 'secure_communication', 'secure_boundary', 'secure_computing',
  'secure_management', 'security_management', 'security_organization',
  'security_personnel', 'security_construction', 'security_maintenance',
]);
export function toDomainKey(raw: string): string {
  const t = String(raw || '').trim();
  const mapped = DOMAIN_NAME_MAP[t] || t;
  return VALID_DOMAIN_KEYS.has(mapped) ? mapped : '';
}

/**
 * 设备类型 key：从 sheet 名或 ObjectType/RelatedAssets 提取。
 * 返回 '' 表示通用（物理/管理/通信网络/区域边界这类与设备无关的条款）。
 */
/**
 * S2：资产分类 id（shared/asset-categories.ts）→ 指导书设备键的显式映射。
 * 分类 id 与指导书 sheet 名是两套词表，必须显式桥接，否则 toDeviceKey 返回 '' 导致设备召回全断。
 * server_storage 依赖 os 二次细分（Linux/Windows），由 toDeviceKey 的 os 参数处理。
 */
const ASSET_CATEGORY_TO_DEVICE: Readonly<Record<string, string>> = {
  network_device: 'network_device',
  security_device: 'security_device',
  business_app: 'business_app',
  terminal: 'terminal',
  data_resource: 'database',
  // 以下分类与设备无关，指导书条目多为通用，返回 '' 走通用召回
  server_storage: '',
  machine_room: '',
  network_boundary: '',
  management_platform: '',
  sys_doc: '',
  other_asset: '',
  crypto_product: '',
  security_personnel: '',
};

const DEVICE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/nginx/i, 'nginx'],
  [/tomcat/i, 'tomcat'],
  [/mysql/i, 'mysql'],
  [/oracle/i, 'oracle'],
  [/mongodb/i, 'mongodb'],
  [/linux|centos|redhat|ubuntu/i, 'linux'],
  [/windows|win服务器/i, 'windows'],
  [/防火墙|firewall/i, 'firewall'],
  [/路由器|router/i, 'router'],
  [/交换机|switch/i, 'switch'],
  // S2：网络设备与安全设备拆开，避免防火墙/路由器条目串味
  [/安全设备/i, 'security_device'],
  [/网络设备/i, 'network_device'],
  [/应用系统|业务应用/i, 'business_app'],
  [/终端|工作站/i, 'terminal'],
  [/数据库/i, 'database'],
  [/中间件/i, 'middleware'],
  [/云计算|云平台/i, 'cloud'],
  [/工控|工业控制/i, 'industrial'],
  [/移动互联/i, 'mobile'],
  [/物联网/i, 'iot'],
];

/**
 * 设备类型 key：支持三种输入——①资产分类 id（network_device 等）；②中文名/sheet 名（网络设备、Linux）；③产品名。
 * os 参数用于 server_storage 的二次细分（Linux/Windows）。
 * 返回 '' 表示通用（物理/管理/通信网络这类与设备无关的条款）。
 */
export function toDeviceKey(raw: string | undefined | null, os?: string | null): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  // ① 资产分类 id 精确映射
  if (t in ASSET_CATEGORY_TO_DEVICE) {
    const mapped = ASSET_CATEGORY_TO_DEVICE[t];
    // server_storage 用 os 细分
    if (t === 'server_storage' && os) {
      const osKey = toDeviceKey(os);
      if (osKey) return osKey;
    }
    return mapped;
  }
  // ② 中文名 / 产品名规则
  for (const [re, key] of DEVICE_RULES) if (re.test(t)) return key;
  // ③ os 兜底（当 raw 是分类 id 但已处理，或 raw 是操作系统名）
  if (os) {
    for (const [re, key] of DEVICE_RULES) if (re.test(String(os))) return key;
  }
  return '';
}

/** 语义键：域 + 控制点 + 归一化要求。不含设备（设备在 deviceKey 单独存）。 */
export function buildSemanticKey(domain: string, controlPoint: string, requirement: string): string {
  const d = toDomainKey(domain) || '通用';
  const c = String(controlPoint || '').trim();
  const r = normalizeRequirement(requirement);
  return `${d}||${c}||${r}`;
}

/**
 * 库内编辑的决策核心（纯函数）：给定现有记录与编辑输入，算出要落库的目标字段，
 * 并做三类校验——测评项为空 / 测评点为空 / 撞到同语义键+同设备的另一条记录。
 *
 * 抽成纯函数是为了可单测：这三类都是"坏了就静默出错"的路径
 * （空文本入库让召回失准、撞唯一索引导致整批事务回滚）。
 */
export interface CheckpointUpdateInput {
  id: string;
  domain?: string | null;
  controlPoint?: string | null;
  requirement?: string;
  checkpoints?: string[];
  interpretation?: string | null;
  resultTemplate?: string | null;
  catalogNo?: string | null;
  deviceKey?: string;
}
export type CheckpointUpdateDecision =
  | { ok: true; values: Record<string, any>; semanticKey: string }
  | { ok: false; reason: 'empty_requirement' | 'empty_checkpoints'; duplicateOf?: undefined };

export function resolveCheckpointUpdate(
  existing: {
    id: string; semanticKey: string; deviceKey: string;
    domain?: string | null; controlPoint?: string | null; requirement: string;
    checkpoints?: string; interpretation?: string | null; resultTemplate?: string | null;
    catalogNo?: string | null;
  },
  input: CheckpointUpdateInput,
): CheckpointUpdateDecision {
  const requirement = String((input.requirement ?? existing.requirement) || '').trim();
  if (!requirement) return { ok: false, reason: 'empty_requirement' };

  let newPoints: string[] | null = null;
  if (input.checkpoints !== undefined) {
    newPoints = input.checkpoints.filter(p => typeof p === 'string' && p.trim().length > 0);
    if (newPoints.length === 0) return { ok: false, reason: 'empty_checkpoints' };
  }

  const domain = input.domain !== undefined ? (input.domain || null) : (existing.domain ?? null);
  const controlPoint = input.controlPoint !== undefined ? (input.controlPoint || null) : (existing.controlPoint ?? null);
  const deviceKey = input.deviceKey !== undefined ? input.deviceKey : existing.deviceKey;
  const semanticKey = buildSemanticKey(domain || '', controlPoint || '', requirement);

  // 未传 checkpoints 时保留原值
  let checkpointsJson = JSON.stringify(newPoints || []);
  if (newPoints === null) {
    try {
      const parsed = JSON.parse(existing.checkpoints || '[]');
      checkpointsJson = JSON.stringify(Array.isArray(parsed) ? parsed.filter((x: any) => typeof x === 'string') : []);
    } catch { checkpointsJson = '[]'; }
  }

  return {
    ok: true,
    semanticKey,
    values: {
      domain, controlPoint, requirement,
      semanticKey, deviceKey,
      checkpoints: checkpointsJson,
      interpretation: input.interpretation !== undefined ? (input.interpretation || null) : existing.interpretation ?? null,
      resultTemplate: input.resultTemplate !== undefined ? (input.resultTemplate || null) : existing.resultTemplate ?? null,
      catalogNo: input.catalogNo !== undefined ? (input.catalogNo || null) : existing.catalogNo ?? null,
    },
  };
}

/**
 * 批量分析的「测评点注入」自适应预算。
 *
 * 批量请求是 N 个测评项共享一次上下文，若每项都用固定额度（如 1200 字/8 点），
 * 50 项会撑到 6 万字以上；而 1-2 项时又白白浪费额度、覆盖不足。
 * 做法：总预算恒定，按实际条数分摊到每一项——
 *   - 条数越少，每项额度越大（上限 6000 字 / 8 点）；
 *   - 条数越多，每项自动收窄（下限 400 字 / 1 点）；
 *   - 总量始终 ≤ 约 2.4 万字，不会随条数线性膨胀。
 */
export function batchCheckpointBudget(itemCount: number): { maxPoints: number; maxChars: number } {
  const n = Math.max(1, Number(itemCount) || 1);
  const TOTAL_CHARS = 24000;
  const TOTAL_POINTS = 120;
  const MIN_CHARS = 400, MAX_CHARS = 6000;
  const MIN_POINTS = 1, MAX_POINTS = 8;
  return {
    maxPoints: Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.ceil(TOTAL_POINTS / n))),
    maxChars: Math.min(MAX_CHARS, Math.max(MIN_CHARS, Math.round(TOTAL_CHARS / n))),
  };
}

/** 列名同义词归一：识别表头属于哪个语义字段 */
export type HeaderField = 'seq' | 'domain' | 'controlPoint' | 'requirement' | 'checkpoints' | 'resultTemplate' | 'interpretation' | 'catalogNo' | 'deviceType' | 'remark';
const HEADER_SYNONYMS: ReadonlyArray<readonly [HeaderField, RegExp]> = [
  ['seq', /^序号$/],
  ['domain', /^(安全层面|类别|层面)$/],
  ['controlPoint', /^(控制点|安全控制点|类)$/],
  ['requirement', /^(测评项|安全要求|基本要求项|控制项)$/],
  ['checkpoints', /^(测评方法|测评要求)$/],
  ['resultTemplate', /^(预期结果|结果记录|现场记录|预期结果或主要证据)$/],
  ['interpretation', /^要求解读$/],
  ['catalogNo', /^(testitemnumber|标准条款号|条款号)$/i],
  ['deviceType', /^(objecttype|relatedassets|设备类型|对象类型)$/i],
  ['remark', /^(备注|说明)$/],
];
/** 返回 列号(1-based) → 字段 的映射；未识别的列忽略 */
export function detectHeaderFields(headerRow: string[]): Map<number, HeaderField> {
  const map = new Map<number, HeaderField>();
  headerRow.forEach((raw, idx) => {
    const t = String(raw || '').trim();
    if (!t) return;
    for (const [field, re] of HEADER_SYNONYMS) {
      if (re.test(t)) { map.set(idx + 1, field); break; }
    }
  });
  return map;
}

/**
 * 从「测评方法/测评要求」列拆出逐条测评点。
 * 支持 `1) xxx；2) xxx` / `1、xxx` / `（1）xxx` / `(1)xxx` 四种编号。
 *
 * M1：只认「数字 + )/）/、」作为编号分隔符，**不认英文句点**——
 * 否则 IP（8.8.8.8）、版本号（2.0.1）、层级号（1.1）会被误切成测评点。
 */
export function splitCheckpoints(text: string): string[] {
  const t = String(text || '').trim();
  if (!t) return [];
  // 消费式分割：匹配「编号前缀」整体（含全角括号），保留编号写回每条（便于对照指导书）
  // 不认英文句点做分隔，避免 IP/版本号误切
  const NUMBER_RE = /[（(]?\d{1,2}\s*[)）、]/g;
  const marks: Array<{ index: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(t)) !== null) marks.push({ index: m.index, text: m[0] });
  // 首条必须从字符串开头附近起（允许前导空白/标点），否则视为无编号单句
  const parts: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : t.length;
    const body = t.slice(start, end).trim().replace(/^[\s；;，,。、]+/, '').trim();
    if (body) parts.push(body);
  }
  // 至少 2 个编号才拆；引导语（如"经核查，"）并入第一条，不丢弃语义
  if (parts.length < 2) return [t.replace(/^[\s；;，,。、]+/, '').trim()];
  const prefix = t.slice(0, marks[0].index).trim().replace(/[\s；;，,。、]+$/, '');
  if (prefix && prefix.length <= 12) {
    parts[0] = `${prefix} ${parts[0]}`;
  }
  // 过滤纯编号标记：如 "1) 2) 3)" 会拆出 ['1)','2)','3)']，
  // 去掉编号前缀后已无实质内容，入库后会在 AI 召回时注入无语义的"检查点"。
  const meaningful = parts.filter((p) => {
    const body = p.replace(/^[（(]?\d{1,2}\s*[)）、]\s*/, '').trim();
    return body.length > 0;
  });
  // 全部是纯编号时返回空（让上游按"未识别到测评数据"处理），
  // 不能回退到 parts——那等于没过滤。
  return meaningful;
}

/** 简单 fuzzy 匹配：归一化后相等、包含、或编辑距离 ≤ 阈值 */
export function fuzzyRequirementMatch(a: string, b: string): 'exact' | 'contains' | 'fuzzy' | null {
  const na = normalizeRequirement(a), nb = normalizeRequirement(b);
  if (!na || !nb) return null;
  if (na === nb) return 'exact';
  const minLen = Math.min(na.length, nb.length), maxLen = Math.max(na.length, nb.length);
  // M2：contains 加长度门槛——短标题（"应核查身份鉴别"，7字）被长条款包含会误判，
  // 只有较短一方 ≥12 字且长度比 ≥0.5 才认 contains
  if ((na.includes(nb) || nb.includes(na)) && minLen >= 12 && minLen / maxLen >= 0.5) return 'contains';
  // 长度差太大直接否
  if (maxLen - minLen > Math.max(8, minLen * 0.35)) return null;
  const dist = levenshtein(na, nb);
  // M2：编辑距离阈值收紧——短条款不允许编辑（8字的"口令复杂度"vs"口令长度"差2字属不同项），
  // 长条款按比例最多 2 字（"身份鉴别信息"这类插入词只在长句里容忍）
  const distLimit = Math.min(2, Math.floor(minLen * 0.1));
  if (distLimit > 0 && dist <= distLimit) return 'fuzzy';
  // 2-gram Jaccard 兜底：仅对长条款（≥20字）启用，阈值 0.7，避免短串近义误判
  if (minLen >= 20) {
    const ga = bigrams(na), gb = bigrams(nb);
    let inter = 0;
    for (const g of ga) if (gb.has(g)) inter++;
    const union = ga.size + gb.size - inter;
    if (union > 0 && inter / union >= 0.7) return 'fuzzy';
  }
  return null;
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[lb];
}
