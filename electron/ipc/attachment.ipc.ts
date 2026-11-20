import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import { wrap } from '../utils/ipc-wrapper';
import { getAppDataPath } from '../main/paths';
import { toRelativePath, validateFsPath } from '../utils/path-resolver';

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
// 脚本/代码类扩展名不再放行：附件会在应用内预览，`.js`/`.ts` 属可执行代码载体，
// 一旦预览链路存在任何执行面即构成代码执行风险，且对测评取证没有实际用途。
// 注意：`.html` 保留（报告导出场景存在），但预览侧必须净化后再展示。
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.md', '.txt', '.csv', '.log', '.json', '.xml', '.html'];

const IMAGE_MAGIC_NUMBERS: Record<string, Buffer> = {
  '.png': Buffer.from([0x89, 0x50, 0x4E, 0x47]),
  '.jpg': Buffer.from([0xFF, 0xD8, 0xFF]),
  '.jpeg': Buffer.from([0xFF, 0xD8, 0xFF]),
  '.gif': Buffer.from([0x47, 0x49, 0x46, 0x38]),
  '.bmp': Buffer.from([0x42, 0x4D]),
  '.webp': Buffer.from([0x52, 0x49, 0x46, 0x46]),
};

/**
 * 按真实文件头识别图片格式（返回规范扩展名，非图片返回 null）。
 *
 * 背景：很多截图/聊天工具保存的图「扩展名与真实格式不符」（如 .png 实为 JPEG、
 * .jpg 实为 WebP），旧逻辑按扩展名匹配 magic number 会把这些合法图片误判为
 * 「无效的图片数据」。改为以内容为准：识别真实格式并回传规范后缀，落盘时统一改名，
 * 既解决误判，又保证后续预览/报告按正确格式处理。
 */
function detectImageExt(buffer: Buffer): string | null {
  // WebP 是 RIFF 容器：仅比对前 4 字节 RIFF 会把 WAV/AVI 等误判为图片，
  // 需再校验第 8-11 字节的 WEBP 标识。
  if (buffer.subarray(0, 4).equals(IMAGE_MAGIC_NUMBERS['.webp'])) {
    return buffer.subarray(8, 12).toString('ascii') === 'WEBP' ? '.webp' : null;
  }
  for (const [ext, magic] of Object.entries(IMAGE_MAGIC_NUMBERS)) {
    if (ext === '.webp') continue;
    if (buffer.subarray(0, magic.length).equals(magic)) return ext;
  }
  return null;
}

export function registerAttachmentHandlers(): void {
  ipcMain.handle('attachment:save', wrap(async (_event, params: { name: string; base64Data: string }) => {
    const { name, base64Data } = params;
    if (!name || typeof name !== 'string') {
      throw new Error('文件名无效');
    }
    if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
      throw new Error('文件名包含非法字符');
    }
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('文件数据无效');
    }

    const ext = path.extname(name).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.includes(ext);
    const isDocument = DOCUMENT_EXTENSIONS.includes(ext);
    if (!isImage && !isDocument) {
      throw new Error(`不支持的文件类型: ${ext || '(无扩展名)'}`);
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0) {
      throw new Error('文件内容为空');
    }
    if (buffer.length > MAX_ATTACHMENT_SIZE) {
      throw new Error(`文件大小超过限制 (${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB)`);
    }

    // 图片以「真实文件头」为准：扩展名是图片类型但内容对不上任何已知图片头 → 拒绝，
    // 防止脚本/伪装文件混进来；扩展名与真实格式不符（如 .png 实为 JPEG）→ 按真实格式纠正后缀。
    let finalName = name;
    if (isImage) {
      const realExt = detectImageExt(buffer);
      if (!realExt) {
        throw new Error('无效的图片数据：文件内容不是可识别的图片格式');
      }
      if (realExt !== ext) {
        finalName = name.slice(0, name.length - ext.length) + realExt;
        log.info(`[attachment:save] 图片扩展名与内容不符，已按真实格式纠正: ${name} -> ${finalName}`);
      }
    }
    // 非图片（文档）按原扩展名放行，不做 magic 校验（PDF/Office 等格式多样，非空与大小已校验）

    const appDataPath = await getAppDataPath();
    const attachmentDir = path.join(appDataPath, 'ai-chat-attachments');
    fs.mkdirSync(attachmentDir, { recursive: true });

    const sanitized = finalName.replace(/[<>:"|?*\x00-\x1f]/g, '_');
    const targetName = `${Date.now()}_${sanitized}`;
    const targetPath = path.join(attachmentDir, targetName);
    fs.writeFileSync(targetPath, buffer);

    const relativePath = await toRelativePath(targetPath);
    log.info('[attachment:save] 附件已保存:', relativePath, 'size:', buffer.length);

    return { path: relativePath, name: sanitized, size: buffer.length, type: isImage ? 'image' : 'document' };
  }, { moduleName: 'attachment' }));

  // 删除受管附件（拓扑图移除时清理物理文件，避免孤儿文件）
  ipcMain.handle('attachment:delete', wrap(async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('文件路径无效');
    // 只允许删除受管附件目录内的文件，拒绝任意路径
    const abs = await validateFsPath(filePath);
    const attachmentDir = path.join(await getAppDataPath(), 'ai-chat-attachments');
    const resolvedDir = path.resolve(attachmentDir);
    if (!abs.startsWith(resolvedDir + path.sep)) {
      throw new Error('只允许删除应用附件目录内的文件');
    }
    try {
      await fs.promises.unlink(abs);
      log.info('[attachment:delete] 附件已删除:', filePath);
      return true;
    } catch (e: any) {
      // 文件已不存在视为成功（幂等）
      if (e.code === 'ENOENT') return true;
      throw e;
    }
  }, { moduleName: 'attachment' }));
}
