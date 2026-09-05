import type { Ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { ElMessage } from 'element-plus';

// ============================================================
// 类型定义
// ============================================================

/**
 * 表格行数据类型
 */
interface TableRow {
  itemId?: string;
  conclusion?: string;
  compliance?: string;
  evidence?: string;
  screenshots?: string[];
  screenshotUrls?: Record<string, string>;
  extensionType?: string;
  [key: string]: any;
}

/**
 * window.api 对象类型（包含 screenshot 子模块）
 */
interface WindowApi {
  screenshot: {
    saveFromBase64(params: {
      projectId: string;
      itemId: string;
      base64Data: string;
    }): Promise<{
      success: boolean;
      data?: { path: string };
      error?: { message: string };
    }>;
    getBase64(params: { filePath: string }): Promise<{
      success: boolean;
      data?: { base64: string; mimeType?: string };
      error?: { message: string };
    }>;
  };
}

/**
 * 工厂函数选项接口
 */
export interface ClipboardHandlerOptions {
  /** 表格行数据 */
  tableRows: Ref<TableRow[]>;
  /** 当前行索引 */
  currentRowIndex: Ref<number>;
  /** 是否有未保存的更改 */
  hasUnsavedChanges: Ref<boolean>;
  /** 保存状态 */
  saveStatus: Ref<'idle' | 'saving' | 'saved' | 'error' | 'unsaved'>;
  /** 加载截图 DataUrl 的函数 */
  loadScreenshotDataUrl: (row: any, filePath: string) => Promise<string | null>;
  /** 防抖自动保存函数 */
  debounceAutoSave: (row: TableRow) => void;
  /** 当前路由 */
  route: RouteLocationNormalizedLoaded;
  /** window.api 对象 */
  api: WindowApi | undefined;
}

// ============================================================
// 纯函数（直接导出）
// ============================================================

/**
 * 从Excel表格HTML中提取单元格值（返回二维：行×列）
 * 用于处理从Excel复制的HTML格式数据
 */
export function parseExcelTableHTML(html: string): string[][] | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;

  const rows: string[][] = [];
  const trs = table.querySelectorAll('tr');
  for (const tr of trs) {
    const tds = tr.querySelectorAll('td, th');
    const rowCells: string[] = [];
    for (const td of tds) {
      const content = td.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      rowCells.push(content);
    }
    if (rowCells.length > 0) rows.push(rowCells);
  }
  return rows.length > 0 ? rows : null;
}

/**
 * 解析纯文本粘贴为二维数组（支持 Tab 分隔的多列）
 */
export function parsePlainText(text: string): string[][] {
  return text.split(/\r\n|\r|\n/).filter(line => line.trim() !== '').map(line => line.split('\t'));
}

// ============================================================
// 符合性文本映射
// ============================================================

/**
 * 符合性文本到值的映射
 */
export const COMPLIANCE_TEXT_MAP: Record<string, string> = {
  '符合': 'conform',
  'conform': 'conform',
  '部分符合': 'partial',
  '部分': 'partial',
  'partial': 'partial',
  '不符合': 'nonconform',
  '不合规': 'nonconform',
  'nonconform': 'nonconform',
  '不适用': 'na',
  'n/a': 'na',
  'na': 'na',
  '待判定': '',
  '': '',
};

/**
 * 解析符合性文本
 * @param text 原始文本
 * @returns 符合性值（conform/partial/nonconform/na/空字符串）
 */
export function parseComplianceText(text: string): string {
  const trimmed = text.trim().toLowerCase();
  for (const [key, value] of Object.entries(COMPLIANCE_TEXT_MAP)) {
    if (trimmed === key.toLowerCase()) {
      return value;
    }
  }
  // 包含匹配
  if (trimmed.includes('部分')) return 'partial';
  if (trimmed.includes('不符合') || trimmed.includes('不合规')) return 'nonconform';
  if (trimmed.includes('符合')) return 'conform';
  if (trimmed.includes('不适用') || trimmed.includes('n/a') || trimmed.includes('na')) return 'na';
  return '';
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建剪贴板处理函数集合
 * @param options 依赖项配置
 * @returns 剪贴板处理函数集合
 */
export function createClipboardHandler(options: ClipboardHandlerOptions) {
  const {
    tableRows,
    currentRowIndex,
    hasUnsavedChanges,
    saveStatus,
    loadScreenshotDataUrl,
    debounceAutoSave,
    route,
    api,
  } = options;

  /**
   * 调整指定行结论 textarea 的高度（根据内容自适应）
   * @param rowIndex 行索引
   */
  function adjustConclusionHeightForRow(rowIndex: number) {
    const domRows = document.querySelectorAll('tbody tr');
    const targetTextarea = domRows[rowIndex]?.querySelector('.conclusion-box') as HTMLTextAreaElement;
    if (targetTextarea) {
      setTimeout(() => {
        targetTextarea.style.height = 'auto';
        targetTextarea.style.height = targetTextarea.scrollHeight + 2 + 'px';
      }, 0);
    }
  }

  /**
   * 处理测评结论批量粘贴（从Excel复制多行多列内容）
   * 多列时按顺序映射：第1列→结论，第2列→符合性，第3列→关键证据点
   * @param _event 粘贴事件
   * @param rowIndex 起始行索引
   */
  function handleConclusionPaste(_event: Event, rowIndex: number) {
    const clipboardData = (_event as ClipboardEvent).clipboardData;
    if (!clipboardData) return;

    let rows: string[][] = [];

    // 优先从HTML解析（Excel复制场景，能正确处理单元格内换行）
    const htmlData = clipboardData.getData('text/html');
    if (htmlData) {
      const parsed = parseExcelTableHTML(htmlData);
      if (parsed && parsed.length > 0) {
        rows = parsed;
      }
    }

    // HTML解析失败则回退到纯文本
    if (rows.length === 0) {
      const pastedText = clipboardData.getData('text');
      if (!pastedText) return;
      // 不含制表符 \t（列分隔符）时，视为单个单元格内容，整体保留其内部换行；
      // 含制表符时才按 行/列 拆成多格表格
      if (!pastedText.includes('\t')) {
        rows = [[pastedText]];
      } else {
        rows = parsePlainText(pastedText);
      }
    }

    // 阻止默认粘贴，改为显式写入目标单元格
    _event.preventDefault();

    // 单值粘贴：直接写入当前行结论列
    if (rows.length <= 1 && rows[0]?.length === 1) {
      tableRows.value[rowIndex].conclusion = rows[0][0];
      adjustConclusionHeightForRow(rowIndex);
      hasUnsavedChanges.value = true;
      saveStatus.value = 'unsaved';
      debounceAutoSave(tableRows.value[rowIndex] || {});
      return;
    }

    // 从当前行开始，批量填充内容
    const colCount = Math.max(...rows.map(r => r.length));
    const isMultiCol = colCount >= 2;

    for (let i = 0; i < rows.length; i++) {
      const targetRowIndex = rowIndex + i;
      if (targetRowIndex >= tableRows.value.length) break;

      // 第一列填充到测评结论
      if (rows[i].length > 0 && rows[i][0]) {
        tableRows.value[targetRowIndex].conclusion = rows[i][0];
        adjustConclusionHeightForRow(targetRowIndex);
      }

      // 第二列填充到符合性（如果存在）
      if (rows[i].length > 1 && rows[i][1]) {
        const complianceValue = parseComplianceText(rows[i][1]);
        tableRows.value[targetRowIndex].compliance = complianceValue;
      }

      // 第三列填充到关键证据点（如果存在）
      if (rows[i].length > 2 && rows[i][2]) {
        tableRows.value[targetRowIndex].evidence = rows[i][2];
      }
    }

    // 标记有未保存的更改并触发自动保存
    hasUnsavedChanges.value = true;
    saveStatus.value = 'unsaved';
    debounceAutoSave(tableRows.value[rowIndex] || {});

    // 显示提示
    const pastedCount = Math.min(rows.length, tableRows.value.length - rowIndex);
    const colHint = isMultiCol ? `（${Math.min(colCount, 3)}列）` : '';
    ElMessage.success(`已批量填写 ${pastedCount} 条${colHint}`);
  }

  /**
   * 处理符合性批量粘贴（从Excel复制多行多列内容）
   * 多列时按顺序映射：第1列→符合性，第2列→关键证据点
   * @param _event 粘贴事件
   * @param rowIndex 起始行索引
   */
  function handleCompliancePaste(_event: Event, rowIndex: number) {
    const clipboardData = (_event as ClipboardEvent).clipboardData;
    if (!clipboardData) return;

    let rows: string[][] = [];

    // 优先从HTML解析
    const htmlData = clipboardData.getData('text/html');
    if (htmlData) {
      const parsed = parseExcelTableHTML(htmlData);
      if (parsed && parsed.length > 0) {
        rows = parsed;
      }
    }

    // HTML解析失败则回退到纯文本
    if (rows.length === 0) {
      const pastedText = clipboardData.getData('text');
      if (!pastedText) return;
      // 不含制表符 \t（列分隔符）时，视为单个单元格内容，整体保留其内部换行；
      // 含制表符时才按 行/列 拆成多格表格
      if (!pastedText.includes('\t')) {
        rows = [[pastedText]];
      } else {
        rows = parsePlainText(pastedText);
      }
    }

    // 如果只有一个值，直接设置当前行
    if (rows.length <= 1 && rows[0]?.length === 1) {
      const value = parseComplianceText(rows[0][0]);
      tableRows.value[rowIndex].compliance = value;
      hasUnsavedChanges.value = true;
      saveStatus.value = 'unsaved';
      debounceAutoSave(tableRows.value[rowIndex] || {});
      return;
    }

    // 阻止默认粘贴
    _event.preventDefault();

    const colCount = Math.max(...rows.map(r => r.length));
    const isMultiCol = colCount >= 2;

    // 批量填充（第1列→符合性，第2列→关键证据点）
    let successCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const targetRowIndex = rowIndex + i;
      if (targetRowIndex >= tableRows.value.length) break;

      // 第一列填充到符合性
      const value = parseComplianceText(rows[i][0]);
      tableRows.value[targetRowIndex].compliance = value;

      // 第二列填充到关键证据点（如果存在）
      if (rows[i].length > 1 && rows[i][1]) {
        tableRows.value[targetRowIndex].evidence = rows[i][1];
      }
      successCount++;
    }

    hasUnsavedChanges.value = true;
    saveStatus.value = 'unsaved';
    debounceAutoSave(tableRows.value[rowIndex] || {});

    const colHint = isMultiCol ? `（${Math.min(colCount, 2)}列）` : '';
    ElMessage.success(`已批量填写 ${successCount} 条符合性${colHint}`);
  }

  /**
   * 保存剪贴板中的图片
   * @param row 目标行数据
   * @param blob 图片 Blob 对象
   */
  async function saveClipboardImage(row: TableRow, blob: Blob) {
    if (!api) {
      ElMessage.error('截图功能不可用');
      return;
    }

    try {
      const reader = new FileReader();
      const base64Data: string = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const projectId = route.params.id as string;
      const itemId = row?.itemId || 'general';

      const res = await api.screenshot.saveFromBase64({
        projectId,
        itemId,
        base64Data,
      });

      if (res.success && res.data) {
        if (!row.screenshots) {
          row.screenshots = [];
        }
        row.screenshots.push(res.data.path);
        await loadScreenshotDataUrl(row, res.data.path);
        ElMessage.success('图片已粘贴');
        debounceAutoSave(row);
      } else {
        throw new Error(res.error?.message || '保存失败');
      }
    } catch (error: any) {
      console.error('保存粘贴图片失败:', error);
      const msg = error?.message || error?.error?.message || '未知错误';
      ElMessage.error('图片粘贴失败: ' + msg);
    }
  }

  /**
   * 设置全局粘贴事件处理器
   * 用于处理图片粘贴和文本粘贴到关键证据点
   */
  // 保存全局粘贴监听引用，便于卸载时移除，避免监听器泄漏
  let globalPasteHandler: ((event: ClipboardEvent) => void) | null = null;

  function setupGlobalPasteHandler() {
    if (globalPasteHandler) return;
    globalPasteHandler = async (event: ClipboardEvent) => {
      if (tableRows.value.length === 0) return;
      const currentRow = tableRows.value[currentRowIndex.value];
      if (!currentRow) return;

      const items = event.clipboardData?.items;
      if (!items || items.length === 0) return;

      // 检查剪贴板是否包含文本（如Excel复制时会同时包含文本和图片）
      const hasText = event.clipboardData?.getData('text/plain')?.trim();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          // 如果剪贴板包含文本，说明可能是Excel复制，不自动粘贴图片
          if (hasText) continue;

          event.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            await saveClipboardImage(currentRow, blob);
          }
          return;
        }
      }

      // 若目标单元格的 @paste 已接管处理，跳过全局文本注入
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement;
      const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      if (isEditable) return;

      const text = event.clipboardData?.getData('text/plain');
      if (text) {
        event.preventDefault();
        if (currentRow.evidence) {
          currentRow.evidence += '\n' + text;
        } else {
          currentRow.evidence = text;
        }
        ElMessage.success('已粘贴到关键证据点');
      }
    };
    document.addEventListener('paste', globalPasteHandler);
  }

  function removeGlobalPasteHandler() {
    if (globalPasteHandler) {
      document.removeEventListener('paste', globalPasteHandler);
      globalPasteHandler = null;
    }
  }

  return {
    handleConclusionPaste,
    handleCompliancePaste,
    saveClipboardImage,
    setupGlobalPasteHandler,
    removeGlobalPasteHandler,
  };
}

// 导出类型
export type ClipboardHandler = ReturnType<typeof createClipboardHandler>;
