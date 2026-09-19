import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';
import { getAppDataPathSync } from '../../main/paths';

/**
 * SSH 主机指纹信任库（Trust On First Use）。
 *
 * 背景：ssh2 在未提供 hostVerifier 时默认接受任意主机密钥，等价于 OpenSSH 的
 * `StrictHostKeyChecking=no` —— 在局域网/不可信网络中，攻击者只要能劫持到目标 IP
 * 即可完成中间人，直接窃取 password 认证方式下的明文口令（本工具的采集凭据通常是
 * 被测系统的管理员账号，危害极大）。
 *
 * 策略（按连接配置的 extraConfig.hostKeyPolicy 选择，默认 tofu）：
 * - tofu：首次连接记录指纹并放行（打印警告，提示人工核对）；后续指纹不匹配一律拒绝。
 * - strict：指纹必须已预先登记，未知主机直接拒绝。
 * - insecure：显式关闭校验（仅用于排障，日志留痕）。
 */
export type HostKeyPolicy = 'tofu' | 'strict' | 'insecure';

const KNOWN_HOSTS_FILE = 'ssh_known_hosts.json';

interface KnownHostEntry {
  /** sha256 指纹，形如 sha256:abcdef...（小写 hex） */
  fingerprint: string;
  addedAt: string;
}

type KnownHostsFile = Record<string, KnownHostEntry>;

function getKnownHostsPath(): string {
  const base = getAppDataPathSync();
  // data 子目录由 ensureDataDirs 保证存在
  return join(base, 'data', KNOWN_HOSTS_FILE);
}

function hostKeyOf(host: string, port: number): string {
  return `[${host}]:${port}`;
}

/**
 * 计算主机公钥指纹。key 为 SSH 线格式编码的公钥 Buffer，取 sha256。
 */
export function fingerprintOf(key: Buffer): string {
  return `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

function readStore(): KnownHostsFile {
  const file = getKnownHostsPath();
  try {
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as KnownHostsFile;
    }
  } catch (e) {
    log.warn('[SSH] 读取主机指纹库失败，按空库处理:', e);
  }
  return {};
}

function writeStore(store: KnownHostsFile): void {
  const file = getKnownHostsPath();
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    log.error('[SSH] 写入主机指纹库失败:', e);
  }
}

export function normalizePolicy(raw: unknown): HostKeyPolicy {
  return raw === 'strict' || raw === 'tofu' || raw === 'insecure' ? raw : 'tofu';
}

/**
 * 校验主机公钥。返回是否放行；被拒绝时 reason 为面向用户的中文说明。
 */
export function verifyHostKey(
  host: string,
  port: number,
  key: Buffer,
  policy: HostKeyPolicy
): { ok: boolean; reason?: string } {
  const fp = fingerprintOf(key);
  const storeKey = hostKeyOf(host, port);

  if (policy === 'insecure') {
    log.warn(`[SSH] 主机指纹校验已显式关闭（insecure）: ${storeKey} ${fp}`);
    return { ok: true };
  }

  const store = readStore();
  const known = store[storeKey];

  if (!known) {
    if (policy === 'strict') {
      return {
        ok: false,
        reason:
          `SSH 主机指纹未登记，连接已被拒绝（strict 模式）。\n` +
          `主机: ${storeKey}\n指纹: ${fp}\n` +
          `请先确认指纹无误后，将连接配置的 hostKeyPolicy 临时设为 tofu 完成登记，再改回 strict。`,
      };
    }
    // TOFU：记录并放行，但明确告警，便于事后审计
    store[storeKey] = { fingerprint: fp, addedAt: new Date().toISOString() };
    writeStore(store);
    log.warn(
      `[SSH] 首次连接主机 ${storeKey}，已按 TOFU 记录指纹 ${fp}。` +
        `若该网络不可信，请在连接前人工核对此指纹。`
    );
    return { ok: true };
  }

  if (known.fingerprint !== fp) {
    return {
      ok: false,
      reason:
        `SSH 主机指纹不匹配，连接已被拒绝（疑似中间人攻击）。\n` +
        `主机: ${storeKey}\n` +
        `已记录: ${known.fingerprint}（登记于 ${known.addedAt}）\n` +
        `本次收到: ${fp}\n` +
        `若确属主机重装/密钥轮换，请删除数据目录下 data/${KNOWN_HOSTS_FILE} 中该条目后重连。`,
    };
  }

  return { ok: true };
}

/** 列出已登记的主机指纹（供设置界面/排障使用） */
export function listKnownHosts(): Array<{ host: string; fingerprint: string; addedAt: string }> {
  const store = readStore();
  return Object.entries(store).map(([host, v]) => ({
    host,
    fingerprint: v.fingerprint,
    addedAt: v.addedAt,
  }));
}

/** 删除某主机的登记指纹 */
export function forgetHost(host: string, port: number): void {
  const store = readStore();
  const storeKey = hostKeyOf(host, port);
  if (store[storeKey]) {
    delete store[storeKey];
    writeStore(store);
    log.info(`[SSH] 已删除主机指纹记录: ${storeKey}`);
  }
}
