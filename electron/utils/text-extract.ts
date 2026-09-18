import * as fs from 'fs';
import { readExcelSheets } from './excel-reader';

export async function extractPdfText(filePath: string): Promise<string> {
  const pdfParse = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text || '';
}

export async function extractWordText(filePath: string): Promise<string> {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

export async function extractExcelText(filePath: string): Promise<string> {
  const sheets = await readExcelSheets(filePath);
  const parts: string[] = [];
  for (const sheet of sheets) {
    const lines = sheet.rows.map((row: any[]) => row.map((cell: any) => String(cell ?? '')).join('\t'));
    parts.push(`[工作表: ${sheet.name}]\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

export async function extractTextFromFile(filePath: string): Promise<string> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return extractPdfText(filePath);
  }
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
    return extractWordText(filePath);
  }
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
    return extractExcelText(filePath);
  }
  return fs.readFileSync(filePath, 'utf-8');
}
