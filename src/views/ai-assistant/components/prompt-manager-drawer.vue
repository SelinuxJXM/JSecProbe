<template>
  <el-drawer
    v-model="visible"
    title="提示词管理"
    size="560px"
  >
    <div class="prompt-manager">
      <div class="prompt-toolbar">
        <span class="prompt-hint">
          自定义 AI 分析提示词模板，模板中使用 <code v-pre>{{变量名}}</code> 作为占位符。保存后立即生效，也可随时恢复为内置默认模板。
        </span>
        <el-button size="small" text type="primary" :loading="promptLoading" @click="loadPrompts">
          <el-icon v-if="!promptLoading"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
      <div v-loading="promptLoading" class="prompt-list">
        <div v-for="item in promptList" :key="item.key" class="prompt-card">
          <div class="prompt-card-main">
            <div class="prompt-card-title">
              <span class="prompt-card-name">{{ item.name }}</span>
              <el-tag v-if="item.customized" type="warning" size="small">已自定义</el-tag>
              <el-tag v-else type="info" size="small">内置默认</el-tag>
            </div>
            <div class="prompt-card-desc">{{ item.description }}</div>
            <div class="prompt-card-vars">
              <el-tag v-for="v in item.variables" :key="v.name" size="small" type="success" effect="plain">{{ varLabel(v.name) }}</el-tag>
            </div>
          </div>
          <div class="prompt-card-actions">
            <el-button v-if="item.customized" size="small" text type="danger" @click="resetFromCard(item)">恢复默认</el-button>
            <el-button size="small" @click="openPromptEditor(item)">编辑</el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 提示词编辑对话框 -->
    <el-dialog
      v-model="promptDialog.visible"
      :title="`编辑提示词：${promptDialog.name}`"
      width="760px"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
    >
      <div class="prompt-editor">
        <el-alert
          v-if="missingVars.length > 0"
          type="warning"
          :closable="false"
          show-icon
          class="prompt-editor-alert"
        >
          <template #title>
            模板中缺少必需变量：{{ missingVars.join('、') }}，运行时这些位置的上下文将不会被填充
          </template>
        </el-alert>
        <div class="prompt-editor-row">
          <span class="prompt-editor-label">可用变量（点击插入到光标处）：</span>
          <div class="prompt-editor-vars">
            <el-tag
              v-for="v in promptDialog.variables"
              :key="v.name"
              size="small"
              type="success"
              effect="plain"
              class="prompt-var-chip"
              @click="insertVariable(v.name)"
            >{{ varLabel(v.name) }}</el-tag>
          </div>
        </div>
        <el-input
          ref="promptEditorTextareaRef"
          v-model="promptDialog.template"
          type="textarea"
          :rows="16"
          resize="vertical"
          class="prompt-editor-textarea"
          placeholder="请输入提示词模板"
        />
        <el-collapse class="prompt-builtin-collapse">
          <el-collapse-item title="查看内置默认模板">
            <pre class="prompt-builtin-pre">{{ promptDialog.builtinTemplate }}</pre>
          </el-collapse-item>
        </el-collapse>
      </div>
      <template #footer>
        <el-tooltip content="当前为内置默认模板，无需恢复" :disabled="promptDialog.customized" placement="top">
          <span class="prompt-reset-wrap">
            <el-button
              type="danger"
              plain
              :disabled="!promptDialog.customized"
              :loading="promptDialog.resetting"
              @click="resetPrompt"
            >恢复默认</el-button>
          </span>
        </el-tooltip>
        <el-button @click="promptDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="promptDialog.saving" @click="savePromptTemplate">保存</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue';
import type { AiPromptInfo } from '../../../../shared/types';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';

const visible = defineModel<boolean>({ required: true });

const promptList = ref<AiPromptInfo[]>([]);
const promptLoading = ref(false);
const promptEditorTextareaRef = ref<{ textarea?: HTMLTextAreaElement } | null>(null);
const promptDialog = reactive({
  visible: false,
  key: '',
  name: '',
  template: '',
  builtinTemplate: '',
  customized: false,
  saving: false,
  resetting: false,
  variables: [] as AiPromptInfo['variables'],
});
// 编辑器内实时校验：模板中缺失的必需变量
const missingVars = computed(() => {
  const item = promptList.value.find(p => p.key === promptDialog.key);
  if (!item) return [];
  const used = new Set<string>();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(promptDialog.template)) !== null) used.add(m[1]);
  return item.variables.filter(v => !used.has(v.name)).map(v => `{{${v.name}}}`);
});
function varLabel(name: string) {
  return '{{' + name + '}}';
}

async function loadPrompts() {
  if (!window.api) return;
  promptLoading.value = true;
  try {
    const res = await window.api.ai.listPrompts();
    if (res.success && res.data) {
      promptList.value = res.data;
    } else {
      ElMessage.error('加载提示词列表失败：' + (res.error?.message || '未知错误'));
    }
  } catch (e) {
    console.error('加载提示词列表失败:', e);
  } finally {
    promptLoading.value = false;
  }
}

function openPromptEditor(item: AiPromptInfo) {
  promptDialog.key = item.key;
  promptDialog.name = item.name;
  promptDialog.template = item.template;
  promptDialog.builtinTemplate = item.builtinTemplate;
  promptDialog.customized = item.customized;
  promptDialog.variables = item.variables;
  promptDialog.saving = false;
  promptDialog.resetting = false;
  promptDialog.visible = true;
}

function insertVariable(name: string) {
  const chip = '{{' + name + '}}';
  const textarea = promptEditorTextareaRef.value?.textarea as HTMLTextAreaElement | undefined;
  if (!textarea) {
    promptDialog.template += chip;
    return;
  }
  const start = textarea.selectionStart ?? promptDialog.template.length;
  const end = textarea.selectionEnd ?? start;
  promptDialog.template = promptDialog.template.slice(0, start) + chip + promptDialog.template.slice(end);
  nextTick(() => {
    textarea.focus();
    const pos = start + chip.length;
    textarea.setSelectionRange(pos, pos);
  });
}

async function savePromptTemplate() {
  if (!window.api) return;
  const template = promptDialog.template.trim();
  if (!template) {
    ElMessage.warning('模板内容不能为空');
    return;
  }
  if (template.length > 20000) {
    ElMessage.warning('模板内容过长（上限 20000 字符）');
    return;
  }
  if (missingVars.value.length > 0) {
    try {
      await ElMessageBox.confirm(
        `模板中缺少必需变量：${missingVars.value.join('、')}，运行时对应上下文将无法填充。确定仍要保存吗？`,
        '缺少必需变量',
        { confirmButtonText: '仍要保存', cancelButtonText: '返回修改', type: 'warning' },
      );
    } catch {
      return;
    }
  }
  promptDialog.saving = true;
  try {
    const res = await window.api.ai.savePrompt({ key: promptDialog.key, template });
    if (res.success) {
      ElMessage.success('提示词已保存，立即生效');
      promptDialog.visible = false;
      await loadPrompts();
    } else {
      ElMessage.error('保存失败：' + (res.error?.message || '未知错误'));
    }
  } catch (e) {
    console.error('保存提示词失败:', e);
    ElMessage.error('保存失败');
  } finally {
    promptDialog.saving = false;
  }
}

async function confirmAndReset(key: string, name: string) {
  if (!window.api) return false;
  try {
    await ElMessageBox.confirm(
      '确定要恢复「' + name + '」为内置默认模板吗？当前自定义内容将被清除。',
      '恢复默认模板',
      { confirmButtonText: '确定恢复', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return false;
  }
  const res = await window.api.ai.resetPrompt({ key });
  if (!res.success) {
    ElMessage.error('恢复失败：' + (res.error?.message || '未知错误'));
    return false;
  }
  ElMessage.success('已恢复为内置默认模板');
  return true;
}

async function resetPrompt() {
  if (!window.api) return;
  const ok = await confirmAndReset(promptDialog.key, promptDialog.name);
  if (!ok) return;
  promptDialog.resetting = true;
  try {
    const item = promptList.value.find(p => p.key === promptDialog.key);
    if (item) {
      promptDialog.template = item.builtinTemplate;
      promptDialog.customized = false;
    }
    promptDialog.visible = false;
    await loadPrompts();
  } catch (e) {
    console.error('恢复默认模板失败:', e);
    ElMessage.error('恢复失败');
  } finally {
    promptDialog.resetting = false;
  }
}

async function resetFromCard(item: AiPromptInfo) {
  if (!window.api) return;
  const ok = await confirmAndReset(item.key, item.name);
  if (ok) await loadPrompts();
}

watch(visible, (v) => {
  if (v) loadPrompts();
});
</script>

<style scoped lang="scss">
.prompt-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-toolbar {
  display: flex;
  align-items: flex-start;
  gap: 8px;

  .prompt-hint {
    flex: 1;
    padding: 10px 14px;
    background: var(--color-primary-light);
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--color-primary);
    line-height: 1.6;

    code {
      padding: 0 4px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: var(--radius-sm);
      font-family: 'Consolas', 'Monaco', monospace;
    }
  }
}

.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 60px;
}

.prompt-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-base);
  background: var(--bg-hover);

  .prompt-card-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prompt-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .prompt-card-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .prompt-card-desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .prompt-card-vars {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .prompt-card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    align-self: flex-start;

    :deep(.el-button + .el-button) {
      margin-left: 0;
    }
  }
}

.prompt-reset-wrap {
  display: inline-block;
  margin-right: 12px;
}

.prompt-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .prompt-editor-alert {
    --el-alert-padding: 8px 12px;
  }

  .prompt-editor-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .prompt-editor-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .prompt-editor-vars {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .prompt-var-chip {
    cursor: pointer;

    &:hover {
      opacity: 0.8;
    }
  }

  .prompt-editor-textarea {
    :deep(.el-textarea__inner) {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      line-height: 1.6;
    }
  }

  .prompt-builtin-collapse {
    border-top: 1px dashed var(--border-color);
    border-bottom: none;

    :deep(.el-collapse-item__header) {
      font-size: 12px;
      color: var(--text-secondary);
      border-bottom: none;
    }

    :deep(.el-collapse-item__wrap) {
      border-bottom: none;
    }
  }

  .prompt-builtin-pre {
    margin: 0;
    padding: 10px 12px;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 260px;
    overflow-y: auto;
    color: var(--text-primary);
  }
}
</style>
