<template>
  <!-- 迷你AI进度条（批量分析最小化时显示） -->
  <div v-if="batchAiMinimized" class="mini-ai-progress" @click="batchAiProgress.visible = true; batchAiMinimized = false">
    <div class="mini-ai-progress-header">
      <span class="mini-ai-progress-title">🤖 AI分析中</span>
      <span class="mini-ai-progress-percent">{{ batchAiProgressPercentDisplay }}</span>
    </div>
    <div class="mini-ai-progress-bar-container">
      <div class="mini-ai-progress-bar" :style="{ width: batchAiProgressPercent + '%' }"></div>
    </div>
    <div class="mini-ai-progress-message">{{ batchAiProgress.message }}</div>
    <div class="mini-ai-progress-restore">点击展开详情</div>
  </div>

  <!-- 迷你AI单条分析进度条（最小化时显示） -->
  <div v-if="aiDialogMinimized" class="mini-ai-progress mini-ai-single" @click="aiDialogVisible = true; aiDialogMinimized = false">
    <div class="mini-ai-progress-header">
      <span class="mini-ai-progress-title">🤖 AI单条分析</span>
      <span class="mini-ai-progress-percent">{{ Math.round((aiStep / 6) * 100) }}%</span>
    </div>
    <div class="mini-ai-progress-bar-container">
      <div class="mini-ai-progress-bar" :style="{ width: (aiStep / 6) * 100 + '%' }"></div>
    </div>
    <div class="mini-ai-progress-message">{{ aiLoadingText || '分析中...' }}</div>
    <div class="mini-ai-progress-restore">点击展开详情</div>
  </div>

  <!-- AI智能分析弹窗 -->
  <el-dialog
    v-model="aiDialogVisible"
    width="780px"
    class="ai-analysis-dialog"
    :close-on-click-modal="false"
    :show-close="false"
  >
    <template #header>
      <div class="ai-progress-header">
        <span class="ai-progress-title">🤖 AI智能分析</span>
        <div class="ai-progress-header-actions">
          <button v-if="aiLoading" class="ai-minimize-btn" @click="aiDialogVisible = false; aiDialogMinimized = true" title="最小化">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button v-if="!aiLoading" class="ai-close-btn" @click="aiDialogVisible = false" title="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </template>
    <div class="ai-flow-steps">
      <div class="flow-step" :class="{ active: aiStep >= 1, done: aiStep > 1 }">
        <span class="step-icon">📷</span>
        <span class="step-text">上传文件</span>
      </div>
      <div class="step-arrow">→</div>
      <div class="flow-step" :class="{ active: aiStep >= 2, done: aiStep > 2 }">
        <span class="step-icon">🔍</span>
        <span class="step-text">AI识别内容</span>
      </div>
      <div class="step-arrow">→</div>
      <div class="flow-step" :class="{ active: aiStep >= 3, done: aiStep > 3 }">
        <span class="step-icon">📊</span>
        <span class="step-text">AI分析结果</span>
      </div>
      <div class="step-arrow">→</div>
      <div class="flow-step" :class="{ active: aiStep >= 4, done: aiStep > 4 }">
        <span class="step-icon">✅</span>
        <span class="step-text">AI判定合规性</span>
      </div>
      <div class="step-arrow">→</div>
      <div class="flow-step" :class="{ active: aiStep >= 5, done: aiStep > 5 }">
        <span class="step-icon">📋</span>
        <span class="step-text">提取关键证据点</span>
      </div>
      <div class="step-arrow">→</div>
      <div class="flow-step" :class="{ active: aiStep >= 6, done: aiStep > 6 }">
        <span class="step-icon">📝</span>
        <span class="step-text">生成测评结论</span>
      </div>
    </div>

    <div v-if="aiLoading" class="ai-loading-area">
      <div class="loading-spinner"></div>
      <p class="loading-text">{{ aiLoadingText }}</p>
    </div>

    <div v-else-if="aiAnalysisResult" class="ai-result-area">
      <div class="result-section">
        <div class="section-title">安全控制点</div>
        <div class="section-content">{{ aiAnalysisResult.controlPoint || '-' }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">测评项（标准条款）</div>
        <div class="section-content">{{ aiAnalysisResult.requirement || '-' }}</div>
      </div>
      <div class="result-section">
        <div class="section-title">关键证据点（输入）</div>
        <div class="section-content mono evidence-input">{{ aiAnalysisResult.evidence || '无' }}</div>
      </div>
      <div v-if="aiAnalysisResult.keyEvidencePoints && aiAnalysisResult.keyEvidencePoints.length > 0" class="result-section">
        <div class="section-title">AI提取的关键证据点</div>
        <div class="section-content">
          <div v-for="(point, idx) in aiAnalysisResult.keyEvidencePoints" :key="idx" class="evidence-point">
            <span class="evidence-num">{{ idx + 1 }}</span>
            <span class="evidence-text">{{ point }}</span>
          </div>
        </div>
      </div>
      <div class="result-section">
        <div class="section-title">合规性判断</div>
        <div class="section-content">
          <span class="compliance-tag" :class="complianceClass">{{ aiAnalysisResult.compliance }}</span>
        </div>
      </div>
      <div class="result-section">
        <div class="section-title">详实测评结论</div>
        <div class="section-content conclusion-text">{{ aiAnalysisResult.conclusion }}</div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="aiDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="aiLoading || !aiAnalysisResult" @click="applyAiResult">
          确认并填入记录表
        </el-button>
      </div>
    </template>
  </el-dialog>

  <!-- AI使用合规确认弹窗 -->
  <el-dialog v-model="showAiConsentDialog" title="AI分析使用确认" width="520px" :close-on-click-modal="false">
    <div class="ai-consent-content">
      <div class="ai-consent-icon">⚠️</div>
      <div class="ai-consent-title">数据合规确认</div>
      <div class="ai-consent-body">
        <p>AI分析功能会将当前测评数据（包括核查记录、截图、文档等）发送到您配置的第三方AI服务进行处理。在使用AI分析功能前，请确认：</p>
        <ul>
          <li>✅ 已获得被测评单位的数据处理授权</li>
          <li>✅ 您配置的AI服务符合数据安全与隐私保护要求</li>
          <li>✅ 您了解发送的数据可能包含系统配置信息、截图内容等敏感信息</li>
        </ul>
        <p class="ai-consent-hint">您可以在「AI设置」中开启隐私模式（仅发送文本，不发送截图），或配置本地部署的LLM以实现数据不出本地。</p>
      </div>
    </div>
    <template #footer>
      <el-button @click="showAiConsentDialog = false; aiConsentPendingAction = null">暂不使用</el-button>
      <el-button type="primary" @click="confirmAiConsent">我已确认，继续使用</el-button>
    </template>
  </el-dialog>

  <!-- AI分析进度弹窗 -->
  <el-dialog v-model="batchAiProgress.visible" width="480px" :close-on-click-modal="false" :show-close="false" :close-on-press-escape="false" class="ai-progress-dialog">
    <template #header>
      <div class="ai-progress-header">
        <span class="ai-progress-title">🤖 AI批量分析</span>
        <div class="ai-progress-header-actions">
          <button v-if="batchAiProgress.percent < 100 && batchAiProgress.stage !== 'error'" class="ai-minimize-btn" @click="batchAiProgress.visible = false; batchAiMinimized = true" title="最小化">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button v-if="batchAiProgress.stage === 'error' || batchAiProgress.stage === 'done'" class="ai-close-btn" @click="batchAiProgress.visible = false" title="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </template>
    <div class="ai-progress-container">
      <!-- Step indicator horizontal layout -->
      <div class="progress-steps">
        <div class="step-item" :class="{ active: batchAiProgress.stage === 'init', completed: batchAiProgress.percent > 5 }">
          <div class="step-icon">{{ batchAiProgress.percent > 5 ? '✓' : '1' }}</div>
          <div class="step-info">
            <div class="step-name">读取配置</div>
            <div class="step-desc">验证连接</div>
          </div>
        </div>
        <div class="step-connector" :class="{ active: batchAiProgress.percent > 15 }"></div>
        <div class="step-item" :class="{ active: batchAiProgress.stage === 'encoding', completed: batchAiProgress.percent > 55 }">
          <div class="step-icon">{{ batchAiProgress.percent > 55 ? '✓' : '2' }}</div>
          <div class="step-info">
            <div class="step-name">编码文件</div>
            <div class="step-desc">图片处理</div>
          </div>
        </div>
        <div class="step-connector" :class="{ active: batchAiProgress.percent > 60 }"></div>
        <div class="step-item" :class="{ active: batchAiProgress.stage === 'sending', completed: batchAiProgress.percent > 70 }">
          <div class="step-icon">{{ batchAiProgress.percent > 70 ? '✓' : '3' }}</div>
          <div class="step-info">
            <div class="step-name">提交AI</div>
            <div class="step-desc">发送请求</div>
          </div>
        </div>
        <div class="step-connector" :class="{ active: batchAiProgress.percent > 75 }"></div>
        <div class="step-item" :class="{ active: batchAiProgress.stage === 'receiving' || batchAiProgress.stage === 'parsing', completed: batchAiProgress.percent >= 100 }">
          <div class="step-icon">{{ batchAiProgress.percent >= 100 ? '✓' : '4' }}</div>
          <div class="step-info">
            <div class="step-name">AI分析</div>
            <div class="step-desc">等待结果</div>
          </div>
        </div>
      </div>

      <!-- Total progress bar section -->
      <div class="total-progress">
        <div class="progress-label">
          <span class="stage-text">{{ batchAiProgress.message || '处理中...' }}</span>
          <span class="percent-text">{{ batchAiProgressPercentDisplay }}</span>
        </div>
        <div class="ai-progress-bar" :class="{ 'stage-error': batchAiProgress.stage === 'error', 'stage-done': batchAiProgress.stage === 'done', 'stage-receiving': batchAiProgress.stage === 'receiving' }">
          <div class="ai-progress-fill" :style="{ width: batchAiProgressPercent + '%' }"></div>
        </div>
      </div>

      <!-- Loading dots animation -->
      <div class="loading-hint" v-if="batchAiProgress.percent < 100 && batchAiProgress.stage !== 'error'">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-hint-text" v-if="batchAiProgress.stage === 'receiving'">AI正在分析内容，大文件可能需要30-60秒...</span>
        <span class="loading-hint-text" v-else-if="batchAiProgress.stage === 'parsing'">正在解析AI返回的结果...</span>
        <span class="loading-hint-text" v-else>处理中，请稍候...</span>
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="batchAiProgress.stage === 'error'" type="primary" @click="batchAiProgress.visible = false">关闭</el-button>
        <el-button v-if="batchAiProgress.stage === 'done'" type="success" @click="batchAiProgress.visible = false">完成</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onBeforeUnmount } from 'vue';

const props = defineProps<{
  tableRows: any[];
  saveAllRows: () => Promise<boolean>;
  loadScreenshotDataUrl: (row: any, filePath: string) => Promise<string | null>;
}>();

import { useAiAnalysis } from '../composables/useAiAnalysis';

const {
  aiDialogVisible,
  aiLoading,
  aiLoadingText,
  aiStep,
  aiCurrentRow,
  aiAnalysisResult,
  batchAiProgress,
  batchAiMinimized,
  aiDialogMinimized,
  aiConsentGiven,
  showAiConsentDialog,
  aiConsentPendingAction,
  batchAiProgressPercent,
  batchAiProgressPercentDisplay,
  batchFiles,
  showBatchScreenshots,
  batchAiLoading,
  aiAnalyze,
  applyAiResult,
  handleBatchUpload,
  removeBatchFile,
  clearBatchFiles,
  batchAiAnalyze,
  getFileType,
  confirmAiConsent,
  cleanup,
} = useAiAnalysis({
  tableRows: computed(() => props.tableRows),
  saveAllRows: props.saveAllRows,
  loadScreenshotDataUrl: props.loadScreenshotDataUrl,
});

// 合规标签样式
const complianceClass = computed(() => {
  if (!aiAnalysisResult.value) return '';
  const compliance = aiAnalysisResult.value.compliance;
  if (compliance === 'conform' || compliance?.includes('符合')) return 'conform';
  if (compliance === 'partial' || compliance?.includes('部分')) return 'partial';
  if (compliance === 'nonconform' || compliance?.includes('不符合')) return 'nonconform';
  return 'na';
});

// 暴露给父组件
defineExpose({
  aiDialogVisible,
  aiLoading,
  aiLoadingText,
  aiStep,
  aiCurrentRow,
  aiAnalysisResult,
  batchAiProgress,
  batchAiMinimized,
  aiDialogMinimized,
  aiConsentGiven,
  showAiConsentDialog,
  batchFiles,
  showBatchScreenshots,
  batchAiLoading,
  aiAnalyze,
  applyAiResult,
  handleBatchUpload,
  removeBatchFile,
  clearBatchFiles,
  batchAiAnalyze,
  getFileType,
  cleanup,
});

onBeforeUnmount(() => {
  cleanup();
});
</script>

<style lang="scss">
// AI分析弹窗
.ai-analysis-dialog {
  :deep(.el-dialog__header) {
    text-align: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    margin: 0;

    .el-dialog__title {
      color: #fff;
      font-size: 18px;
    }

    .el-dialog__headerbtn {
      top: 16px;

      .el-dialog__close {
        color: #fff;
      }
    }
  }

  .el-dialog__body {
    padding: 20px 24px;
  }
}

.ai-flow-steps {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0 20px;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 20px;

  .flow-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    opacity: 0.4;
    transition: opacity 0.3s;

    .step-icon {
      font-size: 20px;
    }

    .step-text {
      font-size: 11px;
      color: #6B7280;
      white-space: nowrap;
    }

    &.active {
      opacity: 1;

      .step-text {
        color: var(--color-primary, #1B5FD9);
        font-weight: 600;
      }
    }

    &.done {
      opacity: 0.7;

      .step-text {
        color: #10B981;
      }
    }
  }

  .step-arrow {
    color: #D1D5DB;
    font-size: 14px;
    flex-shrink: 0;
  }
}

.ai-loading-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;

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

@keyframes spin {
  to { transform: rotate(360deg); }
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

      &.mono {
        font-family: var(--font-family-mono, monospace);
        font-size: 12px;
      }

      &.evidence-input {
        max-height: 150px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }

      &.conclusion-text {
        line-height: 1.8;
        text-align: justify;
      }
    }
  }

  .evidence-point {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;

    &:last-child {
      margin-bottom: 0;
    }

    .evidence-num {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      background: var(--color-primary, #1B5FD9);
      color: #fff;
      border-radius: 50%;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
    }

    .evidence-text {
      flex: 1;
      line-height: 1.5;
    }
  }

  .compliance-tag {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;

    &.conform {
      background: var(--color-success-light);
      color: #059669;
    }

    &.partial {
      background: var(--color-warning-light);
      color: #D97706;
    }

    &.nonconform {
      background: var(--color-danger-light);
      color: #DC2626;
    }

    &.na {
      background: var(--color-bg-base);
      color: #6B7280;
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* Mini AI Progress Bar (minimized mode) */
.mini-ai-progress {
  background: linear-gradient(135deg, #1B5FD9 0%, #3B82F6 100%);
  color: #fff;
  padding: 8px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.2s ease;
  
  &:hover {
    box-shadow: 0 2px 8px rgba(27, 95, 217, 0.3);
  }
  
  &:active {
    transform: scale(0.998);
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

/* AI Progress Dialog Header */
.ai-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 4px;
  
  .ai-progress-title {
    font-size: 16px;
    font-weight: 600;
  }
  
  .ai-progress-header-actions {
    display: flex;
    gap: 4px;
  }
  
  .ai-minimize-btn,
  .ai-close-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: #6B7280;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    
    &:hover {
      background: var(--color-bg-base);
      color: #1F2937;
    }
  }
  
  .ai-close-btn:hover {
    background: var(--color-danger-light);
    color: #DC2626;
  }
}

.ai-progress-dialog {
  .ai-progress-container {
    padding: 10px 0;
  }
  
  /* Step indicator horizontal layout */
  .progress-steps {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 24px;
    padding: 0 10px;
    
    .step-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 0 0 auto;
      position: relative;
      
      .step-icon {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #E5E7EB;
        color: #9CA3AF;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.3s ease;
        margin-bottom: 6px;
        z-index: 2;
        position: relative;
      }
      
      .step-info {
        text-align: center;
        line-height: 1.3;
        
        .step-name {
          font-size: 12px;
          color: #9CA3AF;
          font-weight: 500;
          margin-bottom: 2px;
        }
        
        .step-desc {
          font-size: 10px;
          color: #D1D5DB;
        }
      }
      
      &.active .step-icon {
        background: #1B5FD9;
        color: #fff;
        box-shadow: 0 0 0 4px rgba(27, 95, 217, 0.2);
        animation: stepPulse 1.5s ease infinite;
      }
      
      &.active .step-name {
        color: #1B5FD9;
        font-weight: 600;
      }
      
      &.completed .step-icon {
        background: #10B981;
        color: #fff;
      }
      
      &.completed .step-name {
        color: #10B981;
      }
    }
    
    .step-connector {
      flex: 1;
      height: 2px;
      background: #E5E7EB;
      margin-top: 17px;
      transition: background 0.3s ease;
      min-width: 20px;
      
      &.active {
        background: #10B981;
      }
    }
  }
  
  /* Total progress bar section */
  .total-progress {
    margin-bottom: 16px;
    padding: 12px 16px;
    background: var(--color-bg-base);
    border-radius: 8px;
    border: 1px solid #E5E7EB;
    
    .progress-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      
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
  
  .ai-progress-bar.stage-receiving .ai-progress-fill {
    background: linear-gradient(90deg, #1B5FD9 0%, #3B82F6 50%, #1B5FD9 100%);
    background-size: 200% 100%;
    animation: progressSlide 1.5s ease infinite;
  }
  
  @keyframes progressSlide {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  
  /* Loading dots animation */
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

  .dialog-footer {
    display: flex;
    justify-content: center;
  }
}

@keyframes stepPulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(27, 95, 217, 0.2); }
  50% { box-shadow: 0 0 0 8px rgba(27, 95, 217, 0.1); }
}

@keyframes dotBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* AI Consent Dialog */
.ai-consent-content {
  text-align: center;
  padding: 10px 0;
}

.ai-consent-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.ai-consent-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary, #111827);
  margin-bottom: 16px;
}

.ai-consent-body {
  text-align: left;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary, #4B5563);

  p {
    margin: 0 0 12px 0;
  }

  ul {
    margin: 0 0 12px 0;
    padding: 0;
    list-style: none;
  }

  li {
    margin-bottom: 6px;
    padding-left: 4px;
  }
}

.ai-consent-hint {
  font-size: 12px !important;
  color: var(--color-text-tertiary, #9CA3AF) !important;
  font-style: italic;
  margin-top: 8px !important;
}

// 深色主题覆盖
:root.dark {
  .ai-analysis-dialog {
    :deep(.el-dialog__header) {
      background: linear-gradient(135deg, #1E3A5F 0%, #2D1B4E 100%);
    }
  }

  .ai-flow-steps {
    border-bottom-color: var(--color-border-base);

    .flow-step {
      .step-text {
        color: var(--color-text-tertiary);
      }

      &.done {
        .step-text {
          color: #34D399;
        }
      }
    }

    .step-arrow {
      color: var(--color-border-base);
    }
  }

  .ai-loading-area {
    .loading-spinner {
      border-color: var(--color-border-base);
      border-top-color: var(--color-primary);
    }

    .loading-text {
      color: var(--color-text-tertiary);
    }
  }

  .mini-ai-progress {
    background: linear-gradient(135deg, #1E3A5F 0%, #1B5FD9 100%);
    border-bottom-color: rgba(255, 255, 255, 0.1);

    .mini-ai-progress-bar-container {
      background: rgba(255, 255, 255, 0.15);
    }
  }

  .ai-progress-header {
    .ai-minimize-btn,
    .ai-close-btn {
      color: var(--color-text-tertiary);

      &:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
      }
    }
  }

  .ai-progress-dialog {
    .progress-steps {
      .step-item {
        .step-icon {
          background: var(--color-bg-hover);
          color: var(--color-text-tertiary);
        }

        .step-info {
          .step-name {
            color: var(--color-text-tertiary);
          }

          .step-desc {
            color: var(--color-text-disabled);
          }
        }

        &.active .step-icon {
          background: var(--color-primary);
          color: #fff;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
        }

        &.active .step-name {
          color: var(--color-primary);
        }

        &.completed .step-icon {
          background: #16A34A;
          color: #fff;
        }

        &.completed .step-name {
          color: #16A34A;
        }
      }

      .step-connector {
        background: var(--color-border-base);

        &.active {
          background: #16A34A;
        }
      }
    }

    .total-progress {
      background: var(--color-bg-card);
      border-color: var(--color-border-base);

      .progress-label {
        .stage-text {
          color: var(--color-text-primary);
        }

        .percent-text {
          color: var(--color-primary);
        }
      }
    }

    .ai-progress-bar {
      background: var(--color-border-base);
    }

    .ai-progress-fill {
      background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-hover) 100%);
    }

    .ai-progress-bar.stage-error .ai-progress-fill {
      background: #DC2626;
    }

    .ai-progress-bar.stage-done .ai-progress-fill {
      background: #16A34A;
    }

    .ai-progress-bar.stage-receiving .ai-progress-fill {
      background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-hover) 50%, var(--color-primary) 100%);
      background-size: 200% 100%;
    }

    .loading-hint {
      .loading-dot {
        background: var(--color-primary);
      }

      .loading-hint-text {
        color: var(--color-text-tertiary);
      }
    }
  }
}
</style>
