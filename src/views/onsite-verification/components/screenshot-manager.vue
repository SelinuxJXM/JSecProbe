<template>
  <div class="screenshot-area" v-if="row.screenshots && row.screenshots.length > 0">
    <div v-for="(shot, idx) in row.screenshots" :key="idx" class="screenshot-thumb" @click="previewScreenshot(shot)">
      <template v-if="getFileType(shot) === 'image'">
        <img v-if="getScreenshotState(shot) === 'loaded'" :src="getScreenshotSrc(shot)" alt="截图" />
        <div v-else-if="getScreenshotState(shot) === 'error'" class="thumb-error">加载失败</div>
        <div v-else class="thumb-loading">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
      </template>
      <template v-else>
        <div class="file-thumb-placeholder" :class="getFileType(shot)">{{ getFileType(shot) === 'pdf' ? 'PDF' : (getFileType(shot) === 'word' ? 'DOC' : (getFileType(shot) === 'text' ? 'TXT' : 'FILE')) }}</div>
      </template>
      <span class="remove-shot" @click.stop="handleRemoveScreenshot(idx)">×</span>
    </div>
  </div>
  <button class="screenshot-btn" @click.stop="handleUploadScreenshot">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    上传文件
  </button>

  <!-- 文件预览弹窗 -->
  <el-dialog v-model="previewDialogVisible" width="800px" :title="previewFile?.name || '文件预览'" class="file-preview-dialog" :show-close="true" append-to-body>
    <div class="file-preview-container">
      <div v-if="previewLoading" class="preview-loading">正在加载文件...</div>
      <div v-else-if="previewError" class="preview-error">{{ previewError }}</div>
      <div v-else-if="previewFile?.fileType === 'image'" class="preview-image-wrapper">
        <img :src="previewFileSrc" :alt="previewFile.name" class="preview-image" />
      </div>
      <div v-else-if="previewFile?.fileType === 'pdf'" class="preview-pdf-wrapper">
        <iframe :src="previewFileSrc" class="preview-pdf" frameborder="0" />
      </div>
      <div v-else-if="previewFile?.fileType === 'text' || previewFile?.fileType === 'word'" class="preview-text-wrapper">
        <pre class="preview-text-content">{{ previewTextContent }}</pre>
      </div>
      <div v-else class="preview-unsupported">
        <p>不支持的文件格式</p>
        <el-button @click="openFileExternal(previewFile)">使用系统程序打开</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElDialog } from 'element-plus';

interface Props {
  row: any;
  projectId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:row': [row: any];
  'auto-save': [row: any];
}>();

// ==================== 响应式状态 ====================

const previewDialogVisible = ref(false);
const previewFile = ref<{ name: string; path: string; fileType: string } | null>(null);
const previewFileSrc = ref('');
const previewLoading = ref(false);
const previewError = ref('');
const previewTextContent = ref('');

// ==================== 截图加载锁 ====================

const screenshotLoadingLocks = new Set<string>();

// ==================== 工具函数 ====================

function getFileType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.bmp')) return 'image';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'word';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'text';
  return 'other';
}

function getScreenshotSrc(filePath: string): string {
  return props.row.screenshotUrls?.[filePath] || '';
}

function getScreenshotState(filePath: string): 'loaded' | 'error' | 'loading' {
  const val = props.row.screenshotUrls?.[filePath];
  if (!val) return 'loading';
  if (val === 'error') return 'error';
  if (val.startsWith('data:image/')) return 'loaded';
  return 'loading';
}

// ==================== 截图数据加载 ====================

async function loadScreenshotDataUrl(filePath: string) {
  if (!filePath) return;
  if (props.row.screenshotUrls?.[filePath] && props.row.screenshotUrls[filePath].startsWith('data:image/')) return;
  if (screenshotLoadingLocks.has(filePath)) return;

  if (!window.api) {
    console.warn('[loadScreenshotDataUrl] window.api 不可用');
    return;
  }

  screenshotLoadingLocks.add(filePath);

  try {
    console.log('[loadScreenshotDataUrl] 开始加载:', filePath);
    const res = await window.api.screenshot.getBase64({ filePath });
    if (res.success && res.data && res.data.base64) {
      const dataUrl = `data:${res.data.mimeType || 'image/png'};base64,${res.data.base64}`;
      props.row.screenshotUrls = Object.assign({}, props.row.screenshotUrls, { [filePath]: dataUrl });
      emit('update:row', { ...props.row });
      console.log('[loadScreenshotDataUrl] 加载成功:', filePath.substring(0, 50) + '...');
    } else {
      console.warn('[loadScreenshotDataUrl] getBase64 返回空结果:', filePath, 'success:', res.success, 'hasData:', !!res.data, 'error:', res.error?.message);
      props.row.screenshotUrls = Object.assign({}, props.row.screenshotUrls, { [filePath]: 'error' });
    }
  } catch (error) {
    console.error('[loadScreenshotDataUrl] 读取截图失败:', filePath, error);
    props.row.screenshotUrls = Object.assign({}, props.row.screenshotUrls, { [filePath]: 'error' });
  } finally {
    screenshotLoadingLocks.delete(filePath);
  }
}

// ==================== 上传截图 ====================

async function handleUploadScreenshot() {
  if (!window.api) {
    ElMessage.error('上传功能不可用');
    return;
  }
  try {
    const res = await window.api.dialog.showOpenDialog({
      title: '选择文件',
      filters: [{ name: '支持的文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'pdf', 'doc', 'docx', 'md', 'txt'] }],
      properties: ['openFile', 'multiSelections'],
    });

    if (!res.success) {
      return;
    }
    if (res.data?.canceled || !res.data?.filePaths || res.data.filePaths.length === 0) {
      return;
    }

    const projectId = props.projectId || '';
    const itemId = props.row?.itemId || '';

    for (const filePath of res.data.filePaths) {
      const fileType = getFileType(filePath);
      let savedPath = '';
      let uploadError = '';

      if (fileType === 'image') {
        const uploadRes = await window.api.screenshot.upload({
          projectId,
          itemId,
          filePath,
        });
        if (uploadRes.success && uploadRes.data?.path) {
          savedPath = uploadRes.data.path;
          await loadScreenshotDataUrl(savedPath);
        } else {
          uploadError = uploadRes.error?.message || '图片上传失败';
        }
      } else {
        const uploadFileRes = await window.api.screenshot.uploadFile({
          projectId,
          itemId,
          filePath,
        });
        if (uploadFileRes.success && uploadFileRes.data?.path) {
          savedPath = uploadFileRes.data.path;
        } else {
          uploadError = uploadFileRes.error?.message || '文件上传失败';
        }
      }

      if (uploadError) {
        ElMessage.error(`${filePath.split('\\').pop()}: ${uploadError}`);
      } else if (savedPath) {
        props.row.screenshots = props.row.screenshots || [];
        if (!props.row.screenshots.includes(savedPath)) {
          props.row.screenshots.push(savedPath);
        }
        emit('update:row', { ...props.row });
        const fileName = savedPath.split('\\').pop()?.split('/').pop() || '文件';
        ElMessage.success(`已添加 ${fileName}`);
        emit('auto-save', props.row);
      }
    }
  } catch (error: any) {
    ElMessage.error('上传失败：' + (error.message || '未知错误'));
  }
}

// ==================== 预览截图 ====================

function previewScreenshot(path: string) {
  const fileType = getFileType(path);
  const fileInfo = { name: path.split('\\').pop()?.split('/').pop() || path, path, fileType };
  openFilePreview(fileInfo);
}

async function openFilePreview(fileInfo: { name: string; path: string; fileType: string }) {
  previewFile.value = fileInfo;
  previewFileSrc.value = '';
  previewError.value = '';
  previewLoading.value = true;
  previewDialogVisible.value = true;

  if (fileInfo.fileType === 'text') {
    try {
      const res = await window.api.screenshot.readText({ filePath: fileInfo.path });
      if (res.success && res.data) {
        previewTextContent.value = res.data.content;
      } else {
        previewError.value = '无法读取文本文件';
      }
    } catch {
      previewError.value = '无法读取文本文件';
    } finally {
      previewLoading.value = false;
    }
    return;
  }

  if (fileInfo.fileType === 'word') {
    try {
      const res = await window.api.screenshot.readWord({ filePath: fileInfo.path });
      if (res.success && res.data) {
        previewTextContent.value = res.data.content;
      } else {
        previewError.value = res.error?.message || '无法读取Word文档';
      }
    } catch (err: any) {
      previewError.value = err.message || '无法读取Word文档';
    } finally {
      previewLoading.value = false;
    }
    return;
  }

  try {
    const res = await window.api.screenshot.getBase64({ filePath: fileInfo.path });
    if (res.success && res.data?.base64) {
      const mimeType = res.data.mimeType || (fileInfo.fileType === 'pdf' ? 'application/pdf' : 'image/png');
      previewFileSrc.value = `data:${mimeType};base64,${res.data.base64}`;
    } else {
      previewError.value = '无法加载文件';
    }
  } catch (error: any) {
    previewError.value = '文件加载失败：' + (error.message || '未知错误');
  } finally {
    previewLoading.value = false;
  }
}

// ==================== 外部打开文件 ====================

function openFileExternal(file: any) {
  if (!file?.path) return;
  try {
    if (window.api?.shell?.openPath) {
      window.api.shell.openPath(file.path);
    } else {
      ElMessage.warning('无法打开文件');
    }
  } catch {
    ElMessage.warning('无法打开文件');
  }
}

// ==================== 删除截图 ====================

async function handleRemoveScreenshot(index: number) {
  const filePath = props.row.screenshots[index];
  props.row.screenshots.splice(index, 1);
  if (props.row.screenshotUrls) {
    delete props.row.screenshotUrls[filePath];
  }
  if (filePath && window.api) {
    try {
      await window.api.screenshot.deleteFile({ filePath });
    } catch (e) {
      console.warn('删除文件失败:', e);
    }
  }
  emit('update:row', { ...props.row });
  emit('auto-save', props.row);
}
</script>

<style scoped>
.screenshot-area {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.screenshot-thumb {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--color-border-default, #E5E7EB);
  cursor: pointer;
  flex-shrink: 0;
}

.screenshot-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.screenshot-thumb .thumb-loading {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-base);
  color: #9ca3af;
}

.screenshot-thumb .thumb-loading .spin {
  animation: spin 1s linear infinite;
}

.screenshot-thumb .thumb-error {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-danger-light);
  color: #DC2626;
  font-size: 9px;
  font-weight: 500;
}

.screenshot-thumb .file-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-base);
  color: #6b7280;
  font-size: 10px;
  font-weight: 600;
}

.screenshot-thumb .remove-shot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  background: #EF4444;
  color: #fff;
  border-radius: 50%;
  font-size: 12px;
  line-height: 14px;
  text-align: center;
  display: none;
}

.screenshot-thumb:hover .remove-shot {
  display: block;
}

.screenshot-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 3px 8px;
  background: var(--color-bg-card);
  border: 1px dashed var(--color-border-default, #E5E7EB);
  border-radius: 4px;
  color: var(--color-text-tertiary, #9CA3AF);
  font-size: 11px;
  cursor: pointer;
}

.screenshot-btn:hover {
  border-color: var(--color-primary, #1B5FD9);
  color: var(--color-primary, #1B5FD9);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 文件预览弹窗样式 */
.file-preview-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.preview-loading,
.preview-error {
  padding: 40px;
  text-align: center;
  color: #6B7280;
}

.preview-error {
  color: #DC2626;
}

.preview-image-wrapper {
  width: 100%;
  text-align: center;
}

:deep(.preview-image) {
  max-width: 100%;
  max-height: 60vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.preview-pdf-wrapper {
  width: 100%;
  height: 70vh;
}

.preview-pdf {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 4px;
}

.preview-word-wrapper {
  padding: 40px;
  text-align: center;
  width: 100%;
}

.word-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px;
  color: #6B7280;
}

.word-title {
  font-size: 16px;
  font-weight: 500;
  color: #374151;
  margin: 0;
}

.word-desc {
  font-size: 13px;
  color: #9CA3AF;
  margin: 0;
}

.preview-text-wrapper {
  width: 100%;
  padding: 16px;
}

.preview-text-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  color: #374151;
  background: #F9FAFB;
  padding: 16px;
  border-radius: 4px;
  max-height: 60vh;
  overflow-y: auto;
  margin: 0;
}

.preview-unsupported {
  padding: 40px;
  text-align: center;
  color: #6B7280;
}

/* 深色主题覆盖 */
:root.dark {
  .screenshot-thumb {
    .remove-shot {
      background: #DC2626;
      color: #fff;
    }
  }

  .preview-loading {
    color: var(--color-text-tertiary);
  }

  .preview-error {
    color: #F87171;
  }

  :deep(.preview-image) {
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  }

  .word-placeholder {
    color: var(--color-text-tertiary);
  }

  .word-title {
    color: var(--color-text-primary);
  }

  .word-desc {
    color: var(--color-text-tertiary);
  }

  .preview-text-content {
    color: var(--color-text-primary);
    background: var(--color-bg-base);
  }

  .preview-unsupported {
    color: var(--color-text-tertiary);
  }
}
</style>
