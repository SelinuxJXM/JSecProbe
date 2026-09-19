import ExcelJS from 'exceljs';

export interface ExcelSheetData {
  name: string;
  rows: any[][];
}

/**
 * 将 ExcelJS 的单元格值归一化为「可直接入库的标量」。
 *
 * ExcelJS 不会对单元格做自动求值/展开，直接把 cell.value 交给下游会得到：
 * - 公式单元格 → { formula, result } 对象
 * - 富文本单元格 → { richText: [{ text, font }] } 数组
 * - 超链接单元格 → { text, hyperlink } 对象
 * - 错误单元格 → { error: '#N/A' }
 * 这些都会让字段变成 "[object Object]" 或空值，属于静默写坏数据。
 */
function normalizeCellValue(value: any): any {
  if (value == null) return null;

  // 公式 / 共享公式：优先取已缓存的计算结果，否则退回公式文本本身
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    const result = (value as any).result;
    if (result != null && typeof result === 'object' && 'error' in result) {
      return null; // 公式计算出错误值，按空处理
    }
    return result != null ? normalizeCellValue(result) : null;
  }

  // 富文本：拼接各片段文本
  if (typeof value === 'object' && Array.isArray((value as any).richText)) {
    return (value as any).richText.map((r: any) => String(r?.text ?? '')).join('') || null;
  }

  // 超链接单元格：取显示文本
  if (typeof value === 'object' && 'text' in value && 'hyperlink' in value) {
    return (value as any).text ?? null;
  }

  // 错误单元格
  if (typeof value === 'object' && 'error' in value) {
    return null;
  }

  // 日期：保持 Date 实例，由调用方按需格式化
  if (value instanceof Date) return value;

  return value;
}

function assertXlsx(filePath: string): void {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.xls')) {
    throw new Error('暂不支持 .xls 老格式，请将文件另存为 .xlsx 后重试');
  }
}

/**
 * 读取 .xlsx 所有工作表为二维数组（0-based，语义兼容 SheetJS 的 sheet_to_json(header:1)）。
 * 空单元格填充 null，调用方按需 String(cell ?? '')。
 */
export async function readExcelSheets(filePath: string): Promise<ExcelSheetData[]> {
  assertXlsx(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: ExcelSheetData[] = [];
  for (const ws of workbook.worksheets) {
    const rows: any[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = (row.values as any[]).slice(1).map(normalizeCellValue);
      rows.push(values);
    });
    sheets.push({ name: ws.name, rows });
  }
  return sheets;
}

/**
 * 读取 .xlsx 指定工作表（缺省第一个）为对象数组（第一行为表头，语义兼容 SheetJS 的 sheet_to_json）。
 */
export async function readExcelAsObjects(filePath: string, sheetName?: string): Promise<any[]> {
  assertXlsx(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const ws = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!ws) return [];

  const rows: any[] = [];
  let headers: string[] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = (row.values as any[]).slice(1).map(normalizeCellValue);
    if (rowNumber === 1) {
      headers = values.map((v) => (v == null ? '' : String(v).trim()));
      return;
    }
    const obj: Record<string, any> = {};
    let hasValue = false;
    headers.forEach((h, i) => {
      const v = values[i] ?? '';
      obj[h] = v;
      if (v !== '' && v != null) hasValue = true;
    });
    // 跳过全空行，保持与 SheetJS sheet_to_json 一致，避免下游插入空记录
    if (!hasValue) return;
    rows.push(obj);
  });
  return rows;
}