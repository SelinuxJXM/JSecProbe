import { ipcMain } from 'electron';
import * as path from 'path';
import { wrap } from '../utils/ipc-wrapper';
import { validateReadablePath } from '../utils/path-resolver';
import { extractTextFromFile } from '../utils/text-extract';

export function registerDocumentHandlers(): void {
  ipcMain.handle('document:extractText', wrap(async (_event, params: { filePaths: string[] }) => {
    const results: { name: string; content: string; error?: string }[] = [];
    for (const filePath of params.filePaths) {
      // 逐文件错误隔离：单个附件失败（旧版 .doc、扫描件、路径失效等）不能
      // 让整批文档一起丢失。此前循环内无 try/catch，只要有一个 .doc 触发
      // extractTextFromFile 抛错，整个 wrap 就返回失败，其余正常文件全被前端静默丢弃。
      // 失败项仍占位返回并带 error，前端据此逐项提示并跳过空内容。
      try {
        // 只读场景：受管数据目录内，或本次会话用户亲手挑选的文件（后者免拷贝、
        // 不留档，避免数据目录随每次批量分析持续增长）。穿越防护在校验函数内部。
        const resolvedPath = await validateReadablePath(filePath);
        const fileName = path.basename(resolvedPath);
        const content = await extractTextFromFile(resolvedPath);
        results.push({ name: fileName, content });
      } catch (err: any) {
        results.push({
          name: path.basename(filePath),
          content: '',
          error: err?.message || String(err),
        });
      }
    }
    return results;
  }, { moduleName: 'document' }));
}
