<template>
  <el-tree
    ref="treeRef"
    :data="treeData"
    :node-key="nodeKey"
    :default-expanded-keys="defaultExpandedKeys"
    :default-checked-keys="defaultCheckedKeys"
    :show-checkbox="showCheckbox"
    :highlight-current="highlightCurrent"
    :expand-on-click-node="expandOnClickNode"
    :check-strictly="checkStrictly"
    @node-click="handleNodeClick"
    @node-contextmenu="handleNodeContextmenu"
  >
    <template #default="{ node, data }">
      <slot :node="node" :data="data">
        <span class="tree-node">
          <el-icon v-if="data.icon" class="tree-node-icon">
            <component :is="data.icon" />
          </el-icon>
          <span class="tree-node-label">{{ node.label }}</span>
          <span class="tree-node-count" v-if="data.count !== undefined">({{ data.count }})</span>
        </span>
      </slot>
    </template>
  </el-tree>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{
  data: any[];
  props?: any;
  nodeKey?: string;
  defaultExpandedKeys?: string[];
  defaultCheckedKeys?: string[];
  showCheckbox?: boolean;
  highlightCurrent?: boolean;
  expandOnClickNode?: boolean;
  checkStrictly?: boolean;
}>(), {
  nodeKey: 'id',
  defaultExpandedKeys: () => [],
  defaultCheckedKeys: () => [],
  showCheckbox: false,
  highlightCurrent: true,
  expandOnClickNode: true,
  checkStrictly: false,
});

const emit = defineEmits<{
  nodeClick: [data: any, node: any];
  nodeContextmenu: [event: MouseEvent, data: any, node: any];
}>();

const treeRef = ref();

const treeData = ref<any[]>(props.data);

function handleNodeClick(data: any, node: any) {
  emit('nodeClick', data, node);
}

function handleNodeContextmenu(event: MouseEvent, data: any, node: any) {
  emit('nodeContextmenu', event, data, node);
}

defineExpose({
  treeRef,
});
</script>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
}

.tree-node-icon {
  font-size: 16px;
  color: #909399;
}

.tree-node-label {
  flex: 1;
}

.tree-node-count {
  font-size: 12px;
  color: #909399;
}
</style>