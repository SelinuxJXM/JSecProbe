<template>
  <div class="checkpoints-tab card" v-loading="loading">
    <div class="cp-header">
      <div class="cp-header-text">
        <div class="settings-section-title">测评点知识库</div>
        <div class="hint-text">
          导入等保测评作业指导书，把每条测评项拆成可核查的测评点。AI 分析时会按测评项与设备类型自动召回，逐点生成证据与判定。
        </div>
      </div>
      <div class="cp-header-actions">
        <el-button :icon="Refresh" @click="loadStats">刷新</el-button>
        <el-button :icon="Download" @click="downloadTemplate">下载导入模板</el-button>
        <el-button type="primary" :icon="Upload" @click="pickAndPreview" :loading="previewing">选择指导书导入</el-button>
        <el-button type="danger" :icon="Delete" @click="clearAll" :disabled="stats.total === 0">清空</el-button>
      </div>
    </div>

    <el-row :gutter="12" class="cp-stats">
      <el-col :span="8"><div class="stat-box"><div class="stat-num">{{ stats.total }}</div><div class="stat-label">已导入测评项</div></div></el-col>
      <el-col :span="8"><div class="stat-box"><div class="stat-num">{{ stats.withDevice }}</div><div class="stat-label">含设备类型</div></div></el-col>
      <el-col :span="8"><div class="stat-box"><div class="stat-num warn">{{ stats.unmatched }}</div><div class="stat-label">未匹配标准条款</div></div></el-col>
    </el-row>

    <!-- 预览区：选择文件后展示，用户确认才落库 -->
    <template v-if="preview">
      <el-divider content-position="left">导入预览 — {{ preview.file }}</el-divider>
      <div class="preview-summary">
        共 <b>{{ preview.stats.total }}</b> 条 · 自动匹配 {{ preview.stats.auto }} · 模糊匹配 {{ preview.stats.fuzzy }} ·
        <span class="warn-text">未匹配 {{ preview.stats.unmatched }}</span>（来自 {{ preview.stats.sheets }} 个 sheet）
        <span class="hint-text">未匹配项仍可导入，分析时按控制点/文本相似度近似召回</span>
      </div>
      <el-alert v-if="preview.failedFiles?.length" type="error" :closable="false" show-icon style="margin-bottom: 8px"
        :title="`以下文件解析失败，未包含在此次导入中：${preview.failedFiles.join('；')}`" />
      <el-alert v-if="preview.emptyFiles?.length" type="warning" :closable="false" show-icon style="margin-bottom: 8px"
        :title="`以下文件未识别到测评数据（可能是表头列名不匹配）：${preview.emptyFiles.join('；')}`" />
      <div style="margin: 10px 0">
        <el-checkbox v-model="clearFirst">导入前清空现有知识库</el-checkbox>
        <el-button size="small" type="primary" style="margin-left: 12px" @click="commit" :loading="committing" :disabled="selectedRows.length === 0">
          确认导入 {{ selectedRows.length }} 条
        </el-button>
        <el-button size="small" @click="preview = null">取消</el-button>
      </div>
      <el-table ref="tableRef" :data="preview.rows" max-height="calc(100vh - 380px)" border size="small" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="42" />
        <el-table-column prop="seq" label="序号" width="60" />
        <el-table-column label="匹配" width="80">
          <template #default="{ row }">
            <el-tag :type="row.match === 'auto' ? 'success' : row.match === 'fuzzy' ? 'warning' : 'info'" size="small">
              {{ row.match === 'auto' ? '自动' : row.match === 'fuzzy' ? '模糊' : '未匹配' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="controlPoint" label="类别/控制点" width="110" show-overflow-tooltip />
        <el-table-column prop="requirement" label="测评项" min-width="240" show-overflow-tooltip />
        <el-table-column label="测评点" width="90">
          <template #default="{ row }">{{ row.checkpoints.length }} 条</template>
        </el-table-column>
        <el-table-column label="匹配条款" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.matchedRequirement || '-' }}</template>
        </el-table-column>
        <el-table-column prop="deviceKey" label="设备" width="90" />
        <el-table-column prop="catalogNo" label="条款号" width="150" show-overflow-tooltip />
      </el-table>
      <div class="hint-text" style="margin-top: 8px">
        提示：勾选后点击"确认导入"。同语义键+设备的记录会被更新；系统会自动去重。导入后在现场测评页的 AI 分析中会逐点核查。
      </div>
    </template>

    <!-- 库内记录管理：搜索 + 列表 + 编辑/删除 -->
    <template v-else>
      <el-divider content-position="left">已导入记录 — {{ records.length }} 条</el-divider>
      <div class="record-toolbar">
        <el-input v-model="keyword" placeholder="搜索测评项 / 控制点 / 设备类型 / 条款号" clearable
          style="width: 360px" :prefix-icon="Search" @change="loadRecords" />
        <span class="hint-text">点击「编辑」可修改测评项内容、测评点、设备类型等；删除单条无需清空重导</span>
      </div>
      <el-table :data="records" border size="small" max-height="calc(100vh - 420px)">
        <el-table-column label="匹配" width="80">
          <template #default="{ row }">
            <el-tag :type="row.match === 'auto' ? 'success' : row.match === 'fuzzy' ? 'warning' : 'info'" size="small" effect="plain">
              {{ row.match === 'auto' ? '自动' : row.match === 'fuzzy' ? '模糊' : '未匹配' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="controlPoint" label="控制点" width="110" show-overflow-tooltip />
        <el-table-column prop="requirement" label="测评项" min-width="220" show-overflow-tooltip />
        <el-table-column label="测评点" width="80">
          <template #default="{ row }">{{ row.checkpoints.length }} 条</template>
        </el-table-column>
        <el-table-column prop="deviceKey" label="设备" width="100" show-overflow-tooltip />
        <el-table-column prop="catalogNo" label="条款号" width="140" show-overflow-tooltip />
        <el-table-column prop="updatedAt" label="更新时间" width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="removeRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <div v-if="stats.total === 0 && !preview" class="cp-empty">
      <div class="cp-empty-icon"><el-icon :size="30"><Upload /></el-icon></div>
      <div class="cp-empty-title">尚未导入测评点知识库</div>
      <div class="cp-empty-desc">点击右上角「选择指导书导入」，选择等保测评指导书的 Excel 文件。<br />导入后 AI 现场测评分析会自动按测评项逐点核查。</div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editVisible" title="编辑测评点" width="720px" :close-on-click-modal="false">
      <el-form label-width="96px" size="default">
        <el-form-item label="安全层面">
          <el-select v-model="editForm.domain" placeholder="留空=通用" clearable filterable allow-create style="width: 100%">
            <el-option v-for="d in domainOptions" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="控制点">
          <el-input v-model="editForm.controlPoint" placeholder="如：身份鉴别 / 访问控制" />
        </el-form-item>
        <el-form-item label="测评项" required>
          <el-input v-model="editForm.requirement" type="textarea" :rows="3" placeholder="标准条款原文，参与语义键匹配" />
        </el-form-item>
        <el-form-item label="测评方法" required>
          <el-input v-model="checkpointsText" type="textarea" :rows="6"
            placeholder="每行一个测评点；系统保存时会按编号重新拆分" />
          <div class="hint-text">提示：可直接逐行书写，也可保留 1) 2) 3) 编号；保存时自动按编号拆分。</div>
        </el-form-item>
        <el-form-item label="预期结果">
          <el-input v-model="editForm.resultTemplate" type="textarea" :rows="2" placeholder="核查通过时应看到的配置/状态示例" />
        </el-form-item>
        <el-form-item label="要求解读">
          <el-input v-model="editForm.interpretation" type="textarea" :rows="2" placeholder="条款含义与关键风险点说明" />
        </el-form-item>
        <el-form-item label="设备类型">
          <el-select v-model="editForm.deviceKey" placeholder="留空=通用" clearable filterable allow-create style="width: 100%">
            <el-option v-for="d in deviceOptions" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="标准条款号">
          <el-input v-model="editForm.catalogNo" placeholder="如 GBT22239-2019-8.1.4.1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Upload, Refresh, Delete, Download, Search } from '@element-plus/icons-vue';

/** 与后端 checkpoint-core.splitCheckpoints 同逻辑的本地副本：把编号串拆成逐条 */
function splitPoints(text: string): string[] {
  const t = String(text || '').trim();
  if (!t) return [];
  const NUMBER_RE = /[（(]?\d{1,2}\s*[)）、]/g;
  const marks: Array<{ index: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(t)) !== null) marks.push({ index: m.index, text: m[0] });
  const parts: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : t.length;
    const body = t.slice(start, end).trim().replace(/^[\s；;，,。、]+/, '').trim();
    if (body) parts.push(body);
  }
  if (parts.length < 2) return [t.replace(/^[\s；;，,。、]+/, '').trim()];
  const prefix = t.slice(0, marks[0].index).trim().replace(/[\s；;，,。、]+$/, '');
  if (prefix && prefix.length <= 12) parts[0] = `${prefix} ${parts[0]}`;
  return parts;
}

const loading = ref(false);
const previewing = ref(false);
const committing = ref(false);
const clearFirst = ref(false);
const stats = ref({ total: 0, withDevice: 0, unmatched: 0 });
const preview = ref<any>(null);
const selectedRows = ref<any[]>([]);
const tableRef = ref<any>(null);

// ── 库内记录管理（导入后编辑/删除）──
const records = ref<any[]>([]);
const keyword = ref('');
const editVisible = ref(false);
const saving = ref(false);
const editForm = ref<any>({ id: '', domain: '', controlPoint: '', requirement: '', resultTemplate: '', interpretation: '', deviceKey: '', catalogNo: '' });
const checkpointsText = ref('');
const domainOptions = ['安全物理环境', '安全通信网络', '安全区域边界', '安全计算环境', '安全管理中心', '安全管理制度', '安全管理机构', '安全人员管理', '安全建设管理', '安全运维管理'];
const deviceOptions = ['linux', 'windows', 'nginx', 'tomcat', 'mysql', 'oracle', 'mongodb', 'network_device', 'security_device', 'business_app', 'terminal', 'database', 'cloud', 'industrial', 'mobile', 'iot'];

// vue-tsc 不把 <el-dialog> 渲染分支内的模板引用计入使用分析（会误报 TS6133），
// 这里做一次显式引用，语义不变。
void [domainOptions, deviceOptions, saveEdit];

async function loadRecords() {
  const res = await window.api.checkpoint.list(keyword.value.trim());
  if (res.success && res.data) records.value = res.data;
}

function openEdit(row: any) {
  editForm.value = {
    id: row.id,
    domain: row.domain || '',
    controlPoint: row.controlPoint || '',
    requirement: row.requirement || '',
    resultTemplate: row.resultTemplate || '',
    interpretation: row.interpretation || '',
    deviceKey: row.deviceKey || '',
    catalogNo: row.catalogNo || '',
  };
  // 回显时把数组还原成逐行文本，便于编辑
  checkpointsText.value = (row.checkpoints || []).join('\n');
  editVisible.value = true;
}

async function saveEdit() {
  if (!editForm.value.requirement.trim()) { ElMessage.warning('测评项不能为空'); return; }
  const points = splitPoints(checkpointsText.value.replace(/\n/g, '；'));
  if (!points.length || !points[0]) { ElMessage.warning('测评方法不能为空'); return; }
  saving.value = true;
  try {
    // 编辑表单是普通字面量对象（非响应式表格行），但保险起见同样做纯数据转换再传 IPC
    const payload = JSON.parse(JSON.stringify({
      ...editForm.value,
      domain: editForm.value.domain || null,
      controlPoint: editForm.value.controlPoint || null,
      checkpoints: points,
      resultTemplate: editForm.value.resultTemplate || null,
      interpretation: editForm.value.interpretation || null,
      catalogNo: editForm.value.catalogNo || null,
    }));
    const res = await window.api.checkpoint.update(payload);
    if (res.success && res.data?.ok) {
      ElMessage.success('已保存');
      editVisible.value = false;
      await Promise.all([loadStats(), loadRecords()]);
    } else if (res.data?.reason === 'conflict') {
      ElMessage.error('保存失败：与另一条记录的「安全层面+控制点+测评项+设备」重复');
    } else if (res.data?.reason === 'not_found') {
      ElMessage.error('记录不存在，可能已被删除'); await loadRecords();
    } else {
      ElMessage.error(res.error?.message || '保存失败');
    }
  } finally { saving.value = false; }
}

async function removeRow(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除该测评点吗？\n\n${row.requirement?.slice(0, 80)}`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
  } catch { return; }
  const res = await window.api.checkpoint.delete(row.id);
  if (res.success && res.data?.ok) {
    ElMessage.success('已删除');
    await Promise.all([loadStats(), loadRecords()]);
  } else {
    ElMessage.error('删除失败');
  }
}

async function loadStats() {
  loading.value = true;
  try {
    const res = await window.api.checkpoint.stats();
    if (res.success && res.data) stats.value = res.data;
  } finally { loading.value = false; }
}

async function downloadTemplate() {
  try {
    const res = await window.api.checkpoint.downloadTemplate();
    if (res.success && res.data && !res.data.canceled) {
      ElMessage.success(`模板已保存到：${res.data.path}`);
    } else if (!res.data?.canceled) {
      ElMessage.error(res.error?.message || '模板下载失败');
    }
  } catch (e: any) {
    ElMessage.error('模板下载失败：' + (e?.message || '未知错误'));
  }
}

async function pickAndPreview() {
  const picked = await window.api.checkpoint.pickFile();
  if (!picked.success || !picked.data?.paths?.length) return;
  previewing.value = true;
  try {
    // 多文件合并预览：逐个解析后拼接（每个文件独立匹配，互不影响）
    const all: any[] = [];
    const sum = { total: 0, auto: 0, fuzzy: 0, unmatched: 0, sheets: 0 };
    const failedFiles: string[] = [];
    const emptyFiles: string[] = [];
    for (const p of picked.data.paths) {
      const name = p.split(/[\\/]/).pop() || p;
      const res = await window.api.checkpoint.preview(p);
      if (res.success && res.data) {
        all.push(...res.data.rows);
        sum.total += res.data.stats.total; sum.auto += res.data.stats.auto;
        sum.fuzzy += res.data.stats.fuzzy; sum.unmatched += res.data.stats.unmatched;
        sum.sheets += res.data.stats.sheets;
        // L4：零行 sheet 常驻提示，避免"表头没认出来"却显示绿色成功
        if (res.data.stats.total === 0) emptyFiles.push(name);
      } else {
        failedFiles.push(`${name}（${res.error?.message || '未知错误'}）`);
      }
    }
    preview.value = { file: `${picked.data.paths.length} 个文件`, rows: all, stats: sum, failedFiles, emptyFiles };
    // S6：让表格真的全选，与按钮文案"确认导入 N 条"一致
    await nextTick();
    tableRef.value?.toggleAllSelection?.();
  } finally { previewing.value = false; }
}

function onSelectionChange(rows: any[]) { selectedRows.value = rows; }

async function commit() {
  if (!selectedRows.value.length) { ElMessage.warning('请先勾选要导入的记录'); return; }
  // S5：清空是不可逆的破坏性操作，且影响面远大于普通导入，必须二次确认
  if (clearFirst.value) {
    try {
      await ElMessageBox.confirm(
        `将先清空现有 ${stats.value.total} 条测评点，再导入勾选项。此操作不可恢复，确定继续吗？`,
        '清空后导入确认',
        { type: 'warning', confirmButtonText: '清空并导入', cancelButtonText: '取消' },
      );
    } catch { return; }
  }
  committing.value = true;
  try {
    // el-table 勾选出的行是 ref/preview 深层响应式化后的 Vue Proxy。
    // ipcRenderer.invoke 跨 contextIsolation 用结构化克隆传参，Proxy 无法克隆会抛
    // "An object could not be cloned"。JSON 往返彻底剥离各层 Proxy，只保留纯数据
    // （行内字段均为 string/string[]/boolean，往返无损）。
    const plainRows = JSON.parse(JSON.stringify(selectedRows.value));
    const res = await window.api.checkpoint.commit(plainRows, clearFirst.value);
    if (res.success && res.data) {
      clearFirst.value = false; // S5：成功后必须复位，否则下一次普通导入会再次静默清空
      if (res.data.inserted + res.data.updated === 0 && res.data.skipped > 0) {
        ElMessage.warning(`没有有效记录入库（跳过 ${res.data.skipped} 条），请检查预览数据`);
      } else {
        ElMessage.success(`导入完成：新增 ${res.data.inserted}，更新 ${res.data.updated}，跳过 ${res.data.skipped}`);
      }
      preview.value = null;
      await Promise.all([loadStats(), loadRecords()]);
    } else {
      ElMessage.error(res.error?.message || '导入失败');
    }
  } finally { committing.value = false; }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(`确定清空全部 ${stats.value.total} 条测评点吗？此操作不可恢复。`, '清空知识库', { type: 'warning' });
  } catch { return; }
  const res = await window.api.checkpoint.clear();
  if (res.success) { ElMessage.success('已清空'); await loadStats(); }
}

onMounted(async () => { await loadStats(); await loadRecords(); });
</script>

<style scoped>
.checkpoints-tab { padding: var(--spacing-lg, 18px); min-height: 360px; }
.settings-section-title { font-size: 15px; font-weight: 500; color: var(--color-text-primary); }
.hint-text { color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; margin-top: 4px; }

.cp-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
.cp-header-text { flex: 1; min-width: 0; }
.cp-header-actions { display: flex; gap: 8px; flex-shrink: 0; }

.cp-stats { margin-bottom: 4px; }
.stat-box {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
}
.stat-num { font-size: 22px; font-weight: 500; color: var(--color-primary); line-height: 1; }
.stat-num.warn { color: var(--color-warning); }
.stat-label { font-size: 12px; color: var(--color-text-secondary); }

.preview-summary { font-size: 13px; margin-bottom: 8px; color: var(--color-text-primary); line-height: 1.6; }
.warn-text { color: var(--color-warning); }

.record-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }

.cp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 16px 40px;
  text-align: center;
}
.cp-empty-icon {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-primary-light, rgba(59,130,246,0.12));
  color: var(--color-primary);
}
.cp-empty-title { font-size: 14px; font-weight: 500; color: var(--color-text-primary); }
.cp-empty-desc { font-size: 12px; line-height: 1.8; color: var(--color-text-secondary); max-width: 520px; }
</style>
