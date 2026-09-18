import { safeStorage } from 'electron';

const ENC_PREFIX = 'enc:';
const LEGACY_ENC_PREFIX = 'enc:v1:';

function isEncryptionAvailable(): boolean {
  return typeof safeStorage !== 'undefined' && !!safeStorage && safeStorage.isEncryptionAvailable();
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

export function encryptSecret(plain: string | null | undefined): string {
  if (!plain) return '';
  // 已加密（含历史 enc:v1: 前缀）则原样返回，避免重复加密产生不可逆密文
  if (plain.startsWith(ENC_PREFIX) || plain.startsWith(LEGACY_ENC_PREFIX)) return plain;
  if (!isEncryptionAvailable()) {
    return ENC_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
  }
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
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
