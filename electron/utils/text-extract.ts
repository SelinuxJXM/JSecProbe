import * as fs from 'fs';

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

export function extractExcelText(filePath: string): string {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    const lines = rows.map((row: any[]) => row.map((cell: any) => String(cell ?? '')).join('\t'));
    parts.push(`[工作表: ${sheetName}]\n${lines.join('\n')}`);
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
