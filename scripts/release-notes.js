/**
 * Release 说明生成（GitHub / GitCode 共用单一来源）。
 *
 * 原先 upload-to-github.js 内部的 body 是写死的一段更新日志，只有 TAG 动态 ——
 * 发新版本时会把旧版本的说明原样再贴一遍。改为按优先级取真实来源：
 *   1. docs/releases/v<version>.md（推荐，人工撰写）
 *   2. RELEASE_NOTES.md（仓库根目录）
 *   3. git log 自上一个 tag 以来的提交标题（自动兜底）
 *   4. 占位文本 + 明确告警，避免静默发布错误说明
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function getPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function gitLogSinceLastTag(version, tag) {
  try {
    // 最近一个 tag（不含当前待发布的版本）
    const tags = execSync('git tag --sort=-creatordate', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t && t !== tag && t !== `v${version}` && t !== version);
    const range = tags.length > 0 ? `${tags[0]}..HEAD` : '';
    const log = execSync(`git log ${range} --no-merges --pretty=format:"- %s"`, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).trim();
    return log || '';
  } catch {
    return '';
  }
}

function buildReleaseNotes(tag) {
  const version = getPkgVersion();

  const candidates = [
    path.join(ROOT, 'docs', 'releases', `v${version}.md`),
    path.join(ROOT, 'docs', 'releases', `${version}.md`),
    path.join(ROOT, 'RELEASE_NOTES.md'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf-8').trim();
      if (text) {
        console.log(`Release notes 来源: ${path.relative(ROOT, file)}`);
        return text;
      }
    }
  }

  const commits = gitLogSinceLastTag(version, tag);
  if (commits) {
    console.log('Release notes 来源: git log（自动汇总）');
    return `## ${tag} 更新内容\n\n${commits}\n\n> 本说明由 git log 自动生成。若需人工撰写，请添加 \`docs/releases/v${version}.md\` 后重新发布。`;
  }

  console.warn(
    `⚠️  未找到 docs/releases/v${version}.md，且无法从 git log 生成提交记录。\n` +
      '   Release 说明将是占位文本，建议补写后编辑该 Release。',
  );
  return `## ${tag} 更新内容\n\n（本次发布的更新说明待补充）`;
}

module.exports = { ROOT, getPkgVersion, buildReleaseNotes };
