<template>
  <div class="page-container">
    <!-- AI分析组件（包含所有AI相关弹窗） -->
    <AiAnalysis
      :table-rows="tableRows"
      :save-all-rows="autoSave.saveAllRows"
      :load-screenshot-data-url="loadScreenshotDataUrl"
      ref="aiAnalysisRef"
    />

    <!-- 项目上下文栏 -->
    <div class="project-context-bar">
      <div class="breadcrumb">
        <span class="customer-name">{{ project?.name || '山西长治王庄煤业有限责任公司' }}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span class="current-page">现场核查</span>
      </div>
    </div>

    <!-- 顶部工具栏 -->
    <div class="top-toolbar">
      <div class="toolbar-left">
        <!-- 3-Step Phase Indicator -->
        <div class="phase-steps">
          <div class="phase-step completed" @click="goToPhase('assets')">
            <span class="step-num">1</span>
            <span class="step-text">系统构成</span>
          </div>
          <div class="step-connector" />
          <div class="phase-step active">
            <span class="step-num">2</span>
            <span class="step-text">现场核查</span>
          </div>
          <div class="step-connector" />
          <div class="phase-step" @click="goToPhase('issues')">
            <span class="step-num">3</span>
            <span class="step-text">问题汇总</span>
          </div>
        </div>
      </div>
      <div class="toolbar-center">
        <div class="progress-stats">
          <span class="stat-item">
            <span class="stat-label">总项数</span>
            <span class="stat-value">{{ progress.total }}</span>
          </span>
          <span class="stat-divider" />
          <span class="stat-item">
            <span class="stat-label">已完成</span>
            <span class="stat-value completed">{{ progress.tested }}</span>
          </span>
          <span class="stat-divider" />
          <span class="stat-item">
            <span class="stat-label">符合</span>
            <span class="stat-value compliant">{{ progress.compliant }}</span>
          </span>
          <span class="stat-divider" />
          <span class="stat-item">
            <span class="stat-label">符合率</span>
            <span class="stat-value rate">{{ progress.complianceRate }}%</span>
          </span>
        </div>
      </div>
      <div class="toolbar-right">
        <!-- 保存状态指示器 -->
        <div class="save-status-indicator" :class="autoSave.saveStatus.value" v-if="autoSave.saveStatus.value !== 'idle'">
          <span class="save-status-icon">
            <svg v-if="autoSave.saveStatus.value === 'saving'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <svg v-else-if="autoSave.saveStatus.value === 'saved'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <svg v-else-if="autoSave.saveStatus.value === 'error'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <svg v-else-if="autoSave.saveStatus.value === 'unsaved'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/></svg>
          </span>
          <span class="save-status-text">
            {{ autoSave.saveStatus.value === 'saving' ? '保存中...' : autoSave.saveStatus.value === 'saved' ? '已自动保存' : autoSave.saveStatus.value === 'error' ? '保存失败' : '未保存' }}
          </span>
          <span class="save-status-time" v-if="autoSave.lastSavedTime.value && (autoSave.saveStatus.value === 'saved')">
            {{ autoSave.formatSaveTime(autoSave.lastSavedTime.value) }}
          </span>
        </div>

        <!-- 导入导出组件 -->
        <ImportExport
          :tree-data="treeData"
          :project-id="route.params.id as string"
          @refresh="handleImportRefresh"
        />

        <el-button class="toolbar-btn" @click="syncIssues">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>同步问题</span>
        </el-button>
        <el-button type="primary" class="toolbar-btn primary" @click="autoSave.triggerManualSave()" :loading="autoSave.saveStatus.value === 'saving'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
          <span>保存</span>
        </el-button>
      </div>
    </div>

    <!-- 三栏布局 -->
    <div class="three-columns">
      <!-- 左栏：测评项树 -->
      <div class="left-panel" :class="{ collapsed: leftCollapsed }">
        <div class="panel-search">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input v-model="treeSearch" type="text" placeholder="搜索..." class="search-input" />
        </div>
        <div class="tree-container">
          <div v-for="domain in filteredTreeData" :key="domain.id" class="tree-group">
            <!-- 全局层面（无子节点，直接点击选中） -->
            <div v-if="GLOBAL_DOMAINS.includes(domain.id)"
                 class="tree-parent global-domain"
                 :class="{ active: currentDomainId === domain.id }"
                 @click="selectGlobalDomain(domain.id)">
              <svg class="tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <template v-if="domain.icon === 'wifi'"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></template>
                <template v-else-if="domain.icon === 'settings'"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></template>
                <template v-else-if="domain.icon === 'file-text'"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></template>
                <template v-else-if="domain.icon === 'users'"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></template>
                <template v-else-if="domain.icon === 'user'"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></template>
                <template v-else-if="domain.icon === 'book'"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></template>
                <template v-else><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></template>
              </svg>
              <span class="tree-label">{{ domain.label }}</span>
            </div>
            <!-- 资产层面（有子节点，可展开收起） -->
            <div v-else>
              <div class="tree-parent" @click="toggleDomain(domain.id)">
                <svg class="tree-chevron" :class="{ expanded: expandedDomains.includes(domain.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                <svg class="tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <template v-if="domain.icon === 'building'"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/></template>
                  <template v-else-if="domain.icon === 'layers'"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></template>
                  <template v-else-if="domain.icon === 'server'"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></template>
                </svg>
                <span class="tree-label">{{ domain.label }}</span>
              </div>
              <div v-show="expandedDomains.includes(domain.id)" class="tree-children">
                <div v-for="item in domain.children" :key="item.id"
                     class="tree-item"
                     :class="{ active: currentAsset?.id === item.id }"
                     @click="selectAsset(item)">
                  <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/></svg>
                  <span class="tree-label">{{ item.label }}</span>
                  <span class="tree-count" :class="{ 'count-complete': item.testedCount && item.testedCount === item.totalCount }">{{ item.testedCount || 0 }}/{{ item.totalCount || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 左面板折叠按钮 -->
      <button class="toggle-btn-left" :style="leftToggleStyle" @click="leftCollapsed = !leftCollapsed">
        {{ leftCollapsed ? '›' : '‹' }}
      </button>

      <!-- 中栏：Excel风格表格 -->
      <div class="center-panel">
        <!-- 标题栏 -->
        <div class="section-title-bar">
          <span class="section-title">{{ sectionTitle }}</span>
          <div class="section-actions">
            <button class="section-btn" @click="aiAnalysisRef?.handleBatchUpload()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>上传文件</span>
            </button>
            <button class="section-btn primary" :disabled="!aiAnalysisRef?.batchFiles?.length || aiAnalysisRef?.batchAiLoading" @click="aiAnalysisRef?.batchAiAnalyze()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a6 6 0 0 0-6 6v1h20v-1a6 6 0 0 0-6-6z"/></svg>
              <span>{{ aiAnalysisRef?.batchAiLoading ? '分析中...' : `AI分析 (${aiAnalysisRef?.batchFiles?.length || 0}个)` }}</span>
            </button>
          </div>
        </div>

        <!-- 批量文件管理区域 -->
        <div v-if="aiAnalysisRef?.batchFiles?.length && aiAnalysisRef?.showBatchScreenshots" class="batch-screenshot-bar">
          <div class="batch-screenshot-header">
            <span class="batch-screenshot-title">待分析文件 ({{ aiAnalysisRef?.batchFiles?.length }}个)</span>
            <div class="batch-screenshot-actions">
              <button class="mini-btn" @click="aiAnalysisRef?.clearBatchFiles()" title="清空全部">清空</button>
              <button class="mini-btn" @click="aiAnalysisRef!.showBatchScreenshots = false" title="收起">收起</button>
            </div>
          </div>
          <div class="batch-screenshot-list">
            <div v-for="file in aiAnalysisRef?.batchFiles" :key="file.id" class="batch-screenshot-item" @click="openFilePreview(file)" style="cursor: pointer">
              <template v-if="file.fileType === 'image'">
                <img :src="file.dataUrl" :alt="file.name" class="batch-thumb" />
              </template>
              <template v-else>
                <div class="batch-file-icon">
                  <svg v-if="file.fileType === 'pdf'" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#E74C3C" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  <svg v-else-if="file.fileType === 'word'" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2B5797" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <svg v-else-if="file.fileType === 'text'" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#10B981" fill-opacity="0.1"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="12" y1="9" x2="8" y2="9"/></svg>
                  <svg v-else width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4B5563" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <div class="batch-file-ext">{{ file.fileType === 'pdf' ? 'PDF' : (file.fileType === 'word' ? 'DOCX' : (file.fileType === 'text' ? 'TXT' : 'FILE')) }}</div>
                </div>
              </template>
              <button class="batch-screenshot-del" @click.stop="aiAnalysisRef?.removeBatchFile(file.id)" title="删除">×</button>
              <span class="batch-screenshot-name">{{ file.name }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="aiAnalysisRef?.batchFiles?.length && !aiAnalysisRef?.showBatchScreenshots" class="batch-screenshot-bar collapsed" @click="aiAnalysisRef!.showBatchScreenshots = true">
          <span>展开文件 ({{ aiAnalysisRef?.batchFiles?.length }}个)</span>
        </div>

        <!-- Excel表格 -->
        <div class="table-container" @click="tableCellSelection.handleTableContainerClick($event)">
          <table class="excel-table">
            <colgroup>
              <col style="width: 130px">
              <col style="width: 320px">
              <col style="width: 400px">
              <col style="width: 110px">
              <col style="width: 280px">
              <col style="width: 50px">
            </colgroup>
            <thead>
              <tr>
                <th style="text-align: center;">安全控制点</th>
                <th style="text-align: center;">测评项（标准条款）</th>
                <th style="text-align: center;">测评结论</th>
                <th style="text-align: center;">符合性</th>
                <th style="text-align: center;">关键证据点</th>
                <th style="text-align: center;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.itemId || index" :class="{ active: currentRowIndex === index, 'extension-divider': isExtensionDivider(index) }" @click="currentRowIndex = index">
                <td v-if="!row.controlPointHidden" class="cell-control" :rowspan="row.controlPointRowSpan || 1">{{ row.controlPoint }}</td>
                <td class="cell-requirement">{{ row.requirement }}</td>
                <td class="cell-conclusion" :class="{ selected: tableCellSelection.isCellSelected(index, 'conclusion'), 'selection-anchor': tableCellSelection.isSelectionAnchor(index, 'conclusion') }" @click="tableCellSelection.handleCellClick($event, index, 'conclusion')" @mousedown="tableCellSelection.handleCellMouseDown($event)">
                  <textarea v-model="row.conclusion" class="cell-textarea conclusion-box" placeholder="填写测评结论..." @input="adjustConclusionHeight($event); autoSave.debounceAutoSave(row)" @paste="clipboardHandler.handleConclusionPaste($event, index)" @mousedown="tableCellSelection.handleCellMouseDown($event)" :class="{ 'cell-selected': tableCellSelection.isCellSelected(index, 'conclusion') }" />
                </td>
                <td class="cell-compliance" :class="{ selected: tableCellSelection.isCellSelected(index, 'compliance'), 'selection-anchor': tableCellSelection.isSelectionAnchor(index, 'compliance') }" @click="tableCellSelection.handleCellClick($event, index, 'compliance')" @mousedown="tableCellSelection.handleCellMouseDown($event)">
                  <select v-model="row.compliance" class="compliance-select" :class="row.compliance" @change="autoSave.debounceAutoSave(row)" @paste="clipboardHandler.handleCompliancePaste($event, index)" @mousedown="tableCellSelection.handleCellMouseDown($event)">
                    <option value="">待判定</option>
                    <option value="conform">符合</option>
                    <option value="partial">部分符合</option>
                    <option value="nonconform">不符合</option>
                    <option value="na">不适用</option>
                  </select>
                </td>
                <td class="cell-evidence" :class="{ selected: tableCellSelection.isCellSelected(index, 'evidence'), 'selection-anchor': tableCellSelection.isSelectionAnchor(index, 'evidence') }" @click="tableCellSelection.handleCellClick($event, index, 'evidence')" @mousedown="tableCellSelection.handleCellMouseDown($event)">
                  <textarea v-model="row.evidence" class="cell-textarea evidence-box mono" placeholder="粘贴执行结果、截图，或填写关键证据点..." @input="adjustEvidenceHeight($event); autoSave.debounceAutoSave(row)" @mousedown="tableCellSelection.handleCellMouseDown($event)" :class="{ 'cell-selected': tableCellSelection.isCellSelected(index, 'evidence') }" />
                  <!-- 截图管理组件 -->
                  <ScreenshotManager
                    :row="row"
                    :project-id="route.params.id as string"
                    @update:row="handleRowUpdate"
                    @auto-save="autoSave.debounceAutoSave(row)"
                  />
                </td>
                <td class="cell-actions">
                  <button class="action-btn ai" @click.stop="aiAnalysisRef?.aiAnalyze(row)" title="AI分析此行">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a6 6 0 0 0-6 6v1h20v-1a6 6 0 0 0-6-6z"/></svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 底部栏 -->
        <div class="table-footer">
          <span class="row-count">共 {{ tableRows.length }} 项</span>
        </div>
      </div>

      <!-- 右栏：知识库 -->
      <KnowledgePanel
        :current-asset="currentAsset"
        :current-domain-id="currentDomainId"
        :table-rows="tableRows"
        :current-row-index="currentRowIndex"
        :collapsed="rightCollapsed"
        @quote="handleQuoteCommand"
        @update:collapsed="rightCollapsed = $event"
      />

      <!-- 右面板折叠按钮 -->
      <button v-show="!rightCollapsed" class="toggle-btn-right" :style="rightToggleStyle" @click="rightCollapsed = !rightCollapsed">
        ›
      </button>
      <!-- 右面板浮动按钮 -->
      <button v-show="rightCollapsed" class="right-float-btn" @click="rightCollapsed = false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </button>
    </div>

    <!-- 文件预览弹窗 -->
    <FilePreview
      :visible="previewDialogVisible"
      :file="previewFile"
      @update:visible="previewDialogVisible = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUpdated, onBeforeUnmount, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

// 导入 composables
import { useAutoSave } from './composables/useAutoSave';
import { createTableCellSelection } from './utils/table-cell-selection';
import { createClipboardHandler } from './utils/clipboard-handler';

// 导入子组件
import FilePreview from './components/file-preview.vue';
import ScreenshotManager from './components/screenshot-manager.vue';
import KnowledgePanel from './components/knowledge-panel.vue';
import ImportExport from './components/import-export.vue';
import AiAnalysis from './components/ai-analysis.vue';

// ==================== 路由和基础状态 ====================
const route = useRoute();
const router = useRouter();

// ==================== 核心状态 ====================
const project = ref<any>(null);
const treeSearch = ref('');
const expandedDomains = ref<string[]>([]);

const progress = ref({
  total: 0,
  tested: 0,
  compliant: 0,
  na: 0,
  complianceRate: 0,
  untested: 0,
});

// 面板折叠状态
const leftCollapsed = ref(false);
const rightCollapsed = ref(false);

// 测评项树
const treeData = ref<any[]>([]);

const filteredTreeData = computed(() => {
  if (!treeSearch.value) return treeData.value;
  const keyword = treeSearch.value.toLowerCase();
  return treeData.value.filter(domain => {
    if (GLOBAL_DOMAINS.includes(domain.id)) {
      return domain.label.toLowerCase().includes(keyword);
    }
    return domain.children?.some((item: any) => item.label.toLowerCase().includes(keyword));
  }).map(domain => {
    if (GLOBAL_DOMAINS.includes(domain.id)) {
      return domain;
    }
    return {
      ...domain,
      children: domain.children?.filter((item: any) =>
        item.label.toLowerCase().includes(keyword)
      )
    };
  });
});

// 十大安全层面定义（ID与数据库一致）
const TEN_DOMAINS = [
  { id: 'secure_physical', name: '安全物理环境', icon: 'building' },
  { id: 'secure_communication', name: '安全通信网络', icon: 'wifi' },
  { id: 'secure_boundary', name: '安全区域边界', icon: 'layers' },
  { id: 'secure_computing', name: '安全计算环境', icon: 'server' },
  { id: 'secure_management', name: '安全管理中心', icon: 'settings' },
  { id: 'security_management', name: '安全管理制度', icon: 'file-text' },
  { id: 'security_organization', name: '安全管理机构', icon: 'users' },
  { id: 'security_personnel', name: '安全管理人员', icon: 'user' },
  { id: 'security_construction', name: '安全建设管理', icon: 'book' },
  { id: 'security_maintenance', name: '安全运维管理', icon: 'shield' },
];

// 资产类别到安全层面的映射
const CATEGORY_TO_DOMAIN: Record<string, string> = {
  machine_room: 'secure_physical',
  network_boundary: 'secure_boundary',
  network_device: 'secure_computing',
  security_device: 'secure_computing',
  server_storage: 'secure_computing',
  dbms: 'secure_computing',
  business_app: 'secure_computing',
  terminal: 'secure_computing',
  data_resource: 'secure_computing',
  management_platform: 'secure_computing',
};

// 全局层面（不需要对应资产，直接显示该层面所有测评项）
const GLOBAL_DOMAINS = [
  'secure_communication',
  'secure_management',
  'security_management',
  'security_organization',
  'security_personnel',
  'security_construction',
  'security_maintenance',
];

// 当前选中
const currentAsset = ref<any>(null);
const currentDomainId = ref('');
const currentRowIndex = ref(0);
const sectionTitle = computed(() => {
  if (currentAsset.value) {
    const domain = TEN_DOMAINS.find(d => d.id === currentAsset.value.domainId);
    return `${domain?.name || ''} — ${currentAsset.value.label}`;
  }
  if (currentDomainId.value) {
    const domain = TEN_DOMAINS.find(d => d.id === currentDomainId.value);
    return domain?.name || '';
  }
  return '请选择测评对象';
});

// 表格数据
const tableRows = ref<any[]>([]);

// 折叠按钮动态定位样式
const leftToggleStyle = computed(() => ({
  left: leftCollapsed.value ? '0' : '180px',
}));
const rightToggleStyle = computed(() => ({
  right: rightCollapsed.value ? '0' : '240px',
}));

// 文件预览状态
const previewDialogVisible = ref(false);
const previewFile = ref<{ name: string; path: string; fileType: string } | null>(null);

// ==================== 资产类型与不适用测评项映射表 ====================
const ASSET_NA_MAPPING: Record<string, { controlPoint: string; requirement: string }[]> = {
  network_device: [
    { controlPoint: '入侵防范', requirement: 'd）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；' },
    { controlPoint: '恶意代码防范', requirement: 'a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。' },
    { controlPoint: '剩余信息保护', requirement: 'a）应保证鉴别信息所在的存储空间被释放或重新分配前得到完全清除。' },
    { controlPoint: '个人信息保护', requirement: 'a）应仅采集和保存业务必需的用户个人信息；' },
    { controlPoint: '个人信息保护', requirement: 'b）应禁止未授权访问和非法使用用户个人信息。' },
  ],
  security_device: [
    { controlPoint: '入侵防范', requirement: 'd）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；' },
    { controlPoint: '恶意代码防范', requirement: 'a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。' },
    { controlPoint: '剩余信息保护', requirement: 'a）应保证鉴别信息所在的存储空间被释放或重新分配前得到完全清除。' },
    { controlPoint: '个人信息保护', requirement: 'a）应仅采集和保存业务必需的用户个人信息；' },
    { controlPoint: '个人信息保护', requirement: 'b）应禁止未授权访问和非法使用用户个人信息。' },
  ],
  server_storage: [
    { controlPoint: '入侵防范', requirement: 'd）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；' },
    { controlPoint: '个人信息保护', requirement: 'a）应仅采集和保存业务必需的用户个人信息；' },
    { controlPoint: '个人信息保护', requirement: 'b）应禁止未授权访问和非法使用用户个人信息。' },
  ],
  dbms: [
    { controlPoint: '入侵防范', requirement: 'a）应遵循最小安装的原则，仅安装需要的组件和应用程序；' },
    { controlPoint: '入侵防范', requirement: 'b）应关闭不需要的系统服务、默认共享和高危端口；' },
    { controlPoint: '入侵防范', requirement: 'c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；' },
    { controlPoint: '入侵防范', requirement: 'd）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；' },
    { controlPoint: '恶意代码防范', requirement: 'a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。' },
  ],
  management_platform: [
    { controlPoint: '入侵防范', requirement: 'a）应遵循最小安装的原则，仅安装需要的组件和应用程序；' },
    { controlPoint: '入侵防范', requirement: 'b）应关闭不需要的系统服务、默认共享和高危端口；' },
    { controlPoint: '入侵防范', requirement: 'c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；' },
    { controlPoint: '恶意代码防范', requirement: 'a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。' },
    { controlPoint: '个人信息保护', requirement: 'a）应仅采集和保存业务必需的用户个人信息；' },
    { controlPoint: '个人信息保护', requirement: 'b）应禁止未授权访问和非法使用用户个人信息。' },
  ],
  business_app: [
    { controlPoint: '入侵防范', requirement: 'a）应遵循最小安装的原则，仅安装需要的组件和应用程序；' },
    { controlPoint: '入侵防范', requirement: 'b）应关闭不需要的系统服务、默认共享和高危端口；' },
    { controlPoint: '入侵防范', requirement: 'c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；' },
    { controlPoint: '恶意代码防范', requirement: 'a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。' },
  ],
  terminal: [
    { controlPoint: '入侵防范', requirement: 'd）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；' },
    { controlPoint: '个人信息保护', requirement: 'a）应仅采集和保存业务必需的用户个人信息；' },
    { controlPoint: '个人信息保护', requirement: 'b）应禁止未授权访问和非法使用用户个人信息。' },
  ],
};

// ==================== 扩展类型映射 ====================
const EXTENSION_TYPE_MAP: Record<string, string> = {
  '安全通用要求': 'general',
  '云计算安全扩展要求': 'cloud',
  '移动互联安全扩展要求': 'mobile',
  '物联网安全扩展要求': 'iot',
  '工业控制系统安全扩展要求': 'industrial',
  '大数据安全扩展要求（国标附录）': 'bigdata',
  '大数据安全扩展要求': 'bigdata',
  '关键信息基础设施安全扩展要求': 'cii',
};

function getExtensionTypeCodes(extType: string | string[] | undefined): string[] {
  if (!extType) return [];
  let types: string[];
  if (Array.isArray(extType)) {
    types = extType;
  } else if (typeof extType === 'string') {
    types = extType.split(',').filter(Boolean);
  } else {
    return [];
  }
  const result: string[] = [];
  for (const t of types) {
    if (EXTENSION_TYPE_MAP[t]) {
      result.push(EXTENSION_TYPE_MAP[t]);
    } else if (['general', 'cloud', 'mobile', 'iot', 'industrial', 'bigdata', 'cii'].includes(t)) {
      result.push(t);
    }
  }
  return result;
}

// ==================== Composables 初始化 ====================

// 自动保存 composable
const autoSave = useAutoSave({
  currentAsset,
  currentDomainId,
  tableRows,
  route,
  updateAssetProgress,
  loadProgress,
});

// AI 分析 composable
const aiAnalysisRef = ref<InstanceType<typeof AiAnalysis> | null>(null);

// 表格单元格选区
const tableCellSelection = createTableCellSelection({
  tableRows,
  hasUnsavedChanges: autoSave.hasUnsavedChanges,
  saveStatus: autoSave.saveStatus,
  triggerSave: () => autoSave.saveAllRows(),
  onClearSuccess: (count: number) => {
    ElMessage.success(`已清空 ${count} 个单元格`);
  },
  onCopySuccess: (count: number) => {
    ElMessage.success(`已复制 ${count} 个单元格`);
  },
  onBatchComplianceSuccess: (count: number) => {
    ElMessage.success(`已批量设置 ${count} 个符合性`);
  },
});

// 剪贴板处理
const clipboardHandler = createClipboardHandler({
  tableRows,
  currentRowIndex,
  hasUnsavedChanges: autoSave.hasUnsavedChanges,
  saveStatus: autoSave.saveStatus,
  loadScreenshotDataUrl,
  debounceAutoSave: (row: any) => autoSave.debounceAutoSave(row),
  route,
  api: window.api as any,
});

// ==================== Provide/Inject ====================
provide('tableRows', tableRows);
provide('currentRowIndex', currentRowIndex);
provide('currentAsset', currentAsset);
provide('currentDomainId', currentDomainId);
provide('route', route);

// ==================== 核心函数 ====================

// 判断当前行是否是扩展要求部分的第一行
function isExtensionDivider(index: number): boolean {
  if (index <= 0 || index >= tableRows.value.length) return false;
  const prevRow = tableRows.value[index - 1];
  const currRow = tableRows.value[index];
  return prevRow?.extensionType !== currRow?.extensionType;
}

// 自动调整textarea高度
function adjustHeight(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 2 + 'px';
}

function adjustConclusionHeight(event: Event) {
  const el = event.target as HTMLTextAreaElement;
  el.style.overflowY = 'hidden';
  adjustHeight(el);
}

function adjustEvidenceHeight(event: Event) {
  const el = event.target as HTMLTextAreaElement;
  el.style.overflowY = 'hidden';
  adjustHeight(el);
}

// 根据 controlPoint 合并单元格（仅在同一扩展类型内合并）
function calculateControlPointRowSpans() {
  const rows = tableRows.value;
  if (!rows || rows.length === 0) return;

  let i = 0;
  while (i < rows.length) {
    const cp = rows[i].controlPoint;
    const extType = rows[i].extensionType;
    let j = i + 1;
    while (j < rows.length && rows[j].controlPoint === cp && rows[j].extensionType === extType) {
      j++;
    }
    const span = j - i;
    if (span > 1) {
      rows[i].controlPointRowSpan = span;
      rows[i].controlPointHidden = false;
      for (let k = i + 1; k < j; k++) {
        rows[k].controlPointRowSpan = 1;
        rows[k].controlPointHidden = true;
      }
    } else {
      rows[i].controlPointRowSpan = 1;
      rows[i].controlPointHidden = false;
    }
    i = j;
  }
}

// 选择全局层面
async function selectGlobalDomain(domainId: string) {
  currentAsset.value = null;
  currentDomainId.value = domainId;

  if (!window.api) return;

  try {
    const projectId = route.params.id as string;
    const projectLevel = project.value?.level || 3;
    const projectStandardId = project.value?.standardId || 'gb-t-22239-2019-l3';
    const extensionTypes = getExtensionTypeCodes(project.value?.extensionType);

    const itemsRes = await window.api.assessment.getItems(projectStandardId, domainId, projectLevel, extensionTypes);
    if (!itemsRes.success || !itemsRes.data) {
      tableRows.value = [];
      return;
    }

    const items = itemsRes.data;

    const recordsRes = await window.api.assessment.getRecordsByDomain(projectId, domainId, projectLevel, extensionTypes);
    const existingRecords: any[] = recordsRes.success && recordsRes.data ? recordsRes.data : [];

    const recordMap = new Map<string, any>();
    for (const record of existingRecords) {
      recordMap.set(record.itemId, record);
    }

    const complianceMap: Record<string, string> = {
      'compliant': 'conform',
      'conform': 'conform',
      'partial': 'partial',
      'non_compliant': 'nonconform',
      'nonconform': 'nonconform',
      'not_applicable': 'na',
      'notapplicable': 'na',
      'na': 'na',
      'untested': '',
    };

    const methodMap: Record<string, string> = {
      'check': '核查',
      'interview': '访谈',
      'test': '测试',
    };

    tableRows.value = items.map((item: any, index: number) => {
      const record = recordMap.get(item.id);
      const itemLabel = String.fromCharCode(97 + index) + ')';

      let evidenceText = record?.evidence || '';
      if (!evidenceText && record?.commandOutput) {
        evidenceText = record.commandOutput;
      }
      if (!evidenceText && record?.command) {
        evidenceText = `命令: ${record.command}`;
      }

      const complianceValue = record ? (complianceMap[record.result] || '') : '';
      let conclusionText = record?.findings || '';

      if (complianceValue === 'na' && !conclusionText) {
        conclusionText = '根据《测评要求》测评单元中测评对象适用性描述，此类对象针对此控制项不适用。';
      }

      return {
        id: record?.id || '',
        itemLabel,
        itemId: item.id,
        assetId: '',
        isGlobal: true,
        extensionType: item.extensionType || 'general',
        controlPoint: item.controlPoint || item.requirement,
        requirement: item.requirement,
        method: record ? (methodMap[record.method] || '核查') : '核查',
        compliance: complianceValue,
        conclusion: conclusionText,
        evidence: evidenceText,
        screenshots: record?.screenshotPaths ? JSON.parse(record.screenshotPaths) : [],
      };
    });

    for (const row of tableRows.value) {
      if (row.screenshots) {
        for (const shot of row.screenshots) {
          loadScreenshotDataUrl(row, shot);
        }
      }
    }

    calculateControlPointRowSpans();
    loadProgress();
  } catch (error) {
    console.error('加载全局测评项失败:', error);
  }
}

// 选择资产
async function selectAsset(asset: any) {
  currentAsset.value = asset;

  if (!window.api) return;

  try {
    const projectId = route.params.id as string;
    const domainId = asset.domainId;
    const projectLevel = project.value?.level || 3;
    const projectStandardId = project.value?.standardId || 'gb-t-22239-2019-l3';
    const extensionTypes = getExtensionTypeCodes(project.value?.extensionType);

    const itemsRes = await window.api.assessment.getItems(projectStandardId, domainId, projectLevel, extensionTypes);
    if (!itemsRes.success || !itemsRes.data) {
      tableRows.value = [];
      return;
    }

    const items = itemsRes.data;

    const recordsRes = await window.api.assessment.getRecordsByAsset(projectId, asset.id);
    const existingRecords: any[] = recordsRes.success && recordsRes.data ? recordsRes.data : [];

    const recordMap = new Map<string, any>();
    for (const record of existingRecords) {
      recordMap.set(record.itemId, record);
    }

    const complianceMap: Record<string, string> = {
      'compliant': 'conform',
      'conform': 'conform',
      'partial': 'partial',
      'non_compliant': 'nonconform',
      'nonconform': 'nonconform',
      'not_applicable': 'na',
      'notapplicable': 'na',
      'na': 'na',
      'untested': '',
    };

    const methodMap: Record<string, string> = {
      'check': '核查',
      'interview': '访谈',
      'test': '测试',
    };

    tableRows.value = items.map((item: any, index: number) => {
      const record = recordMap.get(item.id);
      const itemLabel = String.fromCharCode(97 + index) + ')';

      let evidenceText = record?.evidence || '';
      if (!evidenceText && record?.commandOutput) {
        evidenceText = record.commandOutput;
      }
      if (!evidenceText && record?.command) {
        evidenceText = `命令: ${record.command}`;
      }

      const assetCategory = asset.category;
      let initialCompliance = record ? (complianceMap[record.result] || '') : '';
      let initialConclusion = record?.findings || '';

      if (!record && assetCategory && ASSET_NA_MAPPING[assetCategory]) {
        const naItems = ASSET_NA_MAPPING[assetCategory];
        const naItem = naItems.find(na =>
          na.controlPoint === item.controlPoint &&
          na.requirement === item.requirement
        );
        if (naItem) {
          initialCompliance = 'na';
          initialConclusion = (naItem as any).conclusion || '根据《测评要求》测评单元中测评对象适用性描述，此类对象针对此控制项不适用。';
        }
      }

      return {
        id: record?.id || '',
        itemLabel,
        itemId: item.id,
        assetId: asset.id,
        extensionType: item.extensionType || 'general',
        controlPoint: item.controlPoint || item.requirement,
        requirement: item.requirement,
        method: record ? (methodMap[record.method] || '核查') : '核查',
        compliance: initialCompliance,
        conclusion: initialConclusion,
        evidence: evidenceText,
        screenshots: record?.screenshotPaths ? JSON.parse(record.screenshotPaths) : [],
      };
    });

    for (const row of tableRows.value) {
      if (row.screenshots) {
        for (const shot of row.screenshots) {
          loadScreenshotDataUrl(row, shot);
        }
      }
    }

    calculateControlPointRowSpans();
    updateAssetProgress(asset.id, tableRows.value);
    loadProgress();
  } catch (error) {
    console.error('加载测评项失败:', error);
  }
}

// 更新资产的进度计数
function updateAssetProgress(assetId: string, rows: any[]) {
  const tested = rows.filter(r => r.compliance !== '').length;
  const total = rows.length;

  for (const domainNode of treeData.value) {
    const assetNode = domainNode.children?.find((c: any) => c.id === assetId);
    if (assetNode) {
      assetNode.testedCount = tested;
      assetNode.totalCount = total;
      break;
    }
  }
}

// 切换域展开/收起
function toggleDomain(id: string) {
  if (GLOBAL_DOMAINS.includes(id)) {
    selectGlobalDomain(id);
    return;
  }
  const index = expandedDomains.value.indexOf(id);
  if (index >= 0) {
    expandedDomains.value.splice(index, 1);
  } else {
    expandedDomains.value.push(id);
  }
}

// 加载截图 DataURL
async function loadScreenshotDataUrl(row: any, filePath: string): Promise<string | null> {
  if (!filePath) return null;
  if (row.screenshotUrls?.[filePath] && row.screenshotUrls[filePath].startsWith('data:image/')) return row.screenshotUrls[filePath];

  if (!window.api) {
    console.warn('[loadScreenshotDataUrl] window.api 不可用');
    return null;
  }

  try {
    const res = await window.api.screenshot.getBase64({ filePath });
    if (res.success && res.data && res.data.base64) {
      const dataUrl = `data:${res.data.mimeType || 'image/png'};base64,${res.data.base64}`;
      row.screenshotUrls = Object.assign({}, row.screenshotUrls, { [filePath]: dataUrl });
      tableRows.value = [...tableRows.value];
      return dataUrl;
    } else {
      row.screenshotUrls = Object.assign({}, row.screenshotUrls, { [filePath]: 'error' });
      return 'error';
    }
  } catch (error) {
    console.error('[loadScreenshotDataUrl] 读取截图失败:', filePath, error);
    row.screenshotUrls = Object.assign({}, row.screenshotUrls, { [filePath]: 'error' });
    return null;
  }
}

// 打开文件预览
function openFilePreview(fileInfo: { name: string; path: string; fileType: string }) {
  previewFile.value = fileInfo;
  previewDialogVisible.value = true;
}

// 处理行更新（来自 ScreenshotManager）
function handleRowUpdate(updatedRow: any) {
  const index = tableRows.value.findIndex(r => r.itemId === updatedRow.itemId);
  if (index >= 0) {
    tableRows.value[index] = updatedRow;
    tableRows.value = [...tableRows.value];
  }
}

// 处理引用命令（来自 KnowledgePanel）
function handleQuoteCommand(cmd: any) {
  if (tableRows.value.length === 0) {
    ElMessage.warning('无可用行');
    return;
  }
  const currentRow = tableRows.value[currentRowIndex.value];
  const cmdText = `命令: ${cmd.command}`;
  if (currentRow.evidence) {
    currentRow.evidence += '\n' + cmdText;
  } else {
    currentRow.evidence = cmdText;
  }
  ElMessage.success('已引用命令到关键证据点');
}

// 处理导入刷新
async function handleImportRefresh() {
  await loadProject();
  await loadAssetTree();
  await loadProgress();
}

// 同步问题
async function syncIssues() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;

  try {
    const res = await window.api.issue.generateFromRecords(projectId);
    if (res.success) {
      const count = res.data?.count || 0;
      if (count > 0) {
        ElMessage.success(`已同步 ${count} 个问题到问题清单（含不符合项和部分符合项）`);
      } else {
        ElMessage.info('没有新的问题需要同步');
      }
    } else {
      ElMessage.error(res.error?.message || '同步失败');
    }
  } catch (error) {
    ElMessage.error('同步失败');
  }
}

// 加载进度
async function loadProgress() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  const res = await window.api.assessment.getProgress(projectId, project.value?.standardId || 'gb-t-22239-2019-l3');
  if (res.success && res.data) {
    progress.value = res.data;
  }
}

// 加载项目
async function loadProject() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  const res = await window.api.project.get(projectId);
  if (res.success) {
    project.value = res.data;
  }
}

// 加载测评对象树
async function loadAssetTree() {
  if (!window.api) return;
  const projectId = route.params.id as string;
  if (!projectId) return;

  try {
    const res = await window.api.asset.list({
      projectId,
      page: 1,
      pageSize: 500,
    });

    if (res.success && res.data) {
      const assets = res.data.list.filter((a: any) => a.isAssessmentTarget);

      const domainMap = new Map<string, any[]>();
      for (const asset of assets) {
        const domainId = CATEGORY_TO_DOMAIN[asset.category] || 'secure_computing';
        if (!domainMap.has(domainId)) {
          domainMap.set(domainId, []);
        }
        domainMap.get(domainId)!.push({
          id: asset.id,
          label: asset.name,
          category: asset.category,
          os: asset.os,
          domainId,
          assetData: asset,
          testedCount: 0,
          totalCount: 0,
        });
      }

      treeData.value = TEN_DOMAINS.map(domain => {
        const children = domainMap.get(domain.id) || [];
        return {
          id: domain.id,
          label: domain.name,
          icon: domain.icon,
          children,
          totalAssets: children.length,
        };
      });

      const firstDomainWithAssets = treeData.value.find(d => d.children && d.children.length > 0);
      if (firstDomainWithAssets) {
        expandedDomains.value = [firstDomainWithAssets.id];
      }

      if (assets.length > 0 && !currentAsset.value) {
        const firstAsset = (firstDomainWithAssets?.children?.[0]) || assets[0];
        selectAsset(firstAsset);
      }
    }
  } catch (error) {
    console.error('加载测评对象失败:', error);
  }
}

// 跳转到其他阶段
function goToPhase(phase: string) {
  const projectId = route.params.id as string;
  if (projectId) {
    router.push(`/projects/${projectId}/${phase}`);
  }
}

// ==================== 生命周期钩子 ====================
const handleKeyDown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    autoSave.triggerManualSave();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && tableCellSelection.selectedCells.value.size > 0) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
      return;
    }
    e.preventDefault();
    tableCellSelection.copySelectedCells();
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && tableCellSelection.selectedCells.value.size > 0) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
      const inputEl = activeEl as HTMLInputElement | HTMLTextAreaElement;
      if (inputEl.value && inputEl.value.length > 0) return;
    }
    e.preventDefault();
    tableCellSelection.clearSelectedCells();
  }
  if (e.key === 'Escape' && tableCellSelection.selectedCells.value.size > 0) {
    tableCellSelection.selectedCells.value.clear();
    tableCellSelection.selectionAnchor.value = null;
  }
};

const handleBeforeUnload = (e: BeforeUnloadEvent) => {
  if (autoSave.hasUnsavedChanges.value) {
    e.preventDefault();
    e.returnValue = '';
  }
};

onMounted(async () => {
  await loadProject();
  await loadAssetTree();
  await loadProgress();
  clipboardHandler.setupGlobalPasteHandler();

  window.api?.ai.onAnalysisProgress((data: any) => {
    if (aiAnalysisRef.value) {
      aiAnalysisRef.value.batchAiProgress.percent = data.percent || 0;
      aiAnalysisRef.value.batchAiProgress.message = data.message || '';
      aiAnalysisRef.value.batchAiProgress.stage = data.stage || '';
      if (data.stage === 'done') {
        if (aiAnalysisRef.value.batchAiMinimized) {
          aiAnalysisRef.value.batchAiMinimized = false;
          ElMessage.success('AI批量分析已完成！');
        }
        setTimeout(() => { aiAnalysisRef.value!.batchAiProgress.visible = false; }, 800);
      }
    }
  });

  const pollProgress = async () => {
    if (!aiAnalysisRef.value?.batchAiProgress?.visible) return;
    try {
      const res = await window.api.ai.getProgress();
      if (res.success && res.data && aiAnalysisRef.value) {
        const current = aiAnalysisRef.value.batchAiProgress;
        if (res.data.percent > current.percent || res.data.stage !== current.stage) {
          current.percent = res.data.percent || 0;
          current.message = res.data.message || '';
          current.stage = res.data.stage || '';
        }
      }
    } catch {}
  };
  const pollTimer = window.setInterval(pollProgress, 2000);
  (window as any).__aiBatchPollTimer = pollTimer;

  autoSave.startPeriodicSave();

  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('beforeunload', handleBeforeUnload);
});

onBeforeUnmount(() => {
  autoSave.stopPeriodicSave();
  document.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  if ((window as any).__aiBatchPollTimer) {
    clearInterval((window as any).__aiBatchPollTimer);
    (window as any).__aiBatchPollTimer = null;
  }
});

onUpdated(() => {
  const textareas = document.querySelectorAll('.cell-textarea');
  textareas.forEach((ta: any) => {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  });
});
</script>

<style lang="scss" scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--header-height, 52px));
  background: var(--color-bg-page, #F5F6FA);
}

// 项目上下文栏
.project-context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 24px;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default, #E5E7EB);

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;

    .customer-name {
      color: var(--color-text-tertiary, #9CA3AF);
    }

    .current-page {
      color: var(--color-text-primary, #111827);
      font-weight: 500;
    }
  }
}

// 阶段指示器
.phase-steps {
  display: flex;
  align-items: center;

  .phase-step {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px;
    background: var(--color-border-light, #F0F0F3);
    color: var(--color-text-secondary, #4B5563);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;

    &:first-child {
      border-radius: 6px 0 0 6px;
    }

    &:last-child {
      border-radius: 0 6px 6px 0;
    }

    &.active {
      background: var(--color-primary, #1B5FD9);
      color: #fff;
      font-weight: 500;

      .step-num {
        background: rgba(255, 255, 255, 0.25);
        color: #fff;
      }
    }

    &.completed {
      background: var(--color-border-light, #F0F0F3);

      &:hover {
        background: var(--color-bg-hover);
      }
    }

    &:hover:not(.active) {
      background: var(--color-bg-hover);
    }

    .step-num {
      width: 20px;
      height: 20px;
      border-radius: 999px;
      background: var(--color-border-default, #D1D5DB);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: var(--color-text-secondary, #4B5563);
    }

    .step-text {
      white-space: nowrap;
    }
  }

  .step-connector {
    width: 1px;
    height: 28px;
    background: var(--color-border-light, #F0F0F3);
  }
}

// 顶部工具栏
.top-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 24px;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default, #E5E7EB);

  .toolbar-left, .toolbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .save-status-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    transition: all 0.3s ease;
    background: var(--color-bg-base, #F9FAFB);
    border: 1px solid transparent;

    &.saving {
      color: #2563EB;
      background: #EFF6FF;
      border-color: #BFDBFE;
    }
    &.saved {
      color: #059669;
      background: #ECFDF5;
      border-color: #A7F3D0;
    }
    &.error {
      color: #DC2626;
      background: #FEF2F2;
      border-color: #FECACA;
    }
    &.unsaved {
      color: #D97706;
      background: #FFFBEB;
      border-color: #FDE68A;
    }

    .save-status-icon svg.spin {
      animation: spin 1s linear infinite;
    }
    .save-status-text {
      font-weight: 500;
    }
    .save-status-time {
      font-size: 11px;
      opacity: 0.7;
      margin-left: 2px;
    }
  }

  .toolbar-center {
    flex: 1;
    display: flex;
    justify-content: center;
  }

  .progress-stats {
    display: flex;
    align-items: center;
    gap: 16px;

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;

      .stat-label {
        font-size: 11px;
        color: var(--color-text-tertiary, #9CA3AF);
      }

      .stat-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);

        &.completed {
          color: #6B7280;
        }

        &.compliant {
          color: #10B981;
        }

        &.rate {
          color: var(--color-primary, #1B5FD9);
        }
      }
    }

    .stat-divider {
      width: 1px;
      height: 24px;
      background: var(--color-border-default, #E5E7EB);
    }
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: 6px;
    background: var(--color-bg-card);
    color: var(--color-text-secondary, #4B5563);
    font-size: 13px;
    cursor: pointer;
    font-family: var(--font-family);

    &.primary {
      border: none;
      background: var(--color-primary, #1B5FD9);
      color: #fff;
      font-weight: 500;

      &:hover {
        background: #1550B8;
      }
    }

    &.danger {
      border: none;
      background: #DC2626;
      color: #fff;
    }
  }
}

// 三栏布局
.three-columns {
  display: flex;
  flex: 1;
  position: relative;
  overflow: hidden;
}

// 左栏
.left-panel {
  width: 180px;
  flex-shrink: 0;
  background: var(--color-bg-card);
  border-right: 1px solid var(--color-border-default, #E5E7EB);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;

  &.collapsed {
    width: 0;
    border-right: none;

    .panel-search,
    .tree-container {
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.1s ease, visibility 0.1s ease;
    }
  }

  .panel-search {
    padding: 12px 12px 8px;
    position: relative;
    flex-shrink: 0;
    transition: opacity 0.1s ease, visibility 0.1s ease;
    min-width: 156px;

    .search-icon {
      position: absolute;
      left: 22px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-text-tertiary, #9CA3AF);
    }

    .search-input {
      width: 100%;
      height: 32px;
      padding: 0 10px 0 32px;
      border: 1px solid var(--color-border-default, #E5E7EB);
      border-radius: 6px;
      font-size: 12px;
      background: var(--color-bg-page, #F5F6FA);
      outline: none;
      box-sizing: border-box;
    }
  }

  .tree-container {
    flex: 1;
    overflow-y: auto;
    padding: 0 6px 12px;
  }

  .tree-group {
    margin-bottom: 2px;
  }

  .tree-parent {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--color-text-primary, #111827);

    &:hover {
      background: var(--color-bg-page, #F5F6FA);
    }

    &.global-domain {
      padding-left: 22px;

      &.active {
        background: var(--color-primary-light, #EFF6FF);
        color: var(--color-primary, #1B5FD9);
        font-weight: 500;
      }
    }

    .tree-chevron {
      transition: transform 0.15s;
      flex-shrink: 0;

      &.expanded {
        transform: rotate(180deg);
      }
    }

    .tree-icon {
      flex-shrink: 0;
      color: var(--color-text-tertiary, #9CA3AF);
    }

    .tree-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .tree-children {
    padding-left: 12px;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-text-secondary, #4B5563);

    &:hover {
      background: var(--color-bg-page, #F5F6FA);
    }

    &.active {
      background: var(--color-primary-light, #EFF6FF);
      color: var(--color-primary, #1B5FD9);
      font-weight: 500;
    }

    .item-icon {
      flex-shrink: 0;
      color: var(--color-text-tertiary, #9CA3AF);
    }

    .tree-count {
      font-size: 10px;
      color: var(--color-text-tertiary, #9CA3AF);
      margin-left: auto;

      &.count-complete {
        color: #10B981;
      }
    }
  }
}

// 左面板折叠按钮
.toggle-btn-left {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default, #E5E7EB);
  border-left: none;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-text-tertiary, #9CA3AF);
  transition: left 0.2s ease, background 0.15s, color 0.15s;

  &:hover {
    background: var(--color-primary-light, #EFF6FF);
    color: var(--color-primary, #1B5FD9);
  }
}

// 中栏
.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg-card);
  padding: 12px 20px 0;
}

// 标题栏
.section-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  border-bottom: none;
  flex-shrink: 0;
  margin-bottom: 8px;

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
    white-space: nowrap;
  }

  .section-actions {
    display: flex;
    gap: 6px;
  }

  .section-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: 2px;
    background: var(--color-bg-card);
    color: var(--color-text-secondary, #4B5563);
    font-size: 12px;
    cursor: pointer;
    height: 30px;

    &:hover {
      background: var(--color-bg-page, #F5F6FA);
    }

    &.primary {
      background: var(--color-primary, #1B5FD9);
      color: #fff;
      border-color: var(--color-primary, #1B5FD9);

      &:hover {
        background: #1550B8;
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

// 批量文件栏
.batch-screenshot-bar {
  padding: 8px 16px;
  background: var(--color-bg-page, #F5F6FA);
  border-bottom: 1px solid var(--color-border-default, #E5E7EB);
  flex-shrink: 0;

  &.collapsed {
    cursor: pointer;
    text-align: center;
    font-size: 12px;
    color: var(--color-text-tertiary, #9CA3AF);

    &:hover {
      background: var(--color-bg-hover);
    }
  }

  .batch-screenshot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .batch-screenshot-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-secondary, #4B5563);
  }

  .batch-screenshot-actions {
    display: flex;
    gap: 4px;
  }

  .mini-btn {
    padding: 2px 8px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: 3px;
    background: var(--color-bg-card);
    font-size: 11px;
    cursor: pointer;
    color: var(--color-text-tertiary, #9CA3AF);

    &:hover {
      background: var(--color-bg-hover);
    }
  }

  .batch-screenshot-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }

  .batch-screenshot-item {
    position: relative;
    flex-shrink: 0;
    width: 60px;
    text-align: center;

    .batch-thumb {
      width: 60px;
      height: 60px;
      object-fit: cover;
      border-radius: 4px;
      border: 1px solid var(--color-border-default, #E5E7EB);
    }

    .batch-file-icon {
      width: 60px;
      height: 60px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--color-border-default, #E5E7EB);
      border-radius: 4px;
      background: var(--color-bg-card);
    }

    .batch-file-ext {
      font-size: 9px;
      font-weight: 600;
      color: var(--color-text-tertiary, #9CA3AF);
      margin-top: 2px;
    }

    .batch-screenshot-del {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #DC2626;
      color: #fff;
      border: none;
      cursor: pointer;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .batch-screenshot-name {
      display: block;
      font-size: 10px;
      color: var(--color-text-tertiary, #9CA3AF);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }
  }
}

// 表格容器
.table-container {
  flex: 1;
  overflow: auto;
  padding: 0;
  border: 1px solid #D1D5DB;
  background: var(--color-bg-card);
}

// Excel表格
.excel-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  min-width: 1200px;
  font-size: 13px;

  th {
    background: #F5F6FA;
    font-weight: 600;
    font-size: 13px;
    color: #111827;
    padding: 10px 12px;
    text-align: left;
    position: sticky;
    top: 0;
    z-index: 5;
    border: 1px solid #E5E7EB;
    border-bottom: 2px solid #D1D5DB;
    white-space: nowrap;
  }

  td {
    border: 1px solid #E5E7EB;
    padding: 10px 12px;
    vertical-align: top;
  }

  .cell-conclusion,
  .cell-compliance,
  .cell-evidence {
    cursor: pointer;
  }

  tbody tr {
    &:hover {
      background: #F0F5FF;
    }

    &.active {
      background: var(--color-primary-light, #EFF6FF);
    }

    &.extension-divider {
      td {
        border-top: 2px solid var(--color-primary, #1B5FD9);
      }
    }
  }

  .cell-control,
  .cell-requirement {
    cursor: default;
  }

  .cell-control {
    padding: 10px 12px;
    font-weight: 500;
    color: #111827;
    background: var(--color-bg-page, #F5F6FA);
    vertical-align: middle;
    text-align: center;
    font-size: 12px;
  }

  .cell-requirement {
    padding: 10px 12px;
    color: #4B5563;
    font-size: 12px;
    line-height: 1.5;
    background: #F5F6FA;
  }

  .cell-compliance {
    text-align: center;
    vertical-align: middle;
    padding: 10px 12px;
  }

  .cell-conclusion,
  .cell-evidence {
    padding: 0;
  }

  .cell-conclusion,
  .cell-compliance,
  .cell-evidence {
    &.selected {
      outline: 1px solid rgba(27, 95, 217, 0.5);
      outline-offset: -1px;
    }

    &.selection-anchor {
      outline: 1px solid rgba(245, 158, 11, 0.6);
      outline-offset: -1px;
    }
  }

  .cell-textarea {
    width: 100%;
    min-height: 60px;
    padding: 10px 12px;
    border: none;
    outline: none;
    resize: none;
    font-size: 12px;
    line-height: 1.5;
    background: transparent;
    font-family: inherit;
    display: block;

    &.mono {
      font-family: var(--font-family-mono, monospace);
      font-size: 11px;
    }

    &.cell-selected {
      background: transparent;
    }
  }

  .compliance-select {
    width: auto;
    min-width: 80px;
    padding: 3px 10px;
    border: none;
    outline: none;
    font-size: 12px;
    background: transparent;
    cursor: pointer;
    text-align: center;
    border-radius: 2px;
    appearance: none;
    display: block;
    margin: 0 auto;

    &.conform {
      color: #fff;
      background: #16A34A;
      font-weight: 500;
    }

    &.partial {
      color: #fff;
      background: #F59E0B;
      font-weight: 500;
    }

    &.nonconform {
      color: #fff;
      background: #DC2626;
      font-weight: 500;
    }

    &.na {
      color: #fff;
      background: #6B7280;
      font-weight: 500;
    }
  }

  .cell-actions {
    padding: 10px 12px;
    text-align: center;
    vertical-align: middle;
  }

  .action-btn {
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: 2px;
    background: var(--color-bg-card);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary, #1B5FD9);
    vertical-align: middle;

    &:hover {
      background: var(--color-bg-page, #F5F6FA);
    }

    &.ai {
      &:hover {
        background: var(--color-primary-light, #EFF6FF);
        color: var(--color-primary, #1B5FD9);
      }
    }
  }
}

// 底部栏
.table-footer {
  padding: 6px 0;
  flex-shrink: 0;

  .row-count {
    font-size: 12px;
    color: var(--color-text-tertiary, #9CA3AF);
  }
}

// 右面板折叠按钮
.toggle-btn-right {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default, #E5E7EB);
  border-right: none;
  border-radius: 4px 0 0 4px;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-text-tertiary, #9CA3AF);
  transition: right 0.2s ease, background 0.15s, color 0.15s;

  &:hover {
    background: var(--color-primary-light, #EFF6FF);
    color: var(--color-primary, #1B5FD9);
  }
}

// 右面板浮动按钮
.right-float-btn {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary, #1B5FD9);
  color: #fff;
  font-size: 14px;
  border: none;
  border-radius: 4px 0 0 4px;
  cursor: pointer;
  z-index: 20;
  transition: background 0.15s;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);

  &:hover {
    background: #1550B8;
  }
}

// 动画
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// 深色主题覆盖
:root.dark {
  .save-status-indicator {
    &.saving {
      color: #60A5FA;
      background: rgba(59, 130, 246, 0.15);
      border-color: rgba(59, 130, 246, 0.3);
    }
    &.saved {
      color: #34D399;
      background: rgba(24, 169, 87, 0.15);
      border-color: rgba(24, 169, 87, 0.3);
    }
    &.error {
      color: #F87171;
      background: rgba(229, 57, 53, 0.15);
      border-color: rgba(229, 57, 53, 0.3);
    }
    &.unsaved {
      color: #FBBF24;
      background: rgba(212, 136, 6, 0.15);
      border-color: rgba(212, 136, 6, 0.3);
    }
  }

  .stat-value {
    &.completed {
      color: var(--color-text-tertiary);
    }
    &.compliant {
      color: #34D399;
    }
  }

  .toolbar-btn {
    &.primary {
      &:hover {
        background: var(--color-primary-hover);
      }
    }
    &.danger {
      background: var(--color-danger);
    }
  }

  .section-btn {
    &.primary {
      &:hover {
        background: var(--color-primary-hover);
      }
    }
  }

  .table-container {
    border-color: var(--color-border-base);
  }

  .excel-table {
    th {
      background: var(--color-bg-hover);
      color: var(--color-text-primary);
      border-color: var(--color-border-base);
      border-bottom-color: var(--color-border-base);
    }

    td {
      border-color: var(--color-border-base);
    }

    tbody tr:hover {
      background: var(--color-bg-hover);
    }

    .cell-control {
      color: var(--color-text-primary);
      background: var(--color-bg-page);
    }

    .cell-requirement {
      color: var(--color-text-secondary);
      background: var(--color-bg-page);
    }

    .compliance-select {
      &.conform {
        color: #fff;
        background: #16A34A;
      }
      &.partial {
        color: #fff;
        background: #F59E0B;
      }
      &.nonconform {
        color: #fff;
        background: #DC2626;
      }
      &.na {
        color: #fff;
        background: #6B7280;
      }
    }
  }

  .toggle-fold-btn {
    &:hover {
      background: var(--color-primary-hover);
    }
  }
}
</style>

