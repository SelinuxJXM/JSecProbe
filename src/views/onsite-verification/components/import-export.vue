<template>
  <div class="import-export-actions">
    <el-dropdown @command="handleExportCommand">
      <el-button class="toolbar-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>导出</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="excel">导出Excel</el-dropdown-item>
          <el-dropdown-item command="pdf">导出PDF</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <el-button class="toolbar-btn" @click="handleImportExcel">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span>导入测评结果</span>
    </el-button>

    <!-- 导出选择弹窗 -->
    <el-dialog
      v-model="exportDialogVisible"
      title="选择导出内容"
      width="520px"
      class="export-dialog"
      :close-on-click-modal="false"
    >
      <div class="export-tree-container">
        <div class="export-tree-header">
          <label class="checkbox-label">
            <input type="checkbox"
              :checked="isAllSelected"
              :indeterminate="isIndeterminate"
              @change="toggleSelectAll" />
            <span>全选</span>
          </label>
          <span class="selected-count">{{ selectedTotalCount }} / {{ totalCount }}</span>
        </div>
        <div class="export-tree">
          <div v-for="domain in exportTreeData" :key="domain.id" class="tree-group">
            <div v-if="!domain.children || domain.children.length === 0" class="tree-leaf">
              <label class="tree-item-label">
                <input type="checkbox" :value="`domain:${domain.id}`" v-model="selectedExportItems" />
                <span class="item-text">{{ domain.label }}</span>
              </label>
            </div>
            <div v-else class="tree-node">
              <div class="tree-node-header" @click="toggleExportDomain(domain.id)">
                <svg class="tree-chevron" :class="{ expanded: expandedExportDomains.includes(domain.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                <label class="tree-item-label" @click.stop>
                  <input type="checkbox"
                    :checked="isDomainAllSelected(domain)"
                    :indeterminate="isDomainIndeterminate(domain)"
                    @change="toggleDomainSelectAll(domain)" />
                </label>
                <span class="item-text parent-text">{{ domain.label }}</span>
                <span class="item-count">{{ getDomainSelectedCount(domain) }}/{{ domain.children.length }}</span>
              </div>
              <div v-show="expandedExportDomains.includes(domain.id)" class="tree-children">
                <div v-for="child in domain.children" :key="child.id" class="tree-leaf child-leaf">
                  <label class="tree-item-label">
                    <input type="checkbox" :value="`asset:${child.id}`" v-model="selectedExportItems" />
                    <span class="item-text">{{ child.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="exportDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="confirmExport" :disabled="selectedExportItems.length === 0">
          导出选中
        </el-button>
      </template>
    </el-dialog>

    <!-- 导入选择弹窗 -->
    <el-dialog
      v-model="importDialogVisible"
      title="选择导入内容"
      width="520px"
      class="export-dialog"
      :close-on-click-modal="false"
    >
      <div class="export-tree-container">
        <div class="export-tree-header">
          <label class="checkbox-label">
            <input type="checkbox"
              :checked="isImportAllSelected"
              :indeterminate="isImportIndeterminate"
              @change="toggleImportSelectAll" />
            <span>全选</span>
          </label>
          <span class="selected-count">{{ selectedImportItems.length }} / {{ importTotalCount }}</span>
        </div>
        <div class="export-tree">
          <div v-for="domain in importTreeData" :key="domain.id" class="tree-group">
            <div v-if="!domain.children || domain.children.length === 0" class="tree-leaf">
              <label class="tree-item-label">
                <input type="checkbox" :value="`domain:${domain.id}`" v-model="selectedImportItems" />
                <span class="item-text">{{ domain.label }}</span>
              </label>
            </div>
            <div v-else class="tree-node">
              <div class="tree-node-header" @click="toggleImportDomain(domain.id)">
                <svg class="tree-chevron" :class="{ expanded: expandedImportDomains.includes(domain.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                <label class="tree-item-label" @click.stop>
                  <input type="checkbox"
                    :checked="isImportDomainAllSelected(domain)"
                    :indeterminate="isImportDomainIndeterminate(domain)"
                    @change="toggleImportDomainSelectAll(domain)" />
                </label>
                <span class="item-text parent-text">{{ domain.label }}</span>
                <span class="item-count">{{ getImportDomainSelectedCount(domain) }}/{{ domain.children.length }}</span>
              </div>
              <div v-show="expandedImportDomains.includes(domain.id)" class="tree-children">
                <div v-for="child in domain.children" :key="child.id" class="tree-leaf child-leaf">
                  <label class="tree-item-label">
                    <input type="checkbox" :value="`asset:${child.id}`" v-model="selectedImportItems" />
                    <span class="item-text">{{ child.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="confirmImport" :disabled="selectedImportItems.length === 0">
          选择文件导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';

// 树节点类型
interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  [key: string]: any;
}

// Props 定义
const props = defineProps<{
  treeData: TreeNode[];
  projectId: string;
}>();

// Emits 定义
const emit = defineEmits<{
  refresh: [];
}>();

// ==================== 导出选择弹窗 ====================
const exportDialogVisible = ref(false);
const selectedExportItems = ref<string[]>([]);
const expandedExportDomains = ref<string[]>([]);
const exporting = ref(false);

const exportTreeData = computed(() => {
  return props.treeData.map(domain => ({
    id: domain.id,
    label: domain.label,
    children: domain.children || [],
  }));
});

const totalCount = computed(() => {
  let count = 0;
  for (const domain of exportTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      count++;
    } else {
      count += domain.children.length;
    }
  }
  return count;
});

const selectedTotalCount = computed(() => selectedExportItems.value.length);

const isAllSelected = computed(() => {
  return selectedExportItems.value.length === totalCount.value && totalCount.value > 0;
});

const isIndeterminate = computed(() => {
  return selectedExportItems.value.length > 0 && selectedExportItems.value.length < totalCount.value;
});

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedExportItems.value = [];
  } else {
    const allItems: string[] = [];
    for (const domain of exportTreeData.value) {
      if (!domain.children || domain.children.length === 0) {
        allItems.push(`domain:${domain.id}`);
      } else {
        for (const child of domain.children) {
          allItems.push(`asset:${child.id}`);
        }
      }
    }
    selectedExportItems.value = allItems;
  }
}

function isDomainAllSelected(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) {
    return selectedExportItems.value.includes(`domain:${domain.id}`);
  }
  return domain.children.every((child: TreeNode) => selectedExportItems.value.includes(`asset:${child.id}`));
}

function isDomainIndeterminate(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) return false;
  const selected = domain.children.filter((child: TreeNode) => selectedExportItems.value.includes(`asset:${child.id}`)).length;
  return selected > 0 && selected < domain.children.length;
}

function getDomainSelectedCount(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) return 0;
  return domain.children.filter((child: TreeNode) => selectedExportItems.value.includes(`asset:${child.id}`)).length;
}

function toggleDomainSelectAll(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) {
    const key = `domain:${domain.id}`;
    const idx = selectedExportItems.value.indexOf(key);
    if (idx > -1) {
      selectedExportItems.value.splice(idx, 1);
    } else {
      selectedExportItems.value.push(key);
    }
  } else {
    const allSelected = isDomainAllSelected(domain);
    if (allSelected) {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        const idx = selectedExportItems.value.indexOf(key);
        if (idx > -1) selectedExportItems.value.splice(idx, 1);
      }
    } else {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        if (!selectedExportItems.value.includes(key)) {
          selectedExportItems.value.push(key);
        }
      }
    }
  }
}

function toggleExportDomain(domainId: string) {
  const idx = expandedExportDomains.value.indexOf(domainId);
  if (idx > -1) {
    expandedExportDomains.value.splice(idx, 1);
  } else {
    expandedExportDomains.value.push(domainId);
  }
}

function loadExportSelection() {
  const allItems: string[] = [];
  for (const domain of exportTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      allItems.push(`domain:${domain.id}`);
    } else {
      for (const child of domain.children) {
        allItems.push(`asset:${child.id}`);
      }
    }
  }
  selectedExportItems.value = allItems;

  const domainsWithAssets = exportTreeData.value.filter(d => d.children && d.children.length > 0);
  expandedExportDomains.value = domainsWithAssets.map(d => d.id);
}

async function confirmExport() {
  if (selectedExportItems.value.length === 0) {
    ElMessage.warning('请至少选择一项导出内容');
    return;
  }

  const projectId = props.projectId;
  if (!projectId || !window.api) return;

  const domainIds: string[] = [];
  const assetIds: string[] = [];

  for (const item of selectedExportItems.value) {
    if (item.startsWith('domain:')) {
      domainIds.push(item.substring(7));
    } else if (item.startsWith('asset:')) {
      assetIds.push(item.substring(6));
    }
  }

  exporting.value = true;
  try {
    const res = await window.api.assessment.exportExcelByAssets(projectId, assetIds, domainIds);
    if (res.success) {
      ElMessage.success('导出成功');
      exportDialogVisible.value = false;
    } else if (res.error?.message !== '用户取消') {
      ElMessage.error(res.error?.message || '导出失败');
    }
  } catch (error: any) {
    console.error('导出失败:', error);
    ElMessage.error(error?.message || error?.toString() || '导出失败');
  } finally {
    exporting.value = false;
  }
}

// ==================== 导入选择弹窗 ====================
const importDialogVisible = ref(false);
const selectedImportItems = ref<string[]>([]);
const expandedImportDomains = ref<string[]>([]);
const importing = ref(false);

const importTreeData = computed(() => {
  return props.treeData.map(domain => ({
    id: domain.id,
    label: domain.label,
    children: domain.children || [],
  }));
});

const importTotalCount = computed(() => {
  let count = 0;
  for (const domain of importTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      count++;
    } else {
      count += domain.children.length;
    }
  }
  return count;
});

const isImportAllSelected = computed(() => {
  return selectedImportItems.value.length === importTotalCount.value && importTotalCount.value > 0;
});

const isImportIndeterminate = computed(() => {
  return selectedImportItems.value.length > 0 && selectedImportItems.value.length < importTotalCount.value;
});

function toggleImportSelectAll() {
  if (isImportAllSelected.value) {
    selectedImportItems.value = [];
  } else {
    const allItems: string[] = [];
    for (const domain of importTreeData.value) {
      if (!domain.children || domain.children.length === 0) {
        allItems.push(`domain:${domain.id}`);
      } else {
        for (const child of domain.children) {
          allItems.push(`asset:${child.id}`);
        }
      }
    }
    selectedImportItems.value = allItems;
  }
}

function isImportDomainAllSelected(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) {
    return selectedImportItems.value.includes(`domain:${domain.id}`);
  }
  return domain.children.every((child: TreeNode) => selectedImportItems.value.includes(`asset:${child.id}`));
}

function isImportDomainIndeterminate(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) return false;
  const selected = domain.children.filter((child: TreeNode) => selectedImportItems.value.includes(`asset:${child.id}`)).length;
  return selected > 0 && selected < domain.children.length;
}

function getImportDomainSelectedCount(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) return 0;
  return domain.children.filter((child: TreeNode) => selectedImportItems.value.includes(`asset:${child.id}`)).length;
}

function toggleImportDomainSelectAll(domain: TreeNode) {
  if (!domain.children || domain.children.length === 0) {
    const key = `domain:${domain.id}`;
    const idx = selectedImportItems.value.indexOf(key);
    if (idx > -1) {
      selectedImportItems.value.splice(idx, 1);
    } else {
      selectedImportItems.value.push(key);
    }
  } else {
    const allSelected = isImportDomainAllSelected(domain);
    if (allSelected) {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        const idx = selectedImportItems.value.indexOf(key);
        if (idx > -1) selectedImportItems.value.splice(idx, 1);
      }
    } else {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        if (!selectedImportItems.value.includes(key)) {
          selectedImportItems.value.push(key);
        }
      }
    }
  }
}

function toggleImportDomain(domainId: string) {
  const idx = expandedImportDomains.value.indexOf(domainId);
  if (idx > -1) {
    expandedImportDomains.value.splice(idx, 1);
  } else {
    expandedImportDomains.value.push(domainId);
  }
}

function loadImportSelection() {
  const allItems: string[] = [];
  for (const domain of importTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      allItems.push(`domain:${domain.id}`);
    } else {
      for (const child of domain.children) {
        allItems.push(`asset:${child.id}`);
      }
    }
  }
  selectedImportItems.value = allItems;

  const domainsWithAssets = importTreeData.value.filter(d => d.children && d.children.length > 0);
  expandedImportDomains.value = domainsWithAssets.map(d => d.id);
}

function handleImportExcel() {
  importDialogVisible.value = true;
  loadImportSelection();
}

async function confirmImport() {
  if (selectedImportItems.value.length === 0) {
    ElMessage.warning('请至少选择一项导入内容');
    return;
  }

  const projectId = props.projectId;
  if (!projectId || !window.api) {
    ElMessage.error('项目ID缺失或API未初始化');
    return;
  }

  try {
    const fileRes = await window.api.system.selectFile([
      { name: 'Excel文件', extensions: ['xlsx', 'xls'] },
    ]);
    if (!fileRes.success || !fileRes.data) return;

    const domainIds: string[] = [];
    const assetIds: string[] = [];
    for (const item of selectedImportItems.value) {
      if (item.startsWith('domain:')) {
        domainIds.push(item.substring(7));
      } else if (item.startsWith('asset:')) {
        assetIds.push(item.substring(6));
      }
    }

    importing.value = true;
    const res = await window.api.assessment.importExcel(projectId, fileRes.data, domainIds, assetIds);
    importing.value = false;

    if (res.success && res.data) {
      ElMessage.success(`成功导入 ${res.data.count} 条记录`);
      importDialogVisible.value = false;
      emit('refresh');
    }
  } catch (error: any) {
    importing.value = false;
    ElMessage.error(error.message || '导入失败');
  }
}

// ==================== 导出命令处理 ====================
async function handleExportCommand(command: string) {
  if (command === 'excel') {
    const projectId = props.projectId;
    if (!projectId || !window.api) return;

    exportDialogVisible.value = true;
    loadExportSelection();
  } else if (command === 'pdf') {
    ElMessage.info('PDF导出功能开发中');
  }
}
</script>

<style scoped lang="scss">
.import-export-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--color-border, #d9d9d9);
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  color: var(--color-text-primary, #333);
  transition: all 0.15s;

  &:hover {
    border-color: var(--color-primary, #1B5FD9);
    color: var(--color-primary, #1B5FD9);
    background: var(--color-primary-light, #f0f5ff);
  }
}

// 导出选择弹窗
.export-dialog {
  .export-tree-container {
    padding: 5px 0;
  }

  .export-tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--color-bg-base);
    border-radius: 6px;

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;

      input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
        flex-shrink: 0;
      }
    }

    .selected-count {
      color: #8c8c8c;
      font-size: 13px;
    }
  }

  .export-tree {
    max-height: 400px;
    overflow-y: auto;

    .tree-group {
      margin-bottom: 2px;
    }

    .tree-node-header {
      display: flex;
      align-items: center;
      padding: 6px 10px;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.15s;

      &:hover {
        background: var(--color-bg-hover);
      }

      .tree-chevron {
        flex-shrink: 0;
        width: 12px;
        height: 12px;
        margin-right: 4px;
        color: #bfbfbf;
        transition: transform 0.2s;

        &.expanded {
          transform: rotate(90deg);
        }
      }

      .tree-item-label {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-right: 6px;

        input[type="checkbox"] {
          width: 15px;
          height: 15px;
          cursor: pointer;
          flex-shrink: 0;
        }
      }

      .item-text {
        flex: 1;
        font-size: 14px;
        color: #333;

        &.parent-text {
          font-weight: 500;
        }
      }

      .item-count {
        font-size: 12px;
        color: #999;
        margin-left: 8px;
      }
    }

    .tree-leaf {
      .tree-item-label {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px 6px 32px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.15s;

        &:hover {
          background: var(--color-bg-hover);
        }

        input[type="checkbox"] {
          width: 15px;
          height: 15px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .item-text {
          font-size: 14px;
          color: #333;
        }
      }
    }
  }
}
</style>
