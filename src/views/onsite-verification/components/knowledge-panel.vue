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
    <!-- Phase 4 · 任务 30：项目级行业匹配提示 -->
    <div v-if="knowledgeTab === 'command' && matchedIndustry" class="industry-hint" :title="`当前标准行业：${matchedIndustry}，命令列表已自动包含「行业专属」与「通用命令」`">
      🎯 已按项目行业筛选：<b>{{ matchedIndustry }}</b>
    </div>
    <!-- AI 智能推荐核查方法入口 -->
    <button
      v-if="knowledgeTab === 'command'"
      class="ai-recommend-btn"
      :disabled="aiRecommendLoading"
      @click="openAiRecommend"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
      </svg>
      {{ aiRecommendLoading ? 'AI 分析中...' : 'AI 智能推荐核查方法' }}
    </button>
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
        <div class="card-tags" v-if="cmd.os || cmd.industry">
          <span v-if="cmd.industry" class="cmd-tag tag-industry">{{ cmd.industry }}</span>
          <span v-else class="cmd-tag tag-universal">通用</span>
          <span v-if="cmd.os" class="cmd-tag tag-os">{{ cmd.os }}</span>
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

    <!-- AI 推荐核查方法结果对话框 -->
    <el-dialog
      v-model="aiRecommendVisible"
      title="AI 智能推荐核查方法"
      width="560px"
      append-to-body
      :close-on-click-modal="false"
      @close="handleAiRecommendClose"
    >
      <div v-if="aiRecommendLoading" class="ai-rc-loading">
        <div class="ai-rc-spinner"></div>
        <span>正在根据测评项与资产信息匹配核查方法与命令...</span>
      </div>
      <template v-else>
        <div
          v-if="aiRecommendResults.length === 0 && aiRecommendMethods.length === 0"
          class="ai-rc-empty"
        >未获得推荐结果</div>
        <div v-else class="ai-rc-body">
          <template v-if="aiRecommendResults.length > 0">
            <div class="ai-rc-section-title">命令库推荐</div>
            <div class="ai-rc-list">
              <div v-for="item in aiRecommendResults" :key="item.id" class="ai-rc-item">
                <div class="ai-rc-item-head">
                  <span class="ai-rc-name">{{ item.name }}</span>
                  <button class="ai-rc-quote" @click="quoteRecommended(item)">引用</button>
                </div>
                <div class="ai-rc-code">{{ item.command }}</div>
                <div v-if="item.reason" class="ai-rc-reason">{{ item.reason }}</div>
              </div>
            </div>
          </template>
          <template v-if="aiRecommendMethods.length > 0">
            <div class="ai-rc-section-title">
              AI 补充核查方法
              <span class="ai-rc-ai-hint">命令库未覆盖部分由 AI 生成，请人工核实后使用</span>
            </div>
            <div class="ai-rc-list">
              <div v-for="(m, mi) in aiRecommendMethods" :key="mi" class="ai-rc-item ai-method-item">
                <div class="ai-rc-item-head">
                  <span class="ai-method-title">
                    <span class="ai-method-type" :class="`type-${m.type}`">{{ methodTypeLabel(m.type) }}</span>
                    {{ m.title }}
                  </span>
                </div>
                <ol v-if="m.steps && m.steps.length" class="ai-method-steps">
                  <li v-for="(s, si) in m.steps" :key="si">{{ s }}</li>
                </ol>
                <div v-for="(c, ci) in m.commands || []" :key="`cmd-${ci}`" class="ai-method-cmd">
                  <div class="ai-method-cmd-head">
                    <span class="ai-method-cmd-name">
                      {{ c.name || '核查命令' }}
                      <span class="ai-gen-badge">AI 生成</span>
                    </span>
                    <span class="ai-method-cmd-actions">
                      <button class="ai-rc-quote" @click="quoteAiCommand(m, c)">引用</button>
                      <button
                        class="ai-rc-save"
                        :class="{ saved: savedAiCommands.has(`${mi}-${ci}`) }"
                        :disabled="savedAiCommands.has(`${mi}-${ci}`)"
                        @click="saveAiCommand(m, c, mi, ci)"
                      >
                        {{ savedAiCommands.has(`${mi}-${ci}`) ? '已存库' : '存入命令库' }}
                      </button>
                    </span>
                  </div>
                  <div class="ai-rc-code">{{ c.command }}</div>
                </div>
                <div v-if="m.reason" class="ai-rc-reason">{{ m.reason }}</div>
              </div>
            </div>
          </template>
        </div>
      </template>
    </el-dialog>
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
  industry?: string;
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
  // Phase 4 · 任务 30：项目所属标准 ID（行业维自动过滤命令）
  projectStandardId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currentAsset: null,
  currentDomainId: '',
  tableRows: () => [],
  currentRowIndex: 0,
  collapsed: false,
  projectStandardId: '',
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
const matchedIndustry = ref<string>('');

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
      const params: any = { page: 1, pageSize: 200 };
      // Phase 4 · 任务 30：按项目行业匹配命令库（行业专属 + 通用命令）
      if (props.projectStandardId) params.projectStandardId = props.projectStandardId;
      const res = await window.api.knowledge.listCommands(params);
      if (res.success && res.data) {
        matchedIndustry.value = res.data.matchedIndustry || '';
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
          industry: (cmd && typeof cmd.industry === 'string') ? cmd.industry : '',
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

// AI 智能推荐核查方法
const aiRecommendVisible = ref(false);
const aiRecommendLoading = ref(false);
const aiRecommendResults = ref<any[]>([]);
const aiRecommendMethods = ref<any[]>([]);
const savedAiCommands = ref<Set<string>>(new Set());

// 核查方法类型中文标签
function methodTypeLabel(type: string) {
  return type === 'interview' ? '访谈' : type === 'test' ? '测试' : '检查';
}

// 组装推荐参数：当前测评行（控制点/测评项内容）+ 当前资产（品牌/系统/设备类型）
function buildRecommendParams() {
  const row = props.tableRows[props.currentRowIndex] || {};
  const asset = props.currentAsset || {};
  return {
    controlPoint: String(row.controlPoint || ''),
    controlName: String(row.itemLabel || ''),
    requirement: String(row.requirement || row.method || ''),
    assetLabel: String(asset.name || asset.label || ''),
    brand: String(asset.brand || ''),
    os: String(asset.os || asset.osVersion || ''),
    deviceType: String(asset.deviceType || asset.type || ''),
  };
}

async function openAiRecommend() {
  if (props.tableRows.length === 0) {
    ElMessage.warning('请先选择测评行');
    return;
  }
  const params = buildRecommendParams();
  if (!params.requirement && !params.controlPoint) {
    ElMessage.warning('当前行缺少测评项信息，无法推荐');
    return;
  }
  aiRecommendVisible.value = true;
  aiRecommendLoading.value = true;
  aiRecommendResults.value = [];
  aiRecommendMethods.value = [];
  savedAiCommands.value = new Set();
  try {
    const res = await window.api.ai.recommendCommands(params);
    if (res.success && res.data) {
      aiRecommendResults.value = res.data.commands || [];
      aiRecommendMethods.value = res.data.aiMethods || [];
      if (aiRecommendResults.value.length === 0 && aiRecommendMethods.value.length === 0) {
        ElMessage.info('AI 未返回可用的核查方法或命令');
      }
    } else {
      ElMessage.error(res.error?.message || 'AI 推荐失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || 'AI 推荐失败');
  } finally {
    aiRecommendLoading.value = false;
  }
}

// 弹窗关闭时重置 loading 状态，避免请求进行中手动关闭弹窗后按钮卡在"AI 分析中"
function handleAiRecommendClose() {
  aiRecommendLoading.value = false;
}

// 引用推荐命令（复用既有引用链路，写入测评依据）
function quoteRecommended(item: any) {
  handleQuoteCommand({
    id: item.id,
    title: item.name || '',
    command: item.command || '',
    content: item.description || item.reason || '',
    target: item.target || '',
    os: item.os || '',
    brand: item.brand || '',
    category: item.category || '',
    subCategory: item.subCategory || '',
    industry: item.industry || '',
  });
  aiRecommendVisible.value = false;
}

// 引用 AI 生成的命令（同一方法下可能有多条命令，弹窗保持打开便于连续引用）
function quoteAiCommand(m: any, c: any) {
  if (props.tableRows.length === 0) {
    ElMessage.warning('无可用行');
    return;
  }
  emit('quote', {
    id: `ai-gen-${Date.now()}`,
    title: c.name || m.title || '',
    command: c.command || '',
    content: `AI 生成命令（核查方法：${m.title || ''}），使用前请人工核实`,
    target: '',
    os: c.os || '',
    brand: c.brand || '',
    category: '',
    subCategory: '',
    industry: '',
  });
}

// 将 AI 生成的命令存入本地命令库，便于沉淀复用
async function saveAiCommand(m: any, c: any, mi: number, ci: number) {
  if (!window.api) return;
  const key = `${mi}-${ci}`;
  if (savedAiCommands.value.has(key)) return;
  try {
    const res = await window.api.knowledge.createCommand({
      name: (c.name || m.title || 'AI生成核查命令').slice(0, 100),
      target: '',
      command: c.command || '',
      description: `AI 生成（核查方法：${m.title || ''}），使用前请人工核实`,
      os: c.os || '',
      brand: c.brand || '',
      deviceType: '',
      category: '',
      subCategory: '',
      industry: '',
    });
    if (res.success) {
      savedAiCommands.value.add(key);
      ElMessage.success('已存入命令库');
      if (knowledgeTab.value === 'command') loadKnowledgeBase();
    } else {
      ElMessage.error(res.error?.message || '存入命令库失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '存入命令库失败');
  }
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
.right-panel.collapsed .ai-recommend-btn,
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

/* Phase 4 · 任务 30：行业提示 & 标签 */
.industry-hint {
  font-size: 11px;
  color: var(--color-text-secondary, #374151);
  background: linear-gradient(90deg, #ecfdf5 0%, #fef3c7 100%);
  border: 1px solid #d1fae5;
  padding: 4px 8px;
  margin: 6px 16px 0;
  border-radius: 4px;
  line-height: 1.4;
}
.industry-hint b {
  color: #92400e;
  margin-left: 2px;
}
.command-card .card-tags {
  display: flex;
  gap: 4px;
  margin: 2px 0 4px;
  flex-wrap: wrap;
}
.cmd-tag {
  display: inline-block;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.4;
}
.cmd-tag.tag-industry {
  background: #fff7ed;
  color: #c2410c;
  border: 1px solid #fed7aa;
}
.cmd-tag.tag-universal {
  background: #f3f4f6;
  color: #6b7280;
  border: 1px solid #e5e7eb;
}
.cmd-tag.tag-os {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
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

/* AI 智能推荐命令 */
.ai-recommend-btn {
  margin: 4px 16px 8px;
  padding: 7px 10px;
  border: 1px dashed var(--color-primary, #1b5fd9);
  border-radius: 6px;
  background: var(--color-primary-light, rgba(27, 95, 217, 0.06));
  color: var(--color-primary, #1b5fd9);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: all 0.15s;
  flex-shrink: 0;
}

.ai-recommend-btn:hover:not(:disabled) {
  background: var(--color-primary, #1b5fd9);
  color: #fff;
}

.ai-recommend-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* AI 推荐对话框 */
.ai-rc-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 0;
  color: var(--color-text-secondary, #4b5563);
  font-size: 13px;
}

.ai-rc-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--color-border-light, #e5e7eb);
  border-top-color: var(--color-primary, #1b5fd9);
  border-radius: 50%;
  animation: ai-rc-spin 0.8s linear infinite;
}

@keyframes ai-rc-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-rc-empty {
  padding: 32px 0;
  text-align: center;
  color: var(--color-text-tertiary, #9ca3af);
  font-size: 13px;
}

.ai-rc-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 420px;
  overflow-y: auto;
}

.ai-rc-item {
  border: 1px solid var(--color-border-default, #e5e7eb);
  border-radius: 8px;
  padding: 10px 12px;
}

.ai-rc-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.ai-rc-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.ai-rc-quote {
  font-size: 11px;
  padding: 3px 12px;
  border-radius: 4px;
  border: none;
  background: var(--color-primary, #1b5fd9);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
}

.ai-rc-quote:hover {
  opacity: 0.85;
}

.ai-rc-code {
  font-size: 11px;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  color: #374151;
  background: var(--color-bg-base, #f5f6fa);
  border: 1px solid var(--color-border-light, #f0f0f3);
  border-radius: 4px;
  padding: 5px 8px;
  word-break: break-all;
  line-height: 1.5;
}

.ai-rc-reason {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary, #4b5563);
}

.ai-rc-reason::before {
  content: '💡 ';
}

/* AI 核查方法分组渲染 */
.ai-rc-body .ai-rc-list {
  margin-bottom: 4px;
}

.ai-rc-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--color-border-light, #f0f0f3);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary, #4b5563);
}

.ai-rc-body .ai-rc-section-title:first-child {
  margin-top: 0;
}

.ai-rc-ai-hint {
  font-size: 11px;
  font-weight: 400;
  color: #d97706;
}

.ai-method-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.ai-method-type {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
}

.ai-method-type.type-check {
  color: var(--color-primary, #1b5fd9);
  background: var(--color-primary-light, rgba(27, 95, 217, 0.08));
}

.ai-method-type.type-interview {
  color: #059669;
  background: rgba(5, 150, 105, 0.1);
}

.ai-method-type.type-test {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
}

.ai-method-steps {
  margin: 2px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary, #4b5563);
}

.ai-method-cmd {
  margin-top: 8px;
}

.ai-method-cmd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.ai-method-cmd-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-primary, #111827);
}

.ai-gen-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  color: #d97706;
  background: rgba(217, 119, 6, 0.1);
  border: 1px dashed rgba(217, 119, 6, 0.45);
}

.ai-method-cmd-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ai-rc-save {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid var(--color-primary, #1b5fd9);
  background: transparent;
  color: var(--color-primary, #1b5fd9);
  cursor: pointer;
  flex-shrink: 0;
}

.ai-rc-save:hover:not(:disabled) {
  background: var(--color-primary-light, rgba(27, 95, 217, 0.06));
}

.ai-rc-save.saved {
  border-color: var(--color-border-default, #e5e7eb);
  color: var(--color-text-tertiary, #9ca3af);
  cursor: not-allowed;
}

/* AI 推荐对话框深色主题 */
:root.dark {
  .ai-rc-code {
    color: var(--color-text-secondary);
    background: var(--color-bg-page);
    border-color: var(--color-border-base);
  }
}
</style>
