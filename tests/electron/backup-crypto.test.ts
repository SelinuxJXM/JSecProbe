/**
 * backup-crypto 关键链路测试
 *
 * 为什么值得测：备份 / 恢复是"坏了就是数据丢失"的路径，且失败模式极其安静——
 *  1. 明文 ZIP 没被删掉 → 用户以为备份已加密，磁盘上其实还留着全量凭据明文；
 *  2. 加密中途失败留下半个文件 → 备份列表里看得见、点恢复时才炸；
 *  3. 密文被篡改不做完整性校验 → 能"成功恢复"出一份被污染的数据。
 * 这三类都不会在正常使用中报错，只能靠断言拦住。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  sealZipFile,
  openBackupZip,
  isEncryptedBackupFile,
  MIN_BACKUP_PASSWORD_LENGTH,
} from '../../electron/services/backup-crypto';

/** 容器固定头长度：MAGIC(8) + salt(16) + iv(12) + tag(16)，须与模块内 HEADER_LEN 对齐 */
const HEADER_LEN = 52;
const MAGIC = Buffer.from('JSECBKP1', 'ascii');
/** tag 在头内的偏移：MAGIC(8) + salt(16) + iv(12) */
const TAG_OFFSET = 36;
/** 未加密 ZIP 的本地文件头签名，用来确认产物不是明文 ZIP */
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const PASSWORD = 'correct-horse-battery';
const TAMPER_MESSAGE = '备份密码错误，或备份文件已被损坏/篡改';

let dir: string;
let workDir: string;

/** 造一个"以 PK\x03\x04 开头"的明文备份，正文随机，避免与实现细节耦合 */
function makePlainZip(byteLength = 4096): Buffer {
  return Buffer.concat([ZIP_LOCAL_HEADER, crypto.randomBytes(byteLength)]);
}

function writePlainZip(name = 'backup.zip', byteLength = 4096) {
  const content = makePlainZip(byteLength);
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { file, content };
}

/** workDir 下残留的明文中转文件，正常流程结束后必须为空 */
function decryptedLeftovers(): string[] {
  if (!fs.existsSync(workDir)) return [];
  return fs.readdirSync(workDir).filter(f => f.startsWith('decrypted_'));
}

function tmpLeftovers(): string[] {
  return fs.readdirSync(dir).filter(f => f.includes('enc-tmp'));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsec-bkp-'));
  workDir = path.join(dir, 'work');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('常量契约', () => {
  it('最短口令长度为 8（调用方据此决定是否加密）', () => {
    expect(MIN_BACKUP_PASSWORD_LENGTH).toBe(8);
  });
});

describe('isEncryptedBackupFile', () => {
  it('明文 ZIP 判为未加密', () => {
    const { file } = writePlainZip();
    expect(isEncryptedBackupFile(file)).toBe(false);
  });

  it('文件不存在时返回 false 而不是抛异常（备份列表会拿任意路径来问）', () => {
    expect(isEncryptedBackupFile(path.join(dir, 'not-exists.zip'))).toBe(false);
  });

  it('不足魔数长度的文件返回 false（截断文件不能被当成加密备份）', () => {
    const file = path.join(dir, 'tiny.zip');
    fs.writeFileSync(file, Buffer.from([0x50, 0x4b]));
    expect(isEncryptedBackupFile(file)).toBe(false);
  });

  it('以魔数开头的文件判为加密备份', () => {
    const file = path.join(dir, 'magic-only.zip');
    fs.writeFileSync(file, MAGIC);
    expect(isEncryptedBackupFile(file)).toBe(true);
  });
});

describe('sealZipFile', () => {
  it('产物是加密容器：魔数头 + 固定 52 字节头 + 密文，且不再是明文 ZIP', async () => {
    const { file, content } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');

    const size = await sealZipFile(file, target, PASSWORD);

    const raw = fs.readFileSync(target);
    expect(raw.subarray(0, MAGIC.length).equals(MAGIC)).toBe(true);
    expect(raw.subarray(0, 4).equals(ZIP_LOCAL_HEADER)).toBe(false);
    expect(size).toBe(HEADER_LEN + content.length);
    expect(fs.statSync(target).size).toBe(size);
    // 回填必须真正生效：tag 区不能还是头里那 16 字节占位 0
    // （占位 0 被刷盘覆盖真实 tag 就是"备份能存、只有恢复时才炸"的静默损坏）
    expect(raw.subarray(TAG_OFFSET, TAG_OFFSET + 16).equals(Buffer.alloc(16))).toBe(false);
  });

  it('加密成功后删除明文 ZIP，避免磁盘上残留全量凭据', async () => {
    const { file } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');

    await sealZipFile(file, target, PASSWORD);

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('成功后不残留 .enc-tmp 中间文件', async () => {
    const { file } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');

    await sealZipFile(file, target, PASSWORD);

    expect(fs.existsSync(`${target}.enc-tmp`)).toBe(false);
    expect(tmpLeftovers()).toEqual([]);
  });

  it('源文件不存在时失败，且不产生半个损坏的目标文件（原子性）', async () => {
    const target = path.join(dir, 'sealed.zip');

    await expect(
      sealZipFile(path.join(dir, 'missing.zip'), target, PASSWORD)
    ).rejects.toThrow();

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(`${target}.enc-tmp`)).toBe(false);
  });

  it('相同明文 + 相同口令两次加密得到不同密文（salt / iv 必须每次随机）', async () => {
    const content = makePlainZip();
    const a = path.join(dir, 'a.zip');
    const b = path.join(dir, 'b.zip');
    fs.writeFileSync(a, content);
    fs.writeFileSync(b, content);
    const ta = path.join(dir, 'a.sealed.zip');
    const tb = path.join(dir, 'b.sealed.zip');

    await sealZipFile(a, ta, PASSWORD);
    await sealZipFile(b, tb, PASSWORD);

    expect(fs.readFileSync(ta).equals(fs.readFileSync(tb))).toBe(false);

    // 两份都仍能用同一口令解回同一明文
    const oa = await openBackupZip(ta, PASSWORD, workDir);
    const ob = await openBackupZip(tb, PASSWORD, workDir);
    try {
      expect(fs.readFileSync(oa.zipPath).equals(content)).toBe(true);
      expect(fs.readFileSync(ob.zipPath).equals(content)).toBe(true);
    } finally {
      oa.cleanup();
      ob.cleanup();
    }
  });
});

describe('openBackupZip', () => {
  it('正确口令解回与原始明文逐字节一致的 ZIP，cleanup 后明文临时文件被删除', async () => {
    const { file, content } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');
    await sealZipFile(file, target, PASSWORD);

    const opened = await openBackupZip(target, PASSWORD, workDir);

    try {
      expect(opened.isTemp).toBe(true);
      expect(opened.zipPath).not.toBe(target);
      expect(fs.readFileSync(opened.zipPath).equals(content)).toBe(true);
      // 使用期间确实存在一份明文临时文件，所以 cleanup 不能被漏掉
      expect(decryptedLeftovers()).toHaveLength(1);
    } finally {
      opened.cleanup();
    }

    expect(fs.existsSync(opened.zipPath)).toBe(false);
    expect(decryptedLeftovers()).toEqual([]);
  });

  it('口令错误时报错，且不留下解到一半的明文临时文件', async () => {
    const { file } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');
    await sealZipFile(file, target, PASSWORD);

    await expect(openBackupZip(target, 'wrong-password', workDir)).rejects.toThrow(
      TAMPER_MESSAGE
    );

    expect(decryptedLeftovers()).toEqual([]);
  });

  it('密文被篡改时报错（GCM 完整性），不会"成功恢复"出被污染的数据', async () => {
    const { file } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');
    await sealZipFile(file, target, PASSWORD);

    const raw = fs.readFileSync(target);
    raw[HEADER_LEN + 10] ^= 0xff; // 翻转密文区一个字节
    fs.writeFileSync(target, raw);

    await expect(openBackupZip(target, PASSWORD, workDir)).rejects.toThrow(TAMPER_MESSAGE);
    expect(decryptedLeftovers()).toEqual([]);
  });

  it('auth tag 被篡改时同样报错', async () => {
    const { file } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');
    await sealZipFile(file, target, PASSWORD);

    const raw = fs.readFileSync(target);
    raw[TAG_OFFSET] ^= 0xff; // 翻转 auth tag 首字节
    fs.writeFileSync(target, raw);

    await expect(openBackupZip(target, PASSWORD, workDir)).rejects.toThrow(TAMPER_MESSAGE);
    expect(decryptedLeftovers()).toEqual([]);
  });

  it('加密备份未提供口令时明确提示，而不是静默返回原文路径', async () => {
    const { file } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');
    await sealZipFile(file, target, PASSWORD);

    await expect(openBackupZip(target, undefined, workDir)).rejects.toThrow(
      '该备份已加密，请提供备份密码'
    );
    await expect(openBackupZip(target, '', workDir)).rejects.toThrow(
      '该备份已加密，请提供备份密码'
    );
  });

  it('容器被截断（头不足 52 字节）时报"不是有效的加密备份文件"', async () => {
    const target = path.join(dir, 'truncated.zip');
    fs.writeFileSync(target, MAGIC);

    await expect(openBackupZip(target, PASSWORD, workDir)).rejects.toThrow(
      '不是有效的加密备份文件'
    );
  });

  it('未加密备份原样透传：不产生临时文件，cleanup 是空操作', async () => {
    const { file, content } = writePlainZip();

    const opened = await openBackupZip(file, undefined, workDir);

    expect(opened.isTemp).toBe(false);
    expect(opened.zipPath).toBe(file);
    expect(fs.readFileSync(opened.zipPath).equals(content)).toBe(true);

    opened.cleanup();
    expect(fs.existsSync(file)).toBe(true);
    expect(decryptedLeftovers()).toEqual([]);
  });

  it('cleanup 可重复调用且不抛异常（定时清理与 finally 可能都会调到）', async () => {
    const { file } = writePlainZip();
    const target = path.join(dir, 'sealed.zip');
    await sealZipFile(file, target, PASSWORD);

    const opened = await openBackupZip(target, PASSWORD, workDir);

    opened.cleanup();
    expect(() => opened.cleanup()).not.toThrow();
  });
});