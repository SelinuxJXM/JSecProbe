const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { ensureBlockmapInLatestYml } = require('./latest-yml-helper');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const config = {
  // 这些值过去被硬编码在此（真实账户信息随源码泄露），现全部强制从环境变量读取。
  // bucket 的旧兜底还带拼写错误（'secporbe'），一旦环境变量没设就会静默传到错误的桶，
  // 排查成本极高 —— 因此不保留任何兜底，缺哪个就报错退出。
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  baseUrl: process.env.R2_BASE_URL,
};

function getPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

async function main() {
  const missing = [
    !config.accountId && 'R2_ACCOUNT_ID',
    !config.accessKeyId && 'R2_ACCESS_KEY_ID',
    !config.secretAccessKey && 'R2_SECRET_ACCESS_KEY',
    !config.bucket && 'R2_BUCKET',
    !config.baseUrl && 'R2_BASE_URL',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`❌ 缺少环境变量: ${missing.join(', ')}`);
    console.error('  参考 .env.example，例如：');
    console.error('  set R2_ACCOUNT_ID=your_account_id');
    console.error('  set R2_ACCESS_KEY_ID=your_access_key_id');
    console.error('  set R2_SECRET_ACCESS_KEY=your_secret_access_key');
    console.error('  set R2_BUCKET=secprobe');
    console.error('  set R2_BASE_URL=https://your-r2-domain');
    process.exit(1);
  }

  const version = getPkgVersion();
  console.log(`=== 上传 v${version} 更新文件到 Cloudflare R2 ===\n`);

  ensureBlockmapInLatestYml(DIST_DIR, version);

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
      cacheControl: 'public, max-age=31536000, immutable',
    },
    {
      local: path.join(DIST_DIR, `JSecProbe Setup ${version}.exe.blockmap`),
      remote: `JSecProbe-Setup-${version}.exe.blockmap`,
      contentType: 'application/json',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    {
      // 更新元数据必须每次回源校验：不设 no-cache 会被 Cloudflare 边缘按默认 TTL 缓存，
      // 版本覆盖后回退源客户端会长时间读到旧 latest.yml（v2.3.1 发布时实测复现）
      local: path.join(DIST_DIR, 'latest.yml'),
      remote: 'latest.yml',
      contentType: 'text/yaml',
      cacheControl: 'no-cache',
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
        CacheControl: file.cacheControl,
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