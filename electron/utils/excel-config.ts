import { ASSET_CATEGORIES } from '../../shared/asset-categories';
// 标准展示顺序统一由共享资产分类导出，避免与 ASSET_CATEGORIES 顺序漂移
export { ASSET_CATEGORY_ORDER } from '../../shared/asset-categories';

export const ASSET_CATEGORY_NAMES: Record<string, string> = Object.fromEntries(
  ASSET_CATEGORIES.map((c) => [c.id, c.name]),
);

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
  sys_doc: [
    { header: '序号', key: 'index', width: 8 },
    { header: '文档名称', key: 'name', width: 25 },
    { header: '文档主要内容', key: 'os', width: 30 },
    { header: '备注', key: 'description', width: 40 },
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
  other_asset: [
    { header: '序号', key: 'index', width: 8 },
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
    { header: '序号', key: 'index', width: 8 },
    { header: '产品/模块名称', key: 'name', width: 25 },
    { header: '生产厂商', key: 'version', width: 20 },
    { header: '证书编号', key: 'dbSystem', width: 22 },
    { header: '密码算法', key: 'middleware', width: 20 },
    { header: '用途', key: 'deviceUsage', width: 25 },
    { header: '重要程度', key: 'importance', width: 12 },
    { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
  ],
  security_personnel: [
    { header: '序号', key: 'index', width: 8 },
    { header: '姓名', key: 'name', width: 20 },
    { header: '岗位/角色', key: 'deviceUsage', width: 20 },
    { header: '联系方式', key: 'ip', width: 18 },
    { header: '所属单位', key: 'os', width: 25 },
    { header: '测评对象', key: 'isAssessmentTarget', width: 10 },
  ],
};


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
  sys_doc: [
    { name: '系统管理员手册', os: '系统日常运维管理', description: '包含系统维护、故障处理等流程', isAssessmentTarget: '是' },
    { name: '安全策略文档', os: '安全策略配置与管理', description: '安全策略、访问控制等', isAssessmentTarget: '是' },
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
  other_asset: [
    { name: 'UPS电源', isVirtual: '否', os: '', deviceUsage: '不间断电源', ip: '', description: '机房供电保障', importance: '重要', isAssessmentTarget: '否' },
    { name: '网络打印机', isVirtual: '否', os: '', deviceUsage: '办公打印', ip: '192.168.1.210', description: '', importance: '一般', isAssessmentTarget: '否' },
  ],
  crypto_product: [
    { name: '签名验签服务器', version: '某厂商', dbSystem: 'GM/T 00xx-20xx', middleware: 'SM2/SM3', deviceUsage: '电子签名验证', importance: '关键', isAssessmentTarget: '否' },
    { name: '密码机', version: '某厂商', dbSystem: 'GM/T 00xx-20xx', middleware: 'SM4', deviceUsage: '数据加密', importance: '关键', isAssessmentTarget: '否' },
  ],
  security_personnel: [
    { name: '张三', os: '信息中心', deviceUsage: '安全管理员', ip: '13800138000', isAssessmentTarget: '否' },
    { name: '李四', os: '运维部', deviceUsage: '系统管理员', ip: '13900139000', isAssessmentTarget: '否' },
  ],
};

export function sanitizeSheetName(name: string): string {
  return name.replace(/[\\*?:\/\[\]]/g, '-').substring(0, 31);
}