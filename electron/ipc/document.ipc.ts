import { ipcMain } from 'electron';
import * as path from 'path';
import { wrap } from '../utils/ipc-wrapper';
import { validateDataPath } from '../utils/path-resolver';
import { extractTextFromFile } from '../utils/text-extract';

export function registerDocumentHandlers(): void {
  ipcMain.handle('document:extractText', wrap(async (_event, params: { filePaths: string[] }) => {
    const results: { name: string; content: string }[] = [];
    for (const filePath of params.filePaths) {
      // 校验路径，防止读取应用数据目录之外的任意文件
      const resolvedPath = await validateDataPath(filePath);
      const fileName = path.basename(resolvedPath);
      const content = await extractTextFromFile(resolvedPath);
      results.push({ name: fileName, content });
    }
    return results;
  }, { moduleName: 'document' }));
}
