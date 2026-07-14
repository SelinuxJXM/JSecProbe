const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const config = {
  accountId: process.env.R2_ACCOUNT_ID || '5916e35f85cd5615d987c9b8a35398f8',
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  accessKeySecret: process.env.R2_ACCESS_KEY_SECRET || '',
  bucket: process.env.R2_BUCKET || 'secporbe',
  baseUrl: process.env.R2_BASE_URL || 'https://data.semove.ccwu.cc',
};

if (!config.accessKeyId) {
  console.error('❌ 请设置环境变量:');
  console.error('  set R2_ACCESS_KEY_ID=your_api_token');
  console.error('  参考 .env.example 文件配置');
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
  console.log(`=== 上传 v${version} 更新文件到 Cloudflare R2 ===\n`);

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret || ' ',
    },
    forcePathStyle: true,
  });

  try {
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: 'latest.yml' }));
    console.log('✅ R2 连接成功\n');
  } catch {
    console.log('ℹ️ 首次上传或文件不存在\n');
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
  const ymlPath = path.join(DIST_DIR, 'latest-r2.yml');
  fs.writeFileSync(ymlPath, yml, 'utf-8');
  filesToUpload.push({ local: ymlPath, remote: 'latest.yml' });

  for (const file of filesToUpload) {
    const fileSize = (fs.statSync(file.local).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`上传 ${file.remote} (${fileSize} MB)... `);
    try {
      const fileBuffer = fs.readFileSync(file.local);
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: file.remote,
        Body: fileBuffer,
        ContentType: file.remote.endsWith('.exe') ? 'application/octet-stream' :
                    file.remote.endsWith('.blockmap') ? 'application/json' :
                    'text/yaml',
        ACL: 'public-read',
      }));
      console.log('✅');
    } catch (err) {
      console.log('❌ 失败:', err.message);
      throw err;
    }
  }

  fs.unlinkSync(ymlPath);

  console.log(`\n🎉 上传完成！`);
  console.log(`  更新地址: ${config.baseUrl}/latest.yml`);
}

upload().catch(err => {
  console.error('\n❌ 上传失败:', err.message);
  process.exit(1);
});
