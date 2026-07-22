const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'SelinuxJXM';
const REPO = 'JSecProbe';
const TAG = 'v2.0.6';

if (!TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set');
  console.error('Usage: set GITHUB_TOKEN=your_token && node scripts/upload-to-github.js');
  process.exit(1);
}

function getPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  return pkg.version;
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const req = mod.request(urlObj, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

async function createRelease() {
  const body = JSON.stringify({
    tag_name: TAG,
    name: TAG,
    body: `## v2.0.6 更新内容

- 更新系统版本号至 2.0.6
- 修复截图缩略图显示问题（统一数据路径）
- 修复文件预览功能（PDF/Word/文本）
- 修复 AI 批量分析忽略非图片文件的问题
- 增强 AI 返回 JSON 解析容错能力
- 优化单行 AI 分析支持文档文件`,
    draft: false,
    prerelease: false,
  });

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
  const options = {
    method: 'POST',
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'JSecProbe-Release-Script',
    },
  };

  try {
    const release = await httpsRequest(url, options, body);
    console.log(`Release created! ID: ${release.id}`);
    return release;
  } catch (err) {
    console.log(`Error creating release: ${err.message}`);
    // Try to get existing release
    try {
      const getUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`;
      const getOptions = {
        method: 'GET',
        headers: {
          Authorization: `token ${TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'JSecProbe-Release-Script',
        },
      };
      const release = await httpsRequest(getUrl, getOptions);
      console.log(`Release already exists, ID: ${release.id}`);
      return release;
    } catch (getErr) {
      console.log(`Error getting release: ${getErr.message}`);
      process.exit(1);
    }
  }
}

async function uploadAsset(releaseId, filePath, fileName) {
  const fileBuffer = fs.readFileSync(filePath);
  const encodedName = encodeURIComponent(fileName);
  const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodedName}`;

  const options = {
    method: 'POST',
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileBuffer.length,
      'User-Agent': 'JSecProbe-Release-Script',
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

async function main() {
  const version = getPkgVersion();
  console.log(`=== 上传 v${version} 到 GitHub Releases ===\n`);

  const release = await createRelease();
  const releaseId = release.id;

  const files = [
    {
      path: path.join(DIST_DIR, `JSecProbe Setup ${version}.exe`),
      name: `JSecProbe-Setup-${version}.exe`,
    },
    {
      path: path.join(DIST_DIR, `JSecProbe Setup ${version}.exe.blockmap`),
      name: `JSecProbe-Setup-${version}.exe.blockmap`,
    },
    {
      path: path.join(DIST_DIR, 'latest.yml'),
      name: 'latest.yml',
    },
  ];

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      console.log(`Warning: ${file.path} not found, skipping`);
      continue;
    }

    const fileSize = (fs.statSync(file.path).length / 1024 / 1024).toFixed(2);
    process.stdout.write(`Uploading ${file.name} (${fileSize} MB)... `);

    try {
      const result = await uploadAsset(releaseId, file.path, file.name);
      console.log('OK');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  console.log(`\nDone! Release URL: ${release.html_url}`);
}

main().catch((err) => {
  console.error('\nUpload failed:', err.message);
  process.exit(1);
});
