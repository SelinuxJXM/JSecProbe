import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { resolvePath } from '../utils/path-resolver';
import { wrap } from '../utils/ipc-wrapper';

async function validatePath(inputPath: string): Promise<string> {
  const resolved = await resolvePath(inputPath);
  const normalized = path.resolve(resolved);
  if (normalized.includes('..')) {
    throw new Error(`路径访问被拒绝: 非法的路径格式`);
  }
  return normalized;
}

export function registerFileHandlers(): void {
  ipcMain.handle('file:exists', wrap(async (_event, filePath: string) => {
    const safePath = await validatePath(filePath);
    return fs.existsSync(safePath);
  }, 'file'));

  ipcMain.handle('file:readAsArrayBuffer', wrap(async (_event, filePath: string) => {
    const safePath = await validatePath(filePath);
    const buf = fs.readFileSync(safePath);
    return Array.from(buf);
  }, 'file'));

  ipcMain.handle('file:readAsText', wrap(async (_event, filePath: string, encoding?: string) => {
    const safePath = await validatePath(filePath);
    return fs.readFileSync(safePath, (encoding as BufferEncoding) || 'utf-8');
  }, 'file'));
}
