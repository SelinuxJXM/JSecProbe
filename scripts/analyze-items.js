const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed-items.json'), 'utf-8'));

const computingItems = data.filter(item => item.domainName === '安全计算环境');
const dataItems = data.filter(item => item.domainName === '数据类别');

const categories = [...new Set(computingItems.map(i => i.assetCategory))];
console.log('=== 安全计算环境资产类别 ===');
console.log(categories);

console.log('\n=== 各资产类别的控制点列表对比 ===');
const controlPointsByCategory = {};
for (const cat of categories) {
  const items = computingItems.filter(i => i.assetCategory === cat);
  controlPointsByCategory[cat] = items.map(i => `${i.controlPoint} - ${i.requirement.substring(0, 30)}...`);
}

const firstCat = categories[0];
for (const cat of categories.slice(1)) {
  const diffs = [];
  const firstItems = computingItems.filter(i => i.assetCategory === firstCat);
  const catItems = computingItems.filter(i => i.assetCategory === cat);
  
  for (let i = 0; i < Math.max(firstItems.length, catItems.length); i++) {
    const a = firstItems[i];
    const b = catItems[i];
    if (!a || !b || a.controlPoint !== b.controlPoint || a.requirement !== b.requirement) {
      diffs.push({ index: i, a: a ? `${a.controlPoint}: ${a.requirement.substring(0, 30)}` : '无', b: b ? `${b.controlPoint}: ${b.requirement.substring(0, 30)}` : '无' });
    }
  }
  console.log(`\n${firstCat} vs ${cat}: 差异 ${diffs.length} 项`);
  if (diffs.length > 0) {
    diffs.slice(0, 5).forEach(d => console.log(`  [${d.index}] ${d.a} => ${d.b}`));
  }
}

console.log('\n=== 数据类别对比 ===');
const dataCategories = [...new Set(dataItems.map(i => i.assetCategory))];
console.log(dataCategories);

const firstDataCat = dataCategories[0];
for (const cat of dataCategories.slice(1)) {
  const firstItems = dataItems.filter(i => i.assetCategory === firstDataCat);
  const catItems = dataItems.filter(i => i.assetCategory === cat);
  let diffCount = 0;
  for (let i = 0; i < Math.max(firstItems.length, catItems.length); i++) {
    const a = firstItems[i];
    const b = catItems[i];
    if (!a || !b || a.controlPoint !== b.controlPoint || a.requirement !== b.requirement) {
      diffCount++;
    }
  }
  console.log(`${firstDataCat} vs ${cat}: 差异 ${diffCount} 项`);
}

console.log('\n=== 安全计算环境-XX服务器的符合情况 ===');
const serverItems = computingItems.filter(i => i.assetCategory === 'XX服务器');
for (const item of serverItems) {
  if (item.compliance || item.resultRecord) {
    console.log(`${item.controlPoint}: ${item.compliance} - ${item.resultRecord?.substring(0, 50)}`);
  }
}
