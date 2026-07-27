import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import crypto from 'crypto';
import { wrap } from '../utils/ipc-wrapper';
import { getAppDataPath } from '../main/paths';
import { toRelativePath, resolvePath } from '../utils/path-resolver';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_TEXT_SIZE = 1 * 1024 * 1024;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.md', '.txt', '.csv'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.log', '.csv', '.xml', '.html', '.css', '.js', '.ts'];

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

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
};

function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

export function registerScreenshotHandlers(): void {
  ipcMain.handle('screenshot:upload', wrap(async (_event, { projectId, itemId, filePath }: { projectId: string; itemId: string; filePath: string }) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('文件路径无效');
    }
    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在: ' + filePath);
    }
    if (fs.statSync(filePath).size > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    const appDataPath = await getAppDataPath();
    const screenshotsDir = path.join(appDataPath, 'screenshots', projectId, itemId);
    fs.mkdirSync(screenshotsDir, { recursive: true });

    const ext = path.extname(filePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error(`不支持的文件类型: ${ext}`);
    }

    const buffer = fs.readFileSync(filePath);
    if (!isValidImage(buffer, ext)) {
      throw new Error('文件内容不是有效的图片格式');
    }

    const fileHash = crypto.createHash('md5').update(buffer).digest('hex');
    const existingFiles = fs.readdirSync(screenshotsDir);
    for (const existing of existingFiles) {
      const existingPath = path.join(screenshotsDir, existing);
      if (fs.statSync(existingPath).isFile()) {
        const existingHash = crypto.createHash('md5').update(fs.readFileSync(existingPath)).digest('hex');
        if (existingHash === fileHash) {
          const relativePath = await toRelativePath(existingPath);
          return { path: relativePath, name: existing };
        }
      }
    }

    const baseName = path.basename(filePath, ext);
    const targetName = `${baseName}_${Date.now()}${ext}`;
    const targetPath = path.join(screenshotsDir, targetName);

    fs.copyFileSync(filePath, targetPath);

    const relativePath = await toRelativePath(targetPath);
    return { path: relativePath, name: targetName };
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('screenshot:saveFromBase64', wrap(async (_event, { projectId, itemId, base64Data }: { projectId: string; itemId: string; base64Data: string }) => {
    log.info('screenshot:saveFromBase64 called', { projectId, itemId, base64Length: base64Data?.length });

    const appDataPath = await getAppDataPath();
    const screenshotsDir = path.join(appDataPath, 'screenshots', projectId, itemId);
    fs.mkdirSync(screenshotsDir, { recursive: true });

    const targetName = `clipboard_${Date.now()}.png`;
    const targetPath = path.join(screenshotsDir, targetName);

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    if (!isValidImage(buffer, '.png')) {
      throw new Error('无效的图片数据');
    }

    fs.writeFileSync(targetPath, buffer);

    const relativePath = await toRelativePath(targetPath);
    log.info('screenshot saved to:', relativePath, 'size:', buffer.length);

    return { path: relativePath, name: targetName };
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('screenshot:uploadFile', wrap(async (_event, { projectId, itemId, filePath }: { projectId: string; itemId: string; filePath: string }) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('文件路径无效');
    }
    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在: ' + filePath);
    }
    if (fs.statSync(filePath).size > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!DOCUMENT_EXTENSIONS.includes(ext)) {
      throw new Error(`不支持的文件类型: ${ext} (仅支持: ${DOCUMENT_EXTENSIONS.join(', ')})`);
    }

    const appDataPath = await getAppDataPath();
    const evidenceDir = path.join(appDataPath, 'evidence', projectId, itemId);
    fs.mkdirSync(evidenceDir, { recursive: true });

    const buffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('md5').update(buffer).digest('hex');
    const existingFiles = fs.readdirSync(evidenceDir);
    for (const existing of existingFiles) {
      const existingPath = path.join(evidenceDir, existing);
      if (fs.statSync(existingPath).isFile()) {
        const existingHash = crypto.createHash('md5').update(fs.readFileSync(existingPath)).digest('hex');
        if (existingHash === fileHash) {
          const relativePath = await toRelativePath(existingPath);
          return { path: relativePath, name: existing };
        }
      }
    }

    const fileName = path.basename(filePath);
    const targetName = `${Date.now()}_${fileName}`;
    const targetPath = path.join(evidenceDir, targetName);

    fs.copyFileSync(filePath, targetPath);

    const relativePath = await toRelativePath(targetPath);
    return { path: relativePath, name: targetName };
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('screenshot:getBase64', wrap(async (_event, { filePath }: { filePath: string }) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('文件路径无效');
    }

    const resolvedPath = await resolvePath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('文件不存在: ' + filePath);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    const buffer = fs.readFileSync(resolvedPath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = getMimeType(ext);

    return { base64, mimeType };
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('screenshot:readText', wrap(async (_event, { filePath }: { filePath: string }) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('文件路径无效');
    }

    const resolvedPath = await resolvePath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('文件不存在: ' + filePath);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!TEXT_EXTENSIONS.includes(ext)) {
      throw new Error(`不支持的文件类型: ${ext} (仅支持: ${TEXT_EXTENSIONS.join(', ')})`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_TEXT_SIZE) {
      throw new Error(`文件过大 (${Math.round(stat.size / 1024)}KB)，文本预览限制 ${MAX_TEXT_SIZE / 1024}KB`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return { content };
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('screenshot:readWord', wrap(async (_event, { filePath }: { filePath: string }) => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('文件路径无效');
    }

    const resolvedPath = await resolvePath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('文件不存在: ' + filePath);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext !== '.doc' && ext !== '.docx') {
      throw new Error(`不支持的文件类型: ${ext} (仅支持: .doc, .docx)`);
    }

    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: resolvedPath });
      return { content: result.value || '' };
    } catch (err: any) {
      throw new Error(`Word文档解析失败: ${err.message || '未知错误'}`);
    }
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('screenshot:deleteFile', wrap(async (_event, { filePath }: { filePath: string }) => {
    const resolvedPath = await resolvePath(filePath);
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
    return { success: true };
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('image:saveScreenshot', wrap(async (_event, base64Data: string, fileName: string) => {
    const appDataPath = await getAppDataPath();
    const tempDir = path.join(appDataPath, 'screenshots', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });

    const targetPath = path.join(tempDir, fileName);
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    if (!isValidImage(buffer, '.png')) {
      throw new Error('无效的图片数据');
    }

    fs.writeFileSync(targetPath, buffer);

    const relativePath = await toRelativePath(targetPath);
    return { filePath: relativePath, fileName };
  }, { moduleName: 'screenshot' }));
}
