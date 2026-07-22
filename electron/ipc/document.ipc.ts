import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { wrap } from '../utils/ipc-wrapper';

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
  }, { moduleName: 'document' }));
}