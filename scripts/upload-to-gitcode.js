const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');

const TOKEN = process.env.GITCODE_TOKEN;
const OWNER = 'giver';
const REPO = 'JSecProbe';
const API_BASE = 'https://gitcode.com/api/v5';

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
      req.write(body);
    }
    req.end();
  });
}

async function createRelease(version) {
  const releaseData = {
    tag_name: `v${version}`,
    name: `v${version}`,
    body: `## v${version} 更新内容\n\n- 详见 GitHub Releases 了解详细更新内容`,
    draft: false,
    prerelease: false,
  };

  const body = JSON.stringify(releaseData);
  const url = `${API_BASE}/repos/${OWNER}/${REPO}/releases`;
  const options = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
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
    try {
      const getUrl = `${API_BASE}/repos/${OWNER}/${REPO}/releases/tags/v${version}`;
      const getOptions = {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/json',
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
  const url = `${API_BASE}/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`;

  const options = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
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
    req.write(fileBuffer);
    req.end();
  });
}

async function main() {
  if (!TOKEN) {
    console.error('Error: GITCODE_TOKEN environment variable is not set');
    console.error('Usage: set GITCODE_TOKEN=your_token && node scripts/upload-to-gitcode.js');
    process.exit(1);
  }

  const version = getPkgVersion();
  console.log(`=== 上传 v${version} 到 GitCode Releases ===\n`);

  const release = await createRelease(version);
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
      await uploadAsset(releaseId, file.path, file.name);
      console.log('OK');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  console.log(`\nDone! Release URL: https://gitcode.com/${OWNER}/${REPO}/releases`);
}

main().catch((err) => {
  console.error('\nUpload failed:', err.message);
  process.exit(1);
});
