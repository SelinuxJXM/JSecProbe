<template>
  <div class="page-container">
    <!-- 项目上下文栏 -->
    <div class="project-context-bar">
      <div class="breadcrumb">
        <el-icon class="back-btn" @click="goBack"><ArrowLeft /></el-icon>
        <el-icon><HomeFilled /></el-icon>
        <span class="customer-name">{{ project?.name || '未选择项目' }}</span>
        <el-icon><DArrowRight /></el-icon>
        <span class="current-page">问题汇总</span>
      </div>
      <div class="phase-indicators">
        <div class="phase-pill" @click="goToPhase('assets')">
          <span class="pill-num">1</span>
          系统构成
        </div>
        <div class="phase-pill" @click="goToPhase('assessment')">
          <span class="pill-num">2</span>
          现场核查
        </div>
        <div class="phase-pill active">
          <span class="pill-num">3</span>
          问题汇总
        </div>
      </div>
    </div>

    <div class="page-header">
      <div>
        <div class="page-header-title">问题汇总</div>
        <div class="page-header-desc">查看和管理测评发现的问题</div>
      </div>
      <div class="page-header-actions">
        <el-button type="primary" :icon="Refresh" @click="handleGenerate">
          从测评记录生成
        </el-button>
        <el-button :icon="Plus" @click="handleAdd">新增问题</el-button>
        <el-button :icon="Upload" @click="handleImport">导入问题</el-button>
        <el-button :icon="Document" @click="handleDownloadTemplate">下载导入模板</el-button>
        <el-button type="success" :icon="Download" @click="handleExport">
          导出问题清单
        </el-button>
        <el-button type="warning" :icon="Document" @click="handleGenerateReport">
          生成测评报告
        </el-button>
      </div>
    </div>

    <div class="stat-cards-row">
      <div class="stat-card stat-high">
        <div class="stat-icon">
          <el-icon :size="32"><Warning /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ summary.highRisk }}</div>
          <div class="stat-label">高风险问题</div>
        </div>
      </div>
      <div class="stat-card stat-medium">
        <div class="stat-icon">
          <el-icon :size="32"><InfoFilled /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ summary.mediumRisk }}</div>
          <div class="stat-label">中风险问题</div>
        </div>
      </div>
      <div class="stat-card stat-low">
        <div class="stat-icon">
          <el-icon :size="32"><CircleCheck /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ summary.lowRisk }}</div>
          <div class="stat-label">低风险问题</div>
        </div>
      </div>
      <div class="stat-card stat-compliant">
        <div class="stat-icon">
          <el-icon :size="32"><CircleCheckFilled /></el-icon>
        </div>
        <div class="stat-info">
          <el-statistic :value="complianceRateValue" suffix="%" />
          <div class="stat-label">符合率</div>
        </div>
      </div>
      <div class="stat-card stat-total">
        <div class="stat-icon">
          <el-icon :size="32"><Document /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ summary.total }}</div>
          <div class="stat-label">问题总数</div>
        </div>
      </div>
    </div>

    <div class="card p-md" style="margin-bottom: 128px">
      <el-form :inline="true" :model="filterForm" class="mb-sm">
        <el-form-item label="关键词">
          <el-input
            v-model="filterForm.keyword"
            placeholder="搜索标题/描述"
            clearable
            style="width: 180px"
            @keyup.enter="loadIssues"
          />
        </el-form-item>
        <el-form-item label="风险等级">
          <el-select v-model="filterForm.riskLevel" placeholder="全部" clearable style="width: 120px">
            <el-option label="高风险" value="high" />
            <el-option label="中风险" value="medium" />
            <el-option label="低风险" value="low" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filterForm.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="待整改" value="pending" />
            <el-option label="整改中" value="rectifying" />
            <el-option label="已整改" value="resolved" />
            <el-option label="已关闭" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item label="安全域">
          <el-select v-model="filterForm.securityDomain" placeholder="全部" clearable style="width: 160px">
            <el-option v-for="domain in domainList" :key="domain" :label="domain" :value="domain" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="loadIssues">查询</el-button>
          <el-button :icon="Refresh" @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>

      <div class="table-toolbar">
        <div class="toolbar-left">
          <el-button
            type="danger"
            :icon="Delete"
            size="small"
            :disabled="selectedRows.length === 0"
            @click="handleBatchDelete"
          >
            批量删除 ({{ selectedRows.length }})
          </el-button>
          <el-button
            type="warning"
            :icon="Edit"
            size="small"
            :disabled="selectedRows.length === 0"
            @click="handleBatchStatus"
          >
            批量修改状态 ({{ selectedRows.length }})
          </el-button>
        </div>
        <div class="toolbar-right">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            :total="pagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="prev, pager, next, total"
            background
            @size-change="loadIssues"
            @current-change="loadIssues"
          />
        </div>
      </div>

      <el-table
        :data="issueList"
        v-loading="loading"
        border
        stripe
        @selection-change="handleSelectionChange"
        @sort-change="handleSortChange"
      >
        <el-table-column type="selection" width="50" align="center" />
        <el-table-column label="序号" width="60" align="center">
          <template #default="{ $index }">
            {{ (pagination.page - 1) * pagination.pageSize + $index + 1 }}
          </template>
        </el-table-column>
        <el-table-column prop="issueTitle" label="问题标题" min-width="200" sortable="custom">
          <template #default="{ row }">
            <span class="issue-title-cell" @click="handleView(row)">{{ row.issueTitle }}</span>
          </template>
        </el-table-column>
        <el-table-column label="安全域" width="120" sortable="custom" prop="securityDomain">
          <template #default="{ row }">
            {{ getSecurityDomainName(row.securityDomain) }}
          </template>
        </el-table-column>
        <el-table-column prop="assetName" label="测评对象" width="150" sortable="custom" />
        <el-table-column prop="controlPoint" label="控制点" width="120" sortable="custom" />
        <el-table-column prop="riskLevel" label="风险等级" width="100" align="center" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="getRiskTagType(row.riskLevel)" effect="dark">
              {{ getRiskLabel(row.riskLevel) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" align="center" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="170" sortable="custom">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">查看</el-button>
            <el-button link type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="success" size="small" @click="handleEvidence(row)">证据</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 问题详情/编辑弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :title="isEdit ? '编辑问题' : '问题详情'"
      width="750px"
      destroy-on-close
    >
      <el-form :model="formData" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="问题标题">
              <el-input v-model="formData.issueTitle" :disabled="!isEdit" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="风险等级">
              <el-select v-model="formData.riskLevel" style="width: 100%" :disabled="!isEdit">
                <el-option label="高风险" value="high" />
                <el-option label="中风险" value="medium" />
                <el-option label="低风险" value="low" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="安全域">
              <el-input v-model="formData.securityDomain" :disabled="!isEdit" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="控制点">
              <el-input v-model="formData.controlPoint" :disabled="!isEdit" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="控制项">
              <el-input v-model="formData.controlName" :disabled="!isEdit" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-select v-model="formData.status" style="width: 100%" :disabled="!isEdit">
                <el-option label="待整改" value="pending" />
                <el-option label="整改中" value="rectifying" />
                <el-option label="已整改" value="resolved" />
                <el-option label="已关闭" value="closed" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="整改日期">
              <el-date-picker
                v-model="formData.fixedDate"
                type="date"
                placeholder="选择整改日期"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
                style="width: 100%"
                :disabled="!isEdit"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="测评人">
              <el-input v-model="formData.assessor" :disabled="!isEdit" placeholder="请输入测评人" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="问题描述">
          <el-input
            v-model="formData.issueDescription"
            type="textarea"
            :rows="3"
            :disabled="!isEdit"
          />
        </el-form-item>
        <el-form-item label="整改建议">
          <el-input
            v-model="formData.rectificationSuggestion"
            type="textarea"
            :rows="3"
            :disabled="!isEdit"
          />
        </el-form-item>
        <el-form-item label="整改描述">
          <el-input
            v-model="formData.fixedDescription"
            type="textarea"
            :rows="3"
            :disabled="!isEdit"
            placeholder="请输入整改完成情况描述"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="isEdit" type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 证据关联弹窗 -->
    <el-dialog
      v-model="evidenceVisible"
      title="关联证据文件"
      width="600px"
      destroy-on-close
    >
      <div class="evidence-dialog-content">
        <div class="evidence-list" v-if="currentIssueEvidence.length > 0">
          <div v-for="(file, idx) in currentIssueEvidence" :key="idx" class="evidence-item">
            <span class="evidence-name">{{ file.split('\\').pop()?.split('/').pop() || file }}</span>
            <el-button link type="danger" size="small" @click="removeEvidence(idx)">移除</el-button>
          </div>
        </div>
        <div v-else class="evidence-empty">暂无关联证据</div>
        <el-button type="primary" :icon="Plus" @click="addEvidenceFile" class="mt-sm">
          添加证据文件
        </el-button>
      </div>
      <template #footer>
        <el-button @click="evidenceVisible = false">关闭</el-button>
        <el-button type="primary" @click="saveEvidence">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量修改状态弹窗 -->
    <el-dialog
      v-model="batchStatusVisible"
      title="批量修改状态"
      width="400px"
      destroy-on-close
    >
      <el-form label-width="80px">
        <el-form-item label="新状态">
          <el-select v-model="batchNewStatus" placeholder="请选择状态" style="width: 100%">
            <el-option label="待整改" value="pending" />
            <el-option label="整改中" value="rectifying" />
            <el-option label="已整改" value="resolved" />
            <el-option label="已关闭" value="closed" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchStatusVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmBatchStatus">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Plus,
  Download,
  Refresh,
  Search,
  Warning,
  InfoFilled,
  CircleCheck,
  CircleCheckFilled,
  Document,
  HomeFilled,
  DArrowRight,
  ArrowLeft,
  Delete,
  Edit,
  Upload,
} from '@element-plus/icons-vue';
import type { Issue, IssueSummary } from '../../../shared/types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const route = useRoute();
const router = useRouter();
const projectId = computed(() => route.params.id as string);
const project = ref<any>(null);

function goBack() {
  router.back();
}

async function loadProject() {
  const pid = projectId.value;
  if (!pid) return;
  if (!window.api) return;
  try {
    const res = await window.api.project.get(pid);
    if (res.success && res.data) {
      project.value = res.data;
    }
  } catch (error) {
    console.error('加载项目信息失败:', error);
  }
}

function goToPhase(phase: string) {
  const pid = projectId.value;
  if (pid) {
    router.push(`/projects/${pid}/${phase}`);
  }
}

const loading = ref(false);
const saving = ref(false);
const issueList = ref<Issue[]>([]);
const selectedRows = ref<Issue[]>([]);
const summary = ref<IssueSummary>({
  total: 0,
  highRisk: 0,
  mediumRisk: 0,
  lowRisk: 0,
  pending: 0,
  rectifying: 0,
  resolved: 0,
  closed: 0,
  riskStats: [],
  domainStats: [],
});

const filterForm = reactive({
  keyword: '',
  riskLevel: '',
  status: '',
  securityDomain: '',
});

const sortConfig = reactive({
  prop: '',
  order: '' as 'ascending' | 'descending' | '',
});

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
});

const detailVisible = ref(false);
const isEdit = ref(false);
const formData = reactive<Partial<Issue>>({
  issueTitle: '',
  riskLevel: 'medium',
  securityDomain: '',
  controlPoint: '',
  controlName: '',
  status: 'pending',
  issueDescription: '',
  rectificationSuggestion: '',
  rectificationDeadline: '',
  responsiblePerson: '',
  fixedDescription: '',
  fixedDate: '',
  assessor: '',
});

const evidenceVisible = ref(false);
const currentIssueId = ref('');
const currentIssueEvidence = ref<string[]>([]);

const batchStatusVisible = ref(false);
const batchNewStatus = ref('');

const domainList = computed(() => [
  '安全物理环境',
  '安全通信网络',
  '安全区域边界',
  '安全计算环境',
  '安全管理中心',
  '安全管理制度',
  '安全管理机构',
  '安全管理人员',
  '安全建设管理',
  '安全运维管理',
]);

// 安全域ID与中文名称映射
const DOMAIN_ID_TO_NAME: Record<string, string> = {
  'secure_physical': '安全物理环境',
  'secure_communication': '安全通信网络',
  'secure_boundary': '安全区域边界',
  'secure_computing': '安全计算环境',
  'secure_management': '安全管理中心',
  'security_management': '安全管理制度',
  'security_organization': '安全管理机构',
  'security_personnel': '安全管理人员',
  'security_construction': '安全建设管理',
  'security_maintenance': '安全运维管理',
};

function getSecurityDomainName(domainId: string): string {
  return DOMAIN_ID_TO_NAME[domainId] || domainId || '-';
}

const DOMAIN_NAME_TO_ID: Record<string, string> = {};
for (const [id, name] of Object.entries(DOMAIN_ID_TO_NAME)) {
  DOMAIN_NAME_TO_ID[name] = id;
}

const complianceRateValue = computed(() => {
  const rate = summary.value?.complianceRate;
  if (rate === undefined || rate === null || isNaN(Number(rate))) {
    return 0;
  }
  return Number(rate);
});

function getRiskLabel(level: string) {
  const map: Record<string, string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
  };
  return map[level] || level;
}

function getRiskTagType(level: string) {
  const map: Record<string, string> = {
    high: 'danger',
    medium: 'warning',
    low: 'success',
  };
  return map[level] || 'info';
}

function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '待整改',
    rectifying: '整改中',
    resolved: '已整改',
    closed: '已关闭',
  };
  return map[status] || status;
}

function getStatusTagType(status: string) {
  const map: Record<string, string> = {
    pending: 'danger',
    rectifying: 'warning',
    resolved: 'success',
    closed: 'info',
  };
  return map[status] || 'info';
}

function formatDate(date: string) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadSummary() {
  if (!window.api) return;
  try {
    const res = await window.api.issue.getSummary(projectId.value);
    if (res.success && res.data) {
      summary.value = res.data;
    }
  } catch (error: any) {
    console.error('加载统计摘要失败:', error);
  }
}

let requestToken = 0;

async function loadIssues() {
  if (!window.api) return;
  const currentToken = ++requestToken;
  loading.value = true;
  try {
    const res = await window.api.issue.list({
      projectId: projectId.value,
      keyword: filterForm.keyword || undefined,
      riskLevel: filterForm.riskLevel || undefined,
      status: filterForm.status || undefined,
      securityDomain: filterForm.securityDomain ? DOMAIN_NAME_TO_ID[filterForm.securityDomain] : undefined,
      sortProp: sortConfig.prop || undefined,
      sortOrder: sortConfig.order || undefined,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
    if (currentToken !== requestToken) return;
    if (res.success && res.data) {
      issueList.value = res.data.list;
      pagination.total = res.data.total;
    } else if (res.error) {
      ElMessage.error(res.error.message || '加载数据失败');
    }
  } catch (error: any) {
    if (currentToken !== requestToken) return;
    ElMessage.error(error?.message || '加载数据失败');
  } finally {
    if (currentToken === requestToken) {
      loading.value = false;
    }
  }
}

function resetFilter() {
  filterForm.keyword = '';
  filterForm.riskLevel = '';
  filterForm.status = '';
  filterForm.securityDomain = '';
  sortConfig.prop = '';
  sortConfig.order = '';
  pagination.page = 1;
  loadIssues();
}

function handleSelectionChange(rows: Issue[]) {
  selectedRows.value = rows;
}

function handleSortChange({ prop, order }: { prop: string; order: string }) {
  sortConfig.prop = prop;
  sortConfig.order = order as 'ascending' | 'descending' | '';
  pagination.page = 1;
  loadIssues();
}

function handleAdd() {
  isEdit.value = true;
  Object.assign(formData, {
    issueTitle: '',
    riskLevel: 'medium',
    securityDomain: '安全计算环境',
    controlPoint: '',
    controlName: '',
    status: 'pending',
    issueDescription: '',
    rectificationSuggestion: '',
    rectificationDeadline: '',
    responsiblePerson: '',
    fixedDescription: '',
    fixedDate: '',
    assessor: '',
  });
  detailVisible.value = true;
}

function handleView(row: Issue) {
  isEdit.value = false;
  Object.assign(formData, row);
  detailVisible.value = true;
}

function handleEdit(row: Issue) {
  isEdit.value = true;
  Object.assign(formData, row);
  detailVisible.value = true;
}

async function handleSave() {
  if (saving.value) return;

  if (!formData.issueTitle?.trim()) {
    ElMessage.warning('请输入问题标题');
    return;
  }
  if (!formData.securityDomain?.trim()) {
    ElMessage.warning('请选择安全域');
    return;
  }
  if (!formData.issueDescription?.trim()) {
    ElMessage.warning('请输入问题描述');
    return;
  }
  if (!['high', 'medium', 'low'].includes(formData.riskLevel || '')) {
    ElMessage.warning('请选择有效的风险等级');
    return;
  }
  if (!['pending', 'rectifying', 'resolved', 'closed'].includes(formData.status || '')) {
    ElMessage.warning('请选择有效的状态');
    return;
  }

  saving.value = true;
  try {
    if (formData.id) {
      const res = await window.api.issue.update(formData.id, formData);
      if (res.success) {
        ElMessage.success('更新成功');
        detailVisible.value = false;
        loadIssues();
        loadSummary();
      } else {
        ElMessage.error(res.error?.message || '更新失败');
      }
    } else {
      const res = await window.api.issue.create({
        ...formData,
        projectId: projectId.value,
      });
      if (res.success) {
        ElMessage.success('创建成功');
        detailVisible.value = false;
        loadIssues();
        loadSummary();
      } else {
        ElMessage.error(res.error?.message || '创建失败');
      }
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '操作失败');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(row: Issue) {
  try {
    await ElMessageBox.confirm('确定要删除这个问题吗？', '确认删除', {
      type: 'warning',
    });
    const res = await window.api.issue.remove(row.id);
    if (res.success) {
      ElMessage.success('删除成功');
      loadIssues();
      loadSummary();
    } else {
      ElMessage.error(res.error?.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error?.message) {
      ElMessage.error(error?.message || '删除失败');
    }
  }
}

async function handleBatchDelete() {
  if (selectedRows.value.length === 0) return;
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedRows.value.length} 个问题吗？`,
      '批量删除',
      { type: 'warning' }
    );
    const ids = selectedRows.value.map(r => r.id);
    const res = await window.api.issue.batchRemove(ids);
    if (res.success) {
      ElMessage.success(`成功删除 ${ids.length} 个问题`);
      selectedRows.value = [];
      loadIssues();
      loadSummary();
    } else {
      ElMessage.error(res.error?.message || '批量删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error?.message) {
      ElMessage.error(error?.message || '批量删除失败');
    }
  }
}

function handleBatchStatus() {
  if (selectedRows.value.length === 0) return;
  batchNewStatus.value = '';
  batchStatusVisible.value = true;
}

async function confirmBatchStatus() {
  if (!batchNewStatus.value) {
    ElMessage.warning('请选择新状态');
    return;
  }
  try {
    const ids = selectedRows.value.map(r => r.id);
    const res = await window.api.issue.batchUpdateStatus(ids, batchNewStatus.value);
    if (res.success) {
      ElMessage.success(`成功更新 ${ids.length} 个问题的状态`);
      selectedRows.value = [];
      batchStatusVisible.value = false;
      loadIssues();
      loadSummary();
    } else {
      ElMessage.error(res.error?.message || '批量更新失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '批量更新失败');
  }
}

function handleEvidence(row: Issue) {
  currentIssueId.value = row.id;
  try {
    currentIssueEvidence.value = row.evidenceFiles ? JSON.parse(row.evidenceFiles) : [];
  } catch {
    currentIssueEvidence.value = [];
  }
  evidenceVisible.value = true;
}

async function addEvidenceFile() {
  if (!window.api) return;
  const res = await window.api.dialog.showOpenDialog({
    title: '选择证据文件',
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] },
      { name: '文档', extensions: ['pdf', 'doc', 'docx', 'md', 'txt'] },
      { name: '所有文件', extensions: [] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (res.data?.canceled || !res.data?.filePaths) return;

  for (const filePath of res.data.filePaths) {
    if (!currentIssueEvidence.value.includes(filePath)) {
      currentIssueEvidence.value.push(filePath);
    }
  }
}

function removeEvidence(index: number) {
  currentIssueEvidence.value.splice(index, 1);
}

async function saveEvidence() {
  try {
    const res = await window.api.issue.updateEvidence(currentIssueId.value, currentIssueEvidence.value);
    if (res.success) {
      ElMessage.success('证据关联已保存');
      evidenceVisible.value = false;
      loadIssues();
    } else {
      ElMessage.error(res.error?.message || '保存失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  }
}

async function handleGenerate() {
  try {
    await ElMessageBox.confirm(
      '将从测评记录中自动生成不符合项问题，是否继续？',
      '生成问题',
      { type: 'info' }
    );
    const res = await window.api.issue.generateFromRecords(projectId.value);
    if (res.success && res.data) {
      ElMessage.success(`成功生成 ${res.data.count} 条问题`);
      loadIssues();
      loadSummary();
    } else {
      ElMessage.error(res.error?.message || '生成失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error?.message) {
      ElMessage.error(error?.message || '生成失败');
    }
  }
}

async function handleExport() {
  if (summary.value.total === 0) {
    ElMessage.warning('没有可导出的问题');
    return;
  }
  const res = await window.api.issue.exportExcel(projectId.value);
  if (res.success && res.data) {
    ElMessage.success('导出成功');
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '导出失败');
  }
}

// 下载导入模板
async function handleDownloadTemplate() {
  const res = await window.api.issue.downloadTemplate(projectId.value);
  if (res.success && res.data) {
    ElMessage.success('模板下载成功');
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '下载模板失败');
  }
}

async function handleImport() {
  if (!window.api) return;
  const res = await window.api.dialog.showOpenDialog({
    title: '选择要导入的Excel文件',
    filters: [{ name: 'Excel文件', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (res.data?.canceled || !res.data?.filePaths || res.data.filePaths.length === 0) return;

  const importRes = await window.api.issue.importExcel(projectId.value, res.data.filePaths[0]);
  if (importRes.success && importRes.data) {
    const msg = importRes.data.errors?.length
      ? `成功导入 ${importRes.data.count} 条，${importRes.data.errors.length} 条失败`
      : `成功导入 ${importRes.data.count} 条问题`;
    ElMessage.success(msg);
    loadIssues();
    loadSummary();
  } else {
    ElMessage.error(importRes.error?.message || '导入失败');
  }
}

async function handleGenerateReport() {
  try {
    await ElMessageBox.confirm(
      '将根据当前项目的测评数据和问题清单生成PDF格式的测评报告，是否继续？',
      '生成测评报告',
      { type: 'info' }
    );

    const res = await window.api.issue.list({ projectId: projectId.value, page: 1, pageSize: 1000 });
    if (!res.success || !res.data) {
      ElMessage.error('获取问题数据失败');
      return;
    }

    const issues = res.data.list;

    const doc = new jsPDF('p', 'mm', 'a4');

    doc.setFont('helvetica');

    doc.setFontSize(20);
    doc.text('Level Protection Assessment Report', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`Project ID: ${projectId.value}`, 20, 40);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 50);

    doc.setFontSize(14);
    doc.text('Summary', 20, 70);

    doc.setFontSize(11);
    doc.text(`High Risk: ${summary.value.highRisk}`, 20, 80);
    doc.text(`Medium Risk: ${summary.value.mediumRisk}`, 20, 90);
    doc.text(`Low Risk: ${summary.value.lowRisk}`, 20, 100);
    doc.text(`Total Issues: ${summary.value.total}`, 20, 110);

    doc.setFontSize(14);
    doc.text('Issue List', 20, 130);

    const tableData = issues.map((issue: any) => [
      getRiskLabel(issue.riskLevel),
      getStatusLabel(issue.status),
      issue.securityDomain || '-',
      issue.controlPoint || '-',
      issue.issueTitle || '-',
      issue.issueDescription
        ? issue.issueDescription.substring(0, 50) + (issue.issueDescription.length > 50 ? '...' : '')
        : '-',
    ]);

    autoTable(doc, {
      startY: 140,
      head: [['Risk', 'Status', 'Domain', 'Control Point', 'Title', 'Description']],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: [27, 95, 217],
        textColor: [255, 255, 255],
        fontSize: 10,
      },
      bodyStyles: {
        fontSize: 9,
      },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 20 },
        2: { cellWidth: 30 },
        3: { cellWidth: 30 },
        4: { cellWidth: 40 },
        5: { cellWidth: 60 },
      },
    });

    const fileName = `Assessment_Report_${projectId.value}_${new Date().getTime()}.pdf`;
    doc.save(fileName);

    ElMessage.success('Report generated successfully');
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.message || 'Generation failed');
    }
  }
}

onMounted(() => {
  loadProject();
  loadSummary();
  loadIssues();
});
</script>

<style scoped lang="scss">
:root {
  --color-text-primary: #111827;
  --color-text-secondary: #4B5563;
  --color-text-tertiary: #9CA3AF;
  --color-bg-card: #FFFFFF;
  --color-bg-page: #F5F6FA;
  --color-border-default: #E5E7EB;
  --color-border-light: #F3F4F6;
  --color-primary: #1B5FD9;
  --color-primary-light: #E8F0FE;
  --color-success: #059669;
  --color-success-light: #D1FAE5;
  --color-warning: #D97706;
  --color-warning-light: #FEF3C7;
  --color-danger: #DC2626;
  --color-danger-light: #FEE2E2;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.page-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-page);
}

.project-context-bar {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 16px 24px;
  margin-bottom: 10px;

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--color-text-tertiary);
    margin-bottom: 12px;

    .customer-name {
      color: var(--color-text-secondary);
    }

    .current-page {
      color: var(--color-text-primary);
      font-weight: 500;
    }
  }

  .phase-indicators {
    display: flex;
    align-items: center;
    gap: 4px;

    .phase-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      background: var(--color-bg-page);
      color: var(--color-text-tertiary);
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;

      &.active {
        background: var(--color-primary);
        color: #fff;

        .pill-num {
          background: rgba(255, 255, 255, 0.25);
          color: #fff;
        }
      }

      .pill-num {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--color-border-default);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }
    }
  }
}

.stat-cards-row {
  display: flex;
  gap: 10px;
  margin-bottom: 6px;
}

.stat-card {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-default);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.2s, transform 0.15s;

  &:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .stat-icon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    flex-shrink: 0;
  }

  .stat-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-value {
    font-size: 20px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    font-size: 12px;
    color: var(--color-text-tertiary);
    font-weight: 500;
  }
}

.stat-high .stat-icon {
  background: var(--color-danger-light);
  color: var(--color-danger);
}

.stat-medium .stat-icon {
  background: var(--color-warning-light);
  color: var(--color-warning);
}

.stat-low .stat-icon {
  background: var(--color-success-light);
  color: var(--color-success);
}

.stat-total .stat-icon {
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.stat-compliant {
  .stat-icon {
    background: var(--color-success-light);
    color: var(--color-success);
  }

  .stat-value {
    color: var(--color-success);
  }
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  margin-bottom: 10px;
}

.page-header-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.page-header-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

:deep(.el-button) {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
}

:deep(.el-button--primary) {
  background: var(--color-primary);
  border-color: var(--color-primary);

  &:hover {
    background: var(--color-primary-hover);
    border-color: var(--color-primary-hover);
  }
}

:deep(.el-button--success) {
  background: var(--color-success);
  border-color: var(--color-success);
  color: #fff;

  &:hover {
    background: var(--color-success);
    filter: brightness(1.1);
    border-color: var(--color-success);
  }
}

:deep(.el-button--warning) {
  background: var(--color-warning);
  border-color: var(--color-warning);
  color: #fff;

  &:hover {
    background: var(--color-warning);
    filter: brightness(1.1);
    border-color: var(--color-warning);
  }
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.issue-title-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--color-primary);
  font-weight: 500;

  &:hover {
    text-decoration: underline;
  }

  svg {
    flex-shrink: 0;
    opacity: 0.7;
  }
}

:deep(.el-table) {
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-sm);

  .el-table__header th {
    background: var(--color-bg-hover) !important;
    color: var(--color-text-secondary) !important;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid var(--color-border-base) !important;
  }

  .el-table__row {
    &:hover > td {
      background: var(--color-bg-hover) !important;
    }
  }

  .el-table__body td {
    font-size: 13px;
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border-light) !important;
  }
}

.evidence-dialog-content {
  .evidence-list {
    max-height: 300px;
    overflow-y: auto;
    margin-bottom: 12px;
  }

  .evidence-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--color-bg-page);
    border-radius: var(--radius-md);
    margin-bottom: 8px;
    border: 1px solid var(--color-border-light);

    &:hover {
      border-color: var(--color-border-default);
    }
  }

  .evidence-name {
    font-size: 13px;
    color: var(--color-text-primary);
    word-break: break-all;
    flex: 1;
    margin-right: 12px;
    line-height: 1.5;
  }

  .evidence-empty {
    text-align: center;
    padding: 40px;
    color: var(--color-text-tertiary);
  }
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 0 0;
  border-top: 1px solid var(--color-border-light);
}

:deep(.el-drawer__header) {
  margin-bottom: 0;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border-light);

  .el-drawer__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-primary);
  }
}

:deep(.el-drawer__body) {
  padding: 20px 24px;
}

.detail-section {
  margin-bottom: 24px;

  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;

    svg {
      color: var(--color-text-tertiary);
    }
  }

  .section-content {
    font-size: 13px;
    color: var(--color-text-secondary);
    line-height: 1.6;
    background: var(--color-bg-page);
    padding: 10px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-light);
    white-space: pre-wrap;
  }
}

.batch-status-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
