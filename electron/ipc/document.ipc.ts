import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { wrap } from '../utils/ipc-wrapper';
import { validateDataPath } from '../utils/path-resolver';

async function extractPdfText(filePath: string): Promise<string> {
  const pdfParse = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text || '';
}

async function extractWordText(filePath: string): Promise<string> {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

export function registerDocumentHandlers(): void {
  ipcMain.handle('document:extractText', wrap(async (_event, params: { filePaths: string[] }) => {
    const results: { name: string; content: string }[] = [];
    for (const filePath of params.filePaths) {
      // 校验路径，防止读取应用数据目录之外的任意文件
      const resolvedPath = await validateDataPath(filePath);
      const fileName = path.basename(resolvedPath);
      const lower = resolvedPath.toLowerCase();
      let content = '';
      if (lower.endsWith('.pdf')) {
        content = await extractPdfText(resolvedPath);
      } else if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
        content = await extractWordText(resolvedPath);
      } else if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
        content = fs.readFileSync(resolvedPath, 'utf-8');
      }
      results.push({ name: fileName, content });
    }
    return results;
  }, { moduleName: 'document' }));
}