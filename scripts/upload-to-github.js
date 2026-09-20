const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { ensureBlockmapInLatestYml } = require('./latest-yml-helper');
const { ROOT, getPkgVersion, buildReleaseNotes } = require('./release-notes');

const DIST_DIR = path.join(ROOT, 'dist');

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'SelinuxJXM';
const REPO = 'JSecProbe';
const TAG = `v${getPkgVersion()}`; // 发布标签，随版本升级自动同步 package.json

if (!TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set');
  console.error('Usage: set GITHUB_TOKEN=your_token && node scripts/upload-to-github.js');
  process.exit(1);
}

// Release 说明的生成逻辑已抽到 scripts/release-notes.js，与 upload-to-gitcode.js 共用，
// 避免两个源的 Release 正文出现不同步。
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
    // P3-11：此处原为 if/else 两个分支，内容完全相同（死代码）。
    // 非字符串（Buffer）本应直接写，字符串才需要考虑编码 —— 统一显式按 utf8 处理。
    if (body) {
      req.write(typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
    }
    req.end();
  });
}

async function createRelease() {
  const body = JSON.stringify({
    tag_name: TAG,
    name: TAG,
    body: buildReleaseNotes(TAG),
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

async function getReleaseAssets(releaseId) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets`;
  const options = {
    method: 'GET',
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'JSecProbe-Release-Script',
    },
  };
  return httpsRequest(url, options);
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

  ensureBlockmapInLatestYml(DIST_DIR, version);

  const release = await createRelease();
  const releaseId = release.id;

  // 获取已有资产名，实现幂等：同名资产已存在则跳过，避免重复上传报错
  let existingAssetNames = new Set();
  try {
    const existingAssets = await getReleaseAssets(releaseId);
    // 只把 state=uploaded（上传完成）的资产视为已存在；state=starter 的上传未完成，需补传
    existingAssetNames = new Set((existingAssets || []).filter(a => a.state === 'uploaded').map(a => a.name));
  } catch (err) {
    console.log(`Warning: 获取已有资产列表失败（${err.message}），继续尝试上传`);
  }

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
    // 便携版：package.json 的 win.target 含 portable，此前构建出来却从未上传
    {
      path: path.join(DIST_DIR, `JSecProbe ${version}.exe`),
      name: `JSecProbe-Portable-${version}.exe`,
    },
  ];

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      console.log(`Warning: ${file.path} not found, skipping`);
      continue;
    }

    if (existingAssetNames.has(file.name)) {
      console.log(`SKIP: ${file.name} 已存在，跳过（幂等）`);
      continue;
    }

    // 注意用 .size 而非 .length —— statSync 返回的是 fs.Stats，没有 length 属性，
    // 取 length 会得到 undefined 进而算出 NaN，日志里显示成 "(NaN MB)"
    const fileSize = (fs.statSync(file.path).size / 1024 / 1024).toFixed(2);
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
