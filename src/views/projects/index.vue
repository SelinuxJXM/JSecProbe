<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">项目列表</h1>
      <p class="page-subtitle">
        一个项目可包含多个被测系统；进入项目后，为每个系统单独填写系统构成、现场核查、风险分析与整改建议
      </p>
    </div>

    <div class="stat-row">
      <div class="stat-card">
        <span class="stat-label">未归档项目</span>
        <strong class="stat-value">{{ stats.activeCount }}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">已归档项目</span>
        <strong class="stat-value muted">{{ stats.archivedCount }}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">系统总数</span>
        <strong class="stat-value">{{ stats.systemCount }}</strong>
      </div>
    </div>

    <div class="card">
      <div class="card-tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'active' }"
          @click="switchTab('active')"
        >
          未归档项目
          <span class="tab-badge">{{ stats.activeCount }}</span>
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'archived' }"
          @click="switchTab('archived')"
        >
          已归档项目
          <span class="tab-badge muted">{{ stats.archivedCount }}</span>
        </button>
      </div>

      <div class="toolbar" data-guide="project-toolbar">
        <div class="toolbar-left">
          <button class="toolbar-btn primary" data-guide="project-create" @click="openCreate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>新建项目</span>
          </button>
          <button class="toolbar-btn" title="从归档包还原项目（含其下全部系统）" @click="handleImport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>导入归档</span>
          </button>
        </div>
        <div class="toolbar-right">
          <div class="search-box">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input v-model="keyword" type="text" placeholder="搜索项目名称 / 编号 / 被测单位" class="search-input" @input="onSearch" />
          </div>
          <button class="icon-btn" title="刷新" @click="loadAll">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>

      <div class="table-wrapper" v-loading="loading" element-loading-text="正在加载项目列表...">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-index">序号</th>
              <th class="col-no">项目编号</th>
              <th class="col-name">项目名称</th>
              <th class="col-unit">被测单位</th>
              <th class="col-systems">系统数</th>
              <th class="col-progress">测评进度</th>
              <th class="col-time">修改时间</th>
              <th class="col-status">状态</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="row.id" @dblclick="goToSystems(row)">
              <td class="col-index">{{ (pagination.page - 1) * pagination.pageSize + index + 1 }}</td>
              <td class="col-no"><span class="mono-text">{{ row.projectNo || '—' }}</span></td>
              <td class="col-name"><span :title="row.name">{{ row.name }}</span></td>
              <td class="col-unit"><span class="text-secondary" :title="row.assessedUnit || ''">{{ row.assessedUnit || '—' }}</span></td>
              <td class="col-systems">
                <button class="link-btn" @click.stop="goToSystems(row)">{{ row.systemCount }} 个系统</button>
              </td>
              <td class="col-progress">
                <div class="progress-cell">
                  <div class="progress-bar" :class="progressClass(row.progress)">
                    <div class="progress-fill" :style="{ width: (row.progress || 0) + '%' }"></div>
                  </div>
                  <span class="progress-text">{{ row.progress || 0 }}%</span>
                </div>
              </td>
              <td class="col-time"><span class="time-text">{{ formatDateTime(row.updatedAt) }}</span></td>
              <td class="col-status"><span class="status-tag" :class="'status-' + row.status">{{ statusLabel(row.status) }}</span></td>
              <td class="col-actions">
                <button class="action-btn enter" @click.stop="goToSystems(row)" title="进入项目 / 管理系统">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button class="action-btn export" @click.stop="openGroupExport(row)" title="导出整个项目（含其下全部系统）">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="action-btn report" @click.stop="openGroupReport(row)" title="生成项目合册报告（项目综述 + 各系统分册）">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
                </button>
                <button class="action-btn edit" @click.stop="openEdit(row)" title="编辑">
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
          <tbody v-if="!loading && rows.length === 0">
            <tr>
              <td colspan="9" class="empty-cell">
                <el-empty :description="emptyText">
                  <el-button v-if="activeTab === 'active' && !keyword" type="primary" @click="openCreate">新建第一个项目</el-button>
                </el-empty>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pagination-bar">
        <span class="total-text">共 {{ pagination.total }} 条</span>
        <div class="pagination-btns">
          <button class="page-btn" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="page-indicator">{{ pagination.page }} / {{ totalPages }}</span>
          <button class="page-btn" :disabled="pagination.page >= totalPages" @click="changePage(pagination.page + 1)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 新建 / 编辑项目：项目层只填台账信息，系统级信息在系统列表里填 -->
    <div v-if="dialogVisible" class="dialog-overlay" @click.self="closeDialog">
      <div class="form-dialog" role="dialog" aria-modal="true">
        <div class="form-dialog-header">
          <span>{{ editingId ? '编辑项目' : '新建项目' }}</span>
          <button class="close-btn" @click="closeDialog" aria-label="关闭">×</button>
        </div>
        <div class="form-dialog-body">
          <div class="form-row">
            <label class="form-field wide">
              <span class="form-label">项目名称 <em>*</em></span>
              <input v-model="form.name" class="form-input" placeholder="如：某单位 2026 年度等级保护测评" maxlength="120" @keyup.enter="submitDialog" />
            </label>
          </div>
          <div class="form-row">
            <label class="form-field">
              <span class="form-label">项目编号</span>
              <input v-model="form.projectNo" class="form-input mono" placeholder="留空自动生成 DJCP-XXX" maxlength="40" />
            </label>
            <label class="form-field">
              <span class="form-label">被测单位</span>
              <input v-model="form.assessedUnit" class="form-input" placeholder="被测单位名称" maxlength="120" />
            </label>
          </div>
          <div class="form-row">
            <label class="form-field">
              <span class="form-label">客户名称</span>
              <input v-model="form.customerName" class="form-input" placeholder="委托方 / 客户" maxlength="120" />
            </label>
            <label class="form-field">
              <span class="form-label">测评师</span>
              <input v-model="form.assessor" class="form-input" placeholder="项目负责人" maxlength="60" />
            </label>
          </div>
          <div class="form-row">
            <label class="form-field">
              <span class="form-label">开始日期</span>
              <input v-model="form.startDate" type="date" class="form-input" />
            </label>
            <label class="form-field">
              <span class="form-label">结束日期</span>
              <input v-model="form.endDate" type="date" class="form-input" />
            </label>
          </div>
          <label class="form-field wide">
            <span class="form-label">项目说明</span>
            <textarea v-model="form.description" class="form-textarea" rows="3" placeholder="合同范围、进场安排等（选填）"></textarea>
          </label>
          <p class="form-hint">保存后将进入「系统列表」，在那里为项目添加被测系统。标准体系、保护等级、扩展类型按每个系统单独设置。</p>
        </div>
        <div class="form-dialog-footer">
          <button class="dialog-btn" @click="closeDialog">取消</button>
          <button class="dialog-btn primary" :disabled="saving" @click="submitDialog">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 项目归档：整个项目（含其下全部系统）打包 / 还原 -->
    <ProjectExportDialog
      v-model:visible="exportDialogVisible"
      :projects="exportOptions"
      :busy="archiveBusy"
      @confirm="confirmExport"
    />
    <ProjectImportDialog
      v-model:visible="importDialogVisible"
      :preview="archivePreview"
      :busy="archiveBusy"
      @confirm="confirmImport"
    />
    <!-- 项目合册报告：项目综述 + 各系统分册装订 -->
    <ReportConfigDialog ref="reportDialogRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { formatDateTime } from '@/utils/format';
import type { ProjectGroup, ProjectGroupListParams } from '@shared/types';
import ProjectExportDialog from './components/ProjectExportDialog.vue';
import type { ExportPayload, ExportProjectOption } from './components/ProjectExportDialog.vue';
import ProjectImportDialog from './components/ProjectImportDialog.vue';
import type { ArchivePreview } from './components/ProjectImportDialog.vue';
import ReportConfigDialog from '@/views/issues/report-config-dialog.vue';

/**
 * 项目分组列表页。
 *
 * 数据模型：project_groups（项目 / 委托批次） → projects（一个系统） → 资产 / 测评记录 / 问题。
 * 本页只负责项目级台账；创建成功后直接跳转到系统列表页，让用户接着建系统。
 */
const router = useRouter();
const rows = ref<ProjectGroup[]>([]);
const loading = ref(false);
const saving = ref(false);
const activeTab = ref<'active' | 'archived'>('active');
const keyword = ref('');
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const stats = reactive({ activeCount: 0, archivedCount: 0, systemCount: 0 });

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.pageSize)));
const emptyText = computed(() => {
  if (activeTab.value === 'archived') {
    return keyword.value ? '未找到匹配的已归档项目' : '暂无已归档项目';
  }
  return keyword.value ? '未找到匹配的项目' : '暂无项目';
});

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  in_progress: '进行中',
  completed: '已完成',
  archived: '已归档',
};
function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}
function progressClass(progress: number): string {
  if (progress >= 80) return 'high';
  if (progress >= 40) return 'medium';
  return 'low';
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    pagination.page = 1;
    loadRows();
  }, 300);
}

async function loadRows(): Promise<void> {
  if (!window.api?.projectGroup) return;
  loading.value = true;
  try {
    const params: ProjectGroupListParams = {
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: keyword.value || undefined,
    };
    if (activeTab.value === 'active') {
      params.excludeArchived = true;
    } else {
      params.status = 'archived';
    }
    const res = await window.api.projectGroup.list(params);
    if (res.success && res.data) {
      rows.value = res.data.list;
      pagination.total = res.data.total;
    }
  } finally {
    loading.value = false;
  }
}

async function loadStats(): Promise<void> {
  if (!window.api?.projectGroup) return;
  try {
    const base = { page: 1, pageSize: 1 };
    const [activeRes, archivedRes, allRes] = await Promise.all([
      window.api.projectGroup.list({ ...base, excludeArchived: true }),
      window.api.projectGroup.list({ ...base, status: 'archived' }),
      // 系统总数需要把各分组的 systemCount 求和；分组数量通常很少，一次拉完即可
      window.api.projectGroup.list({ page: 1, pageSize: 10000 }),
    ]);
    stats.activeCount = activeRes.success && activeRes.data ? activeRes.data.total : 0;
    stats.archivedCount = archivedRes.success && archivedRes.data ? archivedRes.data.total : 0;
    stats.systemCount = allRes.success && allRes.data
      ? allRes.data.list.reduce((sum, g) => sum + (g.systemCount || 0), 0)
      : 0;
  } catch (err) {
    console.error('刷新项目统计失败:', err);
  }
}

function loadAll(): Promise<void[]> {
  return Promise.all([loadRows(), loadStats()]);
}

function switchTab(tab: 'active' | 'archived') {
  activeTab.value = tab;
  pagination.page = 1;
  loadAll();
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value) return;
  pagination.page = page;
  loadRows();
}

function goToSystems(row: ProjectGroup) {
  router.push(`/projects/${row.id}/systems`);
}

// ==================== 项目合册报告（项目综述 + 各系统分册） ====================
const reportDialogRef = ref<InstanceType<typeof ReportConfigDialog> | null>(null);

/** 按项目分组生成合册；后端会取该分组下全量系统，不受分页/筛选影响 */
function openGroupReport(row: ProjectGroup) {
  if (!row.systemCount) {
    ElMessage.warning('该项目下还没有系统，请先进入项目添加系统');
    return;
  }
  reportDialogRef.value?.open(row.id, row.name, 'group');
}

// ==================== 项目归档：整个项目（分组 + 其下全部系统） ====================
const exportDialogVisible = ref(false);
const exportOptions = ref<ExportProjectOption[]>([]);
const importDialogVisible = ref(false);
const archivePreview = ref<ArchivePreview | null>(null);
const pendingArchive = ref<{ path: string; password: string } | null>(null);
const archiveBusy = ref(false);

/**
 * 「导出整个项目」按 groupId 取全量系统，不受列表分页、搜索词、归档页签影响。
 * 系统列表页的导出候选只覆盖当前页，跨页项目必须走这里。
 */
async function openGroupExport(row: ProjectGroup) {
  if (!row.systemCount) {
    ElMessage.warning('该项目下还没有系统，请先进入项目添加系统');
    return;
  }
  const res = await window.api.project.list({ page: 1, pageSize: 10000, groupId: row.id });
  if (!res.success || !res.data) {
    ElMessage.error(res.error?.message || '读取系统列表失败');
    return;
  }
  const list: any[] = res.data.list || [];
  if (!list.length) {
    ElMessage.warning('该项目下没有可导出的系统');
    return;
  }
  exportOptions.value = list.map(p => ({
    id: p.id,
    name: p.name,
    systemName: p.systemName || '',
    assetCount: p.assetCount || 0,
  }));
  exportDialogVisible.value = true;
}

async function confirmExport(payload: ExportPayload) {
  if (payload.format === 'excel') {
    const res = await window.api.project.exportAll(payload.projectIds);
    if (res.success) {
      ElMessage.success('清单导出成功');
      exportDialogVisible.value = false;
    } else if (res.error?.message !== '用户取消') {
      ElMessage.error(res.error?.message || '导出失败');
    }
    return;
  }

  archiveBusy.value = true;
  try {
    const res = await window.api.project.exportArchive({
      projectIds: payload.projectIds,
      password: payload.password || undefined,
      includeStandards: payload.includeStandards,
      includeCredentials: payload.includeCredentials,
    });
    if (res.success) {
      const d: any = res.data || {};
      exportDialogVisible.value = false;
      const missing = d.missingFiles?.length || 0;
      ElMessage({
        type: 'success',
        duration: 4500,
        showClose: true,
        message: `归档导出成功：${((d.size || 0) / 1024 / 1024).toFixed(2)} MB，含 ${payload.projectIds.length} 个系统、${d.fileCount || 0} 个附件${missing ? `（${missing} 个附件在磁盘上已找不到）` : ''}`,
      });
    } else if (res.error?.message !== '用户取消') {
      ElMessage.error(res.error?.message || '导出失败');
    }
  } finally {
    archiveBusy.value = false;
  }
}

async function handleImport() {
  const sel = await window.api.project.selectArchive();
  if (!sel.success) {
    if (sel.error?.message !== '用户取消') ElMessage.error(sel.error?.message || '选择归档失败');
    return;
  }
  const archivePath = sel.data?.path;
  if (!archivePath) return;

  let password = '';
  if (sel.data?.encrypted) {
    try {
      const input = await ElMessageBox.prompt(
        '该归档包已加密，请输入导出时设置的口令',
        '需要口令',
        { inputType: 'password', inputPlaceholder: '归档口令', confirmButtonText: '确定', cancelButtonText: '取消' },
      );
      password = input.value || '';
    } catch {
      return; // 用户取消
    }
  }

  const pv = await window.api.project.previewArchive({ archivePath, password });
  if (!pv.success) {
    ElMessage.error(pv.error?.message || '无法读取该归档包');
    return;
  }
  archivePreview.value = pv.data as unknown as ArchivePreview;
  pendingArchive.value = { path: archivePath, password };
  importDialogVisible.value = true;
}

async function confirmImport(strategy: 'skip' | 'overwrite' | 'copy') {
  if (!pendingArchive.value) return;
  archiveBusy.value = true;
  try {
    const res = await window.api.project.importArchive({
      archivePath: pendingArchive.value.path,
      password: pendingArchive.value.password,
      strategy,
    });
    if (!res.success) {
      ElMessage.error(res.error?.message || '导入失败');
      return;
    }
    const d: any = res.data || {};
    importDialogVisible.value = false;
    archivePreview.value = null;
    pendingArchive.value = null;
    await loadAll();

    const names = (d.groups || []).map((g: any) => g.name).slice(0, 2).join('、');
    const groupText = d.groups?.length
      ? `${d.groups.length} 个项目（${names}${d.groups.length > 2 ? '…' : ''}）`
      : '对应项目';
    ElMessage({
      type: 'success',
      duration: 5000,
      showClose: true,
      message:
        `导入完成：${d.imported?.length || 0} 个系统已还原到 ${groupText}，${d.restoredFiles || 0} 个附件` +
        (d.skipped?.length ? `，跳过 ${d.skipped.length} 个` : ''),
    });
  } finally {
    archiveBusy.value = false;
  }
}

// ==================== 新建 / 编辑弹窗 ====================
const dialogVisible = ref(false);
const editingId = ref('');
const form = reactive({
  name: '',
  projectNo: '',
  assessedUnit: '',
  customerName: '',
  assessor: '',
  startDate: '',
  endDate: '',
  description: '',
});

function resetForm() {
  form.name = '';
  form.projectNo = '';
  form.assessedUnit = '';
  form.customerName = '';
  form.assessor = '';
  form.startDate = '';
  form.endDate = '';
  form.description = '';
}

function openCreate() {
  editingId.value = '';
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: ProjectGroup) {
  editingId.value = row.id;
  form.name = row.name || '';
  form.projectNo = row.projectNo || '';
  form.assessedUnit = row.assessedUnit || '';
  form.customerName = row.customerName || '';
  form.assessor = row.assessor || '';
  form.startDate = row.startDate || '';
  form.endDate = row.endDate || '';
  form.description = row.description || '';
  dialogVisible.value = true;
}

function closeDialog() {
  dialogVisible.value = false;
}

async function submitDialog() {
  const name = form.name.trim();
  if (!name) {
    ElMessage.warning('请填写项目名称');
    return;
  }
  if (saving.value) return;
  saving.value = true;
  try {
    const payload = {
      name,
      projectNo: form.projectNo,
      assessedUnit: form.assessedUnit,
      customerName: form.customerName,
      assessor: form.assessor,
      startDate: form.startDate,
      endDate: form.endDate,
      description: form.description,
    };
    const res = editingId.value
      ? await window.api.projectGroup.update(editingId.value, payload)
      : await window.api.projectGroup.create(payload);
    if (!res.success) {
      ElMessage.error(res.error?.message || '保存失败，请重试');
      return;
    }
    dialogVisible.value = false;
    if (!editingId.value && res.data?.id) {
      // 用户的工作流：创建项目 → 立刻进入创建系统的页面
      ElMessage.success('项目已创建，请添加被测系统');
      await router.push(`/projects/${res.data.id}/systems`);
      return;
    }
    ElMessage.success('已保存');
    await loadAll();
  } finally {
    saving.value = false;
  }
}

async function toggleArchive(row: ProjectGroup) {
  const next = row.status === 'archived' ? 'draft' : 'archived';
  const label = next === 'archived' ? '归档' : '取消归档';
  try {
    await ElMessageBox.confirm(`确定${label}项目「${row.name}」吗？`, '确认操作');
  } catch {
    return;
  }
  const res = await window.api.projectGroup.update(row.id, { status: next as ProjectGroup['status'] });
  if (res.success) {
    ElMessage.success(`已${label}`);
    await loadAll();
  } else {
    ElMessage.error(res.error?.message || '操作失败');
  }
}

async function handleDelete(row: ProjectGroup) {
  try {
    await ElMessageBox.confirm(
      `确定要删除项目「${row.name}」吗？\n其下 ${row.systemCount} 个系统及全部资产、测评记录、问题清单将一并删除，且不可恢复。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const res = await window.api.projectGroup.remove(row.id);
  if (res.success) {
    ElMessage.success('项目已删除');
    await loadAll();
  } else {
    ElMessage.error(res.error?.message || '删除失败');
  }
}

// Ctrl+S 在弹窗打开时等价于「保存」，与全局保存快捷键保持一致
function onGlobalSave() {
  if (dialogVisible.value && !saving.value) void submitDialog();
}

onMounted(() => {
  loadAll();
  window.addEventListener('app:global-save', onGlobalSave);
});

onUnmounted(() => {
  window.removeEventListener('app:global-save', onGlobalSave);
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
});
</script>

<style lang="scss" scoped>
.page-container {
  padding: 24px;
  background: var(--color-bg-page, #F5F6FA);
  min-height: calc(100vh - var(--titlebar-height, 40px) - var(--header-height, 56px));
}

.page-header {
  margin-bottom: 18px;

  .page-title {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 500;
    color: var(--color-text-primary, #1A2332);
  }

  .page-subtitle {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary, #4A5568);
  }
}

.stat-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.stat-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 20px;
  background: var(--color-bg-card, #fff);
  border: 1px solid var(--color-border-light, #EEF1F6);
  border-radius: var(--radius-lg, 8px);
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.04));

  .stat-label {
    font-size: 12px;
    color: var(--color-text-secondary, #4A5568);
  }

  .stat-value {
    font-size: 24px;
    font-weight: 500;
    line-height: 1.2;
    color: var(--color-primary, #1B5FD9);

    &.muted { color: var(--color-text-tertiary, #8B95A7); }
  }
}

.card {
  background: var(--color-bg-card, #fff);
  border-radius: var(--radius-lg, 8px);
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.04));
  overflow: hidden;
}

.card-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-default, #E5E7EB);
  padding: 0 20px;

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 4px;
    margin-right: 24px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    font-size: 13px;
    color: var(--color-text-secondary, #4A5568);
    cursor: pointer;

    &.active {
      color: var(--color-primary, #1B5FD9);
      border-bottom-color: var(--color-primary, #1B5FD9);
      font-weight: 500;
    }
  }

  .tab-badge {
    min-width: 20px;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--color-primary-light, #E8F0FD);
    color: var(--color-primary, #1B5FD9);

    &.muted {
      background: var(--color-bg-tag, #F0F4F9);
      color: var(--color-text-tertiary, #8B95A7);
    }
  }
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border-light, #EEF1F6);
}

.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border-base, #E2E6ED);
  border-radius: var(--radius-base, 6px);
  background: var(--color-bg-card, #fff);
  color: var(--color-text-secondary, #4A5568);
  font-size: 12px;
  cursor: pointer;

  &:hover { background: var(--color-bg-hover, #F0F4F9); }

  &.primary {
    border-color: var(--color-primary, #1B5FD9);
    background: var(--color-primary, #1B5FD9);
    color: #fff;

    &:hover { background: var(--color-primary-hover, #2A71E8); }
  }
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border-base, #E2E6ED);
  border-radius: var(--radius-base, 6px);
  background: var(--color-bg-card, #fff);
  color: var(--color-text-secondary, #4A5568);
  cursor: pointer;

  &:hover { background: var(--color-bg-hover, #F0F4F9); }
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;

  .search-icon {
    position: absolute;
    left: 10px;
    color: var(--color-text-tertiary, #8B95A7);
    pointer-events: none;
  }

  .search-input {
    width: 240px;
    height: 32px;
    padding: 0 10px 0 30px;
    border: 1px solid var(--color-border-base, #E2E6ED);
    border-radius: var(--radius-base, 6px);
    background: var(--color-bg-card, #fff);
    color: var(--color-text-primary, #1A2332);
    font-size: 12px;
    outline: none;

    &:focus { border-color: var(--color-primary, #1B5FD9); }
    &::placeholder { color: var(--color-text-placeholder, #B0B7C3); }
  }
}

.table-wrapper { min-height: 180px; }

.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;

  th, td {
    padding: 11px 12px;
    text-align: left;
    font-size: 12px;
    border-bottom: 1px solid var(--color-border-light, #EEF1F6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  th {
    font-weight: 500;
    color: var(--color-text-secondary, #4A5568);
    background: var(--color-bg-subtle, #F5F7FA);
  }

  td { color: var(--color-text-primary, #1A2332); }

  tbody tr:hover { background: var(--color-bg-hover, #F0F4F9); }

  .col-index { width: 56px; }
  .col-no { width: 120px; }
  .col-name { width: auto; }
  .col-unit { width: 150px; }
  .col-systems { width: 92px; }
  .col-progress { width: 132px; }
  .col-time { width: 140px; }
  .col-status { width: 88px; }
  // 6 个行内按钮（进入 / 导出 / 合册报告 / 编辑 / 归档 / 删除）：6×26px + 5×4px 间距 + td 左右 padding 24px = 200px，
  // 留出 10px 余量；宽度不足时最后一个「删除」按钮会被 td 的 overflow:hidden 裁掉。
  .col-actions { width: 210px; }
}

.mono-text { font-family: var(--font-mono, monospace); font-size: 11px; }
.text-secondary { color: var(--color-text-secondary, #4A5568); }
.time-text { color: var(--color-text-tertiary, #8B95A7); font-size: 11px; }

.link-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-primary, #1B5FD9);
  font-size: 12px;
  cursor: pointer;

  &:hover { text-decoration: underline; }
}

.progress-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-border-light, #EEF1F6);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-primary, #1B5FD9);

  .high & { background: var(--color-success, #18A957); }
  .medium & { background: var(--color-warning, #D48806); }
  .low & { background: var(--color-info, #5C6C8C); }
}

.progress-text {
  min-width: 32px;
  font-size: 11px;
  color: var(--color-text-secondary, #4A5568);
  text-align: right;
}

.status-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  background: var(--color-bg-tag, #F0F4F9);
  color: var(--color-text-secondary, #4A5568);

  &.status-draft { background: var(--color-info-light, #EEF2F8); color: var(--color-info, #5C6C8C); }
  &.status-in_progress { background: var(--color-primary-light, #E8F0FD); color: var(--color-primary, #1B5FD9); }
  &.status-completed { background: var(--color-success-light, #E7F8EE); color: var(--color-success, #18A957); }
  &.status-archived { background: var(--color-bg-tag, #F0F4F9); color: var(--color-text-tertiary, #8B95A7); }
}

.col-actions {
  white-space: nowrap;
  // 最后一列：即使列宽被 table-layout:fixed 压缩，也不裁掉行内按钮
  overflow: visible;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--color-text-tertiary, #8B95A7);
  cursor: pointer;

  &:hover { background: var(--color-bg-hover, #F0F4F9); }
  &:last-child { margin-right: 0; }
  &.enter:hover { color: var(--color-primary, #1B5FD9); }
  &.export:hover { color: var(--color-success, #2E7D32); }
  &.report:hover { color: var(--color-primary, #1B5FD9); }
  &.edit:hover { color: var(--color-primary, #1B5FD9); }
  &.archive:hover { color: var(--color-warning, #D48806); }
  &.delete:hover { color: var(--color-danger, #E53935); }
}

.empty-cell { padding: 36px 0 !important; text-align: center; }

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-light, #EEF1F6);
}

.total-text, .page-indicator {
  font-size: 12px;
  color: var(--color-text-secondary, #4A5568);
}

.pagination-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border-base, #E2E6ED);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-bg-card, #fff);
  color: var(--color-text-secondary, #4A5568);
  cursor: pointer;

  &:disabled { opacity: 0.45; cursor: not-allowed; }
  &:not(:disabled):hover { background: var(--color-bg-hover, #F0F4F9); }
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
}

.form-dialog {
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-card, #fff);
  border-radius: var(--radius-lg, 8px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.form-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-light, #EEF1F6);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary, #1A2332);
}

.close-btn {
  border: none;
  background: transparent;
  color: var(--color-text-tertiary, #8B95A7);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;

  &:hover { color: var(--color-text-primary, #1A2332); }
}

.form-dialog-body {
  padding: 18px 20px;
  overflow-y: auto;
}

.form-row {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}

.form-field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;

  &.wide { width: 100%; margin-bottom: 14px; }
}

.form-label {
  font-size: 12px;
  color: var(--color-text-secondary, #4A5568);

  em { color: var(--color-danger, #E53935); font-style: normal; }
}

.form-input, .form-textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--color-border-base, #E2E6ED);
  border-radius: var(--radius-base, 6px);
  background: var(--color-bg-card, #fff);
  color: var(--color-text-primary, #1A2332);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;

  &:focus { border-color: var(--color-primary, #1B5FD9); }
  &::placeholder { color: var(--color-text-placeholder, #B0B7C3); }
  &.mono { font-family: var(--font-mono, monospace); }
}

.form-textarea { resize: vertical; line-height: 1.6; }

.form-hint {
  margin: 4px 0 0;
  padding: 10px 12px;
  border-radius: var(--radius-base, 6px);
  background: var(--color-primary-lighter, #F5F8FF);
  color: var(--color-text-secondary, #4A5568);
  font-size: 12px;
  line-height: 1.6;
}

.form-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-light, #EEF1F6);
}

.dialog-btn {
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--color-border-base, #E2E6ED);
  border-radius: var(--radius-base, 6px);
  background: var(--color-bg-card, #fff);
  color: var(--color-text-secondary, #4A5568);
  font-size: 12px;
  cursor: pointer;

  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:not(:disabled):hover { background: var(--color-bg-hover, #F0F4F9); }

  &.primary {
    border-color: var(--color-primary, #1B5FD9);
    background: var(--color-primary, #1B5FD9);
    color: #fff;

    &:not(:disabled):hover { background: var(--color-primary-hover, #2A71E8); }
  }
}
</style>
