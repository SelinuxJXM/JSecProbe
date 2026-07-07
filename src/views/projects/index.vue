<template>
  <div class="page-container">
    <div class="card project-card">
      <!-- Tab导航栏 -->
      <div class="card-tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'active' }"
          @click="activeTab = 'active'; loadProjects()"
        >
          未归档项目
          <span class="tab-badge">{{ stats.activeCount }}</span>
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'archived' }"
          @click="activeTab = 'archived'; loadProjects()"
        >
          已归档项目
          <span class="tab-badge muted">{{ stats.archivedCount }}</span>
        </button>
      </div>

      <!-- 工具栏 -->
      <div class="toolbar">
        <div class="toolbar-left">
          <button class="toolbar-btn" @click="handleImport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>导入</span>
          </button>
          <button class="toolbar-btn" @click="handleExport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>导出</span>
          </button>
          <button class="toolbar-btn primary" @click="addEmptyRow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>新建项目</span>
          </button>
        </div>
        <div class="toolbar-right">
          <div class="search-box">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input v-model="keyword" type="text" placeholder="搜索项目" class="search-input" @input="onSearch" />
          </div>
          <button class="icon-btn" title="筛选" @click="showFilter = !showFilter">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          </button>
          <button class="icon-btn" title="刷新" @click="loadProjects">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>

      <!-- 数据表格 -->
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-index">序号</th>
              <th class="col-no">项目编号</th>
              <th class="col-name">项目名称</th>
              <th class="col-system">系统名称</th>
              <th class="col-unit">被测单位</th>
              <th class="col-standard">标准体系</th>
              <th class="col-level">等级组合</th>
              <th class="col-ext">扩展类型</th>
              <th class="col-progress">项目进度</th>
              <th class="col-time">修改时间</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in projectList" :key="row.id" :class="{ active: currentRowIndex === index, new: row.id < 0 }" @click="selectRow(index)" @dblclick="goToDetail(row)">
              <td class="col-index">{{ row.id < 0 ? '新' : index + 1 }}</td>
              <td class="col-no">
                <input v-if="row.id < 0 || editedRows.has(String(row.id))" v-model="row.projectNo" class="cell-input mono" placeholder="DJCP-001（留空自动生成）" />
                <span v-else class="mono-text">{{ row.projectNo }}</span>
              </td>
              <td class="col-name">
                <input v-if="row.id < 0 || editedRows.has(String(row.id))" v-model="row.name" class="cell-input" placeholder="项目名称" />
                <span v-else>{{ row.name }}</span>
              </td>
              <td class="col-system">
                <input v-if="row.id < 0 || editedRows.has(String(row.id))" v-model="row.systemName" class="cell-input" placeholder="系统名称" />
                <span v-else class="text-secondary">{{ row.systemName }}</span>
              </td>
              <td class="col-unit">
                <input v-if="row.id < 0 || editedRows.has(String(row.id))" v-model="row.assessedUnit" class="cell-input" placeholder="被测单位" />
                <span v-else class="text-secondary">{{ row.assessedUnit }}</span>
              </td>
              <td class="col-standard">
                <select v-if="row.id < 0 || editedRows.has(String(row.id))" v-model="row.standardSystem" class="cell-select">
                  <option value="新国标-正式版">新国标-正式版</option>
                  <option value="新国标-试行版">新国标-试行版</option>
                  <option value="旧国标">旧国标</option>
                </select>
                <span v-else class="text-secondary">{{ row.standardSystem }}</span>
              </td>
              <td class="col-level">
                <input v-if="row.id < 0 || editedRows.has(String(row.id))" v-model="row.levelCombo" class="cell-input level-input" placeholder="S3A3G3" />
                <span v-else class="level-text">{{ row.levelCombo }}</span>
              </td>
              <td class="col-ext">
                <div v-if="row.id < 0 || editedRows.has(String(row.id))" class="ext-select-wrapper">
                  <span class="ext-display" @click="openExtDialog(row)">{{ formatExtDisplay(row.extensionTypes) }}</span>
                </div>
                <span v-else class="text-secondary">{{ formatExtDisplay(row.extensionTypes) }}</span>
              </td>
              <td class="col-progress">
                <div class="progress-cell">
                  <div class="progress-bar" :class="getProgressClass(row.progress)">
                    <div class="progress-fill" :style="{ width: (row.progress || 0) + '%' }"></div>
                  </div>
                  <span class="progress-text" :class="getProgressClass(row.progress)">{{ row.progress || 0 }}%</span>
                </div>
              </td>
              <td class="col-time">
                <span class="time-text">{{ formatDate(row.updatedAt) }}</span>
              </td>
              <td class="col-actions">
                <button class="action-btn enter" @click.stop="goToDetail(row)" title="进入项目">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button class="action-btn edit" @click.stop="toggleEdit(row)" title="编辑">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="action-btn archive" @click.stop="toggleArchive(row)" :title="row.status === 'archived' ? '取消归档' : '归档'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                </button>
                <button class="action-btn delete" @click.stop="handleDelete(row)" title="删除">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 底部栏：合并信息、分页、操作 -->
      <div class="pagination-bar">
        <div class="footer-left">
          <span class="total-text">共 {{ pagination.total }} 条</span>
          <span v-if="editedCount > 0" class="edited-badge">{{ editedCount }} 项待保存</span>
        </div>
        <div class="pagination-btns">
          <button class="page-btn" :disabled="pagination.page <= 1" @click="pagination.page--; loadProjects()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button v-for="p in visiblePages" :key="p" class="page-btn" :class="{ active: pagination.page === p }" @click="pagination.page = p; loadProjects()">
            {{ p }}
          </button>
          <button class="page-btn" :disabled="pagination.page >= totalPages" @click="pagination.page++; loadProjects()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="footer-right">
          <button class="footer-btn" @click="loadProjects">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>刷新</span>
          </button>
          <button class="footer-btn primary" @click="saveAllChanges" :loading="saving" :disabled="editedCount === 0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>保存修改</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 扩展类型多选弹窗 -->
    <div v-if="extDialogVisible" class="dialog-overlay" @click.self="closeExtDialog">
      <div class="ext-dialog">
        <div class="ext-dialog-header">
          <span>选择扩展要求（可多选）</span>
          <button class="close-btn" @click="closeExtDialog">×</button>
        </div>
        <div class="ext-dialog-body">
          <label v-for="ext in extensionOptions" :key="ext.value" class="ext-checkbox-item">
            <input type="checkbox" :value="ext.value" v-model="extDialogSelected" />
            <span>{{ ext.label }}</span>
          </label>
        </div>
        <div class="ext-dialog-footer">
          <button class="ext-dialog-btn cancel" @click="closeExtDialog">取消</button>
          <button class="ext-dialog-btn confirm" @click="confirmExtDialog">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAppStore } from '@/stores/app';

const router = useRouter();
const appStore = useAppStore();
const loading = ref(false);
const saving = ref(false);
const activeTab = ref('active');
const keyword = ref('');
const showFilter = ref(false);
const projectList = ref<any[]>([]);
const stats = reactive({ activeCount: 0, archivedCount: 0 });
const currentRowIndex = ref(-1);

// 编辑状态追踪
const editedRows = reactive(new Set<string>());
const deletedIds = reactive(new Set<string>());
const editedCount = computed(() => editedRows.size + deletedIds.size);

let tempIdCounter = -1;

// 扩展类型选项
const extensionOptions = [
  { label: '云计算安全扩展要求', value: '云计算安全扩展要求' },
  { label: '物联网安全扩展要求', value: '物联网安全扩展要求' },
  { label: '移动互联安全扩展要求', value: '移动互联安全扩展要求' },
  { label: '工业控制系统安全扩展要求', value: '工业控制系统安全扩展要求' },
  { label: '大数据安全扩展要求', value: '大数据安全扩展要求' },
  { label: '关键信息基础设施安全扩展要求', value: '关键信息基础设施安全扩展要求' },
];

// 扩展类型多选弹窗
const extDialogVisible = ref(false);
const extDialogRow = ref<any>(null);
const extDialogSelected = ref<string[]>([]);

function openExtDialog(row: any) {
  extDialogRow.value = row;
  extDialogSelected.value = row.extensionTypes ? [...row.extensionTypes] : [];
  extDialogVisible.value = true;
}

function closeExtDialog() {
  extDialogVisible.value = false;
  extDialogRow.value = null;
  extDialogSelected.value = [];
}

function confirmExtDialog() {
  if (extDialogRow.value) {
    extDialogRow.value.extensionTypes = [...extDialogSelected.value];
    // 标记当前行已编辑
    editedRows.add(String(extDialogRow.value.id));
  }
  closeExtDialog();
}

function formatExtDisplay(extTypes: string[] | undefined): string {
  if (!extTypes || extTypes.length === 0) return '—';
  if (extTypes.length <= 2) return extTypes.map(t => t.replace('安全扩展要求', '')).join('、');
  return `${extTypes.slice(0, 2).map(t => t.replace('安全扩展要求', '')).join('、')}等${extTypes.length}项`;
}

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
});

const totalPages = computed(() => Math.ceil(pagination.total / pagination.pageSize) || 1);
const visiblePages = computed(() => {
  const pages: number[] = [];
  const start = Math.max(1, pagination.page - 1);
  const end = Math.min(totalPages.value, pagination.page + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});

function getProgressClass(progress: number) {
  if (progress >= 100) return 'complete';
  if (progress >= 50) return 'high';
  if (progress >= 20) return 'medium';
  return 'low';
}

function formatDate(date: string) {
  if (!date) return '-';
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    pagination.page = 1;
    loadProjects();
  }, 300);
}

function selectRow(index: number) {
  currentRowIndex.value = index;
}

function toggleEdit(row: any) {
  if (editedRows.has(String(row.id))) {
    editedRows.delete(String(row.id));
  } else {
    editedRows.add(String(row.id));
  }
}

function parseLevelFromCombo(levelCombo: string): number {
  // 从等级组合字符串中提取等级数字，如 "S2A2G2" → 2, "S3A3G3" → 3
  // 等保等级是统一的，取 S/A/G 中的数字（通常都相同）
  const match = levelCombo?.match(/S(\d)A(\d)G(\d)/);
  if (match) {
    // 取三个数字中的最大值作为测评等级
    return Math.max(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
  }
  // 默认三级
  return 3;
}

function addEmptyRow() {
  const newRow: any = {
    id: tempIdCounter--,
    projectNo: '',
    name: '',
    systemName: '',
    assessedUnit: '',
    standardSystem: '新国标-正式版',
    levelCombo: 'S3A3G3',
    extensionTypes: [] as string[],
    progress: 0,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  editedRows.add(String(newRow.id));
  projectList.value.unshift(newRow);
  currentRowIndex.value = 0;
}

async function loadProjects() {
  loading.value = true;
  try {
    if (!window.api) return;

    const isActive = activeTab.value === 'active';
    const listParams: any = {
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: keyword.value || undefined,
    };
    if (isActive) {
      listParams.excludeArchived = true;
    } else {
      listParams.status = 'archived';
    }

    const res = await window.api.project.list(listParams);
    if (res.success && res.data) {
      projectList.value = res.data.list.map(row => ({
        ...row,
        extensionTypes: row.extensionType ? row.extensionType.split(',').filter(Boolean) : [],
      }));
      pagination.total = res.data.total;
      editedRows.clear();
      deletedIds.clear();
      currentRowIndex.value = -1;
    }

    const activeRes = await window.api.project.list({ page: 1, pageSize: 1, excludeArchived: true });
    if (activeRes.success && activeRes.data) stats.activeCount = activeRes.data.total;
    const archivedRes = await window.api.project.list({ page: 1, pageSize: 1, status: 'archived' });
    if (archivedRes.success && archivedRes.data) stats.archivedCount = archivedRes.data.total;
  } finally {
    loading.value = false;
  }
}

async function saveAllChanges() {
  saving.value = true;
  let created = 0, updated = 0, deleted = 0;
  try {
    for (const id of deletedIds) {
      const res = await window.api.project.remove(id);
      if (res.success) deleted++;
    }
    deletedIds.clear();

    for (const row of projectList.value) {
      const isEdited = editedRows.has(String(row.id));
      if (!isEdited && row.id > 0) continue;

      if (row.id < 0) {
        if (!row.name?.trim()) continue;
        const res = await window.api.project.create({
          projectNo: row.projectNo || undefined,
          name: row.name.trim(),
          systemName: row.systemName,
          assessedUnit: row.assessedUnit,
          standardSystem: row.standardSystem,
          levelCombo: row.levelCombo,
          extensionType: row.extensionTypes && row.extensionTypes.length > 0 ? row.extensionTypes.join(',') : undefined,
          level: parseLevelFromCombo(row.levelCombo),
        });
        if (res.success) created++;
      } else {
        const res = await window.api.project.update(row.id, {
          projectNo: row.projectNo,
          name: row.name,
          systemName: row.systemName,
          assessedUnit: row.assessedUnit,
          standardSystem: row.standardSystem,
          levelCombo: row.levelCombo,
          extensionType: row.extensionTypes && row.extensionTypes.length > 0 ? row.extensionTypes.join(',') : undefined,
          level: parseLevelFromCombo(row.levelCombo),
        });
        if (res.success) updated++;
      }
    }
    const msgs: string[] = [];
    if (created > 0) msgs.push(`新增 ${created} 条`);
    if (updated > 0) msgs.push(`更新 ${updated} 条`);
    if (deleted > 0) msgs.push(`删除 ${deleted} 条`);
    if (msgs.length > 0) ElMessage.success(msgs.join('，'));
    else ElMessage.info('没有需要保存的修改');
    editedRows.clear();
    await loadProjects();
  } finally {
    saving.value = false;
  }
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm('确定要删除该项目吗？', '确认删除', { type: 'warning' });
  } catch {
    return;
  }
  if (row.id < 0) {
    projectList.value = projectList.value.filter(r => r.id !== row.id);
    editedRows.delete(String(row.id));
  } else {
    deletedIds.add(String(row.id));
    editedRows.delete(String(row.id));
    projectList.value = projectList.value.filter(r => r.id !== row.id);
  }
}

function goToDetail(row: any) {
  if (row.id < 0) {
    ElMessage.warning('请先保存新建项目');
    return;
  }
  appStore.setCurrentProject(row.id);
  router.push(`/projects/${row.id}/assets`);
}

async function toggleArchive(row: any) {
  if (row.id < 0) {
    ElMessage.warning('请先保存新建项目');
    return;
  }
  const newStatus = row.status === 'archived' ? 'draft' : 'archived';
  const action = newStatus === 'archived' ? '归档' : '取消归档';
  try {
    await ElMessageBox.confirm(`确定${action}该项目吗？`, '确认操作');
  } catch {
    return;
  }
  const res = await window.api.project.update(row.id, { status: newStatus });
  if (res.success) {
    ElMessage.success(`${action}成功`);
    loadProjects();
  } else {
    ElMessage.error(res.error?.message || `${action}失败`);
  }
}

async function handleImport() {
  const res = await window.api.project.import();
  if (res.success) {
    ElMessage.success(`导入成功，共导入 ${res.data?.imported || 0} 个项目`);
    loadProjects();
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '导入失败');
  }
}

async function handleExport() {
  const res = await window.api.project.exportAll();
  if (res.success) ElMessage.success('导出成功');
  else if (res.error?.message !== '用户取消') ElMessage.error(res.error?.message || '导出失败');
}

onMounted(loadProjects);
</script>

<style lang="scss" scoped>
.page-container {
  padding: 24px;
  background: var(--color-bg-page, #F5F6FA);
  min-height: calc(100vh - 52px);
}

.project-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg, 8px);
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.04));
}

.card-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-default, #E5E7EB);
  padding: 0 20px;

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 16px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-tertiary, #9CA3AF);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
    transition: all 0.15s;

    &.active {
      color: var(--color-primary, #1B5FD9);
      border-bottom-color: var(--color-primary, #1B5FD9);
    }

    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 18px;
      padding: 0 6px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;

      &.muted {
        background: var(--color-bg-page, #F5F6FA);
        color: var(--color-text-tertiary, #9CA3AF);
      }
      background: var(--color-primary-light, #E8F0FE);
      color: var(--color-primary, #1B5FD9);
    }
  }
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  gap: 12px;

  .toolbar-left, .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: var(--radius-md, 6px);
    background: var(--color-bg-card);
    color: var(--color-text-secondary, #4B5563);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      border-color: var(--color-primary, #1B5FD9);
      color: var(--color-primary, #1B5FD9);
    }

    &.primary {
      border: none;
      background: var(--color-primary, #1B5FD9);
      color: #fff;

      &:hover {
        background: var(--color-primary-hover, #1550B8);
      }
    }
  }

  .search-box {
    position: relative;

    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-text-tertiary, #9CA3AF);
    }

    .search-input {
      height: 32px;
      padding: 0 12px 0 32px;
      border: 1px solid var(--color-border-default, #E5E7EB);
      border-radius: var(--radius-md, 6px);
      font-size: 12px;
      color: var(--color-text-primary, #111827);
      background: var(--color-bg-card);
      outline: none;
      width: 200px;
      transition: border-color 0.15s;

      &:focus {
        border-color: var(--color-primary, #1B5FD9);
      }
    }
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: var(--radius-md, 6px);
    background: var(--color-bg-card);
    cursor: pointer;
    color: var(--color-text-secondary, #4B5563);
    transition: all 0.15s;

    &:hover {
      border-color: var(--color-primary, #1B5FD9);
      color: var(--color-primary, #1B5FD9);
    }
  }
}

.table-wrapper {
  overflow-x: auto;

  .data-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    min-width: 1100px;

    thead tr {
      background: var(--color-bg-hover);

      th {
        height: 44px;
        padding: 0 16px;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary, #4B5563);
        text-align: left;
        border-bottom: 1px solid var(--color-border-default, #E5E7EB);
        white-space: nowrap;

        &.col-index { width: 56px; }
        &.col-no { width: 180px; }
        &.col-name { min-width: 160px; }
        &.col-system { min-width: 140px; }
        &.col-unit { min-width: 140px; }
        &.col-standard { width: 120px; }
        &.col-level { width: 100px; }
        &.col-ext { width: 140px; }
        &.col-progress { width: 120px; }
        &.col-time { width: 140px; }
        &.col-actions { width: 120px; }
      }
    }

    tbody tr {
      height: 44px;
      cursor: pointer;
      transition: background 0.12s;

      &:hover {
        background: var(--color-bg-surface-hover, #FAFBFD);
      }

      &.active {
        background: var(--color-primary-lighter, #F0F5FF);
      }

      &.new {
        background: var(--color-warning-light);

        &:hover {
          background: var(--color-warning-light);
        }
      }

      td {
        padding: 0 16px;
        font-size: 13px;
        color: var(--color-text-primary, #111827);
        border-bottom: 1px solid var(--color-border-light, #F0F0F3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .col-index {
        color: var(--color-text-secondary, #4B5563);
        text-align: center;
      }

      .col-no {
        .mono-text {
          font-family: var(--font-family-mono, monospace);
          font-size: 11px;
        }
      }

      .col-system, .col-unit {
        color: var(--color-text-secondary, #4B5563);
      }

      .col-standard {
        color: var(--color-text-secondary, #4B5563);
      }

      .col-level {
        .level-text {
          color: var(--color-primary, #1B5FD9);
          font-weight: 500;
        }
      }

      .col-ext {
        color: var(--color-text-secondary, #4B5563);
      }

      .col-progress {
        .progress-cell {
          display: flex;
          align-items: center;
          gap: 8px;

          .progress-bar {
            flex: 1;
            height: 6px;
            background: var(--color-primary-light, #E8F0FE);
            border-radius: 3px;
            min-width: 60px;

            .progress-fill {
              height: 100%;
              border-radius: 3px;
              transition: width 0.2s;
            }
          }

          .progress-text {
            font-size: 11px;
            font-weight: 500;
            white-space: nowrap;

            &.complete { color: #16A34A; }
            &.high, &.medium, &.low { color: var(--color-primary, #1B5FD9); }
          }

          .progress-bar.complete {
            background: var(--color-success-light);
            .progress-fill { background: #16A34A; }
          }
          .progress-bar.high .progress-fill { background: var(--color-primary, #1B5FD9); }
          .progress-bar.medium .progress-fill { background: #D97706; }
          .progress-bar.low .progress-fill { background: #9CA3AF; }
        }
      }

      .col-time {
        color: var(--color-text-tertiary, #9CA3AF);
        font-size: 12px;
      }

      .col-actions {
        display: flex;
        align-items: center;
        gap: 4px;

        .action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: 1px solid var(--color-border-default, #E5E7EB);
          border-radius: var(--radius-md, 6px);
          background: var(--color-bg-card);
          cursor: pointer;
          color: var(--color-text-tertiary, #9CA3AF);
          transition: all 0.15s;

          &:hover {
            border-color: var(--color-primary, #1B5FD9);
            color: var(--color-primary, #1B5FD9);
          }

          &.enter:hover {
            background: var(--color-primary-light, #E8F0FE);
          }

          &.edit:hover {
            background: var(--color-primary-light, #E8F0FE);
          }

          &.archive:hover {
            background: var(--color-warning-light);
            border-color: #D97706;
            color: #D97706;
          }

          &.delete:hover {
            background: var(--color-danger-light);
            border-color: #DC2626;
            color: #DC2626;
          }
        }
      }
    }
  }

  .cell-input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: var(--radius-sm, 2px);
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    background: var(--color-bg-card);
    outline: none;

    &:focus {
      border-color: var(--color-primary, #1B5FD9);
      box-shadow: 0 0 0 2px rgba(27, 95, 217, 0.1);
    }
  }

  .cell-select {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: var(--radius-sm, 2px);
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    background: var(--color-bg-card);
    outline: none;

    &:focus {
      border-color: var(--color-primary, #1B5FD9);
    }
  }

  .mono {
    font-family: var(--font-family-mono, monospace);
    font-size: 11px;
  }

  .level-input {
    color: var(--color-primary, #1B5FD9);
    font-weight: 500;
  }

  .text-secondary {
    color: var(--color-text-secondary, #4B5563);
  }
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-light, #F0F0F3);
  background: var(--color-bg-base);

  .footer-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;

    .total-text {
      font-size: 12px;
      color: var(--color-text-tertiary, #9CA3AF);
      white-space: nowrap;
    }

    .edited-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--color-warning-light);
      color: #D97706;
      font-size: 11px;
      font-weight: 500;
    }
  }

  .pagination-btns {
    display: flex;
    align-items: center;
    gap: 4px;

    .page-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid var(--color-border-default, #E5E7EB);
      border-radius: var(--radius-sm, 2px);
      background: var(--color-bg-card);
      cursor: pointer;
      color: var(--color-text-secondary, #4B5563);
      font-size: 12px;
      transition: all 0.15s;

      &:hover:not(:disabled) {
        border-color: var(--color-primary, #1B5FD9);
        color: var(--color-primary, #1B5FD9);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        color: var(--color-text-tertiary, #9CA3AF);
      }

      &.active {
        border-color: var(--color-primary, #1B5FD9);
        background: var(--color-primary, #1B5FD9);
        color: #fff;
        font-weight: 500;
      }
    }
  }

  .footer-right {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .footer-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: var(--radius-md, 6px);
    background: var(--color-bg-card);
    color: var(--color-text-secondary, #4B5563);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover:not(:disabled) {
      border-color: var(--color-primary, #1B5FD9);
      color: var(--color-primary, #1B5FD9);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &.primary {
      border: none;
      background: var(--color-primary, #1B5FD9);
      color: #fff;

      &:hover:not(:disabled) {
        background: var(--color-primary-hover, #1550B8);
      }

      &:disabled {
        background: #9CA3AF;
      }
    }
  }
}

// 扩展类型多选弹窗
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
  z-index: 1000;
}

.ext-dialog {
  background: var(--color-bg-card);
  border-radius: 8px;
  width: 420px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.ext-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #E5E7EB;
  font-size: 15px;
  font-weight: 600;
  color: #111827;

  .close-btn {
    background: none;
    border: none;
    font-size: 20px;
    color: #9CA3AF;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      color: #4B5563;
    }
  }
}

.ext-dialog-body {
  padding: 20px;
  max-height: 400px;
  overflow-y: auto;
}

.ext-checkbox-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  cursor: pointer;
  border-radius: 4px;
  margin-bottom: 4px;

  &:hover {
    background: var(--color-bg-hover);
  }

  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  span {
    font-size: 14px;
    color: #374151;
  }
}

.ext-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid #E5E7EB;
  background: var(--color-bg-base);
}

.ext-dialog-btn {
  padding: 8px 18px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: all 0.15s;

  &.cancel {
    background: var(--color-bg-card);
    color: #4B5563;
    border: 1px solid #D1D5DB;

    &:hover {
      background: var(--color-bg-hover);
    }
  }

  &.confirm {
    background: #1B5FD9;
    color: #fff;

    &:hover {
      background: #1a56c0;
    }
  }
}

.ext-select-wrapper {
  width: 100%;
}

.ext-display {
  display: inline-block;
  width: 100%;
  padding: 4px 8px;
  color: #1B5FD9;
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: var(--color-primary-light);
    border-radius: 4px;
  }
}
</style>