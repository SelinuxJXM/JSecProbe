<template>
  <div class="titlebar">
    <div class="titlebar-drag" @dblclick="onToggleMaximize">
      <span class="titlebar-name">JSecProbe</span>
      <span class="titlebar-sub">等级保护现场测评系统</span>
    </div>
    <div class="titlebar-controls">
      <button class="tb-btn" title="最小化" @click="onMinimize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
      </button>
      <button class="tb-btn" :title="isMaximized ? '还原' : '最大化'" @click="onToggleMaximize">
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" stroke-width="1" fill="none" />
          <path d="M2.5 2.5v-2h7v7h-2" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
      </button>
      <button class="tb-btn tb-close" title="关闭" @click="onClose">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const isMaximized = ref(false);
let removeMaximizeListener: (() => void) | null = null;

function onMinimize(): void {
  window.api?.window.minimize();
}

function onToggleMaximize(): void {
  window.api?.window.maximizeToggle();
}

function onClose(): void {
  window.api?.window.close();
}

onMounted(async () => {
  if (!window.api?.window) return;
  try {
    const res = await window.api.window.isMaximized();
    if (res.success) {
      isMaximized.value = !!res.data;
    }
  } catch {
    isMaximized.value = false;
  }
  removeMaximizeListener = window.api.window.onMaximizeChange((maximized: boolean) => {
    isMaximized.value = maximized;
  });
});

onUnmounted(() => {
  removeMaximizeListener?.();
  removeMaximizeListener = null;
});
</script>

<style lang="scss" scoped>
.titlebar {
  height: var(--titlebar-height);
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-light);
  user-select: none;
  flex-shrink: 0;
}

.titlebar-drag {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 14px;
  overflow: hidden;
  -webkit-app-region: drag;
}

.titlebar-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.titlebar-sub {
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.titlebar-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.tb-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  outline: none;
}

.tb-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.tb-close:hover {
  background: #e81123;
  color: #ffffff;
}
</style>
