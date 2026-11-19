<template>
  <!-- 迷你进度条（批量识别最小化时显示） -->
  <div v-if="batchMinimized" class="mini-ai-progress" @click="batchVisible = true; batchMinimized = false">
    <div class="mini-ai-progress-header">
      <span class="mini-ai-progress-title"><el-icon><MagicStick /></el-icon> AI重大风险隐患识别中</span>
      <span class="mini-ai-progress-percent">{{ batchPercentDisplay }}</span>
    </div>
    <div class="mini-ai-progress-bar-container">
      <div class="mini-ai-progress-bar" :style="{ width: batchPercent + '%' }"></div>
    </div>
    <div class="mini-ai-progress-message">{{ batchMessage }}</div>
    <div class="mini-ai-progress-restore">点击展开详情</div>
  </div>

  <!-- 单条识别弹窗 -->
  <el-dialog
    v-model="singleVisible"
    width="720px"
    class="ai-issue-dialog"
    :close-on-click-modal="false"
    :show-close="false"
    append-to-body
  >
    <template #header>
      <div class="ai-dialog-header">
        <span class="ai-dialog-title"><el-icon><MagicStick /></el-icon> AI重大风险隐患识别</span>
        <button class="ai-close-btn" @click="closeSingleDialog" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </template>

    <div v-if="singleLoading" class="flow-steps-container">
      <div class="flow-steps">
        <template v-for="(s, i) in steps" :key="s">
          <div class="flow-step" :class="{ active: singleStep >= i + 1, done: singleStep > i + 1 }">
            <div class="step-icon">{{ singleStep > i + 1 ? '✓' : i + 1 }}</div>
            <div class="step-label">{{ s }}</div>
          </div>
          <div v-if="i < steps.length - 1" class="step-connector" :class="{ active: singleStep > i + 1 }"></div>
        </template>
      </div>
    </div>

    <div v-if="singleLoading" class="ai-loading-area">
      <div class="loading-spinner"></div>
      <p class="loading-text">{{ singleMessage || '正在召回清单与现场记录…' }}</p>
    </div>

    <div v-else-if="singleError" class="ai-error">
      <el-alert type="error" :closable="false" :title="singleError" show-icon />
    </div>

    <div v-else-if="singleDraft" class="ai-result-area">
      <el-alert type="success" :closable="false" show-icon class="result-alert">
        <template #title>识别完成，结果已回填，请人工复核后保存</template>
      </el-alert>
      <div class="result-section">
        <div class="section-title">命中清单条目</div>
        <div class="section-content">{{ singleDraft.catalogTitle || '未命中清单条目' }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">相关性</div>
        <div class="section-content conclusion-text">{{ singleDraft.relevance || '—' }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">严重性</div>
        <div class="section-content conclusion-text">{{ singleDraft.severity || '—' }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">高发性</div>
        <div class="section-content conclusion-text">{{ singleDraft.frequency || '—' }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">综合判定</div>
        <div class="section-content verdict-text" :class="verdictClass(singleDraft.verdict)">{{ verdictLabel(singleDraft.verdict) }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">综合结论</div>
        <div class="section-content conclusion-text">{{ singleDraft.conclusion || '—' }}</div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <template v-if="singleLoading">
          <el-button @click="closeSingleDialog" :disabled="singleLoading">最小化</el-button>
          <el-button type="danger" plain @click="handleCancel">中止识别</el-button>
        </template>
        <el-button v-else type="primary" @click="singleVisible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 批量识别进度弹窗 -->
  <el-dialog v-model="batchVisible" width="600px" :close-on-click-modal="false" :show-close="false" :close-on-press-escape="false" class="ai-batch-dialog" append-to-body>
    <template #header>
      <div class="ai-dialog-header">
        <span class="ai-dialog-title"><el-icon><MagicStick /></el-icon> AI批量重大风险隐患识别</span>
        <div class="ai-dialog-header-actions">
          <button class="ai-minimize-btn" @click="batchVisible = false; batchMinimized = true" title="最小化">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="ai-close-btn" @click="closeBatchDialog" title="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </template>

    <div class="batch-progress-container">
      <div class="progress-info">
        <span class="stage-text">{{ batchMessage || '处理中...' }}</span>
        <span class="percent-text">{{ batchPercentDisplay }}</span>
      </div>
      <div class="ai-progress-bar" :class="{ 'stage-error': batchStage === 'error', 'stage-done': batchStage === 'done' }">
        <div class="ai-progress-fill" :style="{ width: batchPercent + '%' }"></div>
      </div>

      <div class="progress-meta">
        <div class="meta-item">
          <span class="meta-label">进度</span>
          <span class="meta-value">{{ batchCurrent }} / {{ batchTotal }}</span>
        </div>
        <div class="meta-item" v-if="batchElapsedTime > 0">
          <span class="meta-label">已用时间</span>
          <span class="meta-value">{{ formatTime(batchElapsedTime) }}</span>
        </div>
        <div class="meta-item" v-if="batchEstimatedRemaining > 0 && batchPercent < 100">
          <span class="meta-label">预计剩余</span>
          <span class="meta-value">{{ formatTime(batchEstimatedRemaining) }}</span>
        </div>
      </div>

      <div class="issue-list-progress" v-if="batchList.length > 0">
        <div class="issue-list-header">识别进度列表</div>
        <div class="issue-list-container">
          <div
            v-for="(item, idx) in batchList"
            :key="item.issueId"
            class="issue-list-item"
            :class="{
              pending: idx > batchCurrent || (idx === batchCurrent && !batchLoading),
              processing: idx === batchCurrent && batchLoading,
              done: idx < batchCurrent && !item.failed,
              failed: item.failed
            }"
          >
            <span class="issue-status-icon">
              <svg v-if="idx < batchCurrent && !item.failed" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              <svg v-else-if="idx === batchCurrent && batchLoading" class="spin-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
              <svg v-else-if="item.failed" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <span v-else class="issue-dot"></span>
            </span>
            <span class="issue-name">{{ item.issueDescription }}</span>
          </div>
        </div>
      </div>

      <div v-if="batchStage === 'done' || batchStage === 'canceled'" class="batch-summary">
        <div class="summary-item success">
          <span class="summary-icon">✓</span>
          <span class="summary-text">成功 {{ batchSuccessCount }} 个</span>
        </div>
        <div class="summary-item failed" v-if="batchFailedCount > 0">
          <span class="summary-icon">✗</span>
          <span class="summary-text">失败 {{ batchFailedCount }} 个</span>
        </div>
      </div>

      <div class="loading-hint" v-if="batchPercent < 100 && batchStage !== 'error' && batchLoading">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-hint-text">AI正在结合清单与现场记录分析，请耐心等待...</span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <template v-if="batchStage === 'done' || batchStage === 'canceled' || batchStage === 'error'">
          <el-button
            :type="batchStage === 'done' ? 'success' : 'primary'"
            @click="batchVisible = false"
          >
            {{ batchStage === 'canceled' ? '已中止，关闭' : batchStage === 'done' ? '完成' : '关闭' }}
          </el-button>
        </template>
        <template v-else>
          <el-button @click="batchVisible = false; batchMinimized = true">最小化</el-button>
          <el-button type="danger" plain :loading="batchCanceling" @click="cancelBatch">
            {{ batchCanceling ? '正在中止...' : '中止识别' }}
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import { MagicStick } from '@element-plus/icons-vue';
import { formatDuration } from '@/utils/format';
import type { MajorRiskAiDraft, MajorRiskAiParams } from '../../../../shared/types';

const emit = defineEmits<{
  /** 单条草稿回填（页面弹编辑框让人复核）；批量完成直接落库后通知刷新 */
  (e: 'draft', draft: MajorRiskAiDraft, params: MajorRiskAiParams): void;
  (e: 'batch-done', results: Array<{ issueId: string; draft?: MajorRiskAiDraft; success: boolean; error?: string }>, canceled?: boolean): void;
}>();

const steps = ['读取配置', '召回清单与现场记录', '提交AI', '等待响应', '生成判定'];

// ==================== 单条识别 ====================
const singleVisible = ref(false);
const singleLoading = ref(false);
const singleStep = ref(0);
const singleMessage = ref('');
const singleError = ref('');
const singleDraft = ref<MajorRiskAiDraft | null>(null);
const singleMinimized = ref(false);

function verdictLabel(v: string): string {
  return v === 'major' ? '属于重大风险隐患' : v === 'non_major' ? '不属于' : '待判定';
}
function verdictClass(v: string): string {
  return v === 'major' ? 'verdict-major' : v === 'non_major' ? 'verdict-none' : 'verdict-pending';
}

function progressTick(step: number, message: string) {
  singleStep.value = step;
  singleMessage.value = message;
}

function closeSingleDialog() {
  // 识别中直接关闭会让用户误以为任务被取消，收进最小化
  if (singleLoading.value) {
    singleVisible.value = false;
    singleMinimized.value = true;
    return;
  }
  singleVisible.value = false;
}

/** 单条识别：打开弹窗并调用 AI，草稿 emit 给页面回填 */
async function analyzeOne(params: MajorRiskAiParams): Promise<void> {
  singleVisible.value = true;
  singleMinimized.value = false;
  singleLoading.value = true;
  singleError.value = '';
  singleDraft.value = null;
  singleStep.value = 1;
  singleMessage.value = '正在读取AI配置…';
  try {
    // 前 3 步是本地动作，固定节奏推进；第 4 步等待远端模型，不自动跳满
    setTimeout(() => { if (singleLoading.value && singleStep.value < 4) progressTick(2, '正在召回清单与检索现场测评记录…'); }, 600);
    setTimeout(() => { if (singleLoading.value && singleStep.value < 4) progressTick(3, '正在提交AI分析…'); }, 1200);
    const res = await window.api.ai.analyzeMajorRisk(params);
    if (!res.success || !res.data) throw new Error(res.error?.message || 'AI识别失败');
    progressTick(5, '生成判定完成');
    singleDraft.value = res.data;
    emit('draft', res.data, params);
  } catch (err: any) {
    singleError.value = err?.message === '已取消' ? '已取消识别' : (err?.message || 'AI识别失败');
  } finally {
    singleLoading.value = false;
  }
}

// ==================== 批量识别 ====================
const batchVisible = ref(false);
const batchLoading = ref(false);
const batchCanceling = ref(false);
const batchMinimized = ref(false);
const batchPercent = ref(0);
const batchMessage = ref('');
const batchStage = ref('');
const batchCurrent = ref(0);
const batchTotal = ref(0);
const batchElapsedTime = ref(0);
const batchEstimatedRemaining = ref(0);
const batchSuccessCount = ref(0);
const batchFailedCount = ref(0);
const batchList = ref<Array<{ issueId: string; issueDescription: string; failed: boolean }>>([]);

const batchPercentDisplay = computed(() => `${batchPercent.value}%`);

function formatTime(seconds: number): string {
  return formatDuration(seconds);
}

function closeBatchDialog() {
  if (batchLoading.value) {
    batchVisible.value = false;
    batchMinimized.value = true;
    return;
  }
  batchVisible.value = false;
}

let unsubProgress: (() => void) | null = null;
let batchStartTime = 0;
let batchTimerInterval: ReturnType<typeof setInterval> | null = null;

async function cancelBatch(): Promise<void> {
  if (!window.api || !batchLoading.value) return;
  batchCanceling.value = true;
  try {
    await window.api.ai.cancelMajorRiskAnalysis();
    ElMessage.info('正在中止，当前这条识别完成后即停止');
  } catch (err: any) {
    ElMessage.error('中止失败：' + (err.message || '未知错误'));
  } finally {
    batchCanceling.value = false;
  }
}

/** 批量识别：订阅进度，调用 AI 批量通道，结果 emit 给页面落库 */
async function analyzeBatch(issues: MajorRiskAiParams[]): Promise<void> {
  if (!issues.length) return;
  if (batchLoading.value) {
    ElMessage.warning('批量 AI 识别进行中，请稍候');
    return;
  }
  batchVisible.value = true;
  batchMinimized.value = false;
  batchLoading.value = true;
  batchPercent.value = 0;
  batchMessage.value = '准备中...';
  batchStage.value = 'init';
  batchCurrent.value = 0;
  batchTotal.value = issues.length;
  batchElapsedTime.value = 0;
  batchEstimatedRemaining.value = 0;
  batchSuccessCount.value = 0;
  batchFailedCount.value = 0;
  batchList.value = issues.map(issue => ({
    issueId: issue.issueId,
    issueDescription: issue.issueDescription || issue.issueTitle || '未命名问题',
    failed: false,
  }));
  batchStartTime = Date.now();

  batchTimerInterval = setInterval(() => {
    batchElapsedTime.value = Math.floor((Date.now() - batchStartTime) / 1000);
    if (batchPercent.value > 0 && batchPercent.value < 100) {
      const estimatedTotal = batchElapsedTime.value / (batchPercent.value / 100);
      batchEstimatedRemaining.value = Math.max(0, Math.floor(estimatedTotal - batchElapsedTime.value));
    }
  }, 1000);

  unsubProgress?.();
  unsubProgress = window.api.ai.onBatchMajorRiskProgress((p: any) => {
    if (typeof p.percent === 'number') batchPercent.value = p.percent;
    if (typeof p.message === 'string') batchMessage.value = p.message;
    if (typeof p.stage === 'string') batchStage.value = p.stage;
    if (typeof p.current === 'number') batchCurrent.value = p.current;
    if (typeof p.total === 'number') batchTotal.value = p.total;
  });

  try {
    const res = await window.api.ai.batchAnalyzeMajorRisks({ issues });
    if (!res.success || !res.data) throw new Error(res.error?.message || 'AI批量识别失败');

    const results = res.data.results;
    for (const result of results) {
      const listItem = batchList.value.find(x => x.issueId === result.issueId);
      if (result.success) {
        batchSuccessCount.value++;
      } else {
        batchFailedCount.value++;
        if (listItem) listItem.failed = true;
      }
    }
    if (!batchStage.value || batchStage.value === 'init' || batchStage.value === 'analyzing') {
      batchStage.value = res.data.canceled ? 'canceled' : 'done';
    }
    batchPercent.value = 100;
    // 中止时后端仍会发 current=total，这里按实际返回的条目数回拨，未处理的保持待处理态
    batchCurrent.value = res.data.canceled ? results.length : batchTotal.value;
    batchMessage.value = res.data.canceled
      ? `已中止，${batchSuccessCount.value} 条结果未应用（需重新执行才会落库）`
      : `完成 ${batchSuccessCount.value}/${batchTotal.value} 条`;
    // S6：把 canceled 一并传给父组件，取消时不落库半成品草稿
    emit('batch-done', results, !!res.data.canceled);
  } catch (err: any) {
    batchStage.value = 'error';
    batchMessage.value = err?.message || 'AI批量识别失败';
    ElMessage.error(err?.message || 'AI批量识别失败');
  } finally {
    batchLoading.value = false;
    batchCanceling.value = false;
    if (batchTimerInterval) {
      clearInterval(batchTimerInterval);
      batchTimerInterval = null;
    }
    unsubProgress?.();
    unsubProgress = null;
  }
}

async function handleCancel(): Promise<void> {
  try {
    await window.api.ai.cancelMajorRiskAnalysis();
  } catch {
    // 取消失败不影响关闭流程
  }
}

onBeforeUnmount(() => {
  unsubProgress?.();
  if (batchTimerInterval) {
    clearInterval(batchTimerInterval);
  }
});

defineExpose({ analyzeOne, analyzeBatch });
</script>

<style lang="scss">
// 弹窗外壳（append-to-body，需非 scoped；类名与整改建议/风险分析弹窗一致，样式互为补充）
.ai-issue-dialog {
  :deep(.el-dialog__header) {
    text-align: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    margin: 0;
    padding: 16px 20px;
  }

  .el-dialog__body {
    padding: 20px 24px;
  }
}

.ai-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 4px;

  .ai-dialog-title {
    font-size: 16px;
    font-weight: 600;
    color: #fff;

    .el-icon {
      vertical-align: -2px;
      margin-right: 4px;
    }
  }

  .ai-close-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }
  }
}

// ==================== 5步流程指示器 ====================
.flow-steps-container {
  padding: 16px 0 20px;
  border-bottom: 1px solid var(--color-border-light);
  margin-bottom: 20px;
}

.flow-steps {
  display: flex;
  align-items: center;
  justify-content: center;
}

.flow-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0.4;
  transition: opacity 0.3s;

  .step-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-border-light);
    color: var(--color-text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.3s ease;
  }

  .step-label {
    font-size: 11px;
    color: var(--color-text-tertiary);
    white-space: nowrap;
    transition: color 0.3s;
  }

  &.active {
    opacity: 1;

    .step-icon {
      background: var(--color-primary);
      color: #fff;
      box-shadow: 0 0 0 4px rgba(27, 95, 217, 0.2);
      animation: stepPulse 1.5s ease infinite;
    }

    .step-label {
      color: var(--color-primary);
      font-weight: 600;
    }
  }

  &.done {
    opacity: 0.7;

    .step-icon {
      background: var(--color-success);
      color: #fff;
    }

    .step-label {
      color: var(--color-success);
    }
  }
}

.step-connector {
  width: 24px;
  height: 2px;
  background: var(--color-border-light);
  margin: 0 4px;
  margin-bottom: 22px;
  transition: background 0.3s ease;

  &.active {
    background: var(--color-success);
  }
}

@keyframes stepPulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(27, 95, 217, 0.2); }
  50% { box-shadow: 0 0 0 8px rgba(27, 95, 217, 0.1); }
}

.ai-loading-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;

  .loading-spinner {
    width: 48px;
    height: 48px;
    border: 3px solid var(--color-border-light);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: mrSpin 1s linear infinite;
  }

  .loading-text {
    margin-top: 16px;
    color: var(--color-text-secondary);
    font-size: 14px;
  }
}

.ai-error {
  padding: 12px 0;
}

// ==================== 单条结果 ====================
.ai-result-area {
  .result-alert {
    margin-bottom: 16px;
  }

  .result-section {
    margin-bottom: 14px;

    &:last-child {
      margin-bottom: 0;
    }

    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-secondary);
      margin-bottom: 6px;
    }

    .section-content {
      font-size: 13px;
      color: var(--color-text-primary);
      line-height: 1.6;
      background: var(--color-bg-page);
      padding: 10px 12px;
      border-radius: var(--radius-base);

      &.conclusion-text {
        line-height: 1.8;
        text-align: justify;
        white-space: pre-wrap;
      }

      &.verdict-text {
        font-weight: 600;
      }
    }
  }
}

.verdict-major { color: var(--color-danger); }
.verdict-none { color: var(--color-success); }
.verdict-pending { color: var(--color-warning); }

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

// ==================== 迷你进度条 ====================
.mini-ai-progress {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  min-width: 400px;
  max-width: 600px;
  width: auto;
  background: linear-gradient(135deg, #1B5FD9 0%, #3B82F6 100%);
  color: #fff;
  padding: 8px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 20px rgba(27, 95, 217, 0.4);
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(27, 95, 217, 0.3);
  }

  .mini-ai-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;

    .mini-ai-progress-title {
      font-size: 13px;
      font-weight: 600;
    }

    .mini-ai-progress-percent {
      font-size: 14px;
      font-weight: 700;
    }
  }

  .mini-ai-progress-bar-container {
    height: 4px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: var(--radius-xs);
    overflow: hidden;
    margin-bottom: 4px;

    .mini-ai-progress-bar {
      height: 100%;
      background: #fff;
      border-radius: var(--radius-xs);
      transition: width 0.3s ease;
    }
  }

  .mini-ai-progress-message {
    font-size: 11px;
    opacity: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini-ai-progress-restore {
    font-size: 10px;
    opacity: 0.7;
    text-align: center;
    margin-top: 2px;
  }
}

// ==================== 批量进度弹窗 ====================
.batch-progress-container {
  padding: 16px 0;

  .progress-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .stage-text {
      font-size: 13px;
      color: var(--color-text-primary);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 12px;
    }

    .percent-text {
      font-size: 13px;
      color: var(--color-primary);
      font-weight: 700;
      flex-shrink: 0;
    }
  }
}

.ai-progress-bar {
  height: 14px;
  background: var(--color-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.ai-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1B5FD9 0%, #3B82F6 100%);
  border-radius: var(--radius-md);
  transition: width 0.3s ease;
}

.ai-progress-bar.stage-error .ai-progress-fill {
  background: var(--color-danger);
}

.ai-progress-bar.stage-done .ai-progress-fill {
  background: var(--color-success);
}

.progress-meta {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-top: 12px;
  padding: 10px 16px;
  background: var(--color-bg-page);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-light);
}

.meta-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.meta-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.meta-value {
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.issue-list-progress {
  margin-top: 16px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.issue-list-header {
  padding: 10px 16px;
  background: var(--color-bg-page);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border-light);
}

.issue-list-container {
  max-height: 200px;
  overflow-y: auto;
  padding: 8px 0;
}

.issue-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  font-size: 12px;
  transition: background 0.2s;

  &:hover {
    background: var(--color-bg-hover);
  }

  &.done {
    .issue-status-icon {
      color: var(--color-success);
    }
  }

  &.processing {
    background: var(--color-primary-subtle);

    .issue-status-icon {
      color: var(--color-primary);
    }

    .issue-name {
      color: var(--color-primary);
      font-weight: 500;
    }
  }

  &.failed {
    .issue-status-icon {
      color: var(--color-danger);
    }

    .issue-name {
      color: var(--color-danger);
      text-decoration: line-through;
    }
  }

  &.pending {
    .issue-name {
      color: var(--color-text-tertiary);
    }
  }
}

.issue-status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.spin-svg {
  animation: mrSpin 1s linear infinite;
}

.issue-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-quaternary);
}

.issue-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
}

.batch-summary {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--color-success-light);
  border-radius: var(--radius-md);
  border: 1px solid rgba(24, 169, 87, 0.35);
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;

  &.success {
    color: var(--color-success);
  }

  &.failed {
    color: var(--color-danger);
  }
}

.summary-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
}

.summary-item.success .summary-icon {
  background: var(--color-success);
  color: #fff;
}

.summary-item.failed .summary-icon {
  background: var(--color-danger);
  color: #fff;
}

.loading-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 0;

  .loading-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-primary);
    animation: mrDotBounce 1.4s ease-in-out infinite;

    &:nth-child(2) { animation-delay: 0.16s; }
    &:nth-child(3) { animation-delay: 0.32s; }
  }

  .loading-hint-text {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-left: 8px;
  }
}

@keyframes mrSpin {
  to { transform: rotate(360deg); }
}

@keyframes mrDotBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}
</style>
