const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const s2Path = path.join(__dirname, '..', 'S2A2G2.xlsx');
const s3Path = path.join(__dirname, '..', 'S3A3G3.xlsx');

const DOMAIN_ORDER = [
  { key: 'secure_physical', name: '安全物理环境', sheet: '安全物理环境' },
  { key: 'secure_communication', name: '安全通信网络', sheet: '安全通信网络' },
  { key: 'secure_boundary', name: '安全区域边界', sheet: '安全区域边界-XX边界' },
  { key: 'secure_computing', name: '安全计算环境', sheet: '安全计算环境-XX服务器' },
  { key: 'secure_management', name: '安全管理中心', sheet: '安全管理中心' },
  { key: 'security_management', name: '安全管理制度', sheet: '安全管理制度' },
  { key: 'security_organization', name: '安全管理机构', sheet: '安全管理机构' },
  { key: 'security_personnel', name: '安全管理人员', sheet: '安全管理人员' },
  { key: 'security_construction', name: '安全建设管理', sheet: '安全建设管理' },
  { key: 'security_maintenance', name: '安全运维管理', sheet: '安全运维管理' },
];

const EXTENSION_TYPES = {
  '安全通用要求': 'general',
  '云计算安全扩展要求': 'cloud',
  '移动互联安全扩展要求': 'mobile',
  '物联网安全扩展要求': 'iot',
  '工业控制系统安全扩展要求': 'industrial',
  '大数据安全扩展要求（国标附录）': 'bigdata',
  '关键信息基础设施安全扩展要求': 'cii',
};

function extractControlName(requirement) {
  if (!requirement) return '';
  const match = requirement.match(/^[a-z]+）\s*(.+)/);
  if (match) return match[1].replace(/[。；]$/, '');
  return requirement.replace(/[。；]$/, '');
}

function escapeForTs(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function parseSheet(worksheet) {
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const items = [];
  let currentExtension = 'general';
  let currentControlPoint = '';
  let sortOrder = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const colA = row[0] ? String(row[0]).trim() : '';
    const colB = row[1] ? String(row[1]).trim() : '';

    if (EXTENSION_TYPES[colA]) {
      currentExtension = EXTENSION_TYPES[colA];
      continue;
    }

    if (!colA || isNaN(parseInt(colA))) continue;

    const controlPoint = colB || '';
    const requirement = row[2] ? String(row[2]).trim() : '';

    if (!requirement) continue;

    sortOrder++;
    items.push({
      controlPoint,
      requirement,
      extensionType: currentExtension,
      sortOrder,
      controlName: extractControlName(requirement),
    });
  }

  return items;
}

function extractItemsFromExcel(excelPath) {
  const workbook = XLSX.readFile(excelPath);
  const result = {};

  for (const domain of DOMAIN_ORDER) {
    const worksheet = workbook.Sheets[domain.sheet];
    if (!worksheet) {
      console.warn(`Sheet not found: ${domain.sheet}`);
      result[domain.key] = [];
      continue;
    }

    const items = parseSheet(worksheet);
    result[domain.key] = items;
    console.log(`  ${domain.name}: ${items.length} 项`);
  }

  return result;
}

function getItemKey(item) {
  return `${item.extensionType}||${item.controlPoint}||${item.requirement}`;
}

function generateSeeder() {
  console.log('解析二级Excel (S2A2G2.xlsx):');
  const s2Items = extractItemsFromExcel(s2Path);
  
  console.log('\n解析三级Excel (S3A3G3.xlsx):');
  const s3Items = extractItemsFromExcel(s3Path);

  const s2KeySet = new Set();
  for (const domain of Object.keys(s2Items)) {
    for (const item of s2Items[domain]) {
      s2KeySet.add(getItemKey(item));
    }
  }

  const allItems = [];
  let globalSortOrder = 0;
  let level2Count = 0;
  let level3Count = 0;

  for (const domain of DOMAIN_ORDER) {
    const items = s3Items[domain.key] || [];
    
    for (const item of items) {
      globalSortOrder++;
      const id = `gb22239-${domain.key}-${globalSortOrder}`;
      const key = getItemKey(item);
      const minLevel = s2KeySet.has(key) ? 2 : 3;
      
      if (minLevel === 2) level2Count++;
      else level3Count++;
      
      allItems.push({
        id,
        standardId: 'gb-t-22239-2019',
        domain: domain.key,
        controlPoint: item.controlPoint,
        controlName: item.controlName,
        requirement: item.requirement,
        minLevel: minLevel,
        maxLevel: 4,
        extensionType: item.extensionType,
        isHighRisk: 0,
        sortOrder: globalSortOrder,
      });
    }
  }

  console.log(`\n统计结果:`);
  console.log(`  二级适用 (minLevel=2): ${level2Count} 项`);
  console.log(`  三级新增 (minLevel=3): ${level3Count} 项`);
  console.log(`  总计: ${allItems.length} 项`);

  const itemsStr = allItems.map(item => `  {
    id: '${item.id}',
    standardId: '${item.standardId}',
    domain: '${item.domain}',
    controlPoint: '${escapeForTs(item.controlPoint)}',
    controlName: '${escapeForTs(item.controlName)}',
    requirement: '${escapeForTs(item.requirement)}',
    minLevel: ${item.minLevel},
    maxLevel: ${item.maxLevel},
    extensionType: '${item.extensionType}',
    isHighRisk: ${item.isHighRisk},
    sortOrder: ${item.sortOrder},
  }`).join(',\n');

  const tsContent = `import type { StandardItem } from '../types';

export const STANDARD_GB_T_22239_2019_ITEMS: StandardItem[] = [
${itemsStr}
];

export const STANDARD_GB_T_22239_2019 = {
  id: 'gb-t-22239-2019',
  name: '信息安全技术 网络安全等级保护基本要求',
  code: 'GB/T 22239-2019',
  version: '2019',
  description: '网络安全等级保护基本要求标准，包含安全通用要求和各应用场景扩展要求',
  grade: 2,
  domainCount: 10,
  itemCount: ${allItems.length},
  isDefault: 1,
};
`;

  const outputPath = path.join(__dirname, '..', 'electron', 'db', 'seeds', 'standard-gbt22239.ts');
  fs.writeFileSync(outputPath, tsContent, 'utf-8');
  
  console.log(`\n已生成: ${outputPath}`);
}

generateSeeder();
