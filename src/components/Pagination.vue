<template>
  <div class="pagination-wrapper">
    <span class="total-text">共 {{ total }} 条</span>
    <el-pagination
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="pageSizes"
      :pager-count="5"
      size="small"
      @current-change="handleCurrentChange"
      @size-change="handleSizeChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
interface Props {
  total: number;
  currentPage?: number;
  pageSize?: number;
  pageSizes?: number[];
}

const props = withDefaults(defineProps<Props>(), {
  currentPage: 1,
  pageSize: 20,
  pageSizes: () => [10, 20, 50],
});

const emit = defineEmits<{
  (e: 'update:currentPage', value: number): void;
  (e: 'update:pageSize', value: number): void;
  (e: 'current-change', value: number): void;
  (e: 'size-change', value: number): void;
}>();

const currentPage = computed({
  get: () => props.currentPage,
  set: (value) => emit('update:currentPage', value),
});

const pageSize = computed({
  get: () => props.pageSize,
  set: (value) => emit('update:pageSize', value),
});

function handleCurrentChange(value: number) {
  emit('current-change', value);
}

function handleSizeChange(value: number) {
  emit('size-change', value);
  emit('update:currentPage', 1);
}
</script>

<style scoped lang="scss">
.pagination-wrapper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-light);

  .total-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
}
</style>