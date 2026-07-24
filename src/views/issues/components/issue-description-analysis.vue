<template>
  <!-- 迷你AI进度条（批量分析最小化时显示） -->
  <div v-if="batchMinimized" class="mini-ai-progress" @click="batchProgress.visible = true; batchMinimized = false">
    <div class="mini-ai-progress-header">
      <span class="mini-ai-progress-title">📝 AI分析问题描述中</span>
      <span class="mini-ai-progress-percent">{{ batchPercentDisplay }}</span>
    </div>
    <div class="mini-ai-progress-bar-container">
      <div class="mini-ai-progress-bar" :style="{ width: batchProgress.percent + '%' }"></div>
    </div>
    <div class="mini-ai-progress-message">{{ batchProgress.message }}</div>
    <div class="mini-ai-progress-restore">点击展开详情</div>
  </div>

  <!-- AI单条分析弹窗 -->
  <el-dialog
    v-model="singleDialogVisible"
    width="720px"
    class="ai-issue-dialog"
    :close-on-click-modal="false"
    :show-close="false"
  >
    <template #header>
      <div class="ai-dialog-header">
        <span class="ai-dialog-title">📝 AI分析问题描述</span>
        <button class="ai-close-btn" @click="singleDialogVisible = false" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </template>

    <!-- 5步流程指示器 -->
    <div v-if="singleLoading" class="flow-steps-container">
      <div class="flow-steps">
        <div class="flow-step" :class="{ active: singleStep >= 1, done: singleStep > 1 }">
          <div class="step-icon">{{ singleStep > 1 ? '✓' : '1' }}</div>
          <div class="step-label">读取配置</div>
        </div>
        <div class="step-connector" :class="{ active: singleStep > 1 }"></div>
        <div class="flow-step" :class="{ active: singleStep >= 2, done: singleStep > 2 }">
          <div class="step-icon">{{ singleStep > 2 ? '✓' : '2' }}</div>
          <div class="step-label">编码输入</div>
        </div>
        <div class="step-connector" :class="{ active: singleStep > 2 }"></div>
        <div class="flow-step" :class="{ active: singleStep >= 3, done: singleStep > 3 }">
          <div class="step-icon">{{ singleStep > 3 ? '✓' : '3' }}</div>
          <div class="step-label">提交AI</div>
        </div>
        <div class="step-connector" :class="{ active: singleStep > 3 }"></div>
        <div class="flow-step" :class="{ active: singleStep >= 4, done: singleStep > 4 }">
          <div class="step-icon">{{ singleStep > 4 ? '✓' : '4' }}</div>
          <div class="step-label">等待响应</div>
        </div>
        <div class="step-connector" :class="{ active: singleStep > 4 }"></div>
        <div class="flow-step" :class="{ active: singleStep >= 5, done: singleStep > 5 }">
          <div class="step-icon">{{ singleStep > 5 ? '✓' : '5' }}</div>
          <div class="step-label">生成描述</div>
        </div>
      </div>
    </div>

    <div v-if="singleLoading" class="ai-loading-area">
      <div class="loading-spinner"></div>
      <p class="loading-text">{{ singleLoadingText }}</p>
    </div>

    <div v-else-if="singleResult" class="ai-result-area">
      <div class="result-section">
        <div class="section-title">问题标题</div>
        <div class="section-content">{{ currentIssue?.issueTitle || '-' }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">问题描述</div>
        <div class="section-content conclusion-text">{{ singleResult }}</div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="singleDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="singleLoading || !singleResult" @click="applySingleResult">
          确认填入问题描述
        </el-button>
      </div>
    </template>
  </el-dialog>

  <!-- AI批量分析进度弹窗 -->
  <el-dialog v-model="batchProgress.visible" width="600px" :close-on-click-modal="false" :show-close="false" :close-on-press-escape="false" class="ai-batch-dialog">
    <template #header>
      <div class="ai-dialog-header">
        <span class="ai-dialog-title">📝 AI批量分析问题描述</span>
        <div class="ai-dialog-header-actions">
          <button v-if="batchProgress.percent < 100 && batchProgress.stage !== 'error'" class="ai-minimize-btn" @click="batchProgress.visible = false; batchMinimized = true" title="最小化">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button v-if="batchProgress.stage === 'error' || batchProgress.stage === 'done'" class="ai-close-btn" @click="batchProgress.visible = false" title="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </template>
    <div class="batch-progress-container">
      <!-- 总进度条 -->
      <div class="progress-info">
        <span class="stage-text">{{ batchProgress.message || '处理中...' }}</span>
        <span class="percent-text">{{ batchPercentDisplay }}</span>
      </div>
      <div class="ai-progress-bar" :class="{ 'stage-error': batchProgress.stage === 'error', 'stage-done': batchProgress.stage === 'done' }">
        <div class="ai-progress-fill" :style="{ width: batchProgress.percent + '%' }"></div>
      </div>

      <!-- 时间和统计信息 -->
      <div class="progress-meta">
        <div class="meta-item">
          <span class="meta-label">进度</span>
          <span class="meta-value">{{ batchProgress.current }} / {{ batchProgress.total }}</span>
        </div>
        <div class="meta-item" v-if="batchElapsedTime > 0">
          <span class="meta-label">已用时间</span>
          <span class="meta-value">{{ formatTime(batchElapsedTime) }}</span>
        </div>
        <div class="meta-item" v-if="batchEstimatedRemaining > 0 && batchProgress.percent < 100">
          <span class="meta-label">预计剩余</span>
          <span class="meta-value">{{ formatTime(batchEstimatedRemaining) }}</span>
        </div>
      </div>

      <!-- 问题列表进度 -->
      <div class="issue-list-progress" v-if="batchIssueList.length > 0">
        <div class="issue-list-header">分析进度列表</div>
        <div class="issue-list-container">
          <div
            v-for="(item, idx) in batchIssueList"
            :key="item.issueId"
            class="issue-list-item"
            :class="{
              pending: idx > batchProgress.current,
              processing: idx === batchProgress.current - 1 && batchProgress.percent < 100,
              done: idx < batchProgress.current - 1 || batchProgress.percent >= 100,
              failed: item.failed
            }"
          >
            <span class="issue-status-icon">
              <svg v-if="idx < batchProgress.current - 1 || batchProgress.percent >= 100" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              <svg v-else-if="idx === batchProgress.current - 1 && batchProgress.percent < 100" class="spin-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
              <svg v-else-if="item.failed" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <span v-else class="issue-dot"></span>
            </span>
            <span class="issue-name">{{ item.issueTitle }}</span>
          </div>
        </div>
      </div>

      <!-- 完成统计 -->
      <div v-if="batchProgress.stage === 'done'" class="batch-summary">
        <div class="summary-item success">
          <span class="summary-icon">✓</span>
          <span class="summary-text">成功 {{ batchSuccessCount }} 个</span>
        </div>
        <div class="summary-item failed" v-if="batchFailedCount > 0">
          <span class="summary-icon">✗</span>
          <span class="summary-text">失败 {{ batchFailedCount }} 个</span>
        </div>
      </div>

      <!-- Loading dots -->
      <div class="loading-hint" v-if="batchProgress.percent < 100 && batchProgress.stage !== 'error'">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-hint-text">AI正在分析生成问题描述，请耐心等待...</span>
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="batchProgress.stage === 'error'" type="primary" @click="batchProgress.visible = false">关闭</el-button>
        <el-button v-if="batchProgress.stage === 'done'" type="success" @click="batchProgress.visible = false">完成</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import type { Issue } from '../../../../shared/types';

const props = defineProps<{
  getIssueDomainId: (domainName: string) => string;
}>();

const emit = defineEmits<{
  (e: 'applyDescription', issueId: string, description: string): void;
}>();

// ==================== 单条分析状态 ====================
const singleDialogVisible = ref(false);
const singleLoading = ref(false);
const singleResult = ref<string | null>(null);
const currentIssue = ref<Issue | null>(null);
const singleStep = ref(0);
const singleLoadingText = ref('正在读取配置...');

const singleStepTexts = [
  '正在读取配置...',
  '正在编码输入数据...',
  '正在提交给AI分析...',
  'AI正在分析中，请耐心等待...',
  '正在生成问题描述...',
];

// ==================== 批量分析状态 ====================
const batchProgress = ref({
  visible: false,
  percent: 0,
  message: '',
  stage: '',
  current: 0,
  total: 0,
});
const batchMinimized = ref(false);
const batchElapsedTime = ref(0);
const batchEstimatedRemaining = ref(0);
const batchSuccessCount = ref(0);
const batchFailedCount = ref(0);
const batchIssueList = ref<Array<{ issueId: string; issueTitle: string; failed: boolean }>>([]);

let batchStartTime = 0;
let batchTimerInterval: ReturnType<typeof setInterval> | null = null;

const batchPercentDisplay = computed(() => `${batchProgress.value.percent}%`);

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}分${secs}秒`;
}

// ==================== 单条分析 ====================
async function analyzeIssueDescription(issue: Issue) {
  if (!window.api) return;

  console.log('[issue-description-analysis.analyzeIssueDescription] 开始分析, issueId:', issue.id, 'issueTitle:', issue.issueTitle);

  currentIssue.value = issue;
  singleDialogVisible.value = true;
  singleLoading.value = true;
  singleResult.value = null;
  singleStep.value = 1;
  singleLoadingText.value = singleStepTexts[0];

  // 模拟步骤进度
  const stepInterval = setInterval(() => {
    if (singleStep.value < 5 && singleLoading.value) {
      singleStep.value++;
      singleLoadingText.value = singleStepTexts[singleStep.value - 1];
    }
  }, 800);

  try {
    const params = {
      issueId: issue.id,
      issueTitle: issue.issueTitle,
      issueDescription: issue.issueDescription || '',
      securityDomain: props.getIssueDomainId(issue.securityDomain || ''),
      controlPoint: issue.controlPoint || '',
      controlName: issue.controlName || '',
    };
    console.log('[issue-description-analysis.analyzeIssueDescription] 调用IPC, params:', JSON.stringify(params));

    const res = await window.api.ai.analyzeIssueDescription(params);

    console.log('[issue-description-analysis.analyzeIssueDescription] IPC返回, success:', res.success, 'hasData:', !!res.data);

    singleStep.value = 5;
    singleLoadingText.value = singleStepTexts[4];

    if (res.success && res.data) {
      singleResult.value = res.data.content;
      console.log('[issue-description-analysis.analyzeIssueDescription] AI返回内容长度:', res.data.content.length);
      console.log('[issue-description-analysis.analyzeIssueDescription] AI返回内容:', res.data.content);
    } else {
      singleResult.value = null;
      console.error('[issue-description-analysis.analyzeIssueDescription] AI分析失败:', res.error);
    }
  } catch (err: any) {
    console.error('[issue-description-analysis.analyzeIssueDescription] IPC调用异常:', err.message);
    singleResult.value = null;
  } finally {
    clearInterval(stepInterval);
    singleLoading.value = false;
  }
}

function applySingleResult() {
  if (!singleResult.value || !currentIssue.value) return;
  emit('applyDescription', currentIssue.value.id, singleResult.value);
  singleDialogVisible.value = false;
}

// ==================== 批量分析 ====================
async function batchAnalyzeIssueDescriptions(issues: Issue[]) {
  if (!window.api || issues.length === 0) return;

  console.log('[issue-description-analysis.batchAnalyzeIssueDescriptions] 开始批量分析, 问题总数:', issues.length);
  console.log('[issue-description-analysis.batchAnalyzeIssueDescriptions] 问题列表:', JSON.stringify(issues.map(i => ({
    issueId: i.id,
    issueTitle: i.issueTitle,
  }))));

  batchProgress.value = { visible: true, percent: 0, message: '准备中...', stage: 'init', current: 0, total: issues.length };
  batchMinimized.value = false;
  batchElapsedTime.value = 0;
  batchEstimatedRemaining.value = 0;
  batchSuccessCount.value = 0;
  batchFailedCount.value = 0;
  batchIssueList.value = issues.map(issue => ({
    issueId: issue.id,
    issueTitle: issue.issueTitle,
    failed: false,
  }));
  batchStartTime = Date.now();

  // 启动计时器
  batchTimerInterval = setInterval(() => {
    batchElapsedTime.value = Math.floor((Date.now() - batchStartTime) / 1000);
    if (batchProgress.value.percent > 0 && batchProgress.value.percent < 100) {
      const estimatedTotal = batchElapsedTime.value / (batchProgress.value.percent / 100);
      batchEstimatedRemaining.value = Math.max(0, Math.floor(estimatedTotal - batchElapsedTime.value));
    }
  }, 1000);

  try {
    // 批量分析：逐个调用API（避免并发过多导致API限流）
    const results: Array<{ issueId: string; description: string; success: boolean }> = [];
    
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      try {
        batchProgress.value = { 
          ...batchProgress.value, 
          percent: Math.round((i / issues.length) * 100),
          message: `正在分析: ${issue.issueTitle}`,
          current: i + 1,
        };
        
        console.log(`[issue-description-analysis.batchAnalyzeIssueDescriptions] [${i + 1}/${issues.length}] 开始分析: ${issue.issueTitle}`);
        
        const res = await window.api.ai.analyzeIssueDescription({
          issueId: issue.id,
          issueTitle: issue.issueTitle,
          issueDescription: issue.issueDescription || '',
          securityDomain: props.getIssueDomainId(issue.securityDomain || ''),
          controlPoint: issue.controlPoint || '',
          controlName: issue.controlName || '',
        });
        
        if (res.success && res.data) {
          results.push({ issueId: issue.id, description: res.data.content, success: true });
          batchSuccessCount.value++;
          console.log(`[issue-description-analysis.batchAnalyzeIssueDescriptions] [${i + 1}/${issues.length}] 分析成功, 返回内容长度: ${res.data.content.length}`);
        } else {
          results.push({ issueId: issue.id, description: '', success: false });
          batchFailedCount.value++;
          const item = batchIssueList.value.find(item => item.issueId === issue.id);
          if (item) item.failed = true;
          console.error(`[issue-description-analysis.batchAnalyzeIssueDescriptions] [${i + 1}/${issues.length}] 分析失败: ${res.error?.message || '未知错误'}`);
        }
      } catch (err: any) {
        results.push({ issueId: issue.id, description: '', success: false });
        batchFailedCount.value++;
        const item = batchIssueList.value.find(item => item.issueId === issue.id);
        if (item) item.failed = true;
        console.error(`[issue-description-analysis.batchAnalyzeIssueDescriptions] [${i + 1}/${issues.length}] 异常: ${err.message}`);
      }
    }

    batchProgress.value = { ...batchProgress.value, percent: 100, message: '分析完成', stage: 'done', current: issues.length };
    
    console.log(`[issue-description-analysis.batchAnalyzeIssueDescriptions] 批量分析完成, 成功: ${batchSuccessCount.value}, 失败: ${batchFailedCount.value}`);
    
    // 逐个回填结果
    for (const result of results) {
      if (result.success && result.description) {
        emit('applyDescription', result.issueId, result.description);
      }
    }
  } catch (err: any) {
    console.error('[issue-description-analysis.batchAnalyzeIssueDescriptions] 批量分析异常:', err.message);
    batchProgress.value = { ...batchProgress.value, stage: 'error', message: '分析过程中发生错误' };
  } finally {
    if (batchTimerInterval) {
      clearInterval(batchTimerInterval);
      batchTimerInterval = null;
    }
  }
}

onBeforeUnmount(() => {
  if (batchTimerInterval) {
    clearInterval(batchTimerInterval);
  }
});

defineExpose({
  analyzeIssueDescription,
  batchAnalyzeIssueDescriptions,
});
</script>

<style lang="scss">
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
  }

  .ai-close-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    border-radius: 4px;
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
  border-bottom: 1px solid #E5E7EB;
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
    background: #E5E7EB;
    color: #9CA3AF;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.3s ease;
  }

  .step-label {
    font-size: 11px;
    color: #9CA3AF;
    white-space: nowrap;
    transition: color 0.3s;
  }

  &.active {
    opacity: 1;

    .step-icon {
      background: #1B5FD9;
      color: #fff;
      box-shadow: 0 0 0 4px rgba(27, 95, 217, 0.2);
      animation: stepPulse 1.5s ease infinite;
    }

    .step-label {
      color: #1B5FD9;
      font-weight: 600;
    }
  }

  &.done {
    opacity: 0.7;

    .step-icon {
      background: #10B981;
      color: #fff;
    }

    .step-label {
      color: #10B981;
    }
  }
}

.step-connector {
  width: 32px;
  height: 2px;
  background: #E5E7EB;
  margin: 0 4px;
  margin-bottom: 22px;
  transition: background 0.3s ease;

  &.active {
    background: #10B981;
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
    border: 3px solid #E5E7EB;
    border-top-color: var(--color-primary, #1B5FD9);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .loading-text {
    margin-top: 16px;
    color: #6B7280;
    font-size: 14px;
  }
}

.ai-result-area {
  .result-section {
    margin-bottom: 16px;

    &:last-child {
      margin-bottom: 0;
    }

    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-secondary, #4B5563);
      margin-bottom: 6px;
    }

    .section-content {
      font-size: 13px;
      color: var(--color-text-primary, #1F2937);
      line-height: 1.6;
      background: var(--color-bg-page, #F5F6FA);
      padding: 10px 12px;
      border-radius: 6px;

      &.conclusion-text {
        line-height: 1.8;
        text-align: justify;
      }
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.mini-ai-progress {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  min-width: 400px;
  max-width: 600px;
  width: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  padding: 8px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
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
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;

    .mini-ai-progress-bar {
      height: 100%;
      background: #fff;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
  }

  .mini-ai-progress-message {
    font-size: 11px;
    opacity: 0.9;
  }

  .mini-ai-progress-restore {
    font-size: 10px;
    opacity: 0.7;
    text-align: center;
    margin-top: 2px;
  }
}

.ai-batch-dialog {
  .ai-dialog-header {
    .ai-dialog-header-actions {
      display: flex;
      gap: 4px;
    }

    .ai-minimize-btn {
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.8);
      border-radius: 4px;
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
}

// 浅色模式下按钮颜色适配
html:not(.dark) .ai-batch-dialog,
html:not(.dark) .ai-issue-dialog {
  .ai-dialog-header {
    .ai-close-btn,
    .ai-minimize-btn {
      color: rgba(0, 0, 0, 0.6);

      &:hover {
        background: rgba(0, 0, 0, 0.08);
        color: rgba(0, 0, 0, 0.9);
      }
    }
  }
}

.batch-progress-container {
  padding: 16px 0;

  .progress-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .stage-text {
      font-size: 13px;
      color: #374151;
      font-weight: 500;
    }

    .percent-text {
      font-size: 13px;
      color: #1B5FD9;
      font-weight: 700;
    }
  }
}

.ai-progress-bar {
  height: 14px;
  background: #E5E7EB;
  border-radius: 7px;
  overflow: hidden;
}

.ai-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1B5FD9 0%, #3B82F6 100%);
  border-radius: 7px;
  transition: width 0.3s ease;
}

.ai-progress-bar.stage-error .ai-progress-fill {
  background: #DC2626;
}

.ai-progress-bar.stage-done .ai-progress-fill {
  background: #10B981;
}

// ==================== 时间和统计信息 ====================
.progress-meta {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-top: 12px;
  padding: 10px 16px;
  background: #F9FAFB;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
}

.meta-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.meta-label {
  font-size: 11px;
  color: #9CA3AF;
}

.meta-value {
  font-size: 13px;
  color: #374151;
  font-weight: 600;
}

// ==================== 问题列表进度 ====================
.issue-list-progress {
  margin-top: 16px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  overflow: hidden;
}

.issue-list-header {
  padding: 10px 16px;
  background: #F9FAFB;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  border-bottom: 1px solid #E5E7EB;
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
    background: #F9FAFB;
  }

  &.done {
    .issue-status-icon {
      color: #10B981;
    }
  }

  &.processing {
    background: #EFF6FF;

    .issue-status-icon {
      color: #1B5FD9;
    }

    .issue-name {
      color: #1B5FD9;
      font-weight: 500;
    }
  }

  &.failed {
    .issue-status-icon {
      color: #DC2626;
    }

    .issue-name {
      color: #DC2626;
      text-decoration: line-through;
    }
  }

  &.pending {
    .issue-name {
      color: #9CA3AF;
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
  animation: spin 1s linear infinite;
}

.issue-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #D1D5DB;
}

.issue-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #374151;
}

// ==================== 完成统计 ====================
.batch-summary {
  display: flex;
  justify-content: center;
  gap: 24px;
  margin-top: 16px;
  padding: 12px 16px;
  background: #F0FDF4;
  border-radius: 8px;
  border: 1px solid #BBF7D0;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;

  &.success {
    color: #059669;
  }

  &.failed {
    color: #DC2626;
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
  background: #059669;
  color: #fff;
}

.summary-item.failed .summary-icon {
  background: #DC2626;
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
    background: #1B5FD9;
    animation: dotBounce 1.4s ease-in-out infinite;

    &:nth-child(2) { animation-delay: 0.16s; }
    &:nth-child(3) { animation-delay: 0.32s; }
  }

  .loading-hint-text {
    font-size: 12px;
    color: #6B7280;
    margin-left: 8px;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes dotBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}
</style>
