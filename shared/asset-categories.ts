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
