import { session } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';

/**
 * AI 网络层：统一走 Chromium 网络栈（session.fetch），
 * 支持系统代理（Clash 系统代理模式）与手动代理（AI 设置中配置），
 * 并把底层网络错误翻译成可读中文。
 */

// 独立的内存会话分区，与渲染层/自动更新互不影响
const AI_SESSION_PARTITION = 'ai-request';

const PROXY_MODES = ['system', 'manual', 'none'] as const;
export type AiProxyMode = (typeof PROXY_MODES)[number];

let aiSession: Electron.Session | null = null;
// 已应用到会话的代理配置（避免每次请求重复 setProxy）
let appliedProxyKey = '';
// 数据库配置同步节流：避免每次请求都查库
let lastSyncAt = 0;
const SYNC_INTERVAL_MS = 5000;

export function isValidProxyMode(v: any): v is AiProxyMode {
  return PROXY_MODES.includes(v);
}

/**
 * 校验手动代理地址格式，返回 { host, port } 或 null。
 * 允许：127.0.0.1:7890 / http://127.0.0.1:7890 / socks5://127.0.0.1:7890 / http://user:pass@host:port
 */
export function parseProxyUrl(input: string): { scheme: string; rules: string } | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) || /^socks(4|5)?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname || !u.port) return null;
    if (!/^(http|https|socks4|socks5|socks)$/.test(u.protocol.replace(':', ''))) return null;
    const scheme = u.protocol.replace(':', '').toLowerCase();
    // socks 协议统一记为 socks5（socks 即 socks5 的常见简写）
    const normalizedScheme = scheme === 'socks' || scheme === 'socks5' ? 'socks5' : scheme;
    const port = Number(u.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    const auth = u.username ? `${u.username}:${u.password}@` : '';
    return { scheme: normalizedScheme, rules: `${auth}${u.hostname}:${port}` };
  } catch {
    return null;
  }
}

function getOrCreateAiSession(): Electron.Session {
  if (!aiSession) {
    aiSession = session.fromPartition(AI_SESSION_PARTITION);
  }
  return aiSession;
}

function buildProxyKey(mode: AiProxyMode, rules: string): string {
  return `${mode}|${rules}`;
}

/**
 * 将代理配置应用到 AI 专用会话。
 * - system：跟随系统代理（Clash 开启「系统代理」即自动生效）
 * - manual：手动代理（rules 形如 127.0.0.1:7890，可含 socks5:// 前缀）
 * - none：直连
 * 相同配置不重复应用；返回是否实际应用。
 */
export async function applyAiProxy(mode: AiProxyMode, rules: string, force = false): Promise<boolean> {
  const key = buildProxyKey(mode, rules);
  if (!force && key === appliedProxyKey && aiSession) return false;
  const ses = getOrCreateAiSession();
  const proxyConfig: Electron.ProxyConfig = { mode: 'system' };
  if (mode === 'manual') { proxyConfig.mode = 'fixed_servers'; proxyConfig.proxyRules = rules; }
  else if (mode === 'none') { proxyConfig.mode = 'direct'; }
  await ses.setProxy(proxyConfig);
  appliedProxyKey = key;
  log.info(`[AI网络] 代理已应用: ${mode === 'system' ? '跟随系统代理' : mode === 'manual' ? `手动代理 ${rules}` : '直连'}`);
  return true;
}

/**
 * 从 ai_configs 读取代理配置并应用（带节流：距上次同步不足 5 秒则跳过）。
 * 每次 AI 请求前调用，保证设置保存后立即生效。
 */
export async function syncAiProxyFromDb(force = false): Promise<void> {
  if (!force && Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return;
  lastSyncAt = Date.now();
  try {
    const db = getDb();
    const rows = await db.select({
      proxyMode: schema.aiConfigs.proxyMode,
      proxyUrl: schema.aiConfigs.proxyUrl,
    }).from(schema.aiConfigs).limit(1);
    const cfg = rows[0];
    const mode: AiProxyMode = isValidProxyMode(cfg?.proxyMode) ? cfg.proxyMode : 'system';
    let rules = '';
    if (mode === 'manual') {
      const parsed = parseProxyUrl(cfg?.proxyUrl || '');
      if (!parsed) {
        // 手动代理地址非法：回退系统代理，避免请求全部失败
        log.warn(`[AI网络] 手动代理地址无效(${cfg?.proxyUrl})，回退为跟随系统代理`);
        await applyAiProxy('system', '');
        return;
      }
      rules = `${parsed.scheme}://${parsed.rules}`;
    }
    await applyAiProxy(mode, rules);
  } catch (e) {
    // 读取失败不阻塞请求，保持上次应用的代理配置
    log.warn('[AI网络] 读取代理配置失败，沿用当前代理设置:', e);
  }
}

/**
 * 把底层网络错误翻译成用户可读的中文（保留原始错误在 cause 中便于排查）。
 * 兼容两类错误来源：
 * - Node/undici：TypeError('fetch failed') + cause.code（ENOTFOUND/ECONNREFUSED/UND_ERR_CONNECT_TIMEOUT...）
 * - Chromium net：Error('net::ERR_NAME_NOT_RESOLVED') 等
 */
export function translateNetworkError(err: any): Error {
  if (err && err.name === 'AbortError') return err; // 主动超时/中止，交由调用方按超时处理
  const cause = err?.cause;
  const code = (cause && (cause.code || '')) || '';
  const rawMsg = String(err?.message || err || '');
  const causeMsg = String(cause?.message || '');

  const map: Array<[RegExp, string]> = [
    [/ENOTFOUND|ERR_NAME_NOT_RESOLVED/i, '域名解析失败(DNS)：请检查 API 地址拼写或本机 DNS'],
    [/ECONNREFUSED|ERR_CONNECTION_REFUSED/i, '连接被拒绝：目标服务器未开放该端口或地址有误'],
    [/ECONNRESET|ERR_CONNECTION_RESET/i, '连接被重置：网络中断或被中间设备拦截'],
    [/UND_ERR_CONNECT_TIMEOUT|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i, '连接超时：目标地址不可达（域名失效/被墙/防火墙拦截）'],
    [/ERR_PROXY_CONNECTION_FAILED/i, '代理连接失败：请检查代理软件是否在运行、端口是否正确'],
    [/ERR_TUNNEL_CONNECTION_FAILED/i, '代理隧道建立失败：代理不可用或规则拒绝了该请求'],
    [/ERR_INTERNET_DISCONNECTED/i, '网络未连接：请检查本机网络'],
    [/CERT_|ERR_TLS|ERR_SSL|DEPTH_ZERO|UNABLE_TO_VERIFY|SELF_SIGNED/i, 'TLS 证书错误：证书无效/过期或为自签名证书'],
    [/ERR_BLOCKED_BY_CLIENT|ERR_BLOCKED_BY_ADMINISTRATOR/i, '请求被拦截：代理软件规则或安全软件阻止了该请求'],
    [/EACCES|ERR_ACCESS_DENIED/i, '访问被拒绝：端口或权限不足'],
    [/EHOSTUNREACH|ERR_ADDRESS_UNREACHABLE|ENETUNREACH/i, '目标地址不可达：路由不可达或网络受限'],
  ];

  const haystack = `${code} ${rawMsg} ${causeMsg}`;
  let friendly = '';
  for (const [re, msg] of map) {
    if (re.test(haystack)) {
      friendly = msg;
      break;
    }
  }
  if (!friendly) {
    // 无法归类时保留原始信息
    friendly = rawMsg || '网络请求失败';
  } else {
    friendly = `${friendly}（${rawMsg || causeMsg}）`;
  }

  const wrapped = new Error(friendly);
  (wrapped as any).cause = cause || err;
  return wrapped;
}

/**
 * AI 请求统一入口：先同步代理配置，再走 Chromium 网络栈发请求。
 * 与全局 fetch 用法一致；网络层错误已翻译为中文。
 */
export async function aiFetch(url: string, init?: RequestInit): Promise<Response> {
  await syncAiProxyFromDb();
  try {
    return await getOrCreateAiSession().fetch(url, init);
  } catch (err) {
    throw translateNetworkError(err);
  }
}
