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
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import log from 'electron-log';

/** 容器魔数，用于识别加密备份（未加密的 ZIP 一定以 'PK\x03\x04' 开头） */
const ENC_MAGIC = Buffer.from('JSECBKP1', 'ascii');

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = ENC_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;

const KEY_LEN = 32;

/** 最短口令长度：低于此值不做加密，避免用户误以为已加密 */
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

/**
 * 异步版密钥派生。
 * scrypt 是**故意**设计为慢且耗 CPU 的（默认 N=16384），同步版会把主进程
 * 整个卡住几百毫秒到数秒；备份文件动辄几百 MB，必须走异步版本。
 */
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * 安全地关闭写流并释放底层文件句柄。
 * 必须在删除临时文件之前调用：Windows 下若写流仍持有句柄，fs.promises.rm 会 EBUSY 且通常被吞掉，
 * 导致"加密中途失败"时残留半个 .enc-tmp 文件，破坏原子性。await 'close' 确保句柄真正释放后再删。
 */
function closeWriteStream(ws: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    ws.once('close', done);
    ws.once('error', done); // 已出错也直接收尾
    try {
      ws.destroy();
    } catch {
      done();
    }
    // 兜底：极端情况下 'close' 永不触发时也不挂死
    setTimeout(done, 1000);
  });
}

/** 读取加密容器的头部（MAGIC 之后是 salt / iv / tag），并校验魔数 */
async function readEncryptedHeader(
  filePath: string
): Promise<{ salt: Buffer; iv: Buffer; tag: Buffer }> {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const head = Buffer.alloc(HEADER_LEN);
    const { bytesRead } = await fh.read(head, 0, HEADER_LEN, 0);
    if (bytesRead < HEADER_LEN || !head.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
      throw new Error('不是有效的加密备份文件');
    }
    let off = ENC_MAGIC.length;
    const salt = Buffer.from(head.subarray(off, off + SALT_LEN));
    off += SALT_LEN;
    const iv = Buffer.from(head.subarray(off, off + IV_LEN));
    off += IV_LEN;
    const tag = Buffer.from(head.subarray(off, off + TAG_LEN));
    return { salt, iv, tag };
  } finally {
    await fh.close();
  }
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

/**
 * 把已生成的明文 ZIP **流式**加密写回目标路径（异步）。
 *
 * 旧实现是 `readFileSync(整个 ZIP)` + `writeFileSync(密文)`：几百 MB 的备份会把主进程
 * 冻结数秒到数十秒（期间界面完全无响应），且峰值内存≈备份体积的 2 倍。
 * 现改为 stream pipeline，内存占用恒定（仅几个 64KB chunk）。
 *
 * GCM 的 auth tag 只有在密文写完后才拿得到，而容器格式把它放在密文之前，
 * 因此先写 16 字节占位头，密文流结束后再用随机写回填 tag（避免整文件二次拷贝）。
 *
 * 采用"先写临时文件再原子替换"的顺序，避免加密中途失败留下半个损坏的备份。
 *
 * @returns 加密后文件字节数
 */
export async function sealZipFile(
  plainZipPath: string,
  targetPath: string,
  password: string
): Promise<number> {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = await deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const header = Buffer.alloc(HEADER_LEN);
  ENC_MAGIC.copy(header, 0);
  salt.copy(header, ENC_MAGIC.length);
  iv.copy(header, ENC_MAGIC.length + SALT_LEN);
  // tag 占位（16 字节 0）：密文流结束后回填到 ENC_MAGIC.length + SALT_LEN + IV_LEN 处

  const tmp = `${targetPath}.enc-tmp`;
  const ws = fs.createWriteStream(tmp);
  try {
    await pipeline(Readable.from(header), ws, { end: false });
    await pipeline(fs.createReadStream(plainZipPath), cipher, ws, { end: false });

    const tag = cipher.getAuthTag();

    // 顺序要点：必须等写流把 header + 密文全部刷盘并关闭后，才用独立 fd 回填 tag。
    // `pipeline(..., ws, { end: false })` 不会等待写流的异步 open() 完成，而小备份的密文
    // 很快就能缓冲完 —— 若先 open(tmp, 'r+')，会早于文件创建而直接 ENOENT；即便文件已在，
    // 头里的 16 字节占位 0 也可能在回填之后才刷盘，把真实 tag 覆盖成 0，
    // 产出一个"能保存、备份列表里看得见、只有恢复时才炸"的坏备份。
    await new Promise<void>((resolve, reject) => {
      ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    const fh = await fs.promises.open(tmp, 'r+');
    try {
      await fh.write(tag, 0, TAG_LEN, ENC_MAGIC.length + SALT_LEN + IV_LEN);
    } finally {
      await fh.close();
    }

    const stat = await fs.promises.stat(tmp);
    await fs.promises.rm(plainZipPath, { force: true });
    await fs.promises.rename(tmp, targetPath);
    return stat.size;
  } catch (error) {
    // 失败兜底：必须先释放写流句柄再删临时文件。
    // Windows 下若写流仍持有句柄，fs.promises.rm 会 EBUSY 且被下方吞掉，
    // 最终残留半个 .enc-tmp 文件（破坏"加密中途失败不留下坏备份"的原子性）。
    await closeWriteStream(ws);
    try {
      await fs.promises.rm(tmp, { force: true });
    } catch {
      /* 忽略清理失败 */
    }
    throw error;
  }
}

export interface OpenedBackupZip {
  /** 可直接交给 compressing / AdmZip 处理的明文 ZIP 路径 */
  zipPath: string;
  /** 该路径是否为临时解密产物（调用方用完后必须调用 cleanup 删除，避免明文凭据残留） */
  isTemp: boolean;
  cleanup: () => void;
}

/**
 * 打开一个备份文件，必要时**流式**解密为临时明文 ZIP（异步）。
 *
 * @param backupPath 备份文件路径（可能是加密容器）
 * @param password   解密口令；加密备份必须提供
 * @param workDir    临时明文文件存放目录（应在应用数据目录内）
 */
export async function openBackupZip(
  backupPath: string,
  password: string | undefined,
  workDir: string,
): Promise<OpenedBackupZip> {
  if (!isEncryptedBackupFile(backupPath)) {
    return { zipPath: backupPath, isTemp: false, cleanup: () => {} };
  }

  if (!password) {
    throw new Error('该备份已加密，请提供备份密码');
  }

  const { salt, iv, tag } = await readEncryptedHeader(backupPath);
  const key = await deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  await fs.promises.mkdir(workDir, { recursive: true });
  // 使用随机文件名，避免并发恢复时互相覆盖
  const tempPath = path.join(workDir, `decrypted_${crypto.randomBytes(8).toString('hex')}.zip`);

  try {
    await pipeline(
      fs.createReadStream(backupPath, { start: HEADER_LEN }),
      decipher,
      fs.createWriteStream(tempPath)
    );
  } catch (error) {
    // GCM 认证失败既可能是口令错误，也可能是文件被篡改——对调用方统一为口令错误，
    // 不区分二者以免给攻击者提供 oracle。
    try {
      await fs.promises.rm(tempPath, { force: true });
    } catch {
      /* 忽略清理失败 */
    }
    logCryptoError(error);
    throw new Error('备份密码错误，或备份文件已被损坏/篡改');
  }

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

/** 解密失败时保留真实原因到日志，但不对调用方暴露细节（避免成为攻击 oracle） */
function logCryptoError(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  log.warn('[备份解密] 认证失败:', msg);
}
