import ExcelJS from 'exceljs';

// ====================== JSecProbe Excel 主题样式常量（下载模板 & 标准导出共用）======================
// 说明：颜色全部 8 位 ARGB（前两位 FF=不透明），统一一个主色可同时修改两套导出的视觉风格。
export const PROBE_THEME = {
  brandDark: 'FF1F4E79',       // 品牌深蓝：主标题/一级区块标题
  brandMid: 'FF2E75B6',        // 品牌中蓝：二级说明/表头
  brandLight: 'FF5B8FF9',      // 品牌亮蓝：域表表头/筛选条
  brandBlueText: 'FF153E75',   // 标题蓝色文字
  bgSoft: 'FFF2F7FC',          // 浅蓝交替底色（K/V 奇数行 / 信息组）
  bgMint: 'FFEAF7F0',          // 浅绿（作用域/成功提示）
  bgRose: 'FFF4EB',            // 暖橙底（模板示例行）
  bgAmber: 'FFFDF3E0',         // 杏色（模板示例次底色，保留原熟悉视觉）
  bgWarning: 'FFFDE7E6',       // 浅红（高风险行）
  bgEmpty: 'FFF0F8FF',       // 空域/占位说明行
  white: 'FFFFFFFF',
  black: 'FF000000',
  textOnBrand: 'FFD8E2F0',   // 深蓝横幅上的浅色副标题文字
  textPrimary: 'FF1B2A4A',     // 正文字
  textSecondary: 'FF5A6B8A',   // 备注/说明灰蓝文字
  textRequired: 'FFD94437',    // 必填红
  textMuted: 'FF7A8599',       // 次要/示例灰
  borderMuted: 'FFD7E0EC',     // 次级边框：与浅蓝交替行融合
  borderBase: 'FFB8C5D6',      // 基础边框
  borderStrong: 'FF8FA3BF',    // 粗边框
};

// 边框预设
export const BORDER_THIN = {
  top: { style: 'thin' as const, color: { argb: PROBE_THEME.borderBase } },
  left: { style: 'thin' as const, color: { argb: PROBE_THEME.borderBase } },
  bottom: { style: 'thin' as const, color: { argb: PROBE_THEME.borderBase } },
  right: { style: 'thin' as const, color: { argb: PROBE_THEME.borderBase } },
};
export const BORDER_MUTED = {
  top: { style: 'thin' as const, color: { argb: PROBE_THEME.borderMuted } },
  left: { style: 'thin' as const, color: { argb: PROBE_THEME.borderMuted } },
  bottom: { style: 'thin' as const, color: { argb: PROBE_THEME.borderMuted } },
  right: { style: 'thin' as const, color: { argb: PROBE_THEME.borderMuted } },
};
export const BORDER_MEDIUM = {
  top: { style: 'medium' as const, color: { argb: PROBE_THEME.borderStrong } },
  left: { style: 'medium' as const, color: { argb: PROBE_THEME.borderStrong } },
  bottom: { style: 'medium' as const, color: { argb: PROBE_THEME.borderStrong } },
  right: { style: 'medium' as const, color: { argb: PROBE_THEME.borderStrong } },
};

// 列索引 → Excel 字母（0-based）
export function colLetter(n: number): string {
  let s = '';
  let x = Math.max(0, Math.floor(Number(n) || 0));
  while (x >= 0) { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; }
  return s;
}

// 对一行的指定列范围统一应用边框
export function applyRowBorder(row: ExcelJS.Row, fromCol: number, toCol: number, border = BORDER_THIN) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = row.getCell(c);
    cell.border = border;
  }
}

// 单元格快速样式（对已有 styleCell 做高阶包装，保留原函数签名兼容）
export function titleCell(cell: ExcelJS.Cell, fontSize = 20, color = PROBE_THEME.brandDark) {
  cell.font = { bold: true, size: fontSize, color: { argb: color }, name: '微软雅黑' };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
}

export function subtitleCell(cell: ExcelJS.Cell, fontSize = 11) {
  cell.font = { size: fontSize, color: { argb: PROBE_THEME.textSecondary }, name: '微软雅黑' };
  cell.alignment = { vertical: 'middle', wrapText: true };
}

// 标准标题横幅：合并 [row,fromCol]-[row,toCol]，写标题文字 + 副标题（并入同一单元格，去掉独立副行）
export function addTitleBanner(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: number,
  title: string,
  subtitle?: string,
  opts: { bgColor?: string; titleColor?: string; subtitleColor?: string; titleSize?: number } = {},
) {
  const toCol = Math.max(1, cols);
  if (toCol > 1) ws.mergeCells(row, 1, row, toCol);
  const cell = ws.getCell(row, 1);
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bgColor ?? PROBE_THEME.brandDark } };
  if (subtitle) {
    cell.value = {
      richText: [
        { text: title + '\n', font: { bold: true, size: opts.titleSize ?? 20, color: { argb: opts.titleColor ?? PROBE_THEME.white }, name: '微软雅黑' } },
        { text: subtitle, font: { size: 10.5, color: { argb: opts.subtitleColor ?? PROBE_THEME.textOnBrand }, name: '微软雅黑' } },
      ],
    };
  } else {
    cell.value = title;
    cell.font = { bold: true, size: opts.titleSize ?? 20, color: { argb: opts.titleColor ?? PROBE_THEME.white }, name: '微软雅黑' };
  }
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 2 };
  ws.getRow(row).height = subtitle ? 46 : 36;
  return { titleRow: row, height: 1 };
}

// 一组区块标题：合并 + 左侧色条
export function addSectionHeader(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: number,
  text: string,
  tag?: string,
) {
  const toCol = Math.max(2, cols);
  if (toCol > 1) ws.mergeCells(row, 1, row, toCol);
  const cell = ws.getCell(row, 1);
  // 左侧色条（ExcelJS 没 native side-bar，用纯色 + 顶部加粗边框模拟）
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROBE_THEME.bgSoft } };
  cell.font = { bold: true, size: 12, color: { argb: PROBE_THEME.brandDark }, name: '微软雅黑' };
  cell.alignment = { vertical: 'middle', indent: 1 };
  cell.value = tag ? `【${tag}】 ${text}` : text;
  cell.border = {
    top: { style: 'medium', color: { argb: PROBE_THEME.brandMid } },
    left: { style: 'thick', color: { argb: PROBE_THEME.brandMid } },
    bottom: { style: 'thin', color: { argb: PROBE_THEME.borderMuted } },
    right: { style: 'thin', color: { argb: PROBE_THEME.borderMuted } },
  };
  ws.getRow(row).height = 26;
  return row;
}

// 表头行：深蓝底白字 + 居中 + 冻结 + 可选筛选器
export function styleHeaderRow(
  ws: ExcelJS.Worksheet,
  row: ExcelJS.Row,
  cols: number,
  opts: { bg?: string; color?: string; withFilter?: boolean; height?: number } = {},
) {
  const bg = opts.bg ?? PROBE_THEME.brandLight;
  const color = opts.color ?? PROBE_THEME.white;
  row.font = { bold: true, size: 11, color: { argb: color }, name: '微软雅黑' };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  row.height = opts.height ?? 30;
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.border = {
      top: { style: 'medium', color: { argb: PROBE_THEME.brandMid } },
      left: { style: 'thin', color: { argb: PROBE_THEME.brandMid } },
      bottom: { style: 'medium', color: { argb: PROBE_THEME.brandMid } },
      right: { style: 'thin', color: { argb: PROBE_THEME.brandMid } },
    };
  }
  if (opts.withFilter) {
    ws.autoFilter = { from: { row: row.number, column: 1 }, to: { row: row.number, column: cols } };
  }
}

// 数据行：斑马纹 + 边框 + 垂直居中；返回这行是否"染色行"
export function stripeRow(
  row: ExcelJS.Row,
  cols: number,
  index: number,
  opts: {
    oddBg?: string;
    evenBg?: string;
    alignCenters?: number[]; // 需要居中的列索引（1-based）
    wrapCol?: number;        // 需要换行的列（1-based）
    rowHeight?: number;
  } = {},
): boolean {
  const odd = (index & 1) === 0;
  const bg = odd ? (opts.oddBg ?? PROBE_THEME.white) : (opts.evenBg ?? PROBE_THEME.bgSoft);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    cell.border = BORDER_MUTED;
    cell.font = { size: 10.5, color: { argb: PROBE_THEME.textPrimary }, name: '微软雅黑' };
    cell.alignment = { vertical: 'middle', wrapText: !!opts.wrapCol && c === opts.wrapCol, horizontal: 'left' };
  }
  if (opts.alignCenters) {
    for (const c of opts.alignCenters) {
      const cell = row.getCell(c);
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  }
  if (opts.wrapCol) {
    const c = row.getCell(opts.wrapCol);
    c.alignment = { vertical: 'top', wrapText: true };
  }
  if (opts.rowHeight) row.height = opts.rowHeight;
  return odd;
}

// 必填标识：在表头某格右侧/下方拼入红色星
export function markRequiredHeaderCell(cell: ExcelJS.Cell, baseText: string) {
  cell.value = {
    richText: [
      { text: baseText, font: { bold: true, size: 11, color: { argb: PROBE_THEME.white }, name: '微软雅黑' } },
      { text: ' *', font: { bold: true, size: 12, color: { argb: 'FFFFB0A0' }, name: '微软雅黑' } },
    ],
  };
}

// 画一个"信息卡片"行：浅蓝背景 + 左侧色条（用于 info sheet 的数值行强调）
export function infoKeyValueRows(ws: ExcelJS.Worksheet, startRow: number, rows: Array<[string, any]>, cols = 2) {
  let r = startRow;
  for (const [k, vRaw] of rows) {
    const isEven = (r - startRow) & 1;
    const kCell = ws.getCell(r, 1);
    const vCell = ws.getCell(r, 2);
    kCell.value = k;
    vCell.value = vRaw == null ? '-' : String(vRaw);
    const bg = isEven ? PROBE_THEME.bgSoft : PROBE_THEME.white;
    kCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    kCell.font = { bold: true, size: 11, color: { argb: PROBE_THEME.brandBlueText }, name: '微软雅黑' };
    vCell.font = { size: 11, color: { argb: PROBE_THEME.textPrimary }, name: '微软雅黑' };
    kCell.alignment = { vertical: 'middle', indent: 1 };
    vCell.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    kCell.border = BORDER_MUTED;
    vCell.border = BORDER_MUTED;
    // 3 列及以上时：把第 3..cols 列也铺底色 + 边框，保证分区块视觉"整行"是一整片
    if (cols > 2) {
      for (let c = 3; c <= cols; c++) {
        const extra = ws.getCell(r, c);
        extra.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        extra.border = BORDER_MUTED;
      }
    }
    ws.getRow(r).height = 22;
    r++;
  }
  return r;
}

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
  // 中文字符：Excel 一个"列宽 1" ≈ 1 个英文字符 ≈ 0.55 个中文字符，所以每列实际能放的"视觉字符数"要按宽度折算。
  const minWrapChars = 4;
  const charsPerLine = Math.max(minWrapChars, Math.floor(colWidthChars * 1.7));
  for (const rl of rawLines) {
    if (rl.length === 0) { lines.push(''); continue; }
    // 中英混合按字符计数逐段切（避免把 1.6 系数后的边界卡到单个英文字母）
    let w = 0;
    let buf = '';
    const flush = () => { if (buf.length) { lines.push(buf); buf = ''; w = 0; } };
    for (const ch of rl) {
      const cw = /[\u3400-\u9FFF\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1.9 : 1;
      if (w + cw > charsPerLine) { flush(); }
      buf += ch;
      w += cw;
    }
    flush();
  }
  const contentHeight = lines.length * lineHeight + 12;
  return Math.max(baseHeight, Math.min(360, contentHeight));
}

/**
 * 自动按"最宽单元格内容（含表头/每行）"调整列宽；再按行内最"高"列（按 wrap 后的折行数）算每行高度。
 * 专为标准导出 & 模板设计：中文字符折算成 1.9 宽、英文 1 宽，避免中文列"明明够宽还是折很多行"。
 * 调用时机：写完一张 sheet 所有单元格之后再调用一次。
 */
export function autoFitSheet(
  ws: ExcelJS.Worksheet,
  opts: {
    headerRows?: number;       // 前 N 行是标题/横幅，不参与行高，但参与列宽
    wrapColumns?: number[];    // 1-based，需要"按列宽折行"的列（如要求列）；折行数越多行高越高
    minWidths?: Record<number, number>;  // 最小列宽（1-based -> width）
    maxWidths?: Record<number, number>;  // 最大列宽（超了就保留默认最大，让它换行）
    defaultMinWidth?: number;
    defaultMaxWidth?: number;
    maxRowHeight?: number;
    minRowHeight?: number;
  } = {},
) {
  const headerRows = opts.headerRows ?? 0;
  const wrapSet = new Set(opts.wrapColumns ?? []);
  const minW = opts.minWidths ?? {};
  const maxW = opts.maxWidths ?? {};
  const defaultMin = opts.defaultMinWidth ?? 6;
  const defaultMax = opts.defaultMaxWidth ?? 110;
  const maxRH = opts.maxRowHeight ?? 360;
  const minRH = opts.minRowHeight ?? 24;
  const colMax: Record<number, number> = {};
  const rowMax: Record<number, number> = {};
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = getCellText(cell);
      // 列宽估算：中文 1.9 / 英文 1 / 数字 1
      let w = 0;
      for (const ch of text) {
        w += /[\u3400-\u9FFF\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1.9 : 1;
      }
      // 额外 padding 2 字符（Excel 有留白）
      const visualW = Math.ceil(w) + 2;
      colMax[colNumber] = Math.max(colMax[colNumber] ?? 0, visualW);
      // 行高：只对 wrapColumns 列做折行数估算，取该行最高的
      if (rowNumber > headerRows && wrapSet.has(colNumber)) {
        const col = ws.getColumn(colNumber);
        const existingW = col && col.width ? col.width : (minW[colNumber] ?? defaultMin);
        const effColW = Math.max(existingW, colMax[colNumber] ?? 0);
        const h = calcRowHeight(text, effColW);
        rowMax[rowNumber] = Math.max(rowMax[rowNumber] ?? 0, h);
      }
    });
  });
  // 应用列宽（夹到 min/max）
  Object.keys(colMax).forEach(k => {
    const c = Number(k);
    const col = ws.getColumn(c);
    if (!col) return;
    const lower = Math.max(defaultMin, minW[c] ?? defaultMin);
    const upper = Math.min(defaultMax, maxW[c] ?? defaultMax);
    const w = Math.min(upper, Math.max(lower, colMax[c], col.width ?? lower));
    col.width = Math.max(lower, w);
  });
  // 确保每列都有最小宽度
  for (let c = 1; c <= ws.columnCount; c++) {
    const col = ws.getColumn(c);
    if (!col || col.width == null || col.width < (minW[c] ?? defaultMin)) {
      col.width = Math.max(defaultMin, minW[c] ?? defaultMin);
    }
    if (maxW[c] != null && (col.width ?? 0) > maxW[c]) col.width = maxW[c];
  }
  // 应用行高（夹到 min/max）
  Object.keys(rowMax).forEach(k => {
    const r = Number(k);
    const row = ws.getRow(r);
    if (!row) return;
    const want = Math.min(maxRH, Math.max(minRH, rowMax[r], row.height ? Number(row.height) : minRH));
    row.height = want;
  });
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
