import ExcelJS from 'exceljs';

export interface ExcelSheetData {
  name: string;
  rows: any[][];
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
      const values = row.values as any[];
      // row.values 为 1-based，移除首位的行号占位
      values.shift();
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
    const values = (row.values as any[]).slice(1);
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