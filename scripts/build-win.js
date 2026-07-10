const { execSync } = require('child_process');
const { rcedit } = require('rcedit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(ROOT, 'dist_tmp');
const FINAL_DIR = path.join(ROOT, 'dist_final');
const DIST_DIR = path.join(ROOT, 'dist');
const ICO_PATH = path.join(ROOT, 'build', 'icon.ico');

const argv = process.argv.slice(2);
const shouldPublish = argv.includes('--publish');

function getPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function generateLatestYml(installerPath) {
  const version = getPkgVersion();
  const stats = fs.statSync(installerPath);
  const fileBuffer = fs.readFileSync(installerPath);
  const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
  const sanitized = `JSecProbe-Setup-${version}.exe`;

  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${sanitized}`,
    `    sha512: ${sha512}`,
    `    size: ${stats.size}`,
    `path: ${sanitized}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');

  return yml;
}

async function build() {
  const version = getPkgVersion();
  console.log(`=== 构建版本: v${version} ===`);

  console.log('\n=== 1/4: 构建前端和后端代码 ===');
  execSync('npx vue-tsc --noEmit && npx vite build && npx electron-builder --win --publish=never --config.directories.output=dist_tmp', {
    cwd: ROOT, stdio: 'inherit', shell: true,
  });

  const exePath = path.join(TMP_DIR, 'win-unpacked', 'JSecProbe.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error('打包后的 exe 未找到: ' + exePath);
  }

  console.log('\n=== 2/4: 使用 rcedit 强制替换主程序图标 ===');
  await rcedit(exePath, { icon: ICO_PATH });
  console.log('✅ 图标替换成功');

  console.log('\n=== 3/4: 从修改后的打包目录重新构建安装包 ===');
  const prepackagedDir = path.dirname(exePath);
  execSync(`npx electron-builder --win --publish=never --prepackaged="${prepackagedDir}" --config.directories.output=dist_final`, {
    cwd: ROOT, stdio: 'inherit', shell: true,
  });

  console.log('\n=== 4/4: 生成更新元数据并整理到 dist 目录 ===');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 复制 win-unpacked 目录
  if (fs.existsSync(path.join(FINAL_DIR, 'win-unpacked'))) {
    fs.cpSync(path.join(FINAL_DIR, 'win-unpacked'), path.join(DIST_DIR, 'win-unpacked'), { recursive: true });
  }

  // 复制最终构建产物到 dist
  for (const f of fs.readdirSync(FINAL_DIR)) {
    if (f.endsWith('.exe') || f.endsWith('.blockmap') || f === 'latest.yml') {
      fs.copyFileSync(path.join(FINAL_DIR, f), path.join(DIST_DIR, f));
    }
  }

  // 生成更新元数据文件 latest.yml（electron-updater 依赖此文件）
  const installerName = `JSecProbe Setup ${version}.exe`;
  const installerPath = path.join(DIST_DIR, installerName);
  if (fs.existsSync(installerPath)) {
    const yml = generateLatestYml(installerPath);
    fs.writeFileSync(path.join(DIST_DIR, 'latest.yml'), yml);
    console.log('✅ latest.yml 已生成');
  }

  // 清理临时目录
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.rmSync(FINAL_DIR, { recursive: true, force: true });

  console.log('\n🎉 构建完成!');
  console.log(`  安装包: dist/JSecProbe Setup ${version}.exe`);
  console.log(`  便携版: dist/JSecProbe ${version}.exe`);
  console.log(`  更新元数据: dist/latest.yml`);
  console.log(`  主程序: dist/win-unpacked/JSecProbe.exe (图标已修复)`);

  if (shouldPublish) {
    console.log('\n=== 发布到 GitHub Releases ===');
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(ROOT, 'upload-release.ps1')}"`, {
      cwd: ROOT, stdio: 'inherit', shell: true,
    });
  } else {
    console.log('\n📌 发布提示: 如需发布到 GitHub Releases，请运行:');
    console.log(`  npm run build:win:full -- --publish`);
    console.log('  或手动上传 dist/ 目录下的以下文件到 GitHub Releases:');
    console.log(`  1. JSecProbe Setup ${version}.exe`);
    console.log(`  2. JSecProbe Setup ${version}.exe.blockmap`);
    console.log(`  3. latest.yml`);
  }
}

build().catch(err => {
  console.error('❌ 构建失败:', err.message);
  process.exit(1);
});