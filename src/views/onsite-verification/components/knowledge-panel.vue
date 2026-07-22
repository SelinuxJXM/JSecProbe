<template>
  <div class="right-panel" :class="{ collapsed: collapsed }">
    <div class="panel-header">
      <span class="panel-title">知识库</span>
    </div>
    <div class="knowledge-tabs">
      <button
        class="tab-btn"
        :class="{ active: knowledgeTab === 'guide' }"
        @click="knowledgeTab = 'guide'; loadKnowledgeBase()"
      >
        作业指导书
      </button>
      <button
        class="tab-btn"
        :class="{ active: knowledgeTab === 'command' }"
        @click="knowledgeTab = 'command'; loadKnowledgeBase()"
      >
        核查命令
      </button>
    </div>
    <div class="panel-search">
      <svg
        class="search-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="knowledgeSearch"
        type="text"
        :placeholder="knowledgeTab === 'guide' ? '搜索作业指导书...' : '搜索核查命令...'"
        class="search-input"
      />
    </div>
    <div class="knowledge-list">
      <!-- 核查命令卡片 -->
      <div
        v-if="knowledgeTab === 'command'"
        v-for="cmd in filteredCommands"
        :key="cmd.id"
        class="command-card"
        @click="handleQuoteCommand(cmd)"
      >
        <div class="card-top">
          <span class="card-name">{{ cmd.title }}</span>
          <span v-if="cmd.target" class="card-badge">{{ cmd.target }}</span>
        </div>
        <div class="card-code">{{ cmd.command }}</div>
        <div v-if="cmd.content" class="card-desc">{{ cmd.content }}</div>
        <div class="card-actions" @click.stop>
          <button class="btn-quote" @click="handleQuoteCommand(cmd)">引用</button>
          <button class="btn-copy" @click="copyCommand(cmd.command)">复制</button>
        </div>
      </div>

      <!-- 作业指导书卡片 -->
      <div
        v-if="knowledgeTab === 'guide'"
        v-for="doc in filteredDocuments"
        :key="doc.id"
        class="document-card"
      >
        <div class="doc-card-header">
          <span class="doc-card-title">{{ doc.title }}</span>
          <span v-if="doc.category" class="doc-card-category">{{ doc.category }}</span>
        </div>
        <div v-if="doc.description" class="doc-card-summary">{{ doc.description }}</div>
        <div class="doc-card-footer">
          <button class="doc-btn-view" @click.stop="viewDocument(doc)">查看</button>
          <button class="doc-btn-copy-text" @click.stop="copyCommand(doc.content)">
            复制内容
          </button>
        </div>
      </div>

      <div
        v-if="
          (knowledgeTab === 'command' && filteredCommands.length === 0) ||
          (knowledgeTab === 'guide' && filteredDocuments.length === 0)
        "
        class="empty-state"
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>{{ knowledgeSearch ? '未找到匹配内容' : '暂无内容' }}</span>
      </div>
    </div>

    <!-- 文件预览对话框 -->
    <FilePreviewDialog ref="previewDialogRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import FilePreviewDialog from './file-preview-dialog.vue';

// 类型定义
interface CommandItem {
  id: string | number;
  title: string;
  command: string;
  content: string;
  target: string;
  os: string;
  brand: string;
  category: string;
  subCategory: string;
}

interface DocumentItem {
  id: string | number;
  title: string;
  description: string;
  content: string;
  filePath?: string;
  category: string;
}

// Props 定义
interface Props {
  currentAsset?: any;
  currentDomainId?: string;
  tableRows?: any[];
  currentRowIndex?: number;
  collapsed?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  currentAsset: null,
  currentDomainId: '',
  tableRows: () => [],
  currentRowIndex: 0,
  collapsed: false,
});

// Emits 定义
const emit = defineEmits<{
  (e: 'quote', cmd: CommandItem): void;
  (e: 'update:collapsed', value: boolean): void;
}>();

// 响应式数据
const knowledgeTab = ref<'command' | 'guide'>('command');
const knowledgeSearch = ref('');
const commandList = ref<CommandItem[]>([]);
const documentList = ref<DocumentItem[]>([]);
const previewDialogRef = ref<InstanceType<typeof FilePreviewDialog>>();

// 计算属性：过滤后的命令列表
const filteredCommands = computed(() => {
  const keyword = knowledgeSearch.value.toLowerCase();
  if (!keyword) return commandList.value;
  return commandList.value.filter(
    (cmd) =>
      cmd.title?.toLowerCase().includes(keyword) ||
      cmd.command?.toLowerCase().includes(keyword) ||
      cmd.content?.toLowerCase().includes(keyword) ||
      cmd.target?.toLowerCase().includes(keyword) ||
      cmd.os?.toLowerCase().includes(keyword) ||
      cmd.brand?.toLowerCase().includes(keyword)
  );
});

// 计算属性：过滤后的文档列表
const filteredDocuments = computed(() => {
  const keyword = knowledgeSearch.value.toLowerCase();
  if (!keyword) return documentList.value;
  return documentList.value.filter(
    (doc) =>
      doc.title?.toLowerCase().includes(keyword) ||
      doc.description?.toLowerCase().includes(keyword) ||
      doc.content?.toLowerCase().includes(keyword) ||
      doc.category?.toLowerCase().includes(keyword)
  );
});

// 加载知识库数据
async function loadKnowledgeBase() {
  if (!window.api) return;
  try {
    if (knowledgeTab.value === 'command') {
      const res = await window.api.knowledge.listCommands({ page: 1, pageSize: 200 });
      if (res.success && res.data) {
        commandList.value = res.data.list.map((cmd: any) => ({
          id: cmd.id,
          title: cmd.name || '',
          command: cmd.command || '',
          content: cmd.description || '',
          target: cmd.target || '',
          os: cmd.os || '',
          brand: cmd.brand || '',
          category: cmd.category || '',
          subCategory: cmd.subCategory || '',
        }));
      }
    } else {
      const res = await window.api.knowledge.listDocuments({ page: 1, pageSize: 200 });
      if (res.success && res.data) {
        documentList.value = res.data.list.map((doc: any) => ({
          id: doc.id,
          title: doc.title || '',
          description: doc.description || '',
          content: doc.content || '',
          filePath: doc.filePath || '',
          category: doc.categoryName || doc.category || '',
        }));
      }
    }
  } catch (error) {
    console.error('加载知识库失败:', error);
  }
}

// 复制命令/内容到剪贴板
async function copyCommand(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败');
  }
}

// 查看文档
function viewDocument(doc: DocumentItem) {
  if (!doc.filePath && !doc.content) {
    ElMessage.warning('该文档没有可预览的内容');
    return;
  }
  previewDialogRef.value?.open(doc);
}

// 引用命令
function handleQuoteCommand(cmd: CommandItem) {
  if (props.tableRows.length === 0) {
    ElMessage.warning('无可用行');
    return;
  }
  emit('quote', cmd);
}

// 初始化加载
loadKnowledgeBase();
</script>

<style scoped>
/* 右栏容器 */
.right-panel {
  width: 240px;
  flex-shrink: 0;
  background: var(--color-bg-card);
  border-left: 1px solid var(--color-border-default, #e5e7eb);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;
}

.right-panel.collapsed {
  width: 0;
  border-left: none;
}

.right-panel.collapsed .panel-header,
.right-panel.collapsed .knowledge-tabs,
.right-panel.collapsed .panel-search,
.right-panel.collapsed .knowledge-list {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.1s ease, visibility 0.1s ease;
}

/* 面板头部 */
.panel-header {
  padding: 16px 16px 0;
  flex-shrink: 0;
  transition: opacity 0.1s ease, visibility 0.1s ease;
  min-width: 248px;
}

.panel-header .panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
  margin-bottom: 12px;
}

/* 标签页 */
.knowledge-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-light, #f0f0f3);
  padding: 0 16px;
  flex-shrink: 0;
  transition: opacity 0.1s ease, visibility 0.1s ease;
  min-width: 248px;
}

.knowledge-tabs .tab-btn {
  flex: 1;
  height: 40px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-secondary, #4b5563);
  font-size: 12px;
  cursor: pointer;
}

.knowledge-tabs .tab-btn.active {
  border-bottom-color: var(--color-primary, #1b5fd9);
  color: var(--color-primary, #1b5fd9);
  font-weight: 500;
}

/* 搜索框 */
.panel-search {
  padding: 12px 16px 8px;
  position: relative;
  flex-shrink: 0;
  transition: opacity 0.1s ease, visibility 0.1s ease;
  min-width: 248px;
}

.panel-search .search-icon {
  position: absolute;
  left: 26px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary, #9ca3af);
}

.panel-search .search-input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 32px;
  border: 1px solid var(--color-border-default, #e5e7eb);
  border-radius: 6px;
  font-size: 12px;
  background: var(--color-bg-page, #f5f6fa);
  outline: none;
  box-sizing: border-box;
}

/* 知识库列表 */
.knowledge-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: opacity 0.1s ease, visibility 0.1s ease;
  min-width: 248px;
}

/* 核查命令卡片 - 简洁列表式 */
.command-card {
  border: 1px solid var(--color-border-default, #e5e7eb);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--color-bg-card);
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}

.command-card:hover {
  border-color: var(--color-primary, #1b5fd9);
  background: var(--color-primary-light);
  box-shadow: 0 1px 4px rgba(27, 95, 217, 0.08);
}

.command-card .card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}

.command-card .card-top .card-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.command-card .card-top .card-badge {
  flex-shrink: 0;
  font-size: 9px;
  color: #6b7280;
  background: var(--color-bg-base);
  padding: 1px 5px;
  border-radius: 2px;
  line-height: 1.4;
}

.command-card .card-code {
  font-size: 11px;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  color: #374151;
  background: var(--color-bg-base);
  border: 1px solid #f3f4f6;
  border-radius: 3px;
  padding: 4px 6px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.command-card .card-desc {
  font-size: 10px;
  color: #9ca3af;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-card .card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  gap: 2px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  padding: 2px;
}

.command-card .card-actions button {
  font-size: 10px;
  padding: 2px 8px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.1s;
}

.command-card .card-actions .btn-quote {
  color: #fff;
  background: var(--color-primary, #1b5fd9);
}

.command-card .card-actions .btn-quote:hover {
  background: #1748b8;
}

.command-card .card-actions .btn-copy {
  color: #4b5563;
  background: #e5e7eb;
}

.command-card .card-actions .btn-copy:hover {
  background: #d1d5db;
}

.command-card:hover .card-actions {
  display: flex;
}

/* 作业指导书卡片 */
.document-card {
  border: 1px solid var(--color-border-default, #e5e7eb);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-bg-card);
  transition: box-shadow 0.2s, border-color 0.2s;
}

.document-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  border-color: var(--color-border-hover, #d1d5db);
}

.document-card .doc-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 12px 4px;
}

.document-card .doc-card-header .doc-card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-card .doc-card-header .doc-card-category {
  flex-shrink: 0;
  font-size: 10px;
  color: #92400e;
  background: var(--color-warning-light);
  padding: 1px 6px;
  border-radius: 3px;
}

.document-card .doc-card-summary {
  font-size: 11px;
  color: var(--color-text-tertiary, #9ca3af);
  padding: 0 12px 4px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.document-card .doc-card-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 6px 12px 10px;
}

.document-card .doc-card-footer .doc-btn-view,
.document-card .doc-card-footer .doc-btn-copy-text {
  font-size: 10px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.15s;
}

.document-card .doc-card-footer .doc-btn-view {
  color: #059669;
  background: var(--color-success-light);
  border: none;
}

.document-card .doc-card-footer .doc-btn-view:hover {
  background: var(--color-success-light);
}

.document-card .doc-card-footer .doc-btn-copy-text {
  color: var(--color-text-secondary, #4b5563);
  background: transparent;
  border: 1px solid var(--color-border-default, #e5e7eb);
}

.document-card .doc-card-footer .doc-btn-copy-text:hover {
  background: var(--color-bg-page, #f5f6fa);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--color-text-tertiary, #9ca3af);
  font-size: 12px;
}

.empty-state svg {
  opacity: 0.4;
}

/* 深色主题覆盖 */
:root.dark {
  .command-card {
    .card-top .card-badge {
      color: var(--color-text-tertiary);
    }

    .card-code {
      color: var(--color-text-secondary);
      background: var(--color-bg-page);
      border-color: var(--color-border-light);
    }

    .card-desc {
      color: var(--color-text-tertiary);
    }

    .card-actions {
      background: rgba(30, 41, 59, 0.95);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);

      .btn-copy {
        color: var(--color-text-secondary);
        background: var(--color-bg-hover);

        &:hover {
          background: var(--color-border-base);
        }
      }
    }
  }

  .document-card {
    .doc-card-header .doc-card-category {
      color: #FBBF24;
      background: rgba(212, 136, 6, 0.15);
    }

    .doc-card-footer .doc-btn-view {
      color: #34D399;
      background: rgba(24, 169, 87, 0.15);
    }

    .doc-card-footer .doc-btn-copy-text {
      color: var(--color-text-secondary);
      border-color: var(--color-border-base);

      &:hover {
        background: var(--color-bg-hover);
      }
    }
  }
}
</style>
