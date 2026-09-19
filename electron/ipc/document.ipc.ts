import { ipcMain } from 'electron';
import * as path from 'path';
import { wrap } from '../utils/ipc-wrapper';
import { validateReadablePath } from '../utils/path-resolver';
import { extractTextFromFile } from '../utils/text-extract';

export function registerDocumentHandlers(): void {
  ipcMain.handle('document:extractText', wrap(async (_event, params: { filePaths: string[] }) => {
    const results: { name: string; content: string }[] = [];
    for (const filePath of params.filePaths) {
      // 只读场景：受管数据目录内，或本次会话用户亲手挑选的文件（后者免拷贝、
      // 不留档，避免数据目录随每次批量分析持续增长）。穿越防护在校验函数内部。
      const resolvedPath = await validateReadablePath(filePath);
      const fileName = path.basename(resolvedPath);
      const content = await extractTextFromFile(resolvedPath);
      results.push({ name: fileName, content });
    }
    return results;
  }, { moduleName: 'document' }));
}
