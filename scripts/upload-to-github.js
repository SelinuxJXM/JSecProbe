const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const config = {
  token: process.env.GITHUB_TOKEN,
  owner: 'SelinuxJXM',
  repo: 'JSecProbe',
};

function getPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || data}`));
          }
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function createRelease(version) {
  const tag = `v${version}`;
  console.log(`Creating release ${tag}...`);

  const releaseBody = `## ${tag} 更新内容\n\n- 全面审查并优化项目代码\n- 移除硬编码Token，改为环境变量配置\n- 增强IPC接口输入验证\n- 修复定时器内存泄漏\n- 从阿里云OSS切换到Cloudflare R2备用源\n- 优化自动更新下载体验\n- 改进导入导出功能一致性`;

  try {
    const release = await request({
      hostname: 'api.github.com',
      path: `/repos/${config.owner}/${config.repo}/releases`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'JSecProbe-Release',
      },
    }, JSON.stringify({
      tag_name: tag,
      name: tag,
      body: releaseBody,
      draft: false,
      prerelease: false,
    }));
    console.log(`Release created! ID: ${release.id}`);
    return release;
  } catch (error) {
    console.log('Error creating release:', error.message);
    console.log('Trying to get existing release...');
    const release = await request({
      hostname: 'api.github.com',
      path: `/repos/${config.owner}/${config.repo}/releases/tags/${tag}`,
      method: 'GET',
      headers: {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'JSecProbe-Release',
      },
    });
    console.log(`Release already exists, ID: ${release.id}`);
    return release;
  }
}

async function uploadAsset(releaseId, filePath, fileName) {
  if (!fs.existsSync(filePath)) {
    console.log(`Warning: ${filePath} not found, skipping`);
    return;
  }

  const fileSize = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
  process.stdout.write(`Uploading ${fileName} (${fileSize} MB)... `);

  const fileBuffer = fs.readFileSync(filePath);

  try {
    const result = await request({
      hostname: 'uploads.github.com',
      path: `/repos/${config.owner}/${config.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileBuffer.length,
        'User-Agent': 'JSecProbe-Release',
      },
    }, fileBuffer);
    console.log('Done');
    return result;
  } catch (error) {
    console.log('Failed:', error.message);
    throw error;
  }
}

async function main() {
  if (!config.token) {
    console.error('❌ 请设置环境变量 GITHUB_TOKEN');
    process.exit(1);
  }

  const version = getPkgVersion();
  const tag = `v${version}`;

  console.log(`=== 发布 v${version} 到 GitHub Releases ===\n`);

  const release = await createRelease(version);

  const files = [
    { path: path.join(DIST_DIR, `JSecProbe Setup ${version}.exe`), name: `JSecProbe-Setup-${version}.exe` },
    { path: path.join(DIST_DIR, `JSecProbe Setup ${version}.exe.blockmap`), name: `JSecProbe-Setup-${version}.exe.blockmap` },
    { path: path.join(DIST_DIR, 'latest.yml'), name: 'latest.yml' },
  ];

  for (const file of files) {
    await uploadAsset(release.id, file.path, file.name);
  }

  console.log(`\n🎉 发布完成！`);
  console.log(`  Release URL: ${release.html_url}`);
}

main().catch(err => {
  console.error('\n❌ 发布失败:', err.message);
  process.exit(1);
});