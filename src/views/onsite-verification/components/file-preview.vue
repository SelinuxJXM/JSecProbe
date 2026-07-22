<template>
  <!-- 文件预览弹窗 -->
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    width="800px"
    :title="file?.name || '文件预览'"
    class="file-preview-dialog"
    :show-close="true"
  >
    <div class="file-preview-container">
      <div v-if="loading" class="preview-loading">正在加载文件...</div>
      <div v-else-if="error" class="preview-error">{{ error }}</div>
      <div v-else-if="file?.fileType === 'image'" class="preview-image-wrapper">
        <img :src="fileSrc" :alt="file.name" class="preview-image" />
      </div>
      <div v-else-if="file?.fileType === 'pdf'" class="preview-pdf-wrapper">
        <iframe :src="fileSrc" class="preview-pdf" frameborder="0" />
      </div>
      <div v-else-if="file?.fileType === 'text' || file?.fileType === 'word'" class="preview-text-wrapper">
        <pre class="preview-text-content">{{ textContent }}</pre>
      </div>
      <div v-else class="preview-unsupported">
        <p>不支持的文件格式</p>
        <el-button @click="handleOpenExternal">使用系统程序打开</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';

// 文件信息类型
interface FileInfo {
  name: string;
  path: string;
  fileType: string;
}

// Props 定义
const props = defineProps<{
  visible: boolean;
  file: FileInfo | null;
}>();

// Emits 定义
defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'open-external', file: FileInfo): void;
}>();

// 响应式状态
const fileSrc = ref('');
const loading = ref(false);
const error = ref('');
const textContent = ref('');

// 获取文件类型
function getFileType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.bmp')) return 'image';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'word';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'text';
  return 'other';
}

// 打开文件预览
async function openFilePreview(fileInfo: FileInfo) {
  // 重置状态
  fileSrc.value = '';
  error.value = '';
  textContent.value = '';
  loading.value = true;

  if (fileInfo.fileType === 'text') {
    try {
      const res = await window.api.screenshot.readText({ filePath: fileInfo.path });
      if (res.success && res.data) {
        textContent.value = res.data.content;
      } else {
        error.value = '无法读取文本文件';
      }
    } catch {
      error.value = '无法读取文本文件';
    } finally {
      loading.value = false;
    }
    return;
  }

  if (fileInfo.fileType === 'word') {
    try {
      const res = await window.api.screenshot.readWord({ filePath: fileInfo.path });
      if (res.success && res.data) {
        textContent.value = res.data.content;
      } else {
        error.value = res.error?.message || '无法读取Word文档';
      }
    } catch (err: any) {
      error.value = err.message || '无法读取Word文档';
    } finally {
      loading.value = false;
    }
    return;
  }

  try {
    const res = await window.api.screenshot.getBase64({ filePath: fileInfo.path });
    if (res.success && res.data?.base64) {
      const mimeType = res.data.mimeType || (fileInfo.fileType === 'pdf' ? 'application/pdf' : 'image/png');
      fileSrc.value = `data:${mimeType};base64,${res.data.base64}`;
    } else {
      error.value = '无法加载文件';
    }
  } catch (err: any) {
    error.value = '文件加载失败：' + (err.message || '未知错误');
  } finally {
    loading.value = false;
  }
}

// 使用系统程序打开文件
function handleOpenExternal() {
  if (!props.file?.path) return;
  try {
    if (window.api?.shell?.openPath) {
      window.api.shell.openPath(props.file.path);
    } else {
      ElMessage.warning('无法打开文件');
    }
  } catch {
    ElMessage.warning('无法打开文件');
  }
}

// 监听 file 变化，自动加载文件
watch(
  () => props.file,
  (newFile) => {
    if (newFile && props.visible) {
      openFilePreview(newFile);
    }
  },
  { immediate: true }
);

// 监听 visible 变化，当对话框打开时加载文件
watch(
  () => props.visible,
  (newVisible) => {
    if (newVisible && props.file) {
      openFilePreview(props.file);
    }
  }
);

// 暴露方法给父组件
defineExpose({
  openFilePreview,
  getFileType
});
</script>

<style scoped>
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

.preview-image {
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

.word-placeholder svg {
  margin-bottom: 16px;
}

.word-title {
  font-size: 16px;
  font-weight: 600;
  color: #1F2937;
  margin: 0 0 8px;
  word-break: break-all;
}

.word-desc {
  font-size: 14px;
  color: #6B7280;
  margin: 0 0 20px;
}

.preview-unsupported {
  padding: 40px;
  text-align: center;
  color: #6B7280;
}

.preview-text-wrapper {
  width: 100%;
  height: 70vh;
  overflow: auto;
  background: #1F2937;
  border-radius: 4px;
}

.preview-text-content {
  margin: 0;
  padding: 20px;
  color: #E5E7EB;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
}
</style>
