<template>
  <div v-if="visible && preview" class="dialog-overlay" @click.self="close">
    <div class="archive-dialog">
      <div class="archive-dialog-header">
        <span>导入项目归档</span>
        <button class="close-btn" @click="close">×</button>
      </div>

      <div class="archive-dialog-body">
        <div class="section">
          <div class="summary-grid">
            <div class="summary-cell">
              <span class="summary-value">{{ projectCount }}</span>
              <span class="summary-label">项目</span>
            </div>
            <div class="summary-cell">
              <span class="summary-value">{{ counts.assets || 0 }}</span>
              <span class="summary-label">资产</span>
            </div>
            <div class="summary-cell">
              <span class="summary-value">{{ counts.records || 0 }}</span>
              <span class="summary-label">测评记录</span>
            </div>
            <div class="summary-cell">
              <span class="summary-value">{{ counts.issues || 0 }}</span>
              <span class="summary-label">问题</span>
            </div>
            <div class="summary-cell">
              <span class="summary-value">{{ counts.files || 0 }}</span>
              <span class="summary-label">附件</span>
            </div>
          </div>
          <div class="pack-meta">
            归档版本 {{ preview.manifest.version }} · 由 v{{ preview.manifest.appVersion }} 于
            {{ formatTime(preview.manifest.createdAt) }} 导出
            <span v-if="preview.encrypted" class="enc-tag">已加密</span>
          </div>
        </div>

        <div class="section">
          <span class="section-title">包含的项目</span>
          <div class="project-list">
            <div v-for="p in preview.projects" :key="p.id" class="import-item">
              <div class="import-main">
                <span class="project-name">{{ p.name }}</span>
                <span v-if="p.existsLocally" class="conflict-tag">本机已存在</span>
              </div>
              <div class="import-meta">
                {{ p.systemName }} · 第{{ p.level }}级 ·
                {{ p.assetCount }} 资产 / {{ p.recordCount }} 记录 / {{ p.issueCount }} 问题
              </div>
            </div>
          </div>
        </div>

        <div v-if="conflictCount > 0" class="section">
          <span class="section-title">本机已存在 {{ conflictCount }} 个项目，如何处理？</span>
          <label class="radio-item">
            <input type="radio" value="copy" v-model="strategy" />
            <div class="radio-text">
              <span class="radio-label">另存为副本<span class="tag-recommend">推荐</span></span>
              <span class="radio-desc">保留现有项目，导入的项目名称后加「（导入副本）」。最安全。</span>
            </div>
          </label>
          <label class="radio-item">
            <input type="radio" value="overwrite" v-model="strategy" />
            <div class="radio-text">
              <span class="radio-label">覆盖现有项目</span>
              <span class="radio-desc">先删除本机的同名项目及其全部数据，再用归档内容重建。此操作不可撤销。</span>
            </div>
          </label>
          <label class="radio-item">
            <input type="radio" value="skip" v-model="strategy" />
            <div class="radio-text">
              <span class="radio-label">跳过这些项目</span>
              <span class="radio-desc">只导入本机不存在的项目。</span>
            </div>
          </label>
        </div>

        <div v-if="warningList.length" class="section">
          <span class="section-title">注意</span>
          <ul class="warn-list">
            <li v-for="(w, i) in warningList" :key="i">{{ w }}</li>
          </ul>
        </div>
      </div>

      <div class="archive-dialog-footer">
        <span class="footer-hint">导入不会改动归档外的其他项目</span>
        <div class="footer-btns">
          <button class="dialog-btn cancel" @click="close">取消</button>
          <button class="dialog-btn confirm" :disabled="busy" @click="confirm">
            {{ busy ? '导入中…' : '开始导入' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

interface PreviewProject {
  id: string;
  name: string;
  systemName: string;
  level: number;
  status: string;
  createdAt: string;
  assetCount: number;
  recordCount: number;
  issueCount: number;
  taskCount: number;
  existsLocally: boolean;
  localName?: string;
}

export interface ArchivePreview {
  manifest: {
    version: string;
    appVersion: string;
    createdAt: string;
    projects: PreviewProject[];
    counts: Record<string, number>;
    includeStandards: boolean;
    credentialsIncluded: boolean;
    encrypted: boolean;
  };
  projects: PreviewProject[];
  encrypted?: boolean;
  warnings?: string[];
}

const props = defineProps<{
  visible: boolean;
  preview: ArchivePreview | null;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'confirm', strategy: 'skip' | 'overwrite' | 'copy'): void;
}>();

const strategy = ref<'skip' | 'overwrite' | 'copy'>('copy');

watch(
  () => props.visible,
  (v) => {
    if (v) strategy.value = 'copy';
  },
);

const projectCount = computed(() => props.preview?.projects?.length ?? 0);
const counts = computed(() => props.preview?.manifest?.counts ?? {});
const warningList = computed(() => props.preview?.warnings ?? []);
const conflictCount = computed(
  () => (props.preview?.projects ?? []).filter(p => p.existsLocally).length,
);

function formatTime(iso: string): string {
  if (!iso) return '';
  return iso.replace('T', ' ').slice(0, 16);
}

function close() {
  emit('update:visible', false);
}

function confirm() {
  emit('confirm', conflictCount.value > 0 ? strategy.value : 'skip');
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
  border-radius: var(--radius-md);
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

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
}

.summary-grid {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.summary-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  border-radius: var(--radius-base);
  background: var(--color-bg-hover, #f0f4f9);
}

.summary-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary, #1a2332);
}

.summary-label {
  font-size: 12px;
  color: var(--color-text-tertiary, #8b95a7);
}

.pack-meta {
  font-size: 12px;
  color: var(--color-text-tertiary, #8b95a7);
}

.enc-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-active, #e8f0fd);
  color: var(--color-text-secondary, #4a5568);
}

.project-list {
  margin-top: 10px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--color-border-light, #eef1f6);
  border-radius: var(--radius-base);
}

.import-item {
  padding: 8px 10px;

  & + & {
    border-top: 1px solid var(--color-border-lighter, #f5f7fa);
  }
}

.import-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary, #1a2332);
}

.conflict-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-active, #e8f0fd);
  color: var(--color-text-secondary, #4a5568);
}

.import-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-text-tertiary, #8b95a7);
}

.radio-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 8px;
  cursor: pointer;
  border-radius: var(--radius-base);

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
  border-radius: var(--radius-sm);
  background: var(--color-bg-active, #e8f0fd);
  color: var(--color-text-secondary, #4a5568);
}

.radio-desc {
  font-size: 12px;
  color: var(--color-text-tertiary, #8b95a7);
  line-height: 1.5;
}

.warn-list {
  margin: 8px 0 0;
  padding-left: 18px;

  li {
    font-size: 12px;
    color: var(--color-text-secondary, #4a5568);
    line-height: 1.7;
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
  border-radius: var(--radius-base);
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
