<template>
  <div v-if="visible" class="dialog-overlay" @click.self="close">
    <div class="archive-dialog">
      <div class="archive-dialog-header">
        <span>导出项目</span>
        <button class="close-btn" @click="close">×</button>
      </div>

      <div class="archive-dialog-body">
        <div class="section">
          <div class="section-head">
            <span class="section-title">选择项目</span>
            <div class="section-actions">
              <button class="mini-btn" @click="selectAll">全选</button>
              <button class="mini-btn" @click="selected = []">清空</button>
            </div>
          </div>
          <div class="project-list">
            <label v-for="p in projects" :key="p.id" class="project-item">
              <input type="checkbox" :value="p.id" v-model="selected" />
              <span class="project-name">{{ p.name }}</span>
              <span class="project-meta">{{ p.systemName }}</span>
              <span class="project-count">{{ p.assetCount }} 资产</span>
            </label>
            <div v-if="projects.length === 0" class="empty-hint">当前条件下没有可导出的项目</div>
          </div>
        </div>

        <div class="section">
          <span class="section-title">导出内容</span>
          <label class="radio-item">
            <input type="radio" value="archive" v-model="format" />
            <div class="radio-text">
              <span class="radio-label">完整归档包（.zip）<span class="tag-recommend">推荐</span></span>
              <span class="radio-desc">项目信息 + 资产 + 测评记录 + 问题清单 + 采集结果 + 截图证据 + 依赖标准。可在别的机器上原样还原。</span>
            </div>
          </label>
          <label class="radio-item">
            <input type="radio" value="excel" v-model="format" />
            <div class="radio-text">
              <span class="radio-label">表格清单（.xlsx）</span>
              <span class="radio-desc">仅项目字段，供台账/汇报使用，不能导回系统。</span>
            </div>
          </label>
        </div>

        <div v-if="format === 'archive'" class="section">
          <span class="section-title">归档选项</span>
          <label class="check-item">
            <input type="checkbox" v-model="includeStandards" />
            <div class="radio-text">
              <span class="radio-label">包含测评标准</span>
              <span class="radio-desc">带上项目使用的标准与测评项，否则换机还原后测评记录会没有题干。</span>
            </div>
          </label>
          <label class="check-item">
            <input type="checkbox" v-model="includeCredentials" />
            <div class="radio-text">
              <span class="radio-label">包含设备连接口令</span>
              <span class="radio-desc">口令经系统安全存储加密，与本机绑定，换机后即使带上也解不开。外发给他人时请不要勾选。</span>
            </div>
          </label>
          <div class="field">
            <span class="field-label">加密口令（可选，至少 8 位）</span>
            <input v-model="password" type="password" class="text-input" placeholder="留空则不加密" />
          </div>
        </div>
      </div>

      <div class="archive-dialog-footer">
        <span class="footer-hint">已选 {{ selected.length }} 个项目</span>
        <div class="footer-btns">
          <button class="dialog-btn cancel" @click="close">取消</button>
          <button class="dialog-btn confirm" :disabled="busy || selected.length === 0" @click="confirm">
            {{ busy ? '导出中…' : '导出' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

export interface ExportProjectOption {
  id: string;
  name: string;
  systemName: string;
  assetCount: number;
}

export interface ExportPayload {
  projectIds: string[];
  format: 'archive' | 'excel';
  password: string;
  includeStandards: boolean;
  includeCredentials: boolean;
}

const props = defineProps<{
  visible: boolean;
  projects: ExportProjectOption[];
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'confirm', payload: ExportPayload): void;
}>();

const selected = ref<string[]>([]);
const format = ref<'archive' | 'excel'>('archive');
const includeStandards = ref(true);
const includeCredentials = ref(false);
const password = ref('');

// 每次打开都按当前列表全选，避免沿用上一次的勾选造成误导出
watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    selected.value = props.projects.map(p => p.id);
    format.value = 'archive';
    password.value = '';
  },
);

function selectAll() {
  selected.value = props.projects.map(p => p.id);
}

function close() {
  emit('update:visible', false);
}

function confirm() {
  emit('confirm', {
    projectIds: [...selected.value],
    format: format.value,
    password: password.value || '',
    includeStandards: includeStandards.value,
    includeCredentials: includeCredentials.value,
  });
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
}

.archive-dialog {
  background: var(--color-bg-card, #fff);
  border-radius: 8px;
  width: 560px;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.archive-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-base, #e5e7eb);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--color-text-tertiary, #9ca3af);
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: var(--color-text-secondary, #4b5563);
  }
}

.archive-dialog-body {
  padding: 4px 20px 16px;
  overflow-y: auto;
}

.section {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border-light, #eef1f6);

  &:last-child {
    border-bottom: none;
  }
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.section-actions {
  display: flex;
  gap: 8px;
}

.mini-btn {
  background: none;
  border: 1px solid var(--color-border-base, #e2e6ed);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--color-text-secondary, #4a5568);
  cursor: pointer;

  &:hover {
    background: var(--color-bg-hover, #f0f4f9);
  }
}

.project-list {
  margin-top: 10px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--color-border-light, #eef1f6);
  border-radius: 6px;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-primary, #1a2332);

  &:hover {
    background: var(--color-bg-hover, #f0f4f9);
  }

  input[type='checkbox'] {
    width: 15px;
    height: 15px;
    cursor: pointer;
    flex-shrink: 0;
  }
}

.project-name {
  font-weight: 500;
  flex-shrink: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-meta {
  color: var(--color-text-tertiary, #8b95a7);
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-count {
  color: var(--color-text-tertiary, #8b95a7);
  font-size: 12px;
  flex-shrink: 0;
}

.empty-hint {
  padding: 16px;
  text-align: center;
  color: var(--color-text-tertiary, #8b95a7);
  font-size: 13px;
}

.radio-item,
.check-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 8px;
  cursor: pointer;
  border-radius: 6px;

  &:hover {
    background: var(--color-bg-hover, #f0f4f9);
  }

  input {
    margin-top: 2px;
    cursor: pointer;
    flex-shrink: 0;
  }
}

.radio-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.radio-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary, #1a2332);
}

.tag-recommend {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--color-bg-active, #e8f0fd);
  color: var(--color-text-secondary, #4a5568);
}

.radio-desc {
  font-size: 12px;
  color: var(--color-text-tertiary, #8b95a7);
  line-height: 1.5;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}

.field-label {
  font-size: 12px;
  color: var(--color-text-secondary, #4a5568);
}

.text-input {
  border: 1px solid var(--color-border-base, #e2e6ed);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--color-bg-base, #f5f7fa);
  color: var(--color-text-primary, #1a2332);
  outline: none;

  &:focus {
    border-color: var(--color-primary, #3b82f6);
  }
}

.archive-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-base, #e5e7eb);
}

.footer-hint {
  font-size: 12px;
  color: var(--color-text-tertiary, #8b95a7);
}

.footer-btns {
  display: flex;
  gap: 10px;
}

.dialog-btn {
  padding: 7px 18px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--color-border-base, #e2e6ed);

  &.cancel {
    background: transparent;
    color: var(--color-text-secondary, #4a5568);
  }

  &.confirm {
    background: var(--color-primary, #3b82f6);
    border-color: var(--color-primary, #3b82f6);
    color: #fff;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}
</style>
