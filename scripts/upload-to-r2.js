const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const config = {
  accountId: process.env.R2_ACCOUNT_ID || '5916e35f85cd5615d987c9b8a35398f8',
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET || 'secporbe',
  baseUrl: process.env.R2_BASE_URL || 'https://data.semove.ccwu.cc',
};

function getPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

async function main() {
  if (!config.accessKeyId || !config.secretAccessKey) {
    console.error('❌ 请设置环境变量:');
    console.error('  set R2_ACCESS_KEY_ID=your_access_key_id');
    console.error('  set R2_SECRET_ACCESS_KEY=your_secret_access_key');
    process.exit(1);
  }

  const version = getPkgVersion();
  console.log(`=== 上传 v${version} 更新文件到 Cloudflare R2 ===\n`);

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  // 测试连接：列出桶中的对象
  try {
    console.log('测试 R2 连接...');
    const listResult = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      MaxKeys: 1,
    }));
    console.log(`连接成功! 桶中已有 ${listResult.KeyCount || 0} 个对象\n`);
  } catch (err) {
    console.error(`❌ 连接失败: ${err.message}`);
    process.exit(1);
  }

  const files = [
    {
      local: path.join(DIST_DIR, `JSecProbe Setup ${version}.exe`),
      remote: `JSecProbe-Setup-${version}.exe`,
      contentType: 'application/octet-stream',
    },
    {
      local: path.join(DIST_DIR, `JSecProbe Setup ${version}.exe.blockmap`),
      remote: `JSecProbe-Setup-${version}.exe.blockmap`,
      contentType: 'application/json',
    },
    {
      local: path.join(DIST_DIR, 'latest.yml'),
      remote: 'latest.yml',
      contentType: 'text/yaml',
    },
  ];

  for (const file of files) {
    if (!fs.existsSync(file.local)) {
      console.warn(`⚠ 文件不存在，跳过: ${file.local}`);
      continue;
    }

    const fileBuffer = fs.readFileSync(file.local);
    const fileSize = (fileBuffer.length / 1024 / 1024).toFixed(2);
    process.stdout.write(`上传 ${file.remote} (${fileSize} MB)... `);

    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: file.remote,
        Body: fileBuffer,
        ContentType: file.contentType,
      }));
      console.log('✅');
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  console.log(`\n✅ 上传完成！`);
  console.log(`\n📌 访问地址:`);
  for (const file of files) {
    console.log(`  ${config.baseUrl}/${file.remote}`);
  }
}

main().catch((err) => {
  console.error('\n❌ 上传失败:', err.message);
  process.exit(1);
});