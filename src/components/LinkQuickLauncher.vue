<template>
  <el-dialog
    v-model="visible"
    class="link-launcher-dialog"
    width="760px"
    top="10vh"
    :show-close="false"
    :close-on-click-modal="true"
    :close-on-press-escape="true"
    append-to-body
    @opened="focusInput"
    @closed="reset"
  >
    <div class="lnk-launcher" @keydown="onKeydown">
      <div class="lnk-search">
        <el-input
          ref="inputRef"
          v-model="keyword"
          size="large"
          clearable
          placeholder="搜索名称、网址或分组，回车打开"
          @input="activeIndex = 0"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <span class="lnk-shortcut">Ctrl+L</span>
      </div>

      <div ref="listRef" class="lnk-list">
        <div v-if="loading" class="lnk-empty">正在加载链接…</div>
        <template v-for="group in groups" :key="group.name">
          <div class="lnk-group-title">{{ group.name }}</div>
          <div class="lnk-card-grid">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="lnk-card"
              :class="{ active: item.id === activeId, stale: item.isStale }"
              @mouseenter="setActive(item.id)"
              @click="open(item)"
            >
              <div class="lnk-card-top">
                <span class="lnk-icon">{{ item.iconText || item.title.charAt(0) }}</span>
                <span class="lnk-tags">
                  <span class="lnk-tag">{{ sourceLabel(item.source) }}</span>
                  <span class="lnk-tag" :class="item.networkZone">{{ item.networkZone === 'intranet' ? '内网' : '需外网' }}</span>
                </span>
              </div>
              <div class="lnk-title">
                {{ item.title }}
                <el-icon v-if="item.isFavorite" class="lnk-star"><Star /></el-icon>
              </div>
              <div class="lnk-url" :title="item.url">{{ linkHost(item.url) }}</div>
              <div class="lnk-desc" :title="item.description">{{ item.description || '点击卡片打开链接' }}</div>
              <div class="lnk-card-foot">
                <span v-if="item.isStale" class="lnk-tag warn">疑似失效</span>
                <span>访问 ↗</span>
              </div>
            </div>
          </div>
        </template>
        <div v-if="!loading && flat.length === 0" class="lnk-empty">
          {{ keyword ? '没有匹配的链接' : '还没有可用链接，可在「系统设置 → 外链管理」中添加' }}
        </div>
      </div>

      <div class="lnk-footer">
        <span>上下键选择 · Enter 打开 · Ctrl+Enter 复制 · Esc 关闭</span>
        <el-button text size="small" @click="copy(activeItem)">复制当前链接</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Search, Star } from '@element-plus/icons-vue';
import type { ExternalLinkItem, LinkOpenContext } from '../../shared/types';
import { copyExternalLink, openExternalLink, sourceLabel } from '@/utils/external-link';
import { linkHost } from '@/utils/link-host';

const props = defineProps<{
  modelValue: boolean;
  context?: LinkOpenContext;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const inputRef = ref<{ focus: () => void } | null>(null);
const listRef = ref<HTMLElement | null>(null);
const keyword = ref('');
const loading = ref(false);
const links = ref<ExternalLinkItem[]>([]);
const activeIndex = ref(0);

const flat = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return links.value;
  return links.value.filter((item) =>
    `${item.title} ${item.url} ${item.groupName} ${item.description}`.toLowerCase().includes(k)
  );
});

const groups = computed(() => {
  const map = new Map<string, ExternalLinkItem[]>();
  for (const item of flat.value) {
    const list = map.get(item.groupName) || [];
    list.push(item);
    map.set(item.groupName, list);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
});

const activeItem = computed(() => flat.value[activeIndex.value] || null);
const activeId = computed(() => activeItem.value?.id || '');

async function load(): Promise<void> {
  if (!window.api?.externalLink) return;
  loading.value = true;
  try {
    const res = await window.api.externalLink.list();
    links.value = res.success && res.data ? res.data.filter((l) => !l.isHidden) : [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      keyword.value = '';
      activeIndex.value = 0;
      void load();
    }
  },
  { immediate: true }
);

function focusInput(): void {
  nextTick(() => inputRef.value?.focus());
}

function reset(): void {
  keyword.value = '';
  activeIndex.value = 0;
}

function setActive(id: string): void {
  const index = flat.value.findIndex((item) => item.id === id);
  if (index >= 0) activeIndex.value = index;
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    listRef.value?.querySelector('.lnk-card.active')?.scrollIntoView({ block: 'nearest' });
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, Math.max(flat.value.length - 1, 0));
    scrollActiveIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    scrollActiveIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = activeItem.value;
    if (!item) return;
    if (e.ctrlKey || e.metaKey) {
      void copy(item);
    } else {
      void open(item);
    }
  }
}

async function open(item: ExternalLinkItem): Promise<void> {
  const ok = await openExternalLink(item, props.context || {});
  if (ok) visible.value = false;
}

async function copy(item: ExternalLinkItem | null): Promise<void> {
  if (!item) return;
  await copyExternalLink(item, props.context || {});
}
</script>

<style scoped lang="scss">
.lnk-launcher {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lnk-search {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lnk-shortcut {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
  border: 1px solid var(--color-border-base);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
}

.lnk-list {
  max-height: 52vh;
  overflow-y: auto;
  padding-right: 4px;
}

.lnk-group-title {
  font-size: 12px;
  color: var(--color-text-tertiary);
  padding: 12px 2px 6px;
}

.lnk-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.lnk-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border-base);
  border-radius: var(--radius-lg);
  background: var(--color-bg-card);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  &:hover,
  &.active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }

  &.active {
    transform: translateY(-1px);
  }

  &.stale .lnk-title {
    text-decoration: line-through;
    color: var(--color-text-tertiary);
  }
}

.lnk-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
}

.lnk-icon {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--color-info-light);
  color: var(--color-primary);
  font-size: 13px;
}

.lnk-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lnk-star {
  color: var(--color-warning);
  font-size: 12px;
}

.lnk-url {
  font-size: 11px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lnk-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 32px;
}

.lnk-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-light);
  font-size: 11px;
  color: var(--color-primary);
}

.lnk-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.lnk-tag {
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-bg-tag);
  border-radius: var(--radius-sm);
  padding: 1px 5px;

  &.intranet {
    color: var(--color-success);
    background: var(--color-success-light);
  }

  &.warn {
    color: var(--color-warning);
    background: var(--color-warning-light);
  }
}

.lnk-empty {
  text-align: center;
  padding: 32px 12px;
  font-size: 13px;
  color: var(--color-text-tertiary);
}

.lnk-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--color-border-light);
  padding-top: 8px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

:deep(.el-dialog__header) {
  display: none;
}

:deep(.el-dialog__body) {
  padding: 16px;
}
</style>
