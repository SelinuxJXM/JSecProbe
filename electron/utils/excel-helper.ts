import ExcelJS from 'exceljs';

export function getCellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toLocaleDateString('zh-CN');
  if (typeof v === 'object' && 'text' in v) return (v as any).text || '';
  if (typeof v === 'object' && 'richText' in v) return (v as any).richText.map((r: any) => r.text).join('');
  if (typeof v === 'object' && 'hypertext' in v) return (v as any).hypertext || '';
  if (typeof v === 'object' && 'formula' in v) return String((v as any).result ?? '');
  if (Array.isArray(v)) return v.map(x => x?.text ?? x?.hypertext ?? '').join('');
  return String(v);
}

export function calcRowHeight(cellText: string, colWidthChars: number, lineHeight = 20): number {
  const baseHeight = 60;
  if (!cellText) return baseHeight;
  const lines: string[] = [];
  const rawLines = cellText.split(/\r?\n/);
  const minWrapChars = 2;
  for (const rl of rawLines) {
    if (rl.length === 0) { lines.push(''); continue; }
    const charsPerLine = Math.max(minWrapChars, Math.floor(colWidthChars * 1.6));
    for (let i = 0; i < rl.length; i += charsPerLine) {
      lines.push(rl.substring(i, i + charsPerLine));
    }
  }
  const contentHeight = lines.length * lineHeight + 10;
  return Math.max(baseHeight, contentHeight);
}

export function getRowMaxHeight(row: ExcelJS.Row, cols: number[], worksheet: ExcelJS.Worksheet): number {
  let maxH = 0;
  for (const ci of cols) {
    const cell = row.getCell(ci);
    const text = getCellText(cell);
    const col = worksheet.getColumn(ci);
    const wch = (col && col.width) ? Number(col.width) : 10;
    const h = calcRowHeight(text, wch);
    if (h > maxH) maxH = h;
  }
  return maxH;
}

export function styleCell(
  cell: ExcelJS.Cell,
  opts: {
    bold?: boolean;
    fontSize?: number;
    fontColor?: string;
    bgColor?: string;
    alignH?: 'left' | 'center' | 'right';
    alignV?: 'top' | 'middle' | 'bottom';
    wrapText?: boolean;
    border?: 'thin' | 'medium';
  } = {},
) {
  const {
    bold = false,
    fontSize = 11,
    fontColor = 'FF000000',
    bgColor,
    alignH = 'left',
    alignV = 'top',
    wrapText = true,
    border = 'thin',
  } = opts;

  cell.font = { bold, size: fontSize, color: { argb: fontColor } };
  if (bgColor) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
  }
  cell.alignment = { horizontal: alignH, vertical: alignV, wrapText };
  if (border === 'thin') {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
      right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
    };
  } else if (border === 'medium') {
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF808080' } },
      left: { style: 'medium', color: { argb: 'FF808080' } },
      bottom: { style: 'medium', color: { argb: 'FF808080' } },
      right: { style: 'medium', color: { argb: 'FF808080' } },
    };
  }
}
