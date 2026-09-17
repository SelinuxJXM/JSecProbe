import { safeStorage } from 'electron';

const ENC_PREFIX = 'enc:';

function isEncryptionAvailable(): boolean {
  return typeof safeStorage !== 'undefined' && !!safeStorage && safeStorage.isEncryptionAvailable();
}

export function encryptSecret(plain: string | null | undefined): string {
  if (!plain) return '';
  if (!isEncryptionAvailable()) {
    return ENC_PREFIX + Buffer.from(plain, 'utf8').toString('base64');
  }
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  const data = stored.startsWith(ENC_PREFIX) ? stored.slice(ENC_PREFIX.length) : stored;
  if (!isEncryptionAvailable()) {
    return Buffer.from(data, 'base64').toString('utf8');
  }
  return safeStorage.decryptString(Buffer.from(data, 'base64'));
}