import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import { wrap } from '../utils/ipc-wrapper';
import { getAppDataPath } from '../main/paths';
import { toRelativePath } from '../utils/path-resolver';

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.md', '.txt', '.csv', '.log', '.json', '.xml', '.html', '.css', '.js', '.ts'];

const IMAGE_MAGIC_NUMBERS: Record<string, Buffer> = {
  '.png': Buffer.from([0x89, 0x50, 0x4E, 0x47]),
  '.jpg': Buffer.from([0xFF, 0xD8, 0xFF]),
  '.jpeg': Buffer.from([0xFF, 0xD8, 0xFF]),
  '.gif': Buffer.from([0x47, 0x49, 0x46, 0x38]),
  '.bmp': Buffer.from([0x42, 0x4D]),
  '.webp': Buffer.from([0x52, 0x49, 0x46, 0x46]),
};

function isValidImage(buffer: Buffer, ext: string): boolean {
  const magic = IMAGE_MAGIC_NUMBERS[ext];
  if (!magic) return false;
  return buffer.subarray(0, magic.length).equals(magic);
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
    if (isImage && !isValidImage(buffer, ext)) {
      throw new Error('无效的图片数据');
    }

    const appDataPath = await getAppDataPath();
    const attachmentDir = path.join(appDataPath, 'ai-chat-attachments');
    fs.mkdirSync(attachmentDir, { recursive: true });

    const sanitized = name.replace(/[<>:"|?*\x00-\x1f]/g, '_');
    const targetName = `${Date.now()}_${sanitized}`;
    const targetPath = path.join(attachmentDir, targetName);
    fs.writeFileSync(targetPath, buffer);

    const relativePath = await toRelativePath(targetPath);
    log.info('[attachment:save] 附件已保存:', relativePath, 'size:', buffer.length);

    return { path: relativePath, name: sanitized, size: buffer.length, type: isImage ? 'image' : 'document' };
  }, { moduleName: 'attachment' }));
}
