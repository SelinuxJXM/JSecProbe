/**
 * 上传安装包到 GitCode Releases（国内更新源）。
 *
 * 与另外两个源的行为对齐：
 *   - scripts/upload-to-github.js：GitHub Releases（electron-updater 原生）
 *   - scripts/upload-to-r2.js    ：Cloudflare R2（自管理托管）
 *
 * 用法：
 *   GITCODE_TOKEN=xxx node scripts/upload-to-gitcode.js [--force]
 *
 * --force：同名附件已存在也重新上传（默认跳过，保证幂等、可重复执行）。
 *
 * 实现要点（都是踩过的坑，改之前先看）：
 *   1. GitCode 的 tag 不带 v 前缀。仓库自 2.2.5 起发布的 tag 形如 `2.4.3`，
 *      而 GitHub 是 `v2.4.3`。两边不同源，所以这里默认用纯版本号；
 *      若仓库策略变了，用 GITCODE_TAG 环境变量覆盖即可。
 *   2. 创建 Release 必须带 release_status=latest，否则 /releases/latest 查不到它，
 *      客户端的 GitCode 更新源会直接失联（它依赖该接口）。
 *   3. 附件不是直接 POST 给 GitCode，而是两步：先向
 *      /repos/:owner/:repo/releases/:tag/upload_url?file_name=xxx 换取一个
 *      华为云 OBS 预签名 PUT 地址 + 必带请求头（x-obs-meta-project-id、
 *      x-obs-acl、x-obs-callback、Content-Type），再流式 PUT 到该地址；
 *      PUT 完成后由 x-obs-callback 回调 GitCode 登记附件。
 *   4. OBS 直传要求固定长度，必须显式给 Content-Length，且要用流式读取，
 *      别把 130MB 安装包一次性 readFileSync 进内存。
 *   5. 文件名保留空格风格（`JSecProbe Setup 2.4.3.exe`），与 GitCode 历史资产一致；
 *      客户端匹配正则 `^JSecProbe[ -]Setup[ -]<version>\.exe$` 空格和连字符都认。
 *   6. 129MB 安装包在国内网络偶发 ECONNRESET（R2 源同样情况），内置 3 次重试，
 *      每次重试重新换取预签名地址。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { ensureBlockmapInLatestYml } = require('./latest-yml-helper');
const { ROOT, getPkgVersion, buildReleaseNotes } = require('./release-notes');

const DIST_DIR = path.join(ROOT, 'dist');
const API_BASE = 'https://api.gitcode.com/api/v5';
const OWNER = 'giver';
const REPO = 'JSecProbe';

const TOKEN = process.env.GITCODE_TOKEN;
const VERSION = getPkgVersion();
const TAG = process.env.GITCODE_TAG || VERSION; // 见实现要点 1
const FORCE = process.argv.includes('--force');
const UPLOAD_TIMEOUT_MS = 20 * 60 * 1000; // 安装包约 130MB，国内网络也要留足时间

if (!TOKEN) {
  console.error('Error: GITCODE_TOKEN environment variable is not set');
  console.error('Usage: GITCODE_TOKEN=your_token node scripts/upload-to-gitcode.js');
  process.exit(1);
}

/** GitCode OpenAPI 请求：令牌走 query 参数，返回 JSON（无法解析时返回原文）。 */
function apiRequest(apiPath, options = {}, body) {
  const sep = apiPath.includes('?') ? '&' : '?';
  const url = `${API_BASE}${apiPath}${sep}access_token=${TOKEN}`;

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
    }
    req.end();
  });
}

function jsonHeaders(extra = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'JSecProbe-Release-Script',
    ...extra,
  };
}

/** 取指定 tag 的 Release，不存在返回 null。 */
async function findRelease(tag) {
  try {
    return await apiRequest(`/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
  } catch {
    return null;
  }
}

async function createRelease() {
  const payload = JSON.stringify({
    tag_name: TAG,
    name: TAG,
    body: buildReleaseNotes(TAG),
    // 见实现要点 2：不设 latest 客户端就查不到这个版本
    release_status: 'latest',
  });
  return apiRequest(
    `/repos/${OWNER}/${REPO}/releases`,
    { method: 'POST', headers: jsonHeaders({ 'Content-Length': Buffer.byteLength(payload) }) },
    payload,
  );
}

/**
 * 兜底：已存在的 Release（例如由仓库同步自动生成的）release_status 可能不是 latest，
 * 那样 /releases/latest 会跳过它、客户端就看不到新版本，这里顺手纠正回来。
 */
async function ensureLatestStatus(release) {
  if (release.release_status === 'latest') return release;
  console.log(`  Release 当前 release_status=${release.release_status}，纠正为 latest ...`);
  const payload = JSON.stringify({
    tag_name: release.tag_name,
    name: release.name || release.tag_name,
    body: release.body || '',
    release_status: 'latest',
  });
  try {
    const updated = await apiRequest(
      `/repos/${OWNER}/${REPO}/releases/${encodeURIComponent(release.tag_name)}`,
      { method: 'PATCH', headers: jsonHeaders({ 'Content-Length': Buffer.byteLength(payload) }) },
      payload,
    );
    console.log('  已纠正');
    return updated || release;
  } catch (err) {
    console.log(`  纠正失败（不影响已上传附件，但客户端可能查不到）: ${err.message}`);
    return release;
  }
}

/** 换取 OBS 预签名直传地址（见实现要点 3）。 */
async function getUploadUrl(tag, fileName) {
  return apiRequest(
    `/repos/${OWNER}/${REPO}/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(fileName)}`,
  );
}

/** 流式 PUT 到 OBS 预签名地址，每 20% 打一次进度。 */
function putToObs(uploadUrl, uploadHeaders, filePath) {
  const size = fs.statSync(filePath).size;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(uploadUrl);
    const req = https.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'PUT',
        headers: { ...uploadHeaders, 'Content-Length': size },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      },
    );

    req.setTimeout(UPLOAD_TIMEOUT_MS, () => req.destroy(new Error('上传超时')));
    req.on('error', reject);

    let uploaded = 0;
    let lastPct = 0;
    fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
      .on('data', (chunk) => {
        uploaded += chunk.length;
        const pct = Math.min(100, Math.floor((uploaded / size) * 100));
        if (pct >= lastPct + 20) {
          lastPct = pct - (pct % 20);
          process.stdout.write(` ${pct}%`);
        }
      })
      .pipe(req);
  });
}

/**
 * 单次上传 = 换预签名地址 + 流式 PUT。
 * 实测 129MB 安装包在国内网络偶发 ECONNRESET / socket hang up（R2 源也有同样情况），
 * 所以外面包一层重试；每次重试都重新换地址，避免复用已失效的预签名 URL。
 */
async function uploadOnce(tag, fileName, filePath) {
  const { url, headers } = await getUploadUrl(tag, fileName);
  if (!url) throw new Error('未获取到上传地址');
  await putToObs(url, headers || {}, filePath);
}

async function uploadWithRetry(tag, file) {
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await uploadOnce(tag, file.name, file.path);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        process.stdout.write(` 重试 ${attempt}/${MAX_ATTEMPTS - 1}（${err.message}）...`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }
  throw lastErr;
}

async function main() {
  console.log(`=== 上传 v${VERSION} 到 GitCode Releases ===\n`);

  ensureBlockmapInLatestYml(DIST_DIR, VERSION);

  let release = await findRelease(TAG);
  if (release) {
    console.log(`Release ${TAG} 已存在（创建于 ${release.created_at}），复用并补充缺失附件`);
  } else {
    console.log(`Release ${TAG} 不存在，正在创建 ...`);
    release = await createRelease();
    console.log('Release created');
  }
  release = await ensureLatestStatus(release);

  const existing = new Set(
    (release.assets || []).filter((a) => a.type === 'attach').map((a) => a.name),
  );

  const files = [
    {
      path: path.join(DIST_DIR, `JSecProbe Setup ${VERSION}.exe`),
      name: `JSecProbe Setup ${VERSION}.exe`,
    },
    {
      path: path.join(DIST_DIR, `JSecProbe Setup ${VERSION}.exe.blockmap`),
      name: `JSecProbe Setup ${VERSION}.exe.blockmap`,
    },
    {
      path: path.join(DIST_DIR, 'latest.yml'),
      name: 'latest.yml',
    },
    // 便携版：与 GitHub 脚本保持一致，构建出来才传
    {
      path: path.join(DIST_DIR, `JSecProbe ${VERSION}.exe`),
      name: `JSecProbe ${VERSION}.exe`,
    },
  ];

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      console.log(`SKIP: 本地文件不存在 ${path.relative(ROOT, file.path)}`);
      continue;
    }

    if (existing.has(file.name) && !FORCE) {
      console.log(`SKIP: ${file.name} 已存在，跳过（幂等，如需重传加 --force）`);
      continue;
    }

    const sizeMB = (fs.statSync(file.path).size / 1024 / 1024).toFixed(2);
    process.stdout.write(`Uploading ${file.name} (${sizeMB} MB) ...`);

    try {
      await uploadWithRetry(TAG, file);
      console.log(' OK');
      existing.add(file.name);
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
    }
  }

  console.log(`\nDone! Release URL: https://gitcode.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
  console.log('提示：客户端通过 /releases/latest + latest.yml 判断版本，请确保上面没有 FAILED。');
}

main().catch((err) => {
  console.error('\nUpload failed:', err.message);
  process.exit(1);
});
