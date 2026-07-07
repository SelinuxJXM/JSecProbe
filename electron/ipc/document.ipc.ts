import { ipcMain } from 'electron';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true, data }))
    .catch((error) => {
      log.error('Document IPC Error:', error);
      return {
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      };
    });
}

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
  ipcMain.handle('document:extractText', (_event, params: { filePaths: string[] }) =>
    wrap(async () => {
      const results: { name: string; content: string }[] = [];
      for (const filePath of params.filePaths) {
        const fileName = path.basename(filePath);
        const lower = filePath.toLowerCase();
        let content = '';
        if (lower.endsWith('.pdf')) {
          content = await extractPdfText(filePath);
        } else if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
          content = await extractWordText(filePath);
        }
        results.push({ name: fileName, content });
      }
      return results;
    })
  );
}