const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const excelPath = path.join(__dirname, '..', 'S2A2G2.xlsx');

const EXTENSION_TYPES = {
  '安全通用要求': 'general',
  '云计算安全扩展要求': 'cloud',
  '移动互联安全扩展要求': 'mobile',
  '物联网安全扩展要求': 'iot',
  '工业控制系统安全扩展要求': 'ics',
  '大数据安全扩展要求（国标附录）': 'bigdata',
};

const DOMAIN_MAP = {
  '安全物理环境': 'secure_physical',
  '安全通信网络': 'secure_communication',
  '安全区域边界': 'secure_boundary',
  '安全计算环境': 'secure_computing',
  '安全管理中心': 'secure_management',
  '安全管理制度': 'security_management',
  '安全管理机构': 'security_organization',
  '安全管理人员': 'security_personnel',
  '安全建设管理': 'security_construction',
  '安全运维管理': 'security_maintenance',
  '数据类别': 'secure_data',
};

function parseSheet(worksheet, sheetName) {
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const items = [];
  let currentExtension = 'general';
  let sortOrder = 0;

  let domainName = sheetName;
  let assetCategory = null;

  if (sheetName.startsWith('安全区域边界-')) {
    domainName = '安全区域边界';
    assetCategory = sheetName.replace('安全区域边界-', '');
  } else if (sheetName.startsWith('安全计算环境-')) {
    domainName = '安全计算环境';
    assetCategory = sheetName.replace('安全计算环境-', '');
  } else if (sheetName.startsWith('数据类别-')) {
    domainName = '数据类别';
    assetCategory = sheetName.replace('数据类别-', '');
  }

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
    const resultRecord = row[3] ? String(row[3]).trim() : '';
    const compliance = row[4] ? String(row[4]).trim() : '';

    if (!requirement) continue;

    sortOrder++;
    items.push({
      domain: DOMAIN_MAP[domainName] || domainName,
      domainName,
      assetCategory,
      controlPoint,
      requirement,
      extensionType: currentExtension,
      sortOrder,
      resultRecord,
      compliance,
    });
  }

  return items;
}

function main() {
  const workbook = XLSX.readFile(excelPath);
  const allItems = [];
  const sheetStats = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const items = parseSheet(worksheet, sheetName);
    allItems.push(...items);
    sheetStats[sheetName] = items.length;
  }

  console.log('=== Sheet统计 ===');
  for (const [name, count] of Object.entries(sheetStats)) {
    console.log(`${name}: ${count} 项`);
  }
  console.log(`\n总计: ${allItems.length} 项`);

  console.log('\n=== 按域统计 ===');
  const domainStats = {};
  for (const item of allItems) {
    const key = `${item.domainName}${item.assetCategory ? ' - ' + item.assetCategory : ''}`;
    domainStats[key] = (domainStats[key] || 0) + 1;
  }
  for (const [name, count] of Object.entries(domainStats)) {
    console.log(`${name}: ${count} 项`);
  }

  console.log('\n=== 按扩展类型统计 ===');
  const extStats = {};
  for (const item of allItems) {
    extStats[item.extensionType] = (extStats[item.extensionType] || 0) + 1;
  }
  for (const [type, count] of Object.entries(extStats)) {
    console.log(`${type}: ${count} 项`);
  }

  fs.writeFileSync(
    path.join(__dirname, 'parsed-items.json'),
    JSON.stringify(allItems, null, 2),
    'utf-8'
  );
  console.log('\n数据已保存到 parsed-items.json');
}

main();
