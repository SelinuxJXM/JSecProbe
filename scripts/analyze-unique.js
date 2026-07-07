const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed-items.json'), 'utf-8'));

const uniqueItems = [];
const seen = new Set();

for (const item of data) {
  const key = `${item.domain}-${item.controlPoint}-${item.requirement}-${item.extensionType}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueItems.push({
      domain: item.domain,
      domainName: item.domainName,
      controlPoint: item.controlPoint,
      requirement: item.requirement,
      extensionType: item.extensionType,
    });
  }
}

const domainGroups = {};
for (const item of uniqueItems) {
  if (!domainGroups[item.domainName]) {
    domainGroups[item.domainName] = [];
  }
  domainGroups[item.domainName].push(item);
}

console.log('=== 去重后各域测评项数量 ===');
let total = 0;
for (const [domain, items] of Object.entries(domainGroups)) {
  console.log(`${domain}: ${items.length} 项`);
  total += items.length;
}
console.log(`总计: ${total} 项`);

console.log('\n=== 安全计算环境控制点列表 ===');
const computingItems = uniqueItems.filter(i => i.domainName === '安全计算环境');
const computingGroups = {};
for (const item of computingItems) {
  if (!computingGroups[item.controlPoint]) {
    computingGroups[item.controlPoint] = [];
  }
  computingGroups[item.controlPoint].push(item);
}
for (const [cp, items] of Object.entries(computingGroups)) {
  console.log(`${cp}: ${items.length} 项`);
  items.forEach(i => console.log(`  ${i.requirement.substring(0, 60)}... [${i.extensionType}]`));
}

console.log('\n=== 数据类别控制点列表 ===');
const dataItems = uniqueItems.filter(i => i.domainName === '数据类别');
const dataGroups = {};
for (const item of dataItems) {
  if (!dataGroups[item.controlPoint]) {
    dataGroups[item.controlPoint] = [];
  }
  dataGroups[item.controlPoint].push(item);
}
for (const [cp, items] of Object.entries(dataGroups)) {
  console.log(`${cp}: ${items.length} 项`);
  items.forEach(i => console.log(`  ${i.requirement.substring(0, 60)}... [${i.extensionType}]`));
}
