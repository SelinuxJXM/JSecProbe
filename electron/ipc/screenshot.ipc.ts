import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import crypto from 'crypto';
import { wrap } from '../utils/ipc-wrapper';
import { getAppDataPath } from '../main/paths';
import { toRelativePath, validateDataPath, resolvePath } from '../utils/path-resolver';


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

/**
 * 模糊匹配文件：如果精确路径不存在，在同目录下查找同名（去时间戳后缀）的文件
 * 例：Snipaste_xxx_1785481868917.jpg -> 在同目录查找 Snipaste_xxx_*.jpg
 */
function findFuzzyMatch(filePath: string): string | null {
  try {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const ext = path.extname(baseName);
    const nameWithoutExt = path.basename(baseName, ext);

    // 提取时间戳后缀：匹配文件名末尾的 _\d{13} 或 _\d{10}
    // 例：Snipaste_2026-06-17_12-24-22_1785481868917 -> 时间戳 1785481868917
    const match = nameWithoutExt.match(/^(.+?)_(\d{10,13})$/);
    if (!match) return null;

    const basePrefix = match[1]; // 不含时间戳的文件名主体

    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir);
    // 优先匹配最近的（按文件修改时间倒序）
    const candidates = files
      .filter(f => f.startsWith(basePrefix + '_') && f.endsWith(ext))
      .map(f => ({
        name: f,
        fullPath: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (candidates.length > 0) {
      return candidates[0].fullPath;
    }
  } catch (err) {
    log.warn('[findFuzzyMatch] 模糊匹配失败:', err);
  }
  return null;
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

function validateId(id: string, name: string): void {
  if (!id || typeof id !== 'string') {
    throw new Error(`${name}无效`);
  }
  if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    throw new Error(`${name}包含非法字符`);
  }
}

/**
 * 解析用户通过文件对话框显式选择的文件：仅做路径归一化与穿越防护，
 * 不强制位于应用数据目录内（用户已主动选择，读取属合理行为）。
 * 用于 getBase64 / readText / readWord 等预览场景；
 * 注意：删除类操作（screenshot:deleteFile）仍使用 validateDataPath 受管目录限制。
 */
async function resolveUserFilePath(inputPath: string): Promise<string> {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('路径无效');
  }
  const resolved = await resolvePath(inputPath);
  const normalized = path.resolve(resolved);
  if (normalized.includes('..')) {
    throw new Error('路径访问被拒绝: 非法的路径格式');
  }
  return normalized;
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

    validateId(projectId, '项目ID');
    validateId(itemId, '测评项ID');

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

    validateId(projectId, '项目ID');
    validateId(itemId, '测评项ID');

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

    validateId(projectId, '项目ID');
    validateId(itemId, '测评项ID');

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
      throw new Error('文件无效');
    }

    let resolvedPath = await resolveUserFilePath(filePath);

    // 容错：如果精确路径不存在，尝试在同目录下按原始文件名（去时间戳）模糊匹配
    if (!fs.existsSync(resolvedPath)) {
      const fuzzyPath = findFuzzyMatch(resolvedPath);
      if (fuzzyPath) {
        log.info(`[screenshot:getBase64] 精确路径不存在，使用模糊匹配: ${resolvedPath} -> ${fuzzyPath}`);
        resolvedPath = fuzzyPath;
      } else {
        throw new Error('文件不存在: ' + filePath);
      }
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

    let resolvedPath = await resolveUserFilePath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      const fuzzyPath = findFuzzyMatch(resolvedPath);
      if (fuzzyPath) {
        log.info(`[screenshot:readText] 使用模糊匹配: ${resolvedPath} -> ${fuzzyPath}`);
        resolvedPath = fuzzyPath;
      } else {
        throw new Error('文件不存在: ' + filePath);
      }
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

    let resolvedPath = await resolveUserFilePath(filePath);
    if (!fs.existsSync(resolvedPath)) {
      const fuzzyPath = findFuzzyMatch(resolvedPath);
      if (fuzzyPath) {
        log.info(`[screenshot:readWord] 使用模糊匹配: ${resolvedPath} -> ${fuzzyPath}`);
        resolvedPath = fuzzyPath;
      } else {
        throw new Error('文件不存在: ' + filePath);
      }
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
    const resolvedPath = await validateDataPath(filePath);
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
    return { success: true };
  }, { moduleName: 'screenshot' }));

  ipcMain.handle('image:saveScreenshot', wrap(async (_event, base64Data: string, fileName: string) => {
    const appDataPath = await getAppDataPath();
    const tempDir = path.join(appDataPath, 'screenshots', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });

    const safeFileName = path.basename(fileName);
    const targetPath = path.join(tempDir, safeFileName);
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    if (!isValidImage(buffer, '.png')) {
      throw new Error('无效的图片数据');
    }

    fs.writeFileSync(targetPath, buffer);

    const relativePath = await toRelativePath(targetPath);
    return { filePath: relativePath, fileName: safeFileName };
  }, { moduleName: 'screenshot' }));
}
