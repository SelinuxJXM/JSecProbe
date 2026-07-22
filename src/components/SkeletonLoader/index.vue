<template>
  <div class="skeleton-loader" :class="{ dark: isDark }">
    <div v-if="type === 'card'" class="skeleton-card">
      <div class="skeleton-header">
        <div class="skeleton-line skeleton-line-short"></div>
        <div class="skeleton-line skeleton-line-long"></div>
      </div>
      <div class="skeleton-body">
        <div v-for="i in rows" :key="i" class="skeleton-row">
          <div class="skeleton-circle"></div>
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-line-medium"></div>
            <div class="skeleton-line skeleton-line-short"></div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="type === 'table'" class="skeleton-table">
      <div class="skeleton-table-header">
        <div v-for="i in columns" :key="'h-' + i" class="skeleton-line skeleton-line-thin"></div>
      </div>
      <div v-for="r in rows" :key="'r-' + r" class="skeleton-table-row">
        <div v-for="c in columns" :key="'c-' + r + '-' + c" class="skeleton-line skeleton-line-thin"></div>
      </div>
    </div>

    <div v-else-if="type === 'list'" class="skeleton-list">
      <div v-for="i in rows" :key="'l-' + i" class="skeleton-list-item">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-content">
          <div class="skeleton-line skeleton-line-long"></div>
          <div class="skeleton-line skeleton-line-short"></div>
        </div>
      </div>
    </div>

    <div v-else-if="type === 'markdown'" class="skeleton-markdown">
      <div class="skeleton-line skeleton-line-title"></div>
      <div class="skeleton-line skeleton-line-long"></div>
      <div class="skeleton-line skeleton-line-medium"></div>
      <div class="skeleton-line skeleton-line-long"></div>
      <div class="skeleton-line skeleton-line-short"></div>
      <div class="skeleton-line skeleton-line-medium"></div>
      <div class="skeleton-line skeleton-line-long"></div>
      <div class="skeleton-line skeleton-line-short"></div>
    </div>

    <div v-else class="skeleton-default">
      <div v-for="i in rows" :key="'d-' + i" class="skeleton-line"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  type?: 'card' | 'table' | 'list' | 'markdown' | 'default';
  rows?: number;
  columns?: number;
  dark?: boolean;
}>(), {
  type: 'default',
  rows: 4,
  columns: 6,
  dark: false,
});

const isDark = computed(() => props.dark || document.documentElement.classList.contains('dark'));
</script>

<style scoped>
.skeleton-loader {
  --skeleton-bg: #f5f5f5;
  --skeleton-bg-dark: #2a2a2a;
  --skeleton-highlight: #e8e8e8;
  --skeleton-highlight-dark: #3a3a3a;
  --skeleton-radius: 6px;
  width: 100%;
}

.skeleton-loader.dark {
  --skeleton-bg: var(--skeleton-bg-dark);
  --skeleton-highlight: var(--skeleton-highlight-dark);
}

.skeleton-line,
.skeleton-circle,
.skeleton-avatar {
  background: linear-gradient(
    90deg,
    var(--skeleton-bg) 25%,
    var(--skeleton-highlight) 50%,
    var(--skeleton-bg) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite ease-in-out;
  border-radius: var(--skeleton-radius);
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-line {
  height: 14px;
  margin-bottom: 10px;
  width: 100%;
}

.skeleton-line-short { width: 40%; }
.skeleton-line-medium { width: 65%; }
.skeleton-line-long { width: 85%; }
.skeleton-line-title { height: 20px; width: 30%; margin-bottom: 16px; }
.skeleton-line-thin { height: 12px; }

.skeleton-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  margin-right: 12px;
  flex-shrink: 0;
}

.skeleton-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  margin-right: 14px;
  flex-shrink: 0;
}

/* Card type */
.skeleton-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--skeleton-bg);
}

.skeleton-body {
  padding: 12px 20px;
}

.skeleton-row {
  display: flex;
  align-items: flex-start;
  padding: 10px 0;
}

.skeleton-content {
  flex: 1;
}

/* Table type */
.skeleton-table-header {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--skeleton-bg);
}

.skeleton-table-header > div {
  flex: 1;
  margin-bottom: 0;
}

.skeleton-table-row {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--skeleton-bg);
}

.skeleton-table-row > div {
  flex: 1;
  margin-bottom: 0;
}

/* List type */
.skeleton-list-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--skeleton-bg);
}

.skeleton-list-item .skeleton-content {
  flex: 1;
}

/* Markdown type */
.skeleton-markdown {
  padding: 20px;
}

.skeleton-markdown .skeleton-line {
  margin-bottom: 14px;
}

.skeleton-default {
  padding: 16px 20px;
}
</style>
