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

export const ASSET_IMPORTANCE_MAP: Record<string, string> = {
  high: '关键',
  medium: '重要',
  low: '一般',
};

export const ASSET_COLUMNS_MAP: Record<string, { header: string; key: string; width: number }[]> = {
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
    { header: '版本', key: 'version', width: 20 },
    { header: 'IP地址', key: 'ip', width: 18 },
    { header: '主要功能', key: 'deviceUsage', width: 40 },
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

export const ASSET_CATEGORY_ORDER = [
  'machine_room', 'network_boundary', 'network_device', 'security_device',
  'server_storage', 'dbms', 'management_platform', 'business_app',
  'terminal', 'data_resource',
] as const;

export const ASSET_EXAMPLE_DATA: Record<string, Record<string, any>[]> = {
  machine_room: [
    { name: '中心机房', os: '北京市海淀区XX路XX号', description: '主要业务机房', importance: '关键', isAssessmentTarget: '是' },
    { name: '备用机房', os: '北京市朝阳区XX路XX号', description: '灾备机房', importance: '重要', isAssessmentTarget: '否' },
  ],
  network_boundary: [
    { name: '互联网边界', description: '连接互联网的区域边界', importance: '关键', isAssessmentTarget: '是' },
    { name: '办公网边界', description: '办公区域与服务器区域边界', importance: '重要', isAssessmentTarget: '否' },
  ],
  network_device: [
    { name: '核心交换机', isVirtual: '否', os: 'Huawei VRP V800R021', version: 'S12700', deviceUsage: '核心层交换', quantity: 2, ip: '192.168.1.1', description: '核心交换设备', importance: '关键', isAssessmentTarget: '是' },
    { name: '汇聚交换机', isVirtual: '否', os: 'Huawei VRP V800R021', version: 'S6720', deviceUsage: '汇聚层交换', quantity: 4, ip: '192.168.1.2', description: '', importance: '重要', isAssessmentTarget: '否' },
  ],
  security_device: [
    { name: '下一代防火墙', isVirtual: '否', os: 'Palo Alto PAN-OS 10.x', version: 'PA-3260', deviceUsage: '边界防护', quantity: 2, ip: '10.0.0.1', description: '互联网边界防火墙', importance: '关键', isAssessmentTarget: '是' },
    { name: '入侵检测系统', isVirtual: '否', os: '', version: 'NSFOCUS NIDS', deviceUsage: '入侵检测', quantity: 1, ip: '10.0.0.2', description: '', importance: '重要', isAssessmentTarget: '否' },
  ],
  server_storage: [
    { name: '应用服务器', isVirtual: '是', os: 'CentOS 7.9', dbSystem: '', middleware: 'Tomcat 9.0', quantity: 4, ip: '172.16.1.10', description: 'Web应用服务器', importance: '关键', isAssessmentTarget: '是' },
    { name: '数据库服务器', isVirtual: '否', os: 'RedHat 8.4', dbSystem: 'Oracle 19c', middleware: '', quantity: 2, ip: '172.16.1.20', description: '核心数据库服务器', importance: '关键', isAssessmentTarget: '是' },
  ],
  dbms: [
    { name: 'Oracle数据库', os: '数据库服务器', deviceUsage: '关系型数据库/19c', quantity: 1, description: '核心业务数据库', importance: '关键', isAssessmentTarget: '是' },
    { name: 'MySQL数据库', os: '应用服务器', deviceUsage: '关系型数据库/8.0', quantity: 1, description: '业务支撑数据库', importance: '重要', isAssessmentTarget: '否' },
  ],
  management_platform: [
    { name: '统一安全管理平台', os: '安全管理服务器', version: 'V3.0', ip: '172.16.1.100', deviceUsage: '安全策略管理、日志审计、安全事件处置', importance: '关键', isAssessmentTarget: '是' },
  ],
  business_app: [
    { name: 'OA办公系统', os: 'Java Web应用', deviceUsage: '日常办公审批', ip: '172.16.1.50', description: '办公自动化系统', importance: '重要', isAssessmentTarget: '否' },
    { name: '业务信息系统', os: 'Java Web应用', deviceUsage: '核心业务处理', ip: '172.16.1.51', description: '核心业务系统', importance: '关键', isAssessmentTarget: '是' },
  ],
  terminal: [
    { name: '办公终端', isVirtual: '否', os: 'Windows 10 专业版', deviceUsage: '日常办公', quantity: 50, ip: 'DHCP', description: '员工办公电脑', importance: '一般', isAssessmentTarget: '否' },
    { name: '运维终端', isVirtual: '否', os: 'Windows 10 专业版', deviceUsage: '系统运维', quantity: 5, ip: '172.16.1.200', description: '运维管理人员使用', importance: '重要', isAssessmentTarget: '是' },
  ],
  data_resource: [
    { name: '用户个人信息', os: '业务信息系统', deviceUsage: '保密性、完整性保护', importance: '关键', isAssessmentTarget: '是' },
    { name: '业务运行数据', os: '业务信息系统', deviceUsage: '可用性、完整性保护', importance: '重要', isAssessmentTarget: '否' },
  ],
};

export function sanitizeSheetName(name: string): string {
  return name.replace(/[\\*?:\/\[\]]/g, '-').substring(0, 31);
}