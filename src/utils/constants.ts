export const IMPORTANCE_OPTIONS = [
  { label: '关键', value: 'high', color: '#C62828' },
  { label: '重要', value: 'medium', color: '#F57F17' },
  { label: '一般', value: 'low', color: '#2E7D32' },
];

export const IMPORTANCE_MAP: Record<string, string> = {
  high: '关键',
  medium: '重要',
  low: '一般',
};

export const COMPLIANCE_OPTIONS = [
  { label: '符合', value: 'compliant', color: '#2E7D32' },
  { label: '部分符合', value: 'partial', color: '#F57F17' },
  { label: '不符合', value: 'noncompliant', color: '#C62828' },
  { label: '不适用', value: 'not_applicable', color: '#757575' },
];

export const COMPLIANCE_MAP: Record<string, string> = {
  compliant: '符合',
  partial: '部分符合',
  noncompliant: '不符合',
  not_applicable: '不适用',
};

export const RISK_LEVEL_OPTIONS = [
  { label: '高风险', value: 'high', color: '#C62828' },
  { label: '中风险', value: 'medium', color: '#F57F17' },
  { label: '低风险', value: 'low', color: '#2E7D32' },
];

export const RISK_LEVEL_MAP: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

export const ISSUE_STATUS_OPTIONS = [
  { label: '待整改', value: 'pending' },
  { label: '整改中', value: 'in_progress' },
  { label: '已整改', value: 'fixed' },
];

export const ISSUE_STATUS_MAP: Record<string, string> = {
  pending: '待整改',
  in_progress: '整改中',
  fixed: '已整改',
};

export const ASSET_CATEGORY_NAMES: Record<string, string> = {
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

export const SECURITY_DOMAINS = [
  { value: 'secure_computing', label: '安全计算环境' },
  { value: 'secure_network', label: '安全网络通信' },
  { value: 'secure_boundary', label: '安全区域边界' },
  { value: 'secure_management', label: '安全管理中心' },
  { value: 'security_management', label: '安全管理制度' },
];

export const PROJECT_STATUS_MAP: Record<string, string> = {
  draft: '草稿',
  in_progress: '进行中',
  completed: '已完成',
};

export const ASSESSMENT_METHODS = [
  { label: '核查', value: 'check' },
  { label: '测试', value: 'test' },
  { label: '访谈', value: 'interview' },
];

export const DOMAIN_DISPLAY_NAMES: Record<string, string> = {
  '安全计算环境': '安全计算环境',
  '安全网络通信': '安全网络通信',
  '安全区域边界': '安全区域边界',
  '安全管理中心': '安全管理中心',
  '安全管理制度': '安全管理制度',
  secure_computing: '安全计算环境',
  secure_network: '安全网络通信',
  secure_boundary: '安全区域边界',
  secure_management: '安全管理中心',
  security_management: '安全管理制度',
};