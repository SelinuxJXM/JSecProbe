/**
 * 备份文件加密（P1-18）
 *
 * 备份 ZIP 内明文包含 users.password_hash、ai_configs.api_key、
 * connection_configs.password_encrypted 等凭据。文档推荐的迁移用法是"把备份拷到另一台机器恢复"，
 * 一旦备份外发即等于全量凭据泄露，与"数据安全，完全掌控"的定位冲突。
 *
 * 方案：对整个 ZIP 文件做信封加密（envelope encryption），而不是依赖 ZIP 自带的
 * 加密特性——Node 生态里 compressing / adm-zip 都不支持写 AES 加密的 ZIP，
 * 自己实现 ZIP 加密格式既不安全也不可靠。
 *
 * 容器格式（字节布局）：
 *   MAGIC(8) | salt(16) | iv(12) | tag(16) | ciphertext(n)
 *
 * 算法：AES-256-GCM（同时提供机密性与完整性），密钥由 scrypt(password, salt) 派生。
 * 保持 .zip 扩展名不变，通过 MAGIC 头区分加密 / 未加密，避免破坏既有的
 * 文件选择、扩展名校验与备份列表逻辑。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** 容器魔数，用于识别加密备份（未加密的 ZIP 一定以 'PK\x03\x04' 开头） */
const ENC_MAGIC = Buffer.from('JSECBKP1', 'ascii');

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = ENC_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;

const KEY_LEN = 32;

/** 最短口令长度：低于此值不做加密，避免用户误以为已加密 */
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LEN);
}

/** 判断文件是否为加密备份（读文件头，不做解密） */
export function isEncryptedBackupFile(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(ENC_MAGIC.length);
      const read = fs.readSync(fd, head, 0, ENC_MAGIC.length, 0);
      if (read !== ENC_MAGIC.length) return false;
      return head.equals(ENC_MAGIC);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export function encryptBuffer(plain: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([ENC_MAGIC, salt, iv, tag, ciphertext]);
}

export function decryptBuffer(enc: Buffer, password: string): Buffer {
  if (enc.length < HEADER_LEN || !enc.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
    throw new Error('不是有效的加密备份文件');
  }

  const salt = enc.subarray(ENC_MAGIC.length, ENC_MAGIC.length + SALT_LEN);
  const iv = enc.subarray(ENC_MAGIC.length + SALT_LEN, ENC_MAGIC.length + SALT_LEN + IV_LEN);
  const tag = enc.subarray(
    ENC_MAGIC.length + SALT_LEN + IV_LEN,
    ENC_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN,
  );
  const ciphertext = enc.subarray(HEADER_LEN);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM 认证失败既可能是口令错误，也可能是文件被篡改——对调用方统一为口令错误，
    // 不区分二者以免给攻击者提供 oracle。
    throw new Error('备份密码错误，或备份文件已被损坏/篡改');
  }
}

/**
 * 把已生成的明文 ZIP 加密写回目标路径。
 * 采用"先写临时文件再原地替换"的顺序，避免加密中途失败留下半个损坏的备份。
 */
export function sealZipFile(plainZipPath: string, targetPath: string, password: string): number {
  const plain = fs.readFileSync(plainZipPath);
  const sealed = encryptBuffer(plain, password);
  const tmp = `${targetPath}.enc-tmp`;
  fs.writeFileSync(tmp, sealed);
  fs.rmSync(plainZipPath, { force: true });
  fs.renameSync(tmp, targetPath);
  return sealed.length;
}

export interface OpenedBackupZip {
  /** 可直接交给 compressing / AdmZip 处理的明文 ZIP 路径 */
  zipPath: string;
  /** 该路径是否为临时解密产物（调用方用完后必须调用 cleanup 删除，避免明文凭据残留） */
  isTemp: boolean;
  cleanup: () => void;
}

/**
 * 打开一个备份文件，必要时解密为临时明文 ZIP。
 *
 * @param backupPath 备份文件路径（可能是加密容器）
 * @param password   解密口令；加密备份必须提供
 * @param workDir    临时明文文件存放目录（应在应用数据目录内）
 */
export function openBackupZip(
  backupPath: string,
  password: string | undefined,
  workDir: string,
): OpenedBackupZip {
  if (!isEncryptedBackupFile(backupPath)) {
    return { zipPath: backupPath, isTemp: false, cleanup: () => {} };
  }

  if (!password) {
    throw new Error('该备份已加密，请提供备份密码');
  }

  const enc = fs.readFileSync(backupPath);
  const plain = decryptBuffer(enc, password);

  fs.mkdirSync(workDir, { recursive: true });
  // 使用随机文件名，避免并发恢复时互相覆盖
  const tempPath = path.join(workDir, `decrypted_${crypto.randomBytes(8).toString('hex')}.zip`);
  fs.writeFileSync(tempPath, plain);

  return {
    zipPath: tempPath,
    isTemp: true,
    cleanup: () => {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        /* 清理失败不影响主流程，但明文临时文件需尽快删除 */
      }
    },
  };
}
