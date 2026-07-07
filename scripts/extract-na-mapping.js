const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(__dirname, '..', 'S2A2G2.xlsx');

// Excel sheet名称到资产类别的映射
const SHEET_TO_CATEGORY = {
  '安全计算环境-XX网络设备': 'network_device',
  '安全计算环境-XX安全设备': 'security_device',
  '安全计算环境-XX服务器': 'server_storage',
  '安全计算环境-XX数据库': 'dbms',
  '安全计算环境-XX管理平台': 'management_platform',
  '安全计算环境-XX应用系统': 'business_app',
  '安全计算环境-XX终端': 'terminal',
  '数据类别-鉴别数据': 'data_auth',
  '数据类别-重要业务数据': 'data_business',
  '数据类别-重要审计数据': 'data_audit',
  '数据类别-重要配置数据': 'data_config',
  '数据类别-重要视频数据': 'data_video',
  '数据类别-重要个人信息': 'data_personal',
};

// 扩展类型映射
const EXTENSION_MAP = {
  '安全通用要求': 'general',
  '云计算安全扩展要求': 'cloud',
  '移动互联安全扩展要求': 'mobile',
  '物联网安全扩展要求': 'iot',
  '工业控制系统安全扩展要求': 'industrial',
  '大数据安全扩展要求（国标附录）': 'bigdata',
};

function parseSheet(worksheet) {
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const naItems = [];
  let currentExtension = 'general';
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const colA = row[0] ? String(row[0]).trim() : '';
    
    // 检查是否是扩展类型标题行
    if (EXTENSION_MAP[colA]) {
      currentExtension = EXTENSION_MAP[colA];
      continue;
    }
    
    // 检查是否是测评项行（序号是数字）
    if (!colA || isNaN(parseInt(colA))) continue;
    
    const colB = row[1] ? String(row[1]).trim() : ''; // 控制点
    const colC = row[2] ? String(row[2]).trim() : ''; // 测评项
    const colE = row[4] ? String(row[4]).trim() : ''; // 符合情况
    
    // 只记录"不适用"的项
    if (colE === '不适用' && colB && colC) {
      naItems.push({
        controlPoint: colB,
        requirement: colC,
        extensionType: currentExtension,
      });
    }
  }
  
  return naItems;
}

function generateNaMapping() {
  const workbook = XLSX.readFile(excelPath);
  const mapping = {};
  
  for (const sheetName of workbook.SheetNames) {
    const category = SHEET_TO_CATEGORY[sheetName];
    if (!category) continue;
    
    const worksheet = workbook.Sheets[sheetName];
    const naItems = parseSheet(worksheet);
    
    if (naItems.length > 0) {
      mapping[category] = naItems;
      console.log(`${sheetName} (${category}): ${naItems.length} 项不适用`);
    }
  }
  
  // 生成TypeScript文件
  const tsContent = `/**
 * 资产类型与不适用测评项映射表
 * 从S2A2G2.xlsx提取
 * 
 * 当选择特定资产类型时，对应的测评项自动标记为"不适用"
 */

export interface NaItem {
  controlPoint: string;
  requirement: string;
  extensionType: string;
}

export const ASSET_NA_MAPPING: Record<string, NaItem[]> = ${JSON.stringify(mapping, null, 2)};

// 资产类别名称映射
export const ASSET_CATEGORY_NAMES: Record<string, string> = {
  network_device: '网络设备',
  security_device: '安全设备',
  server_storage: '服务器/存储设备',
  dbms: '数据库管理系统',
  management_platform: '系统管理平台',
  business_app: '业务应用系统',
  terminal: '业务终端/运维终端',
  data_auth: '鉴别数据',
  data_business: '重要业务数据',
  data_audit: '重要审计数据',
  data_config: '重要配置数据',
  data_video: '重要视频数据',
  data_personal: '重要个人信息',
};
`;

  const outputPath = path.join(__dirname, '..', 'electron', 'db', 'seeds', 'asset-na-mapping.ts');
  fs.writeFileSync(outputPath, tsContent);
  console.log(`\n已生成: ${outputPath}`);
  
  // 统计总数
  let total = 0;
  for (const items of Object.values(mapping)) {
    total += items.length;
  }
  console.log(`总计: ${total} 个不适用映射`);
}

generateNaMapping();