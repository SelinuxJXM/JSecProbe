const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const s2Path = path.join(__dirname, '..', 'S2A2G2.xlsx');
const s3Path = path.join(__dirname, '..', 'S3A3G3.xlsx');

const SHEET_TO_DOMAIN = {
  '安全物理环境': 'secure_physical',
  '安全通信网络': 'secure_communication',
  '安全区域边界-XX边界': 'secure_boundary',
  '安全计算环境-XX服务器': 'secure_computing',
  '安全管理中心': 'secure_management',
  '安全管理制度': 'security_management',
  '安全管理机构': 'security_organization',
  '安全管理人员': 'security_personnel',
  '安全建设管理': 'security_construction',
  '安全运维管理': 'security_maintenance',
};

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
  const items = [];
  let currentExtension = 'general';
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const colA = row[0] ? String(row[0]).trim() : '';
    
    if (EXTENSION_MAP[colA]) {
      currentExtension = EXTENSION_MAP[colA];
      continue;
    }
    
    if (!colA || isNaN(parseInt(colA))) continue;
    
    const colB = row[1] ? String(row[1]).trim() : '';
    const colC = row[2] ? String(row[2]).trim() : '';
    
    if (colB && colC) {
      items.push({
        controlPoint: colB,
        requirement: colC,
        extensionType: currentExtension,
      });
    }
  }
  
  return items;
}

function extractItems(excelPath) {
  const workbook = XLSX.readFile(excelPath);
  const result = {};
  
  for (const sheetName of workbook.SheetNames) {
    const domain = SHEET_TO_DOMAIN[sheetName];
    if (!domain) continue;
    
    const worksheet = workbook.Sheets[sheetName];
    const items = parseSheet(worksheet);
    result[domain] = items;
  }
  
  return result;
}

function compareLevels() {
  console.log('正在对比S2（二级）和S3（三级）测评项差异...\n');
  
  const s2Items = extractItems(s2Path);
  const s3Items = extractItems(s3Path);
  
  const levelData = {};
  let totalS2 = 0;
  let totalS3Only = 0;
  
  for (const domain of Object.keys(s3Items)) {
    levelData[domain] = [];
    
    const s2DomainItems = s2Items[domain] || [];
    const s3DomainItems = s3Items[domain] || [];
    
    for (const s3Item of s3DomainItems) {
      const foundInS2 = s2DomainItems.some(s2Item =>
        s2Item.controlPoint === s3Item.controlPoint &&
        s2Item.requirement === s3Item.requirement &&
        s2Item.extensionType === s3Item.extensionType
      );
      
      const minLevel = foundInS2 ? 2 : 3;
      levelData[domain].push({
        ...s3Item,
        minLevel,
        maxLevel: 4,
      });
      
      if (foundInS2) totalS2++;
      else totalS3Only++;
    }
  }
  
  console.log('统计结果:');
  console.log(`  二级适用 (minLevel=2): ${totalS2} 项`);
  console.log(`  三级新增 (minLevel=3): ${totalS3Only} 项`);
  console.log(`  总测评项数: ${totalS2 + totalS3Only} 项\n`);
  
  // 按域统计
  for (const domain of Object.keys(levelData)) {
    const items = levelData[domain];
    const s2Count = items.filter(i => i.minLevel === 2).length;
    const s3Count = items.filter(i => i.minLevel === 3).length;
    console.log(`  ${domain}: 二级${s2Count}项 + 三级新增${s3Count}项 = ${items.length}项`);
  }
  
  return levelData;
}

function generateSeeder(levelData) {
  let sortOrder = 0;
  const allItems = [];
  
  const DOMAIN_ORDER = [
    'secure_physical',
    'secure_communication',
    'secure_boundary',
    'secure_computing',
    'secure_management',
    'security_management',
    'security_organization',
    'security_personnel',
    'security_construction',
    'security_maintenance',
  ];
  
  for (const domain of DOMAIN_ORDER) {
    const items = levelData[domain] || [];
    for (const item of items) {
      sortOrder++;
      const id = `gb22239-${domain}-${sortOrder}`;
      allItems.push({
        id,
        standardId: 'gb-t-22239-2019',
        domain,
        controlPoint: item.controlPoint,
        controlName: item.requirement,
        requirement: item.requirement,
        minLevel: item.minLevel,
        maxLevel: item.maxLevel,
        extensionType: item.extensionType,
        isHighRisk: 0,
        sortOrder,
      });
    }
  }
  
  const tsContent = `import { db } from '../index';
import { schema } from '../schema';
import type { StandardItem } from '../types';

export const STANDARD_GB_T_22239_2019_ITEMS: StandardItem[] = [
${allItems.map(item => `  {
    id: '${item.id}',
    standardId: '${item.standardId}',
    domain: '${item.domain}',
    controlPoint: '${item.controlPoint.replace(/'/g, "\\'")}',
    controlName: '${item.controlName.replace(/'/g, "\\'")}',
    requirement: '${item.requirement.replace(/'/g, "\\'")}',
    minLevel: ${item.minLevel},
    maxLevel: ${item.maxLevel},
    extensionType: '${item.extensionType}',
    isHighRisk: ${item.isHighRisk},
    sortOrder: ${item.sortOrder},
  }`).join(',\n')}
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

export async function seedGbT22239Standard() {
  const existing = await db
    .select()
    .from(schema.standards)
    .where(schema.standards.id, 'gb-t-22239-2019')
    .limit(1);

  if (existing.length === 0) {
    await db.insert(schema.standards).values(STANDARD_GB_T_22239_2019);
  }

  for (const item of STANDARD_GB_T_22239_2019_ITEMS) {
    await db.insert(schema.assessmentItems).values(item);
  }

  console.log(\`已初始化 GB/T 22239-2019 标准: \${STANDARD_GB_T_22239_2019_ITEMS.length} 条测评项\`);
}
`;

  const outputPath = path.join(__dirname, '..', 'electron', 'db', 'seeds', 'standard-gbt22239.ts');
  fs.writeFileSync(outputPath, tsContent);
  
  console.log(`\n已生成带等级的种子数据: ${outputPath}`);
  console.log(`总测评项数: ${allItems.length}`);
}

const levelData = compareLevels();
generateSeeder(levelData);
