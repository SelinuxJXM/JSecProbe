<template>
  <div class="category-tree">
    <div
      v-for="node in treeData"
      :key="node.id"
      class="tree-node"
    >
      <div
        class="tree-node-content"
        :class="{
          'is-active': selectedId === node.id,
          'is-expanded': expandedIds.has(node.id),
          'is-leaf': !hasChildren(node.id)
        }"
        :style="{ paddingLeft: (depth * 16 + 12) + 'px' }"
        @click="handleSelect(node)"
        @contextmenu.stop.prevent="handleContextMenu(node)"
      >
        <span
          v-if="hasChildren(node.id)"
          class="tree-expand-icon"
          @click.stop="toggleExpand(node.id)"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :style="{ transform: expandedIds.has(node.id) ? 'rotate(90deg)' : 'rotate(0deg)' }"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span v-else class="tree-expand-icon tree-expand-icon-empty"></span>

        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          :stroke="node.color || '#409EFF'"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="tree-node-icon"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>

        <span class="tree-node-label">{{ node.name }}</span>
        <span v-if="node.documentCount" class="tree-node-count">
          {{ node.documentCount }}
        </span>
      </div>

      <div v-if="expandedIds.has(node.id) && hasChildren(node.id)" class="tree-node-children">
        <RecursiveCategoryTree
          :categories="getChildrenOf(node.id)"
          :selected-id="selectedId"
          :expanded-ids="expandedIds"
          :depth="depth + 1"
          :all-categories="allCategories"
          @select="emitSelect"
          @toggle="emitToggle"
          @context-menu="emitContextMenu"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface CategoryNode {
  id: string;
  parentId?: string;
  name: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  documentCount: number;
  children?: CategoryNode[];
}

const props = withDefaults(defineProps<{
  categories: CategoryNode[];
  selectedId?: string;
  expandedIds: Set<string>;
  depth?: number;
  allCategories?: CategoryNode[];
}>(), {
  depth: 0,
  allCategories: () => [],
});

const emit = defineEmits<{
  select: [id: string];
  toggle: [id: string];
  'context-menu': [event: MouseEvent, node: CategoryNode];
}>();

function emitSelect(id: string): void {
  emit('select', id);
}

function emitToggle(id: string): void {
  emit('toggle', id);
}

function emitContextMenu(event: MouseEvent, node: CategoryNode): void {
  emit('context-menu', event, node);
}

const treeData = computed(() => {
  return [...props.categories].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
});

function hasChildren(parentId: string): boolean {
  return props.allCategories.some(c => c.parentId === parentId);
}

function getChildrenOf(parentId: string): CategoryNode[] {
  return props.allCategories
    .filter(c => c.parentId === parentId)
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });
}

function handleSelect(node: CategoryNode): void {
  emitSelect(node.id);
  if (hasChildren(node.id)) {
    emitToggle(node.id);
  }
}

function toggleExpand(id: string): void {
  emitToggle(id);
}

function handleContextMenu(node: CategoryNode): void {
  // 右键事件交由父组件处理菜单显示
  emitContextMenu({} as MouseEvent, node);
}
</script>

<style scoped>
.category-tree {
  display: flex;
  flex-direction: column;
}

.tree-node {
  position: relative;
}

.tree-node-content {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-secondary, #606266);
  font-size: 13px;
  transition: background 0.15s, color 0.15s;
  user-select: none;
}

.tree-node-content:hover {
  background: var(--color-bg-hover, #f5f7fa);
}

.tree-node-content.is-active {
  background: var(--color-primary-subtle, #ecf5ff);
  color: var(--color-primary, #409EFF);
  font-weight: 500;
}

.tree-expand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: transform 0.2s;
}

.tree-expand-icon-empty {
  visibility: hidden;
}

.tree-node-icon {
  flex-shrink: 0;
}

.tree-node-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node-count {
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--color-bg-tag, #f4f4f5);
  color: var(--color-text-tertiary, #909399);
  font-size: 11px;
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.tree-node-children {
  padding-left: 0;
}
</style>
