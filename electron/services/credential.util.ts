import { safeStorage } from 'electron';
import { logger as log } from '../utils/logger';

const ENC_PREFIX = 'enc:';
const LEGACY_ENC_PREFIX = 'enc:v1:';
/**
 * 「假加密」标记前缀：safeStorage 不可用时（Linux 无 keyring、或 headless 环境）
 * 原实现仍产出 `enc:` + base64，与真密文**完全无法区分** —— 备份外发时
 * 用户以为凭据是加密的，实则可一键还原。此处用独立前缀显式标记。
 */
const PLAIN_PREFIX = 'enc:plain:';

function isEncryptionAvailable(): boolean {
  return typeof safeStorage !== 'undefined' && !!safeStorage && safeStorage.isEncryptionAvailable();
}

/** 降级告警只打一次，避免每次读写凭据都刷日志 */
let plainFallbackWarned = false;

function warnPlainFallback(): void {
  if (plainFallbackWarned) return;
  plainFallbackWarned = true;
  log.warn(
    '[credential] 系统安全存储（safeStorage）不可用，凭据将以明文 base64 形式落库（前缀 enc:plain:）。' +
    '请勿在本机存放真实口令，或迁移到支持密钥环的环境（Linux 需安装 libsecret / kwallet）。'
  );
}

function decryptWithPrefix(stored: string, prefix: string): string {
  const data = stored.slice(prefix.length);
  if (!isEncryptionAvailable()) {
    return Buffer.from(data, 'base64').toString('utf8');
  }
  try {
    return safeStorage.decryptString(Buffer.from(data, 'base64'));
  } catch {
    return '';
  }
}

/**
 * 判断一段已存储的凭据是否经过真实加密。
 * 返回 false 表示：旧版明文、或 safeStorage 不可用时的 base64「假加密」——二者均可直接还原。
 * 备份、导出、安全提示等场景应据此给出明确风险提示。
 */
export function isSecretEncrypted(stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (stored.startsWith(PLAIN_PREFIX)) return false;
  if (!stored.startsWith(ENC_PREFIX) && !stored.startsWith(LEGACY_ENC_PREFIX)) return false;
  return isEncryptionAvailable();
}

/** 当前环境是否具备真实加密能力（供 UI 提示与备份风险提示使用） */
export function isSecretEncryptionAvailable(): boolean {
  return isEncryptionAvailable();
}

export function encryptSecret(plain: string | null | undefined): string {
  if (!plain) return '';
  // 已加密（含历史 enc:v1: 前缀与 enc:plain: 明文标记）则原样返回，避免重复加密产生不可逆密文
  if (plain.startsWith(ENC_PREFIX) || plain.startsWith(LEGACY_ENC_PREFIX)) return plain;
  if (!isEncryptionAvailable()) {
    warnPlainFallback();
    return PLAIN_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
  }
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  // 显式「假加密」标记：无论当前 safeStorage 是否可用，都按 base64 还原（恒不调用 safeStorage）
  if (stored.startsWith(PLAIN_PREFIX)) {
    try {
      return Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  // 兼容历史 enc:v1: 前缀：与 enc: 采用相同的 safeStorage 加密 + base64 编码，仅前缀串不同
  if (stored.startsWith(LEGACY_ENC_PREFIX)) {
    return decryptWithPrefix(stored, LEGACY_ENC_PREFIX);
  }
  if (stored.startsWith(ENC_PREFIX)) {
    return decryptWithPrefix(stored, ENC_PREFIX);
  }
  // 未带前缀：视为旧版明文，原样返回（兼容未加密的历史数据）
  return stored;
}
