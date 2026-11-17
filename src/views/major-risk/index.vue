<template>
  <div class="page-container">
    <!-- 项目上下文栏 -->
    <div class="project-context-bar">
      <div class="breadcrumb">
        <el-icon class="back-btn" @click="goBack"><ArrowLeft /></el-icon>
        <el-icon><HomeFilled /></el-icon>
        <span class="customer-name">{{ project?.name || '未选择项目' }}</span>
        <el-icon><DArrowRight /></el-icon>
        <span class="current-page">重大风险隐患识别与分析</span>
      </div>
      <div class="phase-indicators">
        <div class="phase-pill" @click="goToPhase('assets')"><span class="pill-num">1</span>系统构成</div>
        <div class="phase-pill" @click="goToPhase('assessment')"><span class="pill-num">2</span>现场核查</div>
        <div class="phase-pill" @click="goToPhase('risk-analysis')"><span class="pill-num">3</span>风险分析</div>
        <div class="phase-pill" @click="goToPhase('issues')"><span class="pill-num">4</span>整改建议</div>
        <div class="phase-pill active"><span class="pill-num">5</span>重大风险隐患</div>
      </div>
    </div>

    <div class="page-header">
      <div>
        <div class="page-header-title">重大风险隐患识别与分析</div>
        <div class="page-header-desc">依据《重大风险隐患清单》与现场测评记录，按相关性、严重性、高发性三要素逐条判定</div>
      </div>
      <div class="page-header-actions">
        <el-button :icon="Collection" @click="openCatalog">清单管理</el-button>
        <el-button type="primary" data-guide="major-risk-batch" :icon="MagicStick" :loading="batchStarting" @click="handleBatchAnalyze">
          批量AI识别
        </el-button>
        <el-button type="success" :icon="Download" :loading="exporting" @click="handleExport">导出</el-button>
      </div>
    </div>

    <PageHint
      hint-key="major-risk"
      title="第一次做重大风险隐患识别？看这三点"
      :tips="[
        '先在「清单管理」导入或编辑你提供的《重大风险隐患清单》，启用需要参与判定的条目。',
        '逐条点「AI识别」：系统会从清单召回候选条目、检索该问题的现场测评记录，按相关性/严重性/高发性各写一段并给出判定。',
        'AI 结果需人工复核：在编辑框修改三要素与结论后保存，最终结论会纳入项目报告的「重大风险隐患识别与分析」章节。',
      ]"
    />

    <div class="stat-cards-row">
      <div class="stat-card"><div class="stat-icon stat-total"><el-icon><Document /></el-icon></div><div class="stat-body"><div class="stat-label">问题总数</div><div class="stat-value">{{ summary.total }}</div></div></div>
      <div class="stat-card"><div class="stat-icon stat-major"><el-icon><Warning /></el-icon></div><div class="stat-body"><div class="stat-label">属于重大隐患</div><div class="stat-value">{{ summary.major }}</div></div></div>
      <div class="stat-card"><div class="stat-icon stat-none"><el-icon><CircleCheck /></el-icon></div><div class="stat-body"><div class="stat-label">不属于</div><div class="stat-value">{{ summary.nonMajor }}</div></div></div>
      <div class="stat-card"><div class="stat-icon stat-pending"><el-icon><Clock /></el-icon></div><div class="stat-body"><div class="stat-label">待判定</div><div class="stat-value">{{ summary.pending }}</div></div></div>
      <div class="stat-card"><div class="stat-icon stat-catalog"><el-icon><Collection /></el-icon></div><div class="stat-body"><div class="stat-label">清单条目</div><div class="stat-value">{{ summary.catalogCount }}</div></div></div>
    </div>

    <div class="table-section">
      <div class="table-toolbar">
        <el-form :inline="true" class="filter-form">
          <el-form-item>
            <el-input v-model="filterForm.keyword" placeholder="搜索问题描述 / 命中清单" clearable :prefix-icon="Search" style="width: 260px" />
          </el-form-item>
          <el-form-item>
            <el-select v-model="filterForm.verdict" placeholder="判定结论" clearable style="width: 160px">
              <el-option label="属于重大隐患" value="major" />
              <el-option label="不属于" value="non_major" />
              <el-option label="待判定" value="pending" />
            </el-select>
          </el-form-item>
        </el-form>
        <div class="toolbar-tip">问题描述来自「风险分析」页，问题在这里与其共用同一份数据</div>
      </div>

      <el-table :data="filteredRows" v-loading="loading" border stripe>
        <el-table-column label="序号" width="60" align="center">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column prop="issueDescription" label="问题描述" min-width="220" show-overflow-tooltip />
        <el-table-column prop="assetName" label="测评对象" width="130" show-overflow-tooltip />
        <el-table-column prop="controlPoint" label="控制点" width="120" show-overflow-tooltip />
        <el-table-column label="风险等级" width="90" align="center">
          <template #default="{ row }"><el-tag :type="riskTagType(row.riskLevel)" effect="dark">{{ riskLabel(row.riskLevel) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="命中清单" width="180" show-overflow-tooltip>
          <template #default="{ row }"><span :class="{ 'hit-none': !row.catalogTitle }">{{ row.catalogTitle || '未命中' }}</span></template>
        </el-table-column>
        <el-table-column label="判定结论" width="130" align="center">
          <template #default="{ row }">
            <el-tag :type="verdictTag(row.verdict)" effect="dark">{{ verdictLabel(row.verdict) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="复核人" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.analyst || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="center">
          <template #default="{ row }">
            <el-tooltip content="AI识别（三要素分析）" placement="top" :show-after="500">
              <el-button link type="primary" size="small" :icon="MagicStick" @click="handleAnalyze(row)" />
            </el-tooltip>
            <el-tooltip content="人工复核 / 编辑" placement="top" :show-after="500">
              <el-button link type="success" size="small" :icon="EditPen" @click="handleEdit(row)" />
            </el-tooltip>
            <el-tooltip content="清空分析结果" placement="top" :show-after="500">
              <el-button link type="danger" size="small" :icon="Delete" @click="handleClear(row)" />
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 人工复核 / 编辑弹窗 -->
    <el-dialog v-model="editVisible" title="重大风险隐患分析 · 人工复核" width="820px" :close-on-click-modal="false" append-to-body>
      <div v-if="editRow" class="review-context">
        <div class="review-item"><span class="review-label">问题描述</span><span class="review-text">{{ editRow.issueDescription }}</span></div>
        <div class="review-meta">
          <span>安全域：{{ editRow.securityDomain || '—' }}</span>
          <span>测评对象：{{ editRow.assetName || '—' }}</span>
          <span>控制点：{{ editRow.controlPoint || '—' }}</span>
          <span>初判等级：{{ riskLabel(editRow.riskLevel) }}</span>
        </div>
        <div class="review-item">
          <span class="review-label">命中清单</span>
          <el-select v-model="editForm.catalogId" placeholder="未命中清单条目" clearable filterable style="flex: 1" @change="onCatalogChange">
            <el-option v-for="c in catalogOptions" :key="c.id" :label="c.code ? `${c.code} · ${c.title}` : c.title" :value="c.id" />
          </el-select>
        </div>
      </div>

      <el-form label-position="top" class="review-form">
        <el-form-item label="相关性（该问题与清单条目的关联程度）">
          <el-input v-model="editForm.relevance" type="textarea" :rows="3" placeholder="说明问题事实是否与清单条目的判定要点实质吻合，命中/未命中哪个条目" />
        </el-form-item>
        <el-form-item label="严重性（危害后果的严重程度）">
          <el-input v-model="editForm.severity" type="textarea" :rows="3" placeholder="结合测评对象重要性、影响范围、可能后果分析" />
        </el-form-item>
        <el-form-item label="高发性（问题反复出现的可能性）">
          <el-input v-model="editForm.frequency" type="textarea" :rows="3" placeholder="结合现场测评记录中同类问题的出现次数、覆盖面分析" />
        </el-form-item>
        <el-form-item label="最终判定">
          <el-radio-group v-model="editForm.verdict">
            <el-radio value="major">属于重大风险隐患</el-radio>
            <el-radio value="non_major">不属于</el-radio>
            <el-radio value="pending">待判定</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="综合结论">
          <el-input v-model="editForm.conclusion" type="textarea" :rows="2" placeholder="综合三要素说明判定理由" />
        </el-form-item>
        <el-form-item label="复核人">
          <el-input v-model="editForm.analyst" placeholder="填写复核人姓名" style="width: 240px" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 清单管理弹窗 -->
    <el-dialog v-model="catalogVisible" title="重大风险隐患清单管理" width="900px" :close-on-click-modal="false" append-to-body>
      <div class="catalog-toolbar">
        <div class="toolbar-tip">清单为用户提供的全局参考数据，跨项目共用；AI 识别时从启用条目中召回判定依据。</div>
        <div class="catalog-actions">
          <el-button type="primary" size="small" :icon="Plus" @click="openCatalogEdit()">新增条目</el-button>
          <el-button size="small" :icon="Upload" @click="importVisible = true">导入</el-button>
        </div>
      </div>
      <el-table :data="catalogList" v-loading="catalogLoading" border stripe max-height="420">
        <el-table-column label="序号" width="55" align="center"><template #default="{ $index }">{{ $index + 1 }}</template></el-table-column>
        <el-table-column prop="code" label="编号" width="110" show-overflow-tooltip />
        <el-table-column prop="title" label="隐患名称" min-width="200" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="120" show-overflow-tooltip />
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" effect="plain">{{ row.enabled ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :icon="Edit" @click="openCatalogEdit(row)" />
            <el-button link type="danger" size="small" :icon="Delete" @click="handleCatalogRemove(row)" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer><el-button @click="catalogVisible = false">关闭</el-button></template>
    </el-dialog>

    <!-- 清单条目编辑 -->
    <el-dialog v-model="catalogEditVisible" :title="catalogEditForm.id ? '编辑清单条目' : '新增清单条目'" width="640px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="隐患名称"><el-input v-model="catalogEditForm.title" placeholder="如：机房出入口访问控制措施缺失" /></el-form-item>
        <el-form-item label="编号"><el-input v-model="catalogEditForm.code" placeholder="清单编号（可选）" /></el-form-item>
        <el-form-item label="分类 / 安全域"><el-input v-model="catalogEditForm.category" placeholder="如：安全物理环境" /></el-form-item>
        <el-form-item label="判定要点"><el-input v-model="catalogEditForm.criteria" type="textarea" :rows="3" placeholder="满足什么情形认定为该重大风险隐患" /></el-form-item>
        <el-form-item label="匹配关键词"><el-input v-model="catalogEditForm.keywords" placeholder="逗号或换行分隔，用于与问题描述自动召回" /></el-form-item>
        <el-form-item label="来源"><el-input v-model="catalogEditForm.source" placeholder="出处（可选）" /></el-form-item>
        <el-form-item><el-checkbox v-model="catalogEditForm.enabled">启用该条目</el-checkbox></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="catalogEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="catalogSaving" @click="handleCatalogSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 清单导入 -->
    <el-dialog v-model="importVisible" title="导入重大风险隐患清单" width="680px" append-to-body>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        <template #title>粘贴清单内容，每行一条。支持制表符分隔：名称 / 编号 / 分类 / 判定要点 / 关键词；导入将替换现有清单。</template>
      </el-alert>
      <el-input v-model="importText" type="textarea" :rows="14" placeholder="机房出入口访问控制措施缺失&#9;6.1.1.1&#9;安全物理环境&#9;机房出入口未配置访问控制措施&#9;机房,出入口,访问控制" />
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="handleImport">导入并替换</el-button>
      </template>
    </el-dialog>

    <MajorRiskAi
      ref="aiRef"
      @draft="onAiDraft"
      @batch-done="onBatchDone"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft, HomeFilled, DArrowRight, Collection, MagicStick, Download,
  Document, Warning, CircleCheck, Clock, Search, EditPen, Delete, Edit, Plus, Upload,
} from '@element-plus/icons-vue';
import type {
  MajorRiskRow, MajorRiskSummary, MajorRiskCatalogItem, MajorRiskAiDraft,
  MajorRiskAiParams, MajorRiskVerdict,
} from '../../../shared/types';
import PageHint from '@/components/PageHint/index.vue';
import { useProjectNav } from '@/composables/useProjectNav';
import MajorRiskAi from './components/major-risk-ai.vue';

const route = useRoute();
const projectId = computed(() => route.params.id as string);
const { goToPhase, goBack } = useProjectNav(projectId);
const project = ref<any>(null);

const loading = ref(false);
const saving = ref(false);
const exporting = ref(false);
const batchStarting = ref(false);
const rows = ref<MajorRiskRow[]>([]);
const summary = ref<MajorRiskSummary>({ total: 0, analyzed: 0, pending: 0, major: 0, nonMajor: 0, catalogCount: 0 });
const filterForm = reactive({ keyword: '', verdict: '' });
const aiRef = ref<InstanceType<typeof MajorRiskAi> | null>(null);

const filteredRows = computed(() => {
  const kw = filterForm.keyword.trim().toLowerCase();
  return rows.value.filter(r => {
    if (filterForm.verdict && r.verdict !== filterForm.verdict) return false;
    if (kw && !`${r.issueDescription} ${r.catalogTitle || ''} ${r.assetName || ''}`.toLowerCase().includes(kw)) return false;
    return true;
  });
});

function riskLabel(level: string): string { return level === 'high' ? '高' : level === 'medium' ? '中' : '低'; }
function riskTagType(level: string): 'danger' | 'warning' | 'info' { return level === 'high' ? 'danger' : level === 'medium' ? 'warning' : 'info'; }
function verdictLabel(v: MajorRiskVerdict): string { return v === 'major' ? '属于重大隐患' : v === 'non_major' ? '不属于' : '待判定'; }
function verdictTag(v: MajorRiskVerdict): 'danger' | 'success' | 'info' { return v === 'major' ? 'danger' : v === 'non_major' ? 'success' : 'info'; }

async function loadProject(): Promise<void> {
  const pid = projectId.value;
  if (!pid || !window.api) return;
  try {
    const res = await window.api.project.get(pid);
    if (res.success && res.data) project.value = res.data;
  } catch (e) { console.error('加载项目信息失败:', e); }
}

async function loadData(): Promise<void> {
  const pid = projectId.value;
  if (!pid || !window.api) return;
  loading.value = true;
  try {
    const res = await window.api.majorRisk.list({ projectId: pid });
    if (res.success && res.data) {
      rows.value = res.data.list;
      summary.value = res.data.summary;
    } else {
      ElMessage.error(res.error?.message || '加载失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function toAiParams(row: MajorRiskRow): MajorRiskAiParams {
  return {
    issueId: row.issueId,
    projectId: row.projectId,
    issueTitle: row.issueTitle,
    issueDescription: row.issueDescription,
    securityDomain: row.securityDomain,
    controlPoint: row.controlPoint,
    controlName: row.controlName,
    assetName: row.assetName,
    riskLevel: row.riskLevel,
    rectificationSuggestion: undefined,
  };
}

async function handleAnalyze(row: MajorRiskRow): Promise<void> {
  await aiRef.value?.analyzeOne(toAiParams(row));
}

async function handleBatchAnalyze(): Promise<void> {
  const targets = filteredRows.value;
  if (!targets.length) { ElMessage.warning('没有可识别的问题'); return; }
  try {
    await ElMessageBox.confirm(
      `将对当前筛选出的 ${targets.length} 条问题逐条进行 AI 三要素识别，结果会先保存为 AI 草稿，之后仍需人工复核。是否继续？`,
      '批量AI识别',
      { confirmButtonText: '开始', cancelButtonText: '取消', type: 'info' }
    );
  } catch { return; }
  batchStarting.value = true;
  try {
    await aiRef.value?.analyzeBatch(targets.map(toAiParams));
  } finally {
    batchStarting.value = false;
  }
}

// ---- 编辑 / 人工复核 ----
const editVisible = ref(false);
const editRow = ref<MajorRiskRow | null>(null);
const editForm = reactive({
  catalogId: '' as string,
  catalogTitle: '' as string,
  relevance: '', severity: '', frequency: '',
  verdict: 'pending' as MajorRiskVerdict,
  conclusion: '', analyst: '',
});
const catalogOptions = ref<MajorRiskCatalogItem[]>([]);

function fillEditForm(row: MajorRiskRow, draft?: MajorRiskAiDraft): void {
  editForm.catalogId = draft?.catalogId || row.catalogId || '';
  editForm.catalogTitle = draft?.catalogTitle || row.catalogTitle || '';
  editForm.relevance = draft?.relevance ?? row.relevance ?? '';
  editForm.severity = draft?.severity ?? row.severity ?? '';
  editForm.frequency = draft?.frequency ?? row.frequency ?? '';
  editForm.verdict = draft?.verdict ?? row.verdict ?? 'pending';
  editForm.conclusion = draft?.conclusion ?? row.conclusion ?? '';
  editForm.analyst = row.analyst || '';
}

function handleEdit(row: MajorRiskRow): void {
  editRow.value = row;
  fillEditForm(row);
  editVisible.value = true;
}

/** AI 单条草稿回填：打开复核弹窗，不直接落库 */
function onAiDraft(draft: MajorRiskAiDraft, params: MajorRiskAiParams): void {
  const row = rows.value.find(r => r.issueId === params.issueId) || null;
  editRow.value = row;
  fillEditForm(row || ({
    issueId: params.issueId, projectId: params.projectId,
    issueDescription: params.issueDescription, securityDomain: params.securityDomain,
    assetName: params.assetName, controlPoint: params.controlPoint,
    riskLevel: params.riskLevel, verdict: 'pending', source: 'ai',
  } as MajorRiskRow), draft);
  editVisible.value = true;
}

function onCatalogChange(id: string): void {
  const item = catalogOptions.value.find(c => c.id === id);
  editForm.catalogTitle = item ? item.title : '';
}

async function handleSave(): Promise<void> {
  if (!editRow.value) return;
  saving.value = true;
  try {
    const res = await window.api.majorRisk.save({
      issueId: editRow.value.issueId,
      projectId: editRow.value.projectId,
      catalogId: editForm.catalogId,
      catalogTitle: editForm.catalogTitle,
      relevance: editForm.relevance,
      severity: editForm.severity,
      frequency: editForm.frequency,
      verdict: editForm.verdict,
      conclusion: editForm.conclusion,
      analyst: editForm.analyst,
      source: 'manual',
    });
    if (!res.success) throw new Error(res.error?.message || '保存失败');
    editVisible.value = false;
    ElMessage.success('已保存分析结果');
    await loadData();
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 批量完成：把成功草稿直接落库为 AI 草稿，用户随后逐条人工复核 */
async function onBatchDone(results: Array<{ issueId: string; draft?: MajorRiskAiDraft; success: boolean; error?: string }>): Promise<void> {
  let saved = 0;
  for (const r of results) {
    if (!r.success || !r.draft || !r.issueId) continue;
    const row = rows.value.find(x => x.issueId === r.issueId);
    if (!row) continue;
    try {
      const res = await window.api.majorRisk.save({
        issueId: r.issueId, projectId: row.projectId,
        catalogId: r.draft.catalogId, catalogTitle: r.draft.catalogTitle,
        relevance: r.draft.relevance, severity: r.draft.severity, frequency: r.draft.frequency,
        verdict: r.draft.verdict, conclusion: r.draft.conclusion,
        analyst: '', source: 'ai',
      });
      if (res.success) saved++;
    } catch { /* 单条失败不影响其余 */ }
  }
  ElMessage.success(`批量识别完成，已保存 ${saved} 条 AI 草稿，请逐条人工复核`);
  await loadData();
}

async function handleClear(row: MajorRiskRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认清空「${row.issueTitle || '该问题'}」的分析结果？`, '提示', { type: 'warning' });
  } catch { return; }
  try {
    const res = await window.api.majorRisk.clear(row.issueId);
    if (!res.success) throw new Error(res.error?.message || '清空失败');
    ElMessage.success('已清空');
    await loadData();
  } catch (e: any) { ElMessage.error(e?.message || '清空失败'); }
}

async function handleExport(): Promise<void> {
  const pid = projectId.value;
  if (!pid) return;
  exporting.value = true;
  try {
    const res = await window.api.majorRisk.exportExcel(pid);
    if (!res.success) throw new Error(res.error?.message || '导出失败');
    ElMessage.success('已导出 Excel');
  } catch (e: any) {
    if (e?.message !== '用户取消') ElMessage.error(e?.message || '导出失败');
  } finally { exporting.value = false; }
}

// ---- 清单管理 ----
const catalogVisible = ref(false);
const catalogLoading = ref(false);
const catalogList = ref<MajorRiskCatalogItem[]>([]);
async function openCatalog(): Promise<void> {
  catalogVisible.value = true;
  await loadCatalog();
}
async function loadCatalog(): Promise<void> {
  catalogLoading.value = true;
  try {
    const res = await window.api.majorRisk.catalogList();
    if (res.success && res.data) {
      catalogList.value = res.data;
      catalogOptions.value = res.data.filter(c => c.enabled);
    }
  } catch (e) { console.error(e); }
  finally { catalogLoading.value = false; }
}
async function handleCatalogRemove(item: MajorRiskCatalogItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除清单条目「${item.title}」？`, '提示', { type: 'warning' });
  } catch { return; }
  try {
    const res = await window.api.majorRisk.catalogRemove(item.id);
    if (!res.success) throw new Error(res.error?.message || '删除失败');
    ElMessage.success('已删除');
    await loadCatalog();
  } catch (e: any) { ElMessage.error(e?.message || '删除失败'); }
}

const catalogEditVisible = ref(false);
const catalogSaving = ref(false);
const catalogEditForm = reactive({
  id: '', title: '', code: '', category: '', criteria: '', keywords: '', source: '', enabled: true,
});
function openCatalogEdit(item?: MajorRiskCatalogItem): void {
  Object.assign(catalogEditForm, {
    id: item?.id || '', title: item?.title || '', code: item?.code || '',
    category: item?.category || '', criteria: item?.criteria || '', keywords: item?.keywords || '',
    source: item?.source || '', enabled: item ? item.enabled : true,
  });
  catalogEditVisible.value = true;
}
async function handleCatalogSave(): Promise<void> {
  catalogSaving.value = true;
  try {
    const res = await window.api.majorRisk.catalogSave({
      id: catalogEditForm.id || undefined,
      title: catalogEditForm.title, code: catalogEditForm.code, category: catalogEditForm.category,
      criteria: catalogEditForm.criteria, keywords: catalogEditForm.keywords,
      source: catalogEditForm.source, enabled: catalogEditForm.enabled,
    });
    if (!res.success) throw new Error(res.error?.message || '保存失败');
    catalogEditVisible.value = false;
    ElMessage.success('已保存清单条目');
    await loadCatalog();
    await loadData();
  } catch (e: any) { ElMessage.error(e?.message || '保存失败'); }
  finally { catalogSaving.value = false; }
}

const importVisible = ref(false);
const importing = ref(false);
const importText = ref('');
async function handleImport(): Promise<void> {
  const lines = importText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { ElMessage.warning('请先粘贴清单内容'); return; }
  const items = lines.map((line, i) => {
    const parts = line.split(/\t|，(?=.*\t)|,/).map(s => s.trim());
    const title = parts[0] || '';
    return {
      title,
      code: parts[1] || '',
      category: parts[2] || '',
      criteria: parts[3] || '',
      keywords: parts[4] || '',
      sortOrder: i,
      enabled: true,
    };
  }).filter(it => !!it.title);
  importing.value = true;
  try {
    const res = await window.api.majorRisk.catalogImport(items);
    if (!res.success) throw new Error(res.error?.message || '导入失败');
    importVisible.value = false;
    importText.value = '';
    ElMessage.success(`已导入 ${res.data?.count || 0} 条清单条目`);
    await loadCatalog();
    await loadData();
  } catch (e: any) { ElMessage.error(e?.message || '导入失败'); }
  finally { importing.value = false; }
}

onMounted(async () => {
  await Promise.all([loadProject(), loadData(), loadCatalog()]);
});
</script>

<style scoped lang="scss">
.page-container { padding: 20px; }
.project-context-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 16px; flex-wrap: wrap; }
.breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--color-text-secondary); }
.back-btn { cursor: pointer; &:hover { color: var(--color-primary); } }
.customer-name { color: var(--color-text-primary); font-weight: 500; }
.current-page { color: var(--color-text-primary); font-weight: 600; }
.phase-indicators { display: flex; gap: 6px; flex-wrap: wrap; }
.phase-pill { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 16px; background: var(--color-bg-tag); color: var(--color-text-secondary); font-size: 13px; cursor: pointer; transition: all .2s; &:hover { background: var(--color-bg-hover); }
  &.active { background: var(--color-primary); color: #fff; }
  .pill-num { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,.2); font-size: 11px; }
  &:not(.active) .pill-num { background: var(--color-border-light); color: var(--color-text-secondary); }
}
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 16px; }
.page-header-title { font-size: 20px; font-weight: 600; color: var(--color-text-primary); }
.page-header-desc { font-size: 13px; color: var(--color-text-secondary); margin-top: 4px; }
.page-header-actions { display: flex; gap: 8px; }
.stat-cards-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card { display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--color-bg-card); border: 1px solid var(--color-border-light); border-radius: 8px; }
.stat-icon { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
.stat-total { background: var(--color-primary-light); color: var(--color-primary); }
.stat-major { background: var(--color-danger-light); color: var(--color-danger); }
.stat-none { background: var(--color-success-light); color: var(--color-success); }
.stat-pending { background: var(--color-warning-light); color: var(--color-warning); }
.stat-catalog { background: var(--color-ai-light); color: var(--color-ai); }
.stat-label { font-size: 12px; color: var(--color-text-secondary); }
.stat-value { font-size: 24px; font-weight: 700; color: var(--color-text-primary); }
.table-section { background: var(--color-bg-card); border: 1px solid var(--color-border-light); border-radius: 8px; padding: 16px; }
.table-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; flex-wrap: wrap; }
.filter-form { display: flex; gap: 8px; flex-wrap: wrap; }
.toolbar-tip { font-size: 12px; color: var(--color-text-tertiary); }
.hit-none { color: var(--color-text-placeholder); }
.review-context { background: var(--color-bg-page); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; }
.review-item { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.review-label { flex: 0 0 72px; font-size: 13px; font-weight: 600; color: var(--color-text-tertiary); }
.review-text { flex: 1; font-size: 13px; color: var(--color-text); line-height: 1.6; }
.review-meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--color-text-secondary); margin: 8px 0 12px 84px; }
.catalog-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; }
.catalog-actions { display: flex; gap: 8px; }
</style>
