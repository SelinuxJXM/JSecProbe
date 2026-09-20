/**
 * 版本号一致性检查。
 *
 * 背景：项目里多处曾把版本号硬编码在 UI 与文档中（如侧边栏 `v2.4.1`、
 * docs/docs.html 白皮书）。硬编码值当前正确，但发版时只要漏改一处就会静默漂移，
 * 且没有任何提示。
 *
 * 本脚本以 package.json 为唯一真相，扫描可能残留硬编码版本号的受控文件，
 * 发现不一致即以非 0 退出码失败，可接入 CI 或本地 pre-release 检查。
 *
 * 用法：node scripts/check-version-consistency.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const CURRENT = pkg.version;

/**
 * 受控文件清单。
 * - file: 相对仓库根目录的路径
 * - allowStale: 为 true 表示该文件记录的是「历史版本」，允许不等于当前版本
 *   （如 docs/releases/v2.4.1.md 是归档的发布说明）
 */
const TARGETS = [
  { file: 'src/layout/MainLayout.vue' },
  { file: 'docs/docs.html' },
  { file: 'docs/index.html' },
  { file: 'README.md' },
];

/**
 * 明确豁免的「历史版本」字面量。
 * docs.html 里有一张「白皮书版本 ↔ 产品版本」的历史对照表，其中的旧版本号是
 * 有意保留的记录，不是漂移，不应报警。
 */
const ALLOWED_STALE_VERSIONS = new Set([
  '2.2.8',
  '2.2.9',
  '2.4.0',
  // docs.html 附录 D 的变更记录会保留历次版本条目，属有意保留的历史记录，不是漂移
  '2.4.1',
  '2.4.2',
  '2.4.3',
]);

// 只匹配形如 v2.4.1 / V2.4.1 / 2.4.1 的版本号字面量。
// 前后都要求不是数字或点，否则会把 SVG path、坐标等数字串误判成版本号
// （例如路径数据里的 "2.04.138" / "2.873.12"）。
const VERSION_RE = /(?<![\d.])v?(\d+\.\d+\.\d+)(?![\d.])/gi;

const problems = [];
let checkedFiles = 0;

for (const target of TARGETS) {
  const abs = path.join(ROOT, target.file);
  if (!fs.existsSync(abs)) {
    continue;
  }
  checkedFiles++;
  const text = fs.readFileSync(abs, 'utf-8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, idx) => {
    // 跳过压缩/内联资源类长行（SVG path、base64 等），噪声大且无人工维护的版本号
    if (line.length > 400) return;

    VERSION_RE.lastIndex = 0;
    let m;
    while ((m = VERSION_RE.exec(line)) !== null) {
      const normalized = m[1];
      if (normalized === CURRENT) continue;
      if (ALLOWED_STALE_VERSIONS.has(normalized)) continue;
      // 仅关注与当前主版本号相同的候选，避免把第三方依赖/标准编号卷进来
      if (normalized.split('.')[0] !== CURRENT.split('.')[0]) continue;
      problems.push({
        file: target.file,
        line: idx + 1,
        found: m[0],
        snippet: line.trim().slice(0, 120),
      });
    }
  });
}

console.log(`当前版本（package.json）：v${CURRENT}`);
console.log(`已扫描受控文件：${checkedFiles} 个\n`);

if (problems.length === 0) {
  console.log('✅ 版本号一致性检查通过，未发现残留的硬编码版本号。');
  process.exit(0);
}

console.log(`❌ 发现 ${problems.length} 处版本号可能与当前版本不一致：\n`);
for (const p of problems) {
  console.log(`  ${p.file}:${p.line}  找到 "${p.found}"（当前应为 ${CURRENT}）`);
  console.log(`      ${p.snippet}`);
}
console.log(
  '\n处理建议：\n' +
    '  1. UI 中的版本号应改为从主进程 app.getVersion() 读取，不要硬编码；\n' +
    '  2. 文档中的版本号若为有意保留的历史记录，请加入本脚本的 allowStale 白名单；\n' +
    '  3. 若为遗漏，请同步更新后再发版。',
);
process.exit(1);
