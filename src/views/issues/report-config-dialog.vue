<template>
  <el-dialog
    v-model="visible"
    title="生成项目报告"
    width="640px"
    :close-on-click-modal="false"
    destroy-on-close
    class="report-config-dialog"
  >
    <div class="dialog-content">
      <!-- 格式选择 -->
      <div class="config-section">
        <div class="section-title">
          <span class="section-icon">📄</span>
          <span>报告格式</span>
        </div>
        <el-radio-group v-model="config.format" class="format-selector">
          <el-radio value="docx" class="format-option">
            <div class="format-card">
              <div class="format-icon docx-icon">W</div>
              <div class="format-info">
                <span class="format-name">Word 文档</span>
                <span class="format-desc">可编辑，适合二次修改</span>
              </div>
            </div>
          </el-radio>
          <el-radio value="pdf" class="format-option">
            <div class="format-card">
              <div class="format-icon pdf-icon">PDF</div>
              <div class="format-info">
                <span class="format-name">PDF 文档</span>
                <span class="format-desc">版式固定，适合打印分发</span>
              </div>
            </div>
          </el-radio>
        </el-radio-group>
      </div>

      <!-- 模板选择 -->
      <div class="config-section">
        <div class="section-title">
          <span class="section-icon">📋</span>
          <span>报告模板</span>
        </div>
        <el-radio-group v-model="config.template" class="template-selector">
          <el-radio value="simple" class="template-option">
            <div class="template-card">
              <div class="template-header">
                <span class="template-name">简化报告</span>
                <span class="template-tag tag-simple">简洁</span>
              </div>
              <div class="template-desc">包含概述、问题清单和整改建议，适合快速查阅</div>
            </div>
          </el-radio>
          <el-radio value="standard" class="template-option">
            <div class="template-card">
              <div class="template-header">
                <span class="template-name">标准报告</span>
                <span class="template-tag tag-standard">推荐</span>
              </div>
              <div class="template-desc">包含完整章节，适合正式提交和归档</div>
            </div>
          </el-radio>
          <el-radio value="detailed" class="template-option">
            <div class="template-card">
              <div class="template-header">
                <span class="template-name">详细报告</span>
                <span class="template-tag tag-detailed">详尽</span>
              </div>
              <div class="template-desc">包含所有细节描述和分析，适合深度审查</div>
            </div>
          </el-radio>
        </el-radio-group>
      </div>

      <!-- 章节选择 -->
      <div class="config-section">
        <div class="section-title">
          <span class="section-icon">📑</span>
          <span>包含章节</span>
          <span class="section-hint">已选 {{ config.includeSections.length }}/9</span>
        </div>
        <el-checkbox-group v-model="config.includeSections" class="section-selector">
          <el-checkbox value="cover" class="section-option">
            <span class="section-name">封面</span>
          </el-checkbox>
          <el-checkbox value="toc" class="section-option">
            <span class="section-name">目录</span>
          </el-checkbox>
          <el-checkbox value="overview" class="section-option">
            <span class="section-name">报告概述</span>
          </el-checkbox>
          <el-checkbox value="projectInfo" class="section-option">
            <span class="section-name">项目概况</span>
          </el-checkbox>
          <el-checkbox value="methodology" class="section-option">
            <span class="section-name">测评方法</span>
          </el-checkbox>
          <el-checkbox value="results" class="section-option">
            <span class="section-name">测评结果汇总</span>
          </el-checkbox>
          <el-checkbox value="analysis" class="section-option">
            <span class="section-name">总体分析评价</span>
          </el-checkbox>
          <el-checkbox value="issues" class="section-option">
            <span class="section-name">问题清单及分析</span>
          </el-checkbox>
          <el-checkbox value="recommendations" class="section-option">
            <span class="section-name">整改建议及规划</span>
          </el-checkbox>
          <el-checkbox value="appendix" class="section-option">
            <span class="section-name">附录</span>
          </el-checkbox>
        </el-checkbox-group>
      </div>

      <!-- 保存位置 -->
      <div class="config-section">
        <div class="section-title">
          <span class="section-icon">💾</span>
          <span>保存位置</span>
        </div>
        <div class="save-path-container">
          <el-input v-model="savePath" placeholder="请选择报告保存位置" readonly class="path-input" />
          <el-button @click="handleSelectSavePath" class="path-btn">选择位置</el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="handleGenerate" :loading="generating" class="generate-btn">
          <span v-if="!generating">生成报告</span>
          <span v-else>生成中...</span>
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { ElMessage } from 'element-plus';

const visible = ref(false);
const generating = ref(false);
const projectId = ref('');
const projectName = ref('');
const savePath = ref('');

const config = reactive({
  format: 'docx' as 'pdf' | 'docx',
  template: 'standard' as 'standard' | 'detailed' | 'simple',
  includeSections: [
    'cover',
    'toc',
    'overview',
    'projectInfo',
    'methodology',
    'results',
    'analysis',
    'issues',
    'recommendations',
    'appendix',
  ],
});

function open(id: string, name: string) {
  projectId.value = id;
  projectName.value = name;
  savePath.value = '';
  visible.value = true;
}

async function handleSelectSavePath() {
  const defaultFileName = `测评报告_${projectName.value || '项目'}_${new Date().toISOString().slice(0, 10)}${config.format === 'docx' ? '.docx' : '.pdf'}`;

  const res = await window.api.dialog.showSaveDialog({
    defaultPath: defaultFileName,
    filters:
      config.format === 'docx'
        ? [{ name: 'Word 文档', extensions: ['docx'] }]
        : [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });

  if (res.success && res.data && res.data.filePath) {
    savePath.value = res.data.filePath;
  }
}

async function handleGenerate() {
  if (config.includeSections.length === 0) {
    ElMessage.warning('请至少选择一个章节');
    return;
  }

  if (!savePath.value) {
    ElMessage.warning('请选择报告保存位置');
    return;
  }

  generating.value = true;
  try {
    const res = await window.api.report.generate({
      format: config.format,
      template: config.template,
      includeSections: [...config.includeSections],
      projectId: projectId.value,
      savePath: savePath.value,
    });

    if (res.success && res.data) {
      ElMessage.success('报告生成成功');
      visible.value = false;
      window.api.shell.openPath(res.data.filePath);
    } else {
      ElMessage.error(res.error?.message || '报告生成失败');
    }
  } catch (err: any) {
    ElMessage.error(err.message || '报告生成失败');
  } finally {
    generating.value = false;
  }
}

defineExpose({ open });
</script>

<style scoped>
.report-config-dialog {
  :deep(.el-dialog__body) {
    padding: 0 20px 10px;
  }
}

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.section-icon {
  font-size: 16px;
}

.section-hint {
  margin-left: auto;
  font-size: 12px;
  font-weight: 400;
  color: #9ca3af;
}

.format-selector {
  display: flex;
  gap: 12px;
  width: 100%;
}

.format-option {
  flex: 1;
  margin-right: 0 !important;
  height: auto !important;
}

.format-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #fafbfc;
}

.format-card:hover {
  border-color: #1B5FD9;
  background: #f0f6ff;
}

.format-option :deep(.el-radio__input.is-checked) + .el-radio__label .format-card,
.format-option.is-checked .format-card {
  border-color: #1B5FD9;
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgba(27, 95, 217, 0.1);
}

.format-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.docx-icon {
  background: linear-gradient(135deg, #2b5797, #3a7bd5);
}

.pdf-icon {
  background: linear-gradient(135deg, #e74c3c, #c0392b);
}

.format-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.format-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.format-desc {
  font-size: 12px;
  color: #6b7280;
}

.template-selector {
  display: flex;
  gap: 10px;
  width: 100%;
}

.template-option {
  flex: 1;
  margin-right: 0 !important;
  height: auto !important;
}

.template-card {
  padding: 14px;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #fafbfc;
}

.template-card:hover {
  border-color: #1B5FD9;
  background: #f0f6ff;
}

.template-option :deep(.el-radio__input.is-checked) + .el-radio__label .template-card,
.template-option.is-checked .template-card {
  border-color: #1B5FD9;
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgba(27, 95, 217, 0.1);
}

.template-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.template-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
}

.template-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}

.tag-simple {
  background: #ecfdf5;
  color: #059669;
}

.tag-standard {
  background: #eff6ff;
  color: #2563eb;
}

.tag-detailed {
  background: #fef3c7;
  color: #d97706;
}

.template-desc {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
}

.section-selector {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.section-option {
  margin-right: 0 !important;
  height: auto !important;
}

.section-option :deep(.el-checkbox__input) {
  display: none;
}

.section-option :deep(.el-checkbox__label) {
  padding: 0;
}

.section-name {
  display: block;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  color: #4b5563;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
  background: #fff;
}

.section-name:hover {
  border-color: #1B5FD9;
  color: #1B5FD9;
}

.section-option.is-checked .section-name {
  border-color: #1B5FD9;
  background: #eff6ff;
  color: #1B5FD9;
  font-weight: 500;
}

.save-path-container {
  display: flex;
  gap: 8px;
  width: 100%;
}

.path-input {
  flex: 1;
}

.path-btn {
  flex-shrink: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.generate-btn {
  min-width: 120px;
}

.format-option :deep(.el-radio__input),
.template-option :deep(.el-radio__input) {
  display: none;
}

/* 深色主题覆盖 */
:root.dark {
  .section-title {
    color: var(--color-text-primary);
  }

  .section-hint {
    color: var(--color-text-tertiary);
  }

  .format-card {
    border-color: var(--color-border-base);
    background: var(--color-bg-card);

    &:hover {
      border-color: var(--color-primary);
      background: var(--color-primary-light);
    }
  }

  .format-option :deep(.el-radio__input.is-checked) + .el-radio__label .format-card,
  .format-option.is-checked .format-card {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .format-name {
    color: var(--color-text-primary);
  }

  .format-desc {
    color: var(--color-text-secondary);
  }

  .template-card {
    border-color: var(--color-border-base);
    background: var(--color-bg-card);

    &:hover {
      border-color: var(--color-primary);
      background: var(--color-primary-light);
    }
  }

  .template-option :deep(.el-radio__input.is-checked) + .el-radio__label .template-card,
  .template-option.is-checked .template-card {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .template-name {
    color: var(--color-text-primary);
  }

  .tag-simple {
    background: rgba(24, 169, 87, 0.15);
    color: #34D399;
  }

  .tag-standard {
    background: rgba(59, 130, 246, 0.15);
    color: #60A5FA;
  }

  .tag-detailed {
    background: rgba(212, 136, 6, 0.15);
    color: #FBBF24;
  }

  .template-desc {
    color: var(--color-text-secondary);
  }

  .section-name {
    border-color: var(--color-border-base);
    color: var(--color-text-secondary);
    background: var(--color-bg-card);

    &:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
  }

  .section-option.is-checked .section-name {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary);
  }
}
</style>
