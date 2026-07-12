const OSS = require('ali-oss');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const config = {
  region: process.env.OSS_REGION || 'oss-cn-beijing',
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET || 'secprobe',
};

if (!config.accessKeyId || !config.accessKeySecret) {
  console.error('❌ 请设置环境变量:');
  console.error('  set OSS_ACCESS_KEY_ID=your_access_key_id');
  console.error('  set OSS_ACCESS_KEY_SECRET=your_access_key_secret');
  console.error('  可选: set OSS_REGION=oss-cn-hangzhou');
  console.error('  可选: set OSS_BUCKET=jsecprobe-update');
  process.exit(1);
}

function getPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function generateLatestYml(installerPath) {
  const version = getPkgVersion();
  const stats = fs.statSync(installerPath);
  const fileBuffer = fs.readFileSync(installerPath);
  const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
  const urlFilename = `JSecProbe Setup ${version}.exe`;

  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${urlFilename}`,
    `    sha512: ${sha512}`,
    `    size: ${stats.size}`,
    `path: ${urlFilename}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');

  return { yml, urlFilename };
}

async function upload() {
  const version = getPkgVersion();
  console.log(`=== 上传 v${version} 更新文件到阿里云 OSS ===\n`);

  const client = new OSS(config);

  try {
    await client.head('latest.yml');
    console.log('✅ OSS 连接成功\n');
  } catch {
    console.log('ℹ️ 首次上传或 bucket 不存在，将在上传时自动创建\n');
  }

  const installerName = `JSecProbe Setup ${version}.exe`;
  const blockmapName = `JSecProbe Setup ${version}.exe.blockmap`;

  const installerPath = path.join(DIST_DIR, installerName);
  const blockmapPath = path.join(DIST_DIR, blockmapName);

  const filesToUpload = [];

  if (fs.existsSync(installerPath)) {
    filesToUpload.push({ local: installerPath, remote: installerName });
  } else {
    console.warn(`⚠ 安装包不存在: ${installerName}`);
  }

  if (fs.existsSync(blockmapPath)) {
    filesToUpload.push({ local: blockmapPath, remote: blockmapName });
  } else {
    console.warn(`⚠ 差异更新文件不存在: ${blockmapName}`);
  }

  const { yml } = generateLatestYml(installerPath);
  const ymlPath = path.join(DIST_DIR, 'latest-oss.yml');
  fs.writeFileSync(ymlPath, yml, 'utf-8');
  filesToUpload.push({ local: ymlPath, remote: 'latest.yml' });

  for (const file of filesToUpload) {
    const fileSize = (fs.statSync(file.local).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`上传 ${file.remote} (${fileSize} MB)... `);
    try {
      await client.put(file.remote, file.local);
      console.log('✅');
    } catch (err) {
      console.log('❌ 失败:', err.message);
      throw err;
    }
  }

  fs.unlinkSync(ymlPath);

  console.log(`\n🎉 上传完成！`);
  console.log(`  更新地址: https://${config.bucket}.${config.region}.aliyuncs.com/latest.yml`);
}

upload().catch(err => {
  console.error('\n❌ 上传失败:', err.message);
  process.exit(1);
});