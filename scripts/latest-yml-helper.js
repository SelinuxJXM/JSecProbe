const fs = require('fs');
const path = require('path');

/**
 * 确保 dist/latest.yml 的 files 条目包含 blockmap 字段。
 * electron-builder 在某些配置下生成的 latest.yml 缺少该字段，导致增量更新不可用。
 */
function ensureBlockmapInLatestYml(distDir, version) {
  const latestYmlPath = path.join(distDir, 'latest.yml');
  if (!fs.existsSync(latestYmlPath)) return;

  const content = fs.readFileSync(latestYmlPath, 'utf-8');
  // 已包含 blockmap 字段则跳过
  if (content.includes('blockmap:')) return;

  const blockmapName = `JSecProbe-Setup-${version}.exe.blockmap`;
  const lines = content.split('\n');
  const out = [];
  let inFiles = false;
  let inserted = false;

  for (const line of lines) {
    out.push(line);
    if (/^files:/.test(line)) {
      inFiles = true;
      continue;
    }
    // 遇到下一个顶层键（非缩进）即视为离开 files 块，避免 inFiles 永不复位
    if (inFiles && /^\S/.test(line)) {
      inFiles = false;
      continue;
    }
    // files 列表里的每个条目都补 blockmap，而不是只补第一个
    if (inFiles && /^\s+- url:/.test(line)) {
      out.push(`    blockmap: ${blockmapName}`);
      inserted = true;
    }
  }

  if (inserted) {
    fs.writeFileSync(latestYmlPath, out.join('\n'), 'utf-8');
    console.log(`latest.yml 已补充 blockmap 字段: ${blockmapName}`);
  }
}

module.exports = { ensureBlockmapInLatestYml };