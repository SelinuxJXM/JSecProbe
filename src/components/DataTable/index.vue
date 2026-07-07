<template>
  <div class="data-table-container">
    <div class="table-toolbar" v-if="$slots.toolbar">
      <slot name="toolbar" />
    </div>
    <el-table
      :data="tableData"
      :loading="loading"
      :stripe="stripe"
      :border="border"
      :row-key="rowKey"
      @selection-change="handleSelectionChange"
      @sort-change="handleSortChange"
    >
      <el-table-column
        v-if="selection"
        type="selection"
        width="55"
        align="center"
      />
      <slot />
      <template #empty>
        <slot name="empty">
          <el-empty description="暂无数据" />
        </slot>
      </template>
    </el-table>
    <div class="table-pagination" v-if="showPagination && total > 0">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  data: any[];
  loading?: boolean;
  stripe?: boolean;
  border?: boolean;
  rowKey?: string;
  selection?: boolean;
  showPagination?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
}>(), {
  loading: false,
  stripe: true,
  border: false,
  rowKey: 'id',
  selection: false,
  showPagination: true,
  total: 0,
  page: 1,
  pageSize: 20,
});

const emit = defineEmits<{
  selectionChange: [selection: any[]];
  sortChange: [sort: { prop: string; order: string }];
  sizeChange: [size: number];
  currentChange: [page: number];
}>();

const tableData = ref<any[]>(props.data);
const currentPage = ref(props.page);
const pageSize = ref(props.pageSize);

watch(() => props.data, (newVal) => {
  tableData.value = newVal;
});

watch(() => props.page, (newVal) => {
  currentPage.value = newVal;
});

watch(() => props.pageSize, (newVal) => {
  pageSize.value = newVal;
});

function handleSelectionChange(selection: any[]) {
  emit('selectionChange', selection);
}

function handleSortChange(sort: { prop: string; order: string }) {
  emit('sortChange', sort);
}

function handleSizeChange(size: number) {
  emit('sizeChange', size);
}

function handleCurrentChange(page: number) {
  emit('currentChange', page);
}
</script>

<style scoped>
.data-table-container {
  width: 100%;
}

.table-toolbar {
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.table-pagination {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>