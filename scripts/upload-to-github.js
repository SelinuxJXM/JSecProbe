const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { ensureBlockmapInLatestYml } = require('./latest-yml-helper');

const ROOT = path.resolve(__dirname, '..');
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
    body: `## ${TAG} 更新内容

### 问题修复
- 修复现场核查「AI 智能推荐核查方法」弹窗手动关闭后按钮卡在「AI 分析中」的问题
- 修复数据库迁移 SQL 建表顺序，清理未登记孤儿迁移，迁移体系与运行时兜底保持一致
- 修复命令库种子重灌逻辑：按 id 判重，仅补充缺失命令，不再覆盖用户编辑

### 数据健壮性
- 删除项目/资产时级联清理采集任务、采集结果、连接配置等孤儿数据
- 统一 createdAt 为 UTC ISO 格式；补充采集/连接/命令库索引
- VACUUM INTO 备份路径单引号转义；迁移目录改为绝对路径
- system_settings 补齐 created_at 列兜底

### 安全加固
- Excel 解析库由 xlsx 替换为 exceljs（修复 CVE-2023-30533 / CVE-2024-22363），.xls 需另存为 .xlsx 后导入
- .env.example 敏感信息脱敏，移除真实 R2 账户信息

### 构建与发布
- latest.yml 自动补充 blockmap 字段，支持增量更新
- GitHub Releases 上传幂等，同名资产自动跳过
- 新增 npm run typecheck 脚本`,
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
