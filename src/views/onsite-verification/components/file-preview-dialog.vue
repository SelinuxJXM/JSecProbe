<template>
  <el-dialog
    v-model="visible"
    :title="document?.title || '文档预览'"
    width="900px"
    :close-on-click-modal="true"
    destroy-on-close
    class="file-preview-dialog"
  >
    <div class="preview-container">
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <span>正在加载文档...</span>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f56c6c" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{{ error }}</span>
        <el-button type="primary" @click="openWithSystem">使用系统程序打开</el-button>
      </div>

      <!-- PDF 预览 -->
      <div v-else-if="fileType === 'pdf'" class="pdf-preview">
        <div class="pdf-toolbar">
          <el-button-group>
            <el-button @click="prevPage" :disabled="currentPage <= 1">
              <el-icon><ArrowLeft /></el-icon> 上一页
            </el-button>
            <el-button @click="nextPage" :disabled="currentPage >= totalPages">
              下一页 <el-icon><ArrowRight /></el-icon>
            </el-button>
          </el-button-group>
          <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
          <el-button-group>
            <el-button @click="zoomOut"><el-icon><ZoomOut /></el-icon></el-button>
            <el-button @click="zoomIn"><el-icon><ZoomIn /></el-icon></el-button>
          </el-button-group>
        </div>
        <div class="pdf-viewer" ref="pdfViewerRef">
          <canvas ref="pdfCanvasRef" :style="{ transform: `scale(${zoom})` }"></canvas>
        </div>
      </div>

      <!-- Excel 预览 -->
      <div v-else-if="fileType === 'excel'" class="excel-preview">
        <div class="excel-toolbar">
          <el-select v-model="selectedSheet" placeholder="选择工作表" @change="loadSheet">
            <el-option
              v-for="sheet in sheetNames"
              :key="sheet"
              :label="sheet"
              :value="sheet"
            />
          </el-select>
          <el-input
            v-model="searchKeyword"
            placeholder="搜索内容..."
            prefix-icon="Search"
            class="search-input"
            clearable
          />
        </div>
        <div class="excel-table-wrapper">
          <table class="excel-table">
            <thead>
              <tr>
                <th class="row-number">#</th>
                <th v-for="(col, idx) in tableColumns" :key="idx">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIdx) in filteredTableData" :key="rowIdx">
                <td class="row-number">{{ rowIdx + 1 }}</td>
                <td v-for="(col, colIdx) in tableColumns" :key="colIdx">
                  {{ row[col] || '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Word 预览 -->
      <div v-else-if="fileType === 'word'" class="word-preview">
        <div class="word-content" v-html="wordHtmlContent"></div>
      </div>

      <!-- 文本预览 -->
      <div v-else-if="fileType === 'text'" class="text-preview">
        <pre>{{ textContent }}</pre>
      </div>

      <!-- 不支持的文件类型 -->
      <div v-else class="unsupported-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#909399" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>该文件类型暂不支持预览</span>
        <el-button type="primary" @click="openWithSystem">使用系统程序打开</el-button>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="downloadFile">
          <el-icon><Download /></el-icon> 下载文件
        </el-button>
        <el-button @click="openWithSystem">
          <el-icon><FolderOpened /></el-icon> 使用系统程序打开
        </el-button>
        <el-button @click="visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import {
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Download,
  FolderOpened,
} from '@element-plus/icons-vue';

interface DocumentItem {
  id: string | number;
  title: string;
  filePath?: string;
  type?: string;
}

const visible = ref(false);
const loading = ref(false);
const error = ref('');
const document = ref<DocumentItem | null>(null);
const filePath = ref('');

// PDF 相关
const currentPage = ref(1);
const totalPages = ref(0);
const zoom = ref(1);
const pdfViewerRef = ref<HTMLDivElement>();
const pdfCanvasRef = ref<HTMLCanvasElement>();
let pdfDoc: any = null;

// Excel 相关
const sheetNames = ref<string[]>([]);
const selectedSheet = ref('');
const searchKeyword = ref('');
const tableColumns = ref<string[]>([]);
const tableData = ref<any[]>([]);

// Word 相关
const wordHtmlContent = ref('');

// 文本相关
const textContent = ref('');

// 计算文件类型
const fileType = computed(() => {
  if (!filePath.value) return 'unknown';
  const ext = filePath.value.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'csv'].includes(ext || '')) return 'excel';
  if (['doc', 'docx'].includes(ext || '')) return 'word';
  if (['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'sql', 'log'].includes(ext || '')) {
    return 'text';
  }
  return 'unknown';
});

// 过滤后的表格数据
const filteredTableData = computed(() => {
  if (!searchKeyword.value) return tableData.value;
  const kw = searchKeyword.value.toLowerCase();
  return tableData.value.filter(row =>
    Object.values(row).some(val =>
      String(val).toLowerCase().includes(kw)
    )
  );
});

// 打开对话框
function open(doc: DocumentItem) {
  document.value = doc;
  filePath.value = doc.filePath || '';
  visible.value = true;
  error.value = '';
  loading.value = true;

  nextTick(() => {
    loadFile();
  });
}

// 加载文件
async function loadFile() {
  if (!filePath.value) {
    error.value = '文件路径不存在';
    loading.value = false;
    return;
  }

  try {
    const type = fileType.value;
    if (type === 'pdf') {
      await loadPdf();
    } else if (type === 'excel') {
      await loadExcel();
    } else if (type === 'word') {
      await loadWord();
    } else if (type === 'text') {
      await loadText();
    } else {
      error.value = '该文件类型暂不支持预览';
    }
  } catch (err: any) {
    error.value = err.message || '加载文件失败';
  } finally {
    loading.value = false;
  }
}

// 加载 PDF
async function loadPdf() {
  const pdfjsLib = await import('pdfjs-dist');
  
  // 使用 CDN 加载 worker（避免 Vite 开发服务器问题）
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const data = await window.api.file.readAsArrayBuffer(filePath.value);
  if (!data.success) {
    throw new Error(data.error?.message || '读取文件失败，可能是文件路径不在允许访问的目录内');
  }

  pdfDoc = await pdfjsLib.getDocument({ data: data.data }).promise;
  totalPages.value = pdfDoc.numPages;
  currentPage.value = 1;
  await renderPage();
}

// 渲染 PDF 页面
async function renderPage() {
  if (!pdfDoc || !pdfCanvasRef.value) return;

  const page = await pdfDoc.getPage(currentPage.value);
  const canvas = pdfCanvasRef.value;
  const context = canvas.getContext('2d')!;

  const viewport = page.getViewport({ scale: 1.5 * zoom.value });
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;
}

// PDF 翻页
function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--;
    renderPage();
  }
}

function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++;
    renderPage();
  }
}

// PDF 缩放
function zoomIn() {
  zoom.value = Math.min(zoom.value + 0.25, 3);
  renderPage();
}

function zoomOut() {
  zoom.value = Math.max(zoom.value - 0.25, 0.5);
  renderPage();
}

// 加载 Excel
async function loadExcel() {
  const res = await window.api.knowledge.readExcelFile(filePath.value);
  if (!res.success || !res.data) {
    throw new Error(res.error?.message || '读取Excel失败，可能是文件路径不在允许访问的目录内');
  }

  sheetNames.value = res.data.sheetNames;
  selectedSheet.value = res.data.sheetNames[0] || '';
  tableColumns.value = res.data.columns;
  tableData.value = res.data.data;
}

// 切换工作表
async function loadSheet() {
  if (!filePath.value || !selectedSheet.value) return;
  const res = await window.api.knowledge.readExcelFile(filePath.value, selectedSheet.value);
  if (res.success && res.data) {
    tableColumns.value = res.data.columns;
    tableData.value = res.data.data;
  }
}

// 加载 Word
async function loadWord() {
  const res = await window.api.knowledge.readWordFile(filePath.value);
  if (!res.success || !res.data) {
    throw new Error(res.error?.message || '读取Word失败，可能是文件路径不在允许访问的目录内');
  }
  wordHtmlContent.value = res.data.html;
}

// 加载文本
async function loadText() {
  const res = await window.api.file.readAsText(filePath.value);
  if (!res.success || !res.data) {
    throw new Error(res.error?.message || '读取文件失败，可能是文件路径不在允许访问的目录内');
  }
  textContent.value = res.data;
}

// 使用系统程序打开
async function openWithSystem() {
  if (!filePath.value) return;
  const res = await window.api.shell.openPath(filePath.value);
  if (!res.success) {
    ElMessage.error('打开文件失败：' + (res.error?.message || '未知错误'));
  }
}

// 下载文件
async function downloadFile() {
  if (!document.value) return;
  const res = await window.api.knowledge.downloadAndSave(String(document.value.id));
  if (res.success && res.data && 'saved' in res.data && res.data.saved) {
    ElMessage.success('文件已保存');
  }
}

// 监听对话框关闭
watch(visible, (val) => {
  if (!val) {
    pdfDoc = null;
    wordHtmlContent.value = '';
    textContent.value = '';
    tableData.value = [];
    tableColumns.value = [];
    sheetNames.value = [];
  }
});

defineExpose({ open });
</script>

<style scoped>
.file-preview-dialog {
  :deep(.el-dialog__body) {
    padding: 0;
    height: 600px;
    overflow: hidden;
  }
}

.preview-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #909399;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e7eb;
  border-top-color: #1B5FD9;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 错误状态 */
.error-state,
.unsupported-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #606266;
}

/* PDF 预览 */
.pdf-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.page-info {
  font-size: 14px;
  color: #606266;
}

.pdf-viewer {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  padding: 20px;
  background: #f3f4f6;
}

.pdf-viewer canvas {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform-origin: center top;
}

/* Excel 预览 */
.excel-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.excel-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.search-input {
  width: 200px;
}

.excel-table-wrapper {
  flex: 1;
  overflow: auto;
}

.excel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.excel-table th,
.excel-table td {
  border: 1px solid #e5e7eb;
  padding: 8px 12px;
  text-align: left;
  white-space: nowrap;
}

.excel-table th {
  background: #f3f4f6;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.excel-table .row-number {
  background: #f9fafb;
  color: #909399;
  text-align: center;
  width: 50px;
}

.excel-table tbody tr:hover {
  background: #f0f6ff;
}

/* Word 预览 */
.word-preview {
  flex: 1;
  overflow: auto;
  padding: 24px;
  background: #fff;
}

.word-content {
  max-width: 800px;
  margin: 0 auto;
  line-height: 1.8;
  color: #333;
}

.word-content :deep(h1),
.word-content :deep(h2),
.word-content :deep(h3) {
  margin: 16px 0 8px;
  color: #1f2937;
}

.word-content :deep(p) {
  margin: 8px 0;
}

.word-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.word-content :deep(th),
.word-content :deep(td) {
  border: 1px solid #d1d5db;
  padding: 8px 12px;
}

.word-content :deep(th) {
  background: #f3f4f6;
}

/* 文本预览 */
.text-preview {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: #1f2937;
}

.text-preview pre {
  margin: 0;
  color: #e5e7eb;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* 底部按钮 */
.dialog-footer {
  display: flex;
  gap: 8px;
}

/* 深色主题覆盖 */
:root.dark {
  .loading-state {
    color: var(--color-text-tertiary);
  }

  .loading-spinner {
    border-color: var(--color-border-base);
    border-top-color: var(--color-primary);
  }

  .error-state,
  .unsupported-state {
    color: var(--color-text-secondary);
  }

  .pdf-toolbar {
    border-bottom-color: var(--color-border-base);
    background: var(--color-bg-card);
  }

  .page-info {
    color: var(--color-text-secondary);
  }

  .pdf-viewer {
    background: var(--color-bg-page);
  }

  .pdf-viewer canvas {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .excel-toolbar {
    border-bottom-color: var(--color-border-base);
    background: var(--color-bg-card);
  }

  .excel-table {
    th,
    td {
      border-color: var(--color-border-base);
    }

    th {
      background: var(--color-bg-hover);
    }

    .row-number {
      background: var(--color-bg-card);
      color: var(--color-text-tertiary);
    }

    tbody tr:hover {
      background: var(--color-bg-hover);
    }
  }

  .word-preview {
    background: var(--color-bg-card);
  }

  .word-content {
    color: var(--color-text-primary);

    :deep(h1),
    :deep(h2),
    :deep(h3) {
      color: var(--color-text-primary);
    }

    :deep(th),
    :deep(td) {
      border-color: var(--color-border-base);
    }

    :deep(th) {
      background: var(--color-bg-hover);
    }
  }

  .text-preview {
    background: #0F172A;
  }

  .text-preview pre {
    color: #E2E8F0;
  }
}
</style>
