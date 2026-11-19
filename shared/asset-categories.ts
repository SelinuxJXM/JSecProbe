// 资产分类单一数据源（Single Source of Truth）
// 系统构成、预置明细、资产导入/导出、报表均以此为基准，避免分类在多处重复定义而产生漂移。
// 注意：本文件定义的是「分类静态定义」（不含运行时统计字段 count），
// 含统计数据的业务类型请使用 shared/types.ts 中的 AssetCategory。
export interface AssetCategoryDef {
  id: string;
  name: string;
  icon: string;
}

// 系统构成全部资产分类（13 类）
export const ASSET_CATEGORIES: readonly AssetCategoryDef[] = [
  { id: 'machine_room', name: '管理机房', icon: 'Server' },
  { id: 'network_boundary', name: '区域边界', icon: 'Network' },
  { id: 'network_device', name: '网络设备', icon: 'Router' },
  { id: 'security_device', name: '安全设备', icon: 'Shield' },
  { id: 'server_storage', name: '服务器/存储设备', icon: 'Database' },
  { id: 'management_platform', name: '系统管理平台', icon: 'Settings' },
  { id: 'business_app', name: '业务应用系统', icon: 'Layers' },
  { id: 'terminal', name: '业务终端/运维终端', icon: 'Monitor' },
  { id: 'other_asset', name: '其他系统或设备', icon: 'Box' },
  { id: 'data_resource', name: '数据资源', icon: 'FileData' },
  { id: 'crypto_product', name: '密码产品', icon: 'Key' },
  { id: 'security_personnel', name: '安全相关人员', icon: 'Users' },
  { id: 'sys_doc', name: '系统管理文档', icon: 'HardDrive' },
] as const;

// 资产分类的标准展示顺序
export const ASSET_CATEGORY_ORDER: readonly string[] = ASSET_CATEGORIES.map((c) => c.id);

/** 合法分类 id 集合，用于校验导入/AI 给出的分类，防止非法值落库后"资产凭空消失" */
export const ASSET_CATEGORY_IDS: ReadonlySet<string> = new Set(ASSET_CATEGORIES.map((c) => c.id));

/**
 * 按名称（sheet 名 / 文件名）推断资产分类——"最具体优先"有序规则。
 *
 * 历史 bug：宽泛词（平台/管理/安全/业务）排在精确词（应用/终端/安全人员）之前，
 * 导致「业务应用系统」落到系统管理平台、「业务终端」落到业务应用系统。
 * 这里把复合精确词放前面，单个宽泛词放最后，并整段 trim/归一化。
 * 返回 null 表示无法判定（调用方再决定兜底）。
 */
const CATEGORY_NAME_RULES: ReadonlyArray<readonly [string, string]> = [
  ['业务应用系统', 'business_app'],
  ['应用系统', 'business_app'],
  ['业务应用', 'business_app'],
  ['系统管理平台', 'management_platform'],
  ['系统管理文档', 'sys_doc'],
  ['安全相关人员', 'security_personnel'],
  ['安全人员', 'security_personnel'],
  ['相关人员', 'security_personnel'],
  ['业务终端', 'terminal'],
  ['运维终端', 'terminal'],
  ['终端', 'terminal'],
  ['数据资源', 'data_resource'],
  ['数据库', 'sys_doc'], // 数据库相关归系统管理文档，先于「服务器」避免「数据库服务器」误判
  ['服务器存储设备', 'server_storage'],
  ['服务器-存储设备', 'server_storage'],
  ['服务器/存储设备', 'server_storage'],
  ['服务器', 'server_storage'],
  ['存储', 'server_storage'],
  ['管理机房', 'machine_room'],
  ['机房', 'machine_room'],
  ['区域边界', 'network_boundary'],
  ['边界', 'network_boundary'],
  ['网络设备', 'network_device'],
  ['安全设备', 'security_device'],
  ['交换机', 'network_device'],
  ['路由器', 'network_device'],
  ['密码产品', 'crypto_product'],
  ['加密', 'crypto_product'],
  ['其他系统', 'other_asset'],
  ['其他设备', 'other_asset'],
  ['文档', 'sys_doc'],
  ['管理平台', 'management_platform'],
  ['management', 'management_platform'],
  ['平台', 'management_platform'],
  ['应用', 'business_app'],
  ['业务系统', 'business_app'],
  ['业务', 'business_app'],
  ['network', 'network_device'],
  ['security', 'security_device'],
  ['server', 'server_storage'],
  ['terminal', 'terminal'],
  ['crypto', 'crypto_product'],
];
export function resolveAssetCategoryByName(rawName: string | undefined | null): string | null {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name) return null;
  for (const [keyword, id] of CATEGORY_NAME_RULES) {
    if (name.includes(keyword)) return id;
  }
  return null;
}

/** sheet 名 → 分类：先按标准名精确匹配，再走最具体优先的关键字规则 */
export function resolveAssetCategoryFromSheet(sheetName: string | undefined | null): string | null {
  const trimmed = String(sheetName || '').trim();
  const exact = ASSET_CATEGORIES.find((c) => c.name === trimmed);
  if (exact) return exact.id;
  const normalized = trimmed.replace(/[\/／]/g, '-'); // 服务器/存储设备 ↔ 服务器-存储设备
  const exact2 = ASSET_CATEGORIES.find((c) => c.name.replace(/[\/／]/g, '-') === normalized);
  if (exact2) return exact2.id;
  return resolveAssetCategoryByName(trimmed);
}

// 「安全计算环境」域下存在「按资产类型预置」的分类（共 7 类）；
// 其余分类在该域无按类型预置，导入时回退到域级默认预置。
export const SECURE_COMPUTING_ASSET_KEYS = [
  'network_device',
  'security_device',
  'server_storage',
  'management_platform',
  'business_app',
  'terminal',
  'data_resource',
] as const;
