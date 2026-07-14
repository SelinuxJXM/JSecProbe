<template>
  <div class="page-container">
    <!-- 迷你AI进度条（最小化时显示） -->
    <div v-if="batchAiMinimized" class="mini-ai-progress" @click="batchAiProgress.visible = true; batchAiMinimized = false">
      <div class="mini-ai-progress-header">
        <span class="mini-ai-progress-title">🤖 AI分析中</span>
        <span class="mini-ai-progress-percent">{{ batchAiProgressPercentDisplay }}</span>
      </div>
      <div class="mini-ai-progress-bar-container">
        <div class="mini-ai-progress-bar" :style="{ width: batchAiProgressPercent + '%' }" />
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
        <div class="mini-ai-progress-bar" :style="{ width: (aiStep / 6) * 100 + '%' }" />
      </div>
      <div class="mini-ai-progress-message">{{ aiLoadingText || '分析中...' }}</div>
      <div class="mini-ai-progress-restore">点击展开详情</div>
    </div>
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
        <div class="save-status-indicator" :class="saveStatus" v-if="saveStatus !== 'idle'">
          <span class="save-status-icon">
            <svg v-if="saveStatus === 'saving'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <svg v-else-if="saveStatus === 'saved'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <svg v-else-if="saveStatus === 'error'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <svg v-else-if="saveStatus === 'unsaved'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/></svg>
          </span>
          <span class="save-status-text">
            {{ saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已自动保存' : saveStatus === 'error' ? '保存失败' : '未保存' }}
          </span>
          <span class="save-status-time" v-if="lastSavedTime && (saveStatus === 'saved')">
            {{ formatSaveTime(lastSavedTime) }}
          </span>
        </div>
        <el-dropdown @command="handleExportCommand">
          <el-button class="toolbar-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>导出</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="excel">导出Excel</el-dropdown-item>
              <el-dropdown-item command="pdf">导出PDF</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button class="toolbar-btn" @click="syncIssues">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>同步问题</span>
        </el-button>
        <el-button class="toolbar-btn" @click="handleImportExcel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>导入测评结果</span>
        </el-button>
        <el-button type="primary" class="toolbar-btn primary" @click="triggerManualSave" :loading="saveStatus === 'saving'">
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
      <button class="toggle-btn-left" @click="leftCollapsed = !leftCollapsed">
        {{ leftCollapsed ? '›' : '‹' }}
      </button>

      <!-- 中栏：Excel风格表格 -->
      <div class="center-panel">
        <!-- 标题栏 -->
        <div class="section-title-bar">
          <span class="section-title">{{ sectionTitle }}</span>
          <div class="section-actions">
            <button class="section-btn" @click="handleBatchUpload">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>上传文件</span>
            </button>
            <button class="section-btn primary" :disabled="batchFiles.length === 0 || batchAiLoading" @click="batchAiAnalyze">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a6 6 0 0 0-6 6v1h20v-1a6 6 0 0 0-6-6z"/></svg>
              <span>{{ batchAiLoading ? '分析中...' : `AI分析 (${batchFiles.length}个)` }}</span>
            </button>
          </div>
        </div>

        <!-- 批量文件管理区域 -->
        <div v-if="batchFiles.length > 0 && showBatchScreenshots" class="batch-screenshot-bar">
          <div class="batch-screenshot-header">
            <span class="batch-screenshot-title">待分析文件 ({{ batchFiles.length }}个)</span>
            <div class="batch-screenshot-actions">
              <button class="mini-btn" @click="clearBatchFiles" title="清空全部">清空</button>
              <button class="mini-btn" @click="showBatchScreenshots = false" title="收起">收起</button>
            </div>
          </div>
          <div class="batch-screenshot-list">
            <div v-for="file in batchFiles" :key="file.id" class="batch-screenshot-item" @click="openFilePreview(file)" style="cursor: pointer">
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
              <button class="batch-screenshot-del" @click.stop="removeBatchFile(file.id)" title="删除">×</button>
              <span class="batch-screenshot-name">{{ file.name }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="batchFiles.length > 0 && !showBatchScreenshots" class="batch-screenshot-bar collapsed" @click="showBatchScreenshots = true">
          <span>展开文件 ({{ batchFiles.length }}个)</span>
        </div>

        <!-- Excel表格 -->
        <div class="table-container" @click="handleTableContainerClick($event)">
          <table class="excel-table">
            <colgroup>
              <col style="width: 130px">
              <col style="width: 320px">
              <col style="width: 400px">
              <col style="width: 80px">
              <col style="width: 280px">
              <col style="width: 50px">
            </colgroup>
            <thead>
              <tr>
                <th>安全控制点</th>
                <th>测评项（标准条款）</th>
                <th>测评结论</th>
                <th>符合性</th>
                <th>关键证据点</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in tableRows" :key="row.itemId || index" :class="{ active: currentRowIndex === index, 'extension-divider': isExtensionDivider(index) }" @click="currentRowIndex = index">
                <td v-if="!row.controlPointHidden" class="cell-control" :rowspan="row.controlPointRowSpan || 1">{{ row.controlPoint }}</td>
                <td class="cell-requirement">{{ row.requirement }}</td>
                <td class="cell-conclusion" :class="{ selected: isCellSelected(index, 'conclusion'), 'selection-anchor': isSelectionAnchor(index, 'conclusion') }" @click="handleCellClick($event, index, 'conclusion')" @mousedown="handleCellMouseDown($event)">
                  <textarea v-model="row.conclusion" class="cell-textarea conclusion-box" placeholder="填写测评结论..." @input="adjustConclusionHeight($event); debounceAutoSave(row)" @paste="handleConclusionPaste($event, index)" @mousedown="handleCellMouseDown($event)" :class="{ 'cell-selected': isCellSelected(index, 'conclusion') }" />
                </td>
                <td class="cell-compliance" :class="{ selected: isCellSelected(index, 'compliance'), 'selection-anchor': isSelectionAnchor(index, 'compliance') }" @click="handleCellClick($event, index, 'compliance')" @mousedown="handleCellMouseDown($event)">
                  <select v-model="row.compliance" class="compliance-select" :class="row.compliance" @change="debounceAutoSave(row)" @paste="handleCompliancePaste($event, index)" @mousedown="handleCellMouseDown($event)">
                    <option value="">待判定</option>
                    <option value="conform">符合</option>
                    <option value="partial">部分符合</option>
                    <option value="nonconform">不符合</option>
                    <option value="na">不适用</option>
                  </select>
                </td>
                <td class="cell-evidence" :class="{ selected: isCellSelected(index, 'evidence'), 'selection-anchor': isSelectionAnchor(index, 'evidence') }" @click="handleCellClick($event, index, 'evidence')" @mousedown="handleCellMouseDown($event)">
                  <textarea v-model="row.evidence" class="cell-textarea evidence-box mono" placeholder="粘贴执行结果、截图，或填写关键证据点..." @input="adjustEvidenceHeight($event); debounceAutoSave(row)" @mousedown="handleCellMouseDown($event)" :class="{ 'cell-selected': isCellSelected(index, 'evidence') }" />
                  <div class="screenshot-area" v-if="row.screenshots && row.screenshots.length > 0">
                    <div v-for="(shot, idx) in row.screenshots" :key="idx" class="screenshot-thumb" @click="previewScreenshot(row, shot)">
                      <template v-if="getFileType(shot) === 'image'">
                        <img v-if="getScreenshotState(row, shot) === 'loaded'" :src="getScreenshotSrc(row, shot)" alt="截图" />
                        <div v-else-if="getScreenshotState(row, shot) === 'error'" class="thumb-error">加载失败</div>
                        <div v-else class="thumb-loading">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                        </div>
                      </template>
                      <template v-else>
                        <div class="file-thumb-placeholder" :class="getFileType(shot)">{{ getFileType(shot) === 'pdf' ? 'PDF' : (getFileType(shot) === 'word' ? 'DOC' : (getFileType(shot) === 'text' ? 'TXT' : 'FILE')) }}</div>
                      </template>
                      <span class="remove-shot" @click.stop="removeScreenshot(row, idx)">×</span>
                    </div>
                  </div>
                  <button class="screenshot-btn" @click.stop="uploadScreenshot(row)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    上传文件
                  </button>
                </td>
                <td class="cell-actions">
                  <button class="action-btn ai" @click.stop="aiAnalyze(row)" title="AI分析此行">
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
      <div class="right-panel" :class="{ collapsed: rightCollapsed }">
        <div class="panel-header">
          <span class="panel-title">知识库</span>
        </div>
        <div class="knowledge-tabs">
          <button class="tab-btn" :class="{ active: knowledgeTab === 'guide' }" @click="knowledgeTab = 'guide'; loadKnowledgeBase()">作业指导书</button>
          <button class="tab-btn" :class="{ active: knowledgeTab === 'command' }" @click="knowledgeTab = 'command'; loadKnowledgeBase()">核查命令</button>
        </div>
        <div class="panel-search">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input v-model="knowledgeSearch" type="text" :placeholder="knowledgeTab === 'guide' ? '搜索作业指导书...' : '搜索核查命令...'" class="search-input" />
        </div>
        <div class="knowledge-list">
          <!-- 核查命令卡片 -->
          <div v-if="knowledgeTab === 'command'" v-for="cmd in filteredCommands" :key="cmd.id" class="command-card" @click="quoteCommand(cmd)">
            <div class="card-top">
              <span class="card-name">{{ cmd.title }}</span>
              <span v-if="cmd.target" class="card-badge">{{ cmd.target }}</span>
            </div>
            <div class="card-code">{{ cmd.command }}</div>
            <div v-if="cmd.content" class="card-desc">{{ cmd.content }}</div>
            <div class="card-actions" @click.stop>
              <button class="btn-quote" @click="quoteCommand(cmd)">引用</button>
              <button class="btn-copy" @click="copyCommand(cmd.command)">复制</button>
            </div>
          </div>

          <!-- 作业指导书卡片 -->
          <div v-if="knowledgeTab === 'guide'" v-for="doc in filteredDocuments" :key="doc.id" class="document-card">
            <div class="doc-card-header">
              <span class="doc-card-title">{{ doc.title }}</span>
              <span v-if="doc.category" class="doc-card-category">{{ doc.category }}</span>
            </div>
            <div v-if="doc.description" class="doc-card-summary">{{ doc.description }}</div>
            <div class="doc-card-preview" v-if="doc.content">
              <div class="preview-content" :class="{ expanded: doc._expanded }">{{ doc.content }}</div>
              <button v-if="doc.content && doc.content.length > 150" class="expand-toggle" @click.stop="toggleExpand(doc)">
                {{ doc._expanded ? '收起' : '展开全文' }}
              </button>
            </div>
            <div class="doc-card-footer">
              <button class="doc-btn-view" @click.stop="viewDocument(doc)">查看</button>
              <button class="doc-btn-copy-text" @click.stop="copyCommand(doc.content)">复制内容</button>
            </div>
          </div>

          <div v-if="(knowledgeTab === 'command' && filteredCommands.length === 0) || (knowledgeTab === 'guide' && filteredDocuments.length === 0)" class="empty-state">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>{{ knowledgeSearch ? '未找到匹配内容' : '暂无内容' }}</span>
          </div>
        </div>
      </div>

      <!-- 右面板折叠按钮 -->
      <button v-show="!rightCollapsed" class="toggle-btn-right" @click="rightCollapsed = !rightCollapsed">
        ›
      </button>
      <!-- 右面板浮动按钮 -->
      <button v-show="rightCollapsed" class="right-float-btn" @click="rightCollapsed = false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </button>
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
          <div class="section-content">{{ aiAnalysisResult.controlPoint }}</div>
        </div>
        <div class="result-section">
          <div class="section-title">测评项（标准条款）</div>
          <div class="section-content">{{ aiAnalysisResult.requirement }}</div>
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

    <!-- 导出选择弹窗 -->
    <el-dialog
      v-model="exportDialogVisible"
      title="选择导出内容"
      width="520px"
      class="export-dialog"
      :close-on-click-modal="false"
    >
      <div class="export-tree-container">
        <div class="export-tree-header">
          <label class="checkbox-label">
            <input type="checkbox" 
              :checked="isAllSelected"
              :indeterminate="isIndeterminate"
              @change="toggleSelectAll" />
            <span>全选</span>
          </label>
          <span class="selected-count">{{ selectedTotalCount }} / {{ totalCount }}</span>
        </div>
        <div class="export-tree">
          <div v-for="domain in exportTreeData" :key="domain.id" class="tree-group">
            <!-- 全局层面（无子节点） -->
            <div v-if="!domain.children || domain.children.length === 0" class="tree-leaf">
              <label class="tree-item-label">
                <input type="checkbox" :value="`domain:${domain.id}`" v-model="selectedExportItems" />
                <span class="item-text">{{ domain.label }}</span>
              </label>
            </div>
            <!-- 有子节点的层面（可展开） -->
            <div v-else class="tree-node">
              <div class="tree-node-header" @click="toggleExportDomain(domain.id)">
                <svg class="tree-chevron" :class="{ expanded: expandedExportDomains.includes(domain.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                <label class="tree-item-label" @click.stop>
                  <input type="checkbox" 
                    :checked="isDomainAllSelected(domain)"
                    :indeterminate="isDomainIndeterminate(domain)"
                    @change="toggleDomainSelectAll(domain)" />
                </label>
                <span class="item-text parent-text">{{ domain.label }}</span>
                <span class="item-count">{{ getDomainSelectedCount(domain) }}/{{ domain.children.length }}</span>
              </div>
              <div v-show="expandedExportDomains.includes(domain.id)" class="tree-children">
                <div v-for="child in domain.children" :key="child.id" class="tree-leaf child-leaf">
                  <label class="tree-item-label">
                    <input type="checkbox" :value="`asset:${child.id}`" v-model="selectedExportItems" />
                    <span class="item-text">{{ child.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="exportDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="confirmExport" :disabled="selectedExportItems.length === 0">
          导出选中
        </el-button>
      </template>
    </el-dialog>

<!-- 导入选择弹窗 -->
    <el-dialog
      v-model="importDialogVisible"
      title="选择导入内容"
      width="520px"
      class="export-dialog"
      :close-on-click-modal="false"
    >
      <div class="export-tree-container">
        <div class="export-tree-header">
          <label class="checkbox-label">
            <input type="checkbox" 
              :checked="isImportAllSelected"
              :indeterminate="isImportIndeterminate"
              @change="toggleImportSelectAll" />
            <span>全选</span>
          </label>
          <span class="selected-count">{{ selectedImportItems.length }} / {{ importTotalCount }}</span>
        </div>
        <div class="export-tree">
          <div v-for="domain in importTreeData" :key="domain.id" class="tree-group">
            <!-- 全局层面（无子节点） -->
            <div v-if="!domain.children || domain.children.length === 0" class="tree-leaf">
              <label class="tree-item-label">
                <input type="checkbox" :value="`domain:${domain.id}`" v-model="selectedImportItems" />
                <span class="item-text">{{ domain.label }}</span>
              </label>
            </div>
            <!-- 有子节点的层面（可展开） -->
            <div v-else class="tree-node">
              <div class="tree-node-header" @click="toggleImportDomain(domain.id)">
                <svg class="tree-chevron" :class="{ expanded: expandedImportDomains.includes(domain.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                <label class="tree-item-label" @click.stop>
                  <input type="checkbox" 
                    :checked="isImportDomainAllSelected(domain)"
                    :indeterminate="isImportDomainIndeterminate(domain)"
                    @change="toggleImportDomainSelectAll(domain)" />
                </label>
                <span class="item-text parent-text">{{ domain.label }}</span>
                <span class="item-count">{{ getImportDomainSelectedCount(domain) }}/{{ domain.children.length }}</span>
              </div>
              <div v-show="expandedImportDomains.includes(domain.id)" class="tree-children">
                <div v-for="child in domain.children" :key="child.id" class="tree-leaf child-leaf">
                  <label class="tree-item-label">
                    <input type="checkbox" :value="`asset:${child.id}`" v-model="selectedImportItems" />
                    <span class="item-text">{{ child.label }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="confirmImport" :disabled="selectedImportItems.length === 0">
          选择文件导入
        </el-button>
      </template>
    </el-dialog>

    <!-- 文件预览弹窗 -->
    <el-dialog v-model="previewDialogVisible" width="800px" :title="previewFile?.name || '文件预览'" class="file-preview-dialog" :show-close="true">
      <div class="file-preview-container">
        <div v-if="previewLoading" class="preview-loading">正在加载文件...</div>
        <div v-else-if="previewError" class="preview-error">{{ previewError }}</div>
        <div v-else-if="previewFile?.fileType === 'image'" class="preview-image-wrapper">
          <img :src="previewFileSrc" :alt="previewFile.name" class="preview-image" />
        </div>
        <div v-else-if="previewFile?.fileType === 'pdf'" class="preview-pdf-wrapper">
          <iframe :src="previewFileSrc" class="preview-pdf" frameborder="0" />
        </div>
        <div v-else-if="previewFile?.fileType === 'word'" class="preview-word-wrapper">
          <div class="word-placeholder">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#2B5797" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#2B5797" fill-opacity="0.1"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <p class="word-title">{{ previewFile.name }}</p>
            <p class="word-desc">Word文档暂不支持在线预览</p>
            <el-button type="primary" @click="openFileExternal(previewFile)">使用系统程序打开</el-button>
          </div>
        </div>
        <div v-else-if="previewFile?.fileType === 'text'" class="preview-text-wrapper">
          <pre class="preview-text-content">{{ previewTextContent }}</pre>
        </div>
        <div v-else class="preview-unsupported">
          <p>不支持的文件格式</p>
          <el-button @click="openFileExternal(previewFile)">使用系统程序打开</el-button>
        </div>
      </div>
    </el-dialog>

    <!-- AI分析进度弹窗 -->
    <el-dialog v-model="batchAiProgress.visible" title="🤖 AI批量分析" width="480px" :close-on-click-modal="false" :show-close="false" :close-on-press-escape="false" class="ai-progress-dialog">
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
        <!-- 步骤指示器 -->
        <div class="progress-steps">
          <div class="step-item" :class="{ active: batchAiProgress.stage === 'init', completed: batchAiProgressPercent > 5 }">
            <div class="step-icon">{{ batchAiProgressPercent > 5 ? '✓' : '1' }}</div>
            <div class="step-info">
              <div class="step-name">读取配置</div>
              <div class="step-desc">验证连接</div>
            </div>
          </div>
          <div class="step-connector" :class="{ active: batchAiProgressPercent > 15 }" />
          
          <div class="step-item" :class="{ active: batchAiProgress.stage === 'encoding', completed: batchAiProgressPercent > 55 }">
            <div class="step-icon">{{ batchAiProgressPercent > 55 ? '✓' : '2' }}</div>
            <div class="step-info">
              <div class="step-name">编码文件</div>
              <div class="step-desc">图片处理</div>
            </div>
          </div>
          <div class="step-connector" :class="{ active: batchAiProgressPercent > 60 }" />
          
          <div class="step-item" :class="{ active: batchAiProgress.stage === 'sending', completed: batchAiProgressPercent > 70 }">
            <div class="step-icon">{{ batchAiProgressPercent > 70 ? '✓' : '3' }}</div>
            <div class="step-info">
              <div class="step-name">提交AI</div>
              <div class="step-desc">发送请求</div>
            </div>
          </div>
          <div class="step-connector" :class="{ active: batchAiProgressPercent > 75 }" />
          
          <div class="step-item" :class="{ active: batchAiProgress.stage === 'receiving' || batchAiProgress.stage === 'parsing', completed: batchAiProgressPercent >= 100 }">
            <div class="step-icon">{{ batchAiProgressPercent >= 100 ? '✓' : '4' }}</div>
            <div class="step-info">
              <div class="step-name">AI分析</div>
              <div class="step-desc">等待结果</div>
            </div>
          </div>
        </div>
        
        <!-- 总进度条 -->
        <div class="total-progress">
          <div class="progress-label">
            <span class="stage-text">{{ batchAiProgress.message }}</span>
            <span class="percent-text">{{ batchAiProgressPercentDisplay }}</span>
          </div>
          <el-progress :percentage="batchAiProgress.percent" :stroke-width="14" :status="batchAiProgress.stage === 'error' ? 'exception' : (batchAiProgress.stage === 'done' ? 'success' : '')" :indeterminate="batchAiProgress.stage === 'receiving'" style="margin-top: 8px" />
        </div>
        
        <!-- 加载动画 -->
        <div class="loading-hint" v-if="batchAiProgress.percent < 100 && batchAiProgress.stage !== 'error'">
          <span class="loading-dot" />
          <span class="loading-dot" />
          <span class="loading-dot" />
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUpdated, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { AssessmentRecord } from '../../../shared/types';

// 资产类型与不适用测评项映射表（从S2A2G2.xlsx提取）
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

// 扩展类型中文名称到英文代码的映射
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

const route = useRoute();
const router = useRouter();

const project = ref<any>(null);
const treeSearch = ref('');
const expandedDomains = ref<string[]>([]);

const progress = ref({
  total: 0,
  tested: 0,
  compliant: 0,
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
const currentAsset = ref<any>(null);  // 当前选中的测评对象（资产）
const currentDomainId = ref('');  // 当前选中的全局层面ID
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

// 表格数据（当前资产在当前层面下的所有测评项）
const tableRows = ref<any[]>([]);

// 判断当前行是否是扩展要求部分的第一行（需要显示绿色分隔线）
function isExtensionDivider(index: number): boolean {
  if (index <= 0 || index >= tableRows.value.length) return false;
  const prevRow = tableRows.value[index - 1];
  const currRow = tableRows.value[index];
  // 上一行是通用要求，当前行不是通用要求 → 需要分隔线
  return prevRow?.extensionType === 'general' && currRow?.extensionType !== 'general';
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

// 处理测评结论批量粘贴（从Excel复制多行内容）
// 从Excel表格HTML中提取单元格值（返回二维：行×列）
function parseExcelTableHTML(html: string): string[][] | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;

  const rows: string[][] = [];
  const trs = table.querySelectorAll('tr');
  for (const tr of trs) {
    const tds = tr.querySelectorAll('td, th');
    const rowCells: string[] = [];
    for (const td of tds) {
      const content = td.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      rowCells.push(content);
    }
    if (rowCells.length > 0) rows.push(rowCells);
  }
  return rows.length > 0 ? rows : null;
}

// 解析纯文本粘贴为二维（支持 Tab 分隔的多列）
function parsePlainText(text: string): string[][] {
  return text.split(/\r\n|\r|\n/).filter(line => line.trim() !== '').map(line => line.split('\t'));
}

// 单元格多选功能
const selectedCells = ref<Set<string>>(new Set());
const selectionAnchor = ref<{ rowIndex: number; field: string } | null>(null);

function cellKey(rowIndex: number, field: string): string {
  return `${rowIndex}:${field}`;
}

function isCellSelected(rowIndex: number, field: string): boolean {
  return selectedCells.value.has(cellKey(rowIndex, field));
}

function isSelectionAnchor(rowIndex: number, field: string): boolean {
  return selectionAnchor.value?.rowIndex === rowIndex && selectionAnchor.value?.field === field;
}

function handleCellMouseDown(event: MouseEvent) {
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    event.preventDefault();
  }
}

function handleCellClick(event: MouseEvent, rowIndex: number, field: string) {
  const key = cellKey(rowIndex, field);

  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    event.preventDefault();
  }

  if (event.ctrlKey || event.metaKey) {
    if (selectedCells.value.has(key)) {
      selectedCells.value.delete(key);
    } else {
      selectedCells.value.add(key);
    }
    selectionAnchor.value = { rowIndex, field };
  } else if (event.shiftKey && selectionAnchor.value) {
    // Shift+Click: 范围选择
    const startRow = selectionAnchor.value.rowIndex;
    const endRow = rowIndex;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const fields = ['conclusion', 'compliance', 'evidence'];
    const anchorFieldIdx = fields.indexOf(selectionAnchor.value.field);
    const currentFieldIdx = fields.indexOf(field);

    for (let r = minRow; r <= maxRow; r++) {
      // 如果锚点和当前点在同一列，只选该列
      if (anchorFieldIdx === currentFieldIdx) {
        selectedCells.value.add(cellKey(r, field));
      } else {
        // 跨列时选所有中间列
        const minF = Math.min(anchorFieldIdx, currentFieldIdx);
        const maxF = Math.max(anchorFieldIdx, currentFieldIdx);
        for (let f = minF; f <= maxF; f++) {
          selectedCells.value.add(cellKey(r, fields[f]));
        }
      }
    }
  } else {
    // 普通点击：清除其他选中，只选当前单元格
    selectedCells.value.clear();
    selectedCells.value.add(key);
    selectionAnchor.value = { rowIndex, field };
  }
}

function clearSelectedCells() {
  if (selectedCells.value.size === 0) return;

  const fields: Record<string, (row: any) => any> = {
    'conclusion': (row: any) => row.conclusion = '',
    'compliance': (row: any) => row.compliance = '',
    'evidence': (row: any) => row.evidence = '',
  };

  for (const key of selectedCells.value) {
    const [rowIdxStr, field] = key.split(':');
    const rowIdx = parseInt(rowIdxStr);
    if (rowIdx >= 0 && rowIdx < tableRows.value.length && fields[field]) {
      fields[field](tableRows.value[rowIdx]);
    }
  }

  hasUnsavedChanges.value = true;
  saveStatus.value = 'unsaved';
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => saveAllRows(), 1500);

  const count = selectedCells.value.size;
  selectedCells.value.clear();
  selectionAnchor.value = null;
  ElMessage.success(`已清空 ${count} 个单元格`);
}

// 点击空白处取消选中
function handleTableContainerClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest('td')) {
    selectedCells.value.clear();
    selectionAnchor.value = null;
  }
}

// 处理测评结论批量粘贴（从Excel复制多行/多列内容）
function handleConclusionPaste(_event: Event, rowIndex: number) {
  const clipboardData = (_event as ClipboardEvent).clipboardData;
  if (!clipboardData) return;

  let rows: string[][] = [];

  // 优先从HTML解析（Excel复制场景，能正确处理单元格内换行）
  const htmlData = clipboardData.getData('text/html');
  if (htmlData) {
    const parsed = parseExcelTableHTML(htmlData);
    if (parsed && parsed.length > 0) {
      rows = parsed;
    }
  }

  // HTML解析失败则回退到纯文本
  if (rows.length === 0) {
    const pastedText = clipboardData.getData('text');
    if (!pastedText) return;
    rows = parsePlainText(pastedText);
  }

  // 如果只有一行，正常粘贴不做处理
  if (rows.length <= 1) return;

  // 阻止默认粘贴行为
  event!.preventDefault();

  // 获取表格行
  const domRows = document.querySelectorAll('tbody tr');
  if (!domRows || domRows.length === 0) return;

  const colCount = Math.max(...rows.map(r => r.length));

  // 从当前行开始，批量填充内容
  for (let i = 0; i < rows.length; i++) {
    const targetRowIndex = rowIndex + i;
    if (targetRowIndex >= tableRows.value.length) break;

    // 第一列填充到测评结论
    if (rows[i].length > 0 && rows[i][0]) {
      tableRows.value[targetRowIndex].conclusion = rows[i][0];
      const targetTextarea = domRows[targetRowIndex]?.querySelector('.conclusion-box') as HTMLTextAreaElement;
      if (targetTextarea) {
        setTimeout(() => {
          targetTextarea.style.height = 'auto';
          targetTextarea.style.height = targetTextarea.scrollHeight + 2 + 'px';
        }, 0);
      }
    }

    // 第二列填充到符合性（如果存在）
    if (colCount >= 2 && rows[i].length > 1 && rows[i][1]) {
      const complianceValue = parseComplianceText(rows[i][1]);
      tableRows.value[targetRowIndex].compliance = complianceValue;
    }
  }

  // 标记有未保存的更改并触发自动保存
  hasUnsavedChanges.value = true;
  saveStatus.value = 'unsaved';
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => saveAllRows(), 1500);

  // 显示提示
  const pastedCount = Math.min(rows.length, tableRows.value.length - rowIndex);
  const colHint = colCount >= 2 ? '（含测评结论 + 符合性）' : '';
  ElMessage.success(`已批量填写 ${pastedCount} 条测评结论${colHint}`);
}

// 符合性文本到值的映射
const COMPLIANCE_TEXT_MAP: Record<string, string> = {
  '符合': 'conform',
  '部分符合': 'partial',
  '部分': 'partial',
  '不符合': 'nonconform',
  '不合规': 'nonconform',
  '不适用': 'na',
  'n/a': 'na',
  'na': 'na',
  '待判定': '',
  '': '',
};

// 解析符合性文本
function parseComplianceText(text: string): string {
  const trimmed = text.trim().toLowerCase();
  for (const [key, value] of Object.entries(COMPLIANCE_TEXT_MAP)) {
    if (trimmed === key.toLowerCase()) {
      return value;
    }
  }
  // 包含匹配
  if (trimmed.includes('部分')) return 'partial';
  if (trimmed.includes('不符合') || trimmed.includes('不合规')) return 'nonconform';
  if (trimmed.includes('符合')) return 'conform';
  if (trimmed.includes('不适用') || trimmed.includes('n/a') || trimmed.includes('na')) return 'na';
  return '';
}

// 处理符合性批量粘贴（从Excel复制多行/多列内容）
function handleCompliancePaste(_event: Event, rowIndex: number) {
  const clipboardData = (_event as ClipboardEvent).clipboardData;
  if (!clipboardData) return;

  let rows: string[][] = [];

  // 优先从HTML解析
  const htmlData = clipboardData.getData('text/html');
  if (htmlData) {
    const parsed = parseExcelTableHTML(htmlData);
    if (parsed && parsed.length > 0) {
      rows = parsed;
    }
  }

  // HTML解析失败则回退到纯文本
  if (rows.length === 0) {
    const pastedText = clipboardData.getData('text');
    if (!pastedText) return;
    rows = parsePlainText(pastedText);
  }

  // 如果只有一个值，直接设置当前行
  if (rows.length <= 1 && rows[0]?.length === 1) {
    const value = parseComplianceText(rows[0][0]);
    tableRows.value[rowIndex].compliance = value;
    hasUnsavedChanges.value = true;
    saveStatus.value = 'unsaved';
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => saveAllRows(), 1500);
    return;
  }

  // 阻止默认粘贴
  event!.preventDefault();

  // 批量填充
  let successCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const targetRowIndex = rowIndex + i;
    if (targetRowIndex >= tableRows.value.length) break;

    // 如果有多列，第二列是符合性；如果只有一列，第一列是符合性
    const colIdx = rows[i].length >= 2 ? 1 : 0;
    const value = parseComplianceText(rows[i][colIdx]);
    tableRows.value[targetRowIndex].compliance = value;
    successCount++;
  }

  hasUnsavedChanges.value = true;
  saveStatus.value = 'unsaved';
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => saveAllRows(), 1500);

  ElMessage.success(`已批量填写 ${successCount} 条符合性`);
}

// 保存状态管理
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';
const saveStatus = ref<SaveStatus>('idle');
const hasUnsavedChanges = ref(false);
const lastSavedTime = ref<Date | null>(null);
let autoSaveTimer: number | null = null;
let periodicSaveTimer: number | null = null;

// 统一的保存逻辑：保存所有行
async function saveAllRows(): Promise<boolean> {
  if (!currentAsset.value && !currentDomainId.value) return false;
  if (tableRows.value.length === 0) return false;

  saveStatus.value = 'saving';
  try {
    const projectId = route.params.id as string;
    const assetId = currentAsset.value?.id || '';

    const complianceMap: Record<string, string> = {
      'conform': 'compliant',
      'partial': 'partial',
      'nonconform': 'non_compliant',
      'na': 'not_applicable',
      '': 'untested',
    };

    const methodMap: Record<string, string> = {
      '核查': 'check',
      '访谈': 'interview',
      '测试': 'test',
    };

    for (const row of tableRows.value) {
      const data: Partial<AssessmentRecord> = {
        id: row.id || undefined,
        projectId,
        assetId: assetId || undefined,
        itemId: row.itemId,
        result: (complianceMap[row.compliance] || 'untested') as AssessmentRecord['result'],
        method: (methodMap[row.method] || 'check') as AssessmentRecord['method'],
        commandOutput: row.evidence || '',
        evidence: row.evidence || '',
        findings: row.conclusion || '',
        screenshotPaths: row.screenshots && row.screenshots.length > 0 ? JSON.stringify(row.screenshots) : undefined,
      };

      const res = await window.api.assessment.saveRecord(data);
      if (res.success && res.data) {
        row.id = res.data.id;
      }
    }

    if (assetId) {
      updateAssetProgress(assetId, tableRows.value);
    }
    await loadProgress();

    saveStatus.value = 'saved';
    hasUnsavedChanges.value = false;
    lastSavedTime.value = new Date();
    return true;
  } catch (error) {
    console.error('保存失败:', error);
    saveStatus.value = 'error';
    return false;
  }
}

// 防抖自动保存（输入时触发）
function debounceAutoSave(_row: any) {
  hasUnsavedChanges.value = true;
  saveStatus.value = 'unsaved';
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = window.setTimeout(() => {
    saveAllRows();
  }, 1500);
}

// 启动周期性备份保存（每30秒）
function startPeriodicSave() {
  stopPeriodicSave();
  periodicSaveTimer = window.setInterval(() => {
    if (hasUnsavedChanges.value) {
      saveAllRows();
    }
  }, 30000);
}

function stopPeriodicSave() {
  if (periodicSaveTimer) {
    clearInterval(periodicSaveTimer);
    periodicSaveTimer = null;
  }
}

// 手动保存
async function triggerManualSave() {
  const success = await saveAllRows();
  if (success) {
    ElMessage.success('保存成功');
  } else {
    ElMessage.error('保存失败，请重试');
  }
}

// 格式化保存时间
function formatSaveTime(date: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
const aiDialogVisible = ref(false);
const aiLoading = ref(false);
const aiLoadingText = ref('');
const aiStep = ref(0);
const aiCurrentRow = ref<any>(null);
const aiAnalysisResult = ref<any>(null);

// 批量AI分析进度弹窗
const batchAiProgress = ref({ visible: false, percent: 0, message: '', stage: '' });
const batchAiMinimized = ref(false);
const aiDialogMinimized = ref(false);

// AI使用合规确认
const aiConsentGiven = ref(false);
const showAiConsentDialog = ref(false);
const aiConsentPendingAction = ref<'single' | 'batch' | null>(null);

function confirmAiConsent() {
  aiConsentGiven.value = true;
  showAiConsentDialog.value = false;
  if (aiConsentPendingAction.value === 'single') {
    executeAiAnalyze(aiCurrentRow.value);
  } else if (aiConsentPendingAction.value === 'batch') {
    executeBatchAiAnalyze();
  }
  aiConsentPendingAction.value = null;
}

// 文件预览
const previewDialogVisible = ref(false);
const previewFile = ref<{ name: string; path: string; fileType: string } | null>(null);
const previewFileSrc = ref('');
const previewLoading = ref(false);
const previewError = ref('');
const previewTextContent = ref('');

const complianceClass = computed(() => {
  const map: Record<string, string> = {
    '符合': 'conform',
    '部分符合': 'partial',
    '不符合': 'nonconform',
    '不适用': 'na',
  };
  return map[aiAnalysisResult.value?.compliance] || '';
});

const batchAiProgressPercent = computed(() => batchAiProgress.value.percent);
const batchAiProgressPercentDisplay = computed(() => `${batchAiProgress.value.percent}%`);

const batchFiles = ref<{ id: string; path: string; name: string; fileType: string; dataUrl?: string }[]>([]);
const showBatchScreenshots = ref(true);
const batchAiLoading = ref(false);

function getFileType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.bmp')) return 'image';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'word';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'text';
  return 'other';
}

async function handleBatchUpload() {
  if (!window.api) {
    ElMessage.error('文件上传功能不可用');
    return;
  }
  try {
    const res = await window.api.dialog.showOpenDialog({
      title: '选择文件',
      filters: [{ name: '支持的文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'pdf', 'doc', 'docx', 'md', 'txt'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (res.data?.canceled || !res.data?.filePaths) return;
    for (const filePath of res.data.filePaths) {
      const fileName = filePath.split('\\').pop()?.split('/').pop() || filePath;
      const fileType = getFileType(filePath);
      const id = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      let dataUrl = '';
      if (fileType === 'image') {
        const imgRes = await window.api.screenshot.getBase64({ filePath });
        if (imgRes.success && imgRes.data) {
          dataUrl = `data:${imgRes.data.mimeType};base64,${imgRes.data.base64}`;
        }
      }
      batchFiles.value.push({ id, path: filePath, name: fileName, fileType, dataUrl });
    }
  } catch (error) {
    ElMessage.error('上传文件失败');
  }
}

function removeBatchFile(id: string) {
  const index = batchFiles.value.findIndex(s => s.id === id);
  if (index > -1) {
    batchFiles.value.splice(index, 1);
  }
}

function clearBatchFiles() {
  batchFiles.value = [];
}

function batchAiAnalyze() {
  if (!aiConsentGiven.value) {
    aiConsentPendingAction.value = 'batch';
    showAiConsentDialog.value = true;
    return;
  }
  executeBatchAiAnalyze();
}

function executeBatchAiAnalyze() {
  if (!window.api) {
    ElMessage.error('AI功能不可用');
    return;
  }
  if (batchFiles.value.length === 0) {
    ElMessage.warning('请先上传文件');
    return;
  }
  if (tableRows.value.length === 0) {
    ElMessage.warning('没有可分析的测评项');
    return;
  }

  batchAiLoading.value = true;
  batchAiProgress.value = { visible: true, percent: 0, message: '准备中...', stage: 'init' };

  (async () => {
    try {
      const items = tableRows.value
        .filter(row => row.compliance !== 'na')
        .map(row => ({
          id: row.itemId,
          controlPoint: row.controlPoint || '',
          requirement: row.requirement || '',
        }));
      const imagePaths = batchFiles.value.filter(f => f.fileType === 'image').map(s => s.path);
      const docFiles = batchFiles.value.filter(f => f.fileType === 'pdf' || f.fileType === 'word');
      let docContents: { name: string; content: string }[] = [];
      if (docFiles.length > 0) {
        const docRes = await window.api.document.extractText({ filePaths: docFiles.map(d => d.path) });
        if (docRes.success && docRes.data) {
          docContents = docRes.data;
        }
      }

      const res = await window.api.ai.batchAnalyzeScreenshots({
        items,
        screenshots: imagePaths,
        documents: docContents,
      });

      if (res.success && res.data) {
        const content = res.data.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          const results = analysis.results || [];
          let appliedCount = 0;

          console.log('[batchAiAnalyze] batchFiles:', batchFiles.value.map(b => ({ name: b.name, path: b.path.substring(0, 60), hasDataUrl: !!b.dataUrl })));
          console.log('[batchAiAnalyze] results screenshots:', results.map((r: any) => ({ itemId: r.itemId, screenshots: r.screenshots })));

          for (const result of results) {
            const row = tableRows.value.find(r => r.itemId === result.itemId);
            if (row) {
              const resultMap: Record<string, string> = {
                '符合': 'conform',
                '部分符合': 'partial',
                '不符合': 'nonconform',
                '不适用': 'na',
              };
              const complianceValue = resultMap[result.compliance] || '';
              if (complianceValue) {
                row.compliance = complianceValue;
              }
              if (result.conclusion) {
                row.conclusion = result.conclusion;
              }
              if (result.keyEvidencePoints && result.keyEvidencePoints.length > 0) {
                row.evidence = result.keyEvidencePoints.join('\n');
              }
              if (result.screenshots && result.screenshots.length > 0) {
                row.screenshots = row.screenshots || [];
                row.screenshotUrls = row.screenshotUrls || {};
                
                const loadPromises: Promise<void>[] = [];
                const newUrls: Record<string, string> = {};
                
                for (const s of result.screenshots) {
                  const sBasename = (s.includes('\\') ? s.split('\\').pop() : s.split('/').pop()) || s;
                  let match = batchFiles.value.find(b => 
                    b.name === s || 
                    b.path === s || 
                    b.path.endsWith('\\' + s) || 
                    b.path.endsWith('/' + s) ||
                    b.name === sBasename
                  );
                  if (!match) {
                    match = batchFiles.value.find(b => 
                      b.name.includes(sBasename) || sBasename.includes(b.name)
                    );
                  }
                  
                  if (!match) {
                    console.warn('[batchAiAnalyze] 未找到匹配的截图文件:', s, '可用文件:', batchFiles.value.map(b => b.name));
                    continue;
                  }
                  
                  const filePath = match.path;
                  
                  if (!row.screenshots.includes(filePath)) {
                    row.screenshots = [...row.screenshots, filePath];
                  }
                  
                  if (match.dataUrl && match.dataUrl.startsWith('data:image/')) {
                    newUrls[filePath] = match.dataUrl;
                  } else {
                    loadPromises.push(loadScreenshotDataUrl(row, filePath));
                  }
                }
                
                if (Object.keys(newUrls).length > 0) {
                  row.screenshotUrls = Object.assign({}, row.screenshotUrls, newUrls);
                  tableRows.value = [...tableRows.value];
                }
                
                if (loadPromises.length > 0) {
                  await Promise.all(loadPromises);
                }
              }
              appliedCount++;
            }
          }

          tableRows.value = [...tableRows.value];
          ElMessage.success(`AI分析完成，已自动填入 ${appliedCount} 条测评记录`);
          for (const result of results) {
            const row = tableRows.value.find(r => r.itemId === result.itemId);
            if (row && row.screenshots && row.screenshots.length > 0) {
              autoSaveTimer = window.setTimeout(() => saveAllRows(), 1000);
            }
          }
        } else {
          ElMessage.error('AI返回格式无法解析');
          batchAiProgress.value.stage = 'error';
          batchAiProgress.value.message = 'AI返回格式无法解析';
        }
      } else {
        ElMessage.error(res.error?.message || 'AI分析失败');
        batchAiProgress.value.stage = 'error';
        batchAiProgress.value.message = res.error?.message || 'AI分析失败';
      }
    } catch (error: any) {
      ElMessage.error('AI分析失败：' + (error.message || error));
      batchAiProgress.value.stage = 'error';
      batchAiProgress.value.message = error.message || '未知错误';
    } finally {
      batchAiLoading.value = false;
    }
  })();
}

// 知识库
const knowledgeTab = ref('command');
const knowledgeSearch = ref('');
const commandList = ref<any[]>([]);
const documentList = ref<any[]>([]);

const filteredCommands = computed(() => {
  const keyword = knowledgeSearch.value.toLowerCase();
  if (!keyword) return commandList.value;
  return commandList.value.filter(cmd =>
    cmd.title?.toLowerCase().includes(keyword) ||
    cmd.command?.toLowerCase().includes(keyword) ||
    cmd.content?.toLowerCase().includes(keyword) ||
    cmd.target?.toLowerCase().includes(keyword) ||
    cmd.os?.toLowerCase().includes(keyword) ||
    cmd.brand?.toLowerCase().includes(keyword)
  );
});

const filteredDocuments = computed(() => {
  const keyword = knowledgeSearch.value.toLowerCase();
  if (!keyword) return documentList.value;
  return documentList.value.filter(doc =>
    doc.title?.toLowerCase().includes(keyword) ||
    doc.description?.toLowerCase().includes(keyword) ||
    doc.content?.toLowerCase().includes(keyword) ||
    doc.category?.toLowerCase().includes(keyword)
  );
});

async function loadKnowledgeBase() {
  if (!window.api) return;
  try {
    if (knowledgeTab.value === 'command') {
      const res = await window.api.knowledge.listCommands({ page: 1, pageSize: 200 });
      if (res.success && res.data) {
        commandList.value = res.data.list.map((cmd: any) => ({
          id: cmd.id,
          title: cmd.name || '',
          command: cmd.command || '',
          content: cmd.description || '',
          target: cmd.target || '',
          os: cmd.os || '',
          brand: cmd.brand || '',
          category: cmd.category || '',
          subCategory: cmd.subCategory || '',
        }));
      }
    } else {
      const res = await window.api.knowledge.listDocuments({ page: 1, pageSize: 200 });
      if (res.success && res.data) {
        documentList.value = res.data.list.map((doc: any) => ({
          id: doc.id,
          title: doc.title || '',
          description: doc.description || '',
          content: doc.content || '',
          category: doc.categoryName || doc.category || '',
          _expanded: false,
        }));
      }
    }
  } catch (error) {
    console.error('加载知识库失败:', error);
  }
}

function toggleExpand(doc: any) {
  doc._expanded = !doc._expanded;
}

async function copyCommand(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败');
  }
}

function viewDocument(doc: any) {
  ElMessage.info(`文档"${doc.title}"可在知识库模块中查看`);
}

function goToPhase(phase: string) {
  const projectId = route.params.id as string;
  if (projectId) {
    router.push(`/projects/${projectId}/${phase}`);
  }
}

function toggleDomain(id: string) {
  // 全局层面直接选中，不需要展开/收起
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

// 选择全局层面（直接显示该层面所有测评项）
async function selectGlobalDomain(domainId: string) {
  console.log('[selectGlobalDomain] 被调用, domainId:', domainId);
  currentAsset.value = null;
  currentDomainId.value = domainId;

  if (!window.api) {
    console.log('[selectGlobalDomain] window.api 不存在，直接返回');
    return;
  }

  try {
    const projectId = route.params.id as string;
    const projectLevel = project.value?.level || 3;  // 默认三级
    const projectStandardId = project.value?.standardId || 'gb-t-22239-2019-l3';
    const extensionTypes = getExtensionTypeCodes(project.value?.extensionType);
    console.log('[selectGlobalDomain] projectId:', projectId, 'level:', projectLevel, 'standardId:', projectStandardId, 'extensions:', extensionTypes);

    // 加载该层面的所有测评项（根据项目等级和扩展类型筛选）
    const itemsRes = await window.api.assessment.getItems(projectStandardId, domainId, projectLevel, extensionTypes);
    console.log('[selectGlobalDomain] itemsRes:', itemsRes);
    if (!itemsRes.success || !itemsRes.data) {
      console.log('[selectGlobalDomain] 测评项查询失败或为空');
      tableRows.value = [];
      return;
    }

    const items = itemsRes.data;
    console.log('[selectGlobalDomain] 测评项数量:', items.length);

    // 加载该层面已有的全局测评记录（assetId为空的记录）
    const recordsRes = await window.api.assessment.getRecordsByDomain(projectId, domainId, projectLevel, extensionTypes);
    const existingRecords: any[] = recordsRes.success && recordsRes.data ? recordsRes.data : [];
    console.log('[selectGlobalDomain] 获取记录结果:', recordsRes.success, '记录数:', existingRecords.length);
    if (existingRecords.length > 0) {
      console.log('[selectGlobalDomain] 记录样本:', JSON.stringify(existingRecords[0]));
    }

    // 将记录按 itemId 索引
    const recordMap = new Map<string, any>();
    for (const record of existingRecords) {
      recordMap.set(record.itemId, record);
    }
    console.log('[selectGlobalDomain] recordMap大小:', recordMap.size, '测评项数量:', items.length);
    let matchedCount = 0;
    for (const item of items) {
      if (recordMap.has(item.id)) matchedCount++;
    }
    console.log('[selectGlobalDomain] 匹配到的记录数:', matchedCount);

    const complianceMap: Record<string, string> = {
      'compliant': 'conform',
      'conform': 'conform',
      'partial': 'partial',
      'non_compliant': 'nonconform',
      'nonconform': 'nonconform',
      'not_applicable': 'na',
      'na': 'na',
      'untested': '',
    };

    const methodMap: Record<string, string> = {
      'check': '核查',
      'interview': '访谈',
      'test': '测试',
    };

    // 构建表格行：每个测评项一行
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
        screenshots: record?.screenshots ? JSON.parse(record.screenshots) : [],
      };
    });
    
    for (const row of tableRows.value) {
      if (row.screenshots) {
        for (const shot of row.screenshots) {
          loadScreenshotDataUrl(row, shot);
        }
      }
    }

    // 计算控制点单元格合并
    calculateControlPointRowSpans();
  } catch (error) {
    console.error('加载全局测评项失败:', error);
  }
}

// 根据 controlPoint 合并单元格
function calculateControlPointRowSpans() {
  const rows = tableRows.value;
  if (!rows || rows.length === 0) return;

  let i = 0;
  while (i < rows.length) {
    const cp = rows[i].controlPoint;
    let j = i + 1;
    while (j < rows.length && rows[j].controlPoint === cp) {
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
async function selectAsset(asset: any) {
  currentAsset.value = asset;

  if (!window.api) return;

  try {
    const projectId = route.params.id as string;
    const domainId = asset.domainId;
    const projectLevel = project.value?.level || 3;  // 默认三级
    const projectStandardId = project.value?.standardId || 'gb-t-22239-2019-l3';
    const extensionTypes = getExtensionTypeCodes(project.value?.extensionType);

    // 加载该层面的所有测评项（根据项目等级和扩展类型筛选）
    const itemsRes = await window.api.assessment.getItems(projectStandardId, domainId, projectLevel, extensionTypes);
    if (!itemsRes.success || !itemsRes.data) {
      tableRows.value = [];
      return;
    }

    const items = itemsRes.data;

    // 加载该资产已有的测评记录
    const recordsRes = await window.api.assessment.getRecordsByAsset(projectId, asset.id);
    const existingRecords: any[] = recordsRes.success && recordsRes.data ? recordsRes.data : [];

    // 将记录按 itemId 索引
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

      // 检查是否为该资产类型的不适用项
      const assetCategory = asset.category;
      let initialCompliance = record ? (complianceMap[record.result] || '') : '';
      let initialConclusion = record?.findings || '';
      
      // 如果没有已有记录，检查是否为预设的不适用项
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
        screenshots: record?.screenshots ? JSON.parse(record.screenshots) : [],
      };
    });
    
    for (const row of tableRows.value) {
      if (row.screenshots) {
        for (const shot of row.screenshots) {
          loadScreenshotDataUrl(row, shot);
        }
      }
    }

    // 计算控制点单元格合并
    calculateControlPointRowSpans();

    updateAssetProgress(asset.id, tableRows.value);
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

async function uploadScreenshot(row: any) {
  if (!window.api) {
    ElMessage.error('上传功能不可用');
    return;
  }
  try {
    const res = await window.api.dialog.showOpenDialog({
      title: '选择文件',
      filters: [{ name: '支持的文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'pdf', 'doc', 'docx', 'md', 'txt'] }],
      properties: ['openFile', 'multiSelections'],
    });

    if (!res.success) {
      return;
    }
    if (res.data?.canceled || !res.data?.filePaths || res.data.filePaths.length === 0) {
      return;
    }

    const projectId = route.params.id as string;
    const itemId = row?.itemId || '';

    for (const filePath of res.data.filePaths) {
      const fileType = getFileType(filePath);
      let savedPath = '';
      let uploadError = '';

      if (fileType === 'image') {
        const uploadRes = await window.api.screenshot.upload({
          projectId,
          itemId,
          filePath,
        });
        if (uploadRes.success && uploadRes.data?.path) {
          savedPath = uploadRes.data.path;
          await loadScreenshotDataUrl(row, savedPath);
        } else {
          uploadError = uploadRes.error?.message || '图片上传失败';
        }
      } else {
        const uploadFileRes = await window.api.screenshot.uploadFile({
          projectId,
          itemId,
          filePath,
        });
        if (uploadFileRes.success && uploadFileRes.data?.path) {
          savedPath = uploadFileRes.data.path;
        } else {
          uploadError = uploadFileRes.error?.message || '文件上传失败';
        }
      }

      if (uploadError) {
        ElMessage.error(`${filePath.split('\\').pop()}: ${uploadError}`);
      } else if (savedPath) {
        row.screenshots = row.screenshots || [];
        if (!row.screenshots.includes(savedPath)) {
          row.screenshots.push(savedPath);
        }
        tableRows.value = [...tableRows.value];
        const fileName = savedPath.split('\\').pop()?.split('/').pop() || '文件';
        ElMessage.success(`已添加 ${fileName}`);
        debounceAutoSave(row);
      }
    }
  } catch (error: any) {
    ElMessage.error('上传失败：' + (error.message || '未知错误'));
  }
}

const screenshotLoadingLocks = new Set<string>();

async function loadScreenshotDataUrl(row: any, filePath: string) {
  if (!filePath) return;
  if (row.screenshotUrls?.[filePath] && row.screenshotUrls[filePath].startsWith('data:image/')) return;
  if (screenshotLoadingLocks.has(filePath)) return;
  
  if (!window.api) {
    console.warn('[loadScreenshotDataUrl] window.api 不可用');
    return;
  }
  
  screenshotLoadingLocks.add(filePath);
  
  try {
    console.log('[loadScreenshotDataUrl] 开始加载:', filePath);
    const res = await window.api.screenshot.getBase64({ filePath });
    if (res.success && res.data && res.data.base64) {
      const dataUrl = `data:${res.data.mimeType || 'image/png'};base64,${res.data.base64}`;
      row.screenshotUrls = Object.assign({}, row.screenshotUrls, { [filePath]: dataUrl });
      tableRows.value = [...tableRows.value];
      console.log('[loadScreenshotDataUrl] 加载成功:', filePath.substring(0, 50) + '...');
    } else {
      console.warn('[loadScreenshotDataUrl] getBase64 返回空结果:', filePath, 'success:', res.success, 'hasData:', !!res.data, 'error:', res.error?.message);
      row.screenshotUrls = Object.assign({}, row.screenshotUrls, { [filePath]: 'error' });
    }
  } catch (error) {
    console.error('[loadScreenshotDataUrl] 读取截图失败:', filePath, error);
    row.screenshotUrls = Object.assign({}, row.screenshotUrls, { [filePath]: 'error' });
  } finally {
    screenshotLoadingLocks.delete(filePath);
  }
}

function getScreenshotSrc(row: any, filePath: string): string {
  return row.screenshotUrls?.[filePath] || '';
}

function getScreenshotState(row: any, filePath: string): 'loaded' | 'error' | 'loading' {
  const val = row.screenshotUrls?.[filePath];
  if (!val) return 'loading';
  if (val === 'error') return 'error';
  if (val.startsWith('data:image/')) return 'loaded';
  return 'loading';
}

function previewScreenshot(_row: any, path: string) {
  const fileType = getFileType(path);
  const fileInfo = { name: path.split('\\').pop()?.split('/').pop() || path, path, fileType };
  openFilePreview(fileInfo);
}

async function openFilePreview(fileInfo: { name: string; path: string; fileType: string }) {
  previewFile.value = fileInfo;
  previewFileSrc.value = '';
  previewError.value = '';
  previewLoading.value = true;
  previewDialogVisible.value = true;
  
  if (fileInfo.fileType === 'word') {
    previewLoading.value = false;
    return;
  }
  
  if (fileInfo.fileType === 'text') {
    try {
      const res = await window.api.screenshot.readText({ filePath: fileInfo.path });
      if (res.success && res.data) {
        previewTextContent.value = res.data.content;
      } else {
        previewError.value = '无法读取文本文件';
      }
    } catch {
      previewError.value = '无法读取文本文件';
    } finally {
      previewLoading.value = false;
    }
    return;
  }
  
  try {
    const res = await window.api.screenshot.getBase64({ filePath: fileInfo.path });
    if (res.success && res.data?.base64) {
      const mimeType = res.data.mimeType || (fileInfo.fileType === 'pdf' ? 'application/pdf' : 'image/png');
      previewFileSrc.value = `data:${mimeType};base64,${res.data.base64}`;
    } else {
      previewError.value = '无法加载文件';
    }
  } catch (error: any) {
    previewError.value = '文件加载失败：' + (error.message || '未知错误');
  } finally {
    previewLoading.value = false;
  }
}

function openFileExternal(file: any) {
  if (!file?.path) return;
  try {
    if (window.api?.shell?.openPath) {
      window.api.shell.openPath(file.path);
    } else {
      ElMessage.warning('无法打开文件');
    }
  } catch {
    ElMessage.warning('无法打开文件');
  }
}

async function removeScreenshot(row: any, index: number) {
  const filePath = row.screenshots[index];
  row.screenshots.splice(index, 1);
  if (row.screenshotUrls) {
    delete row.screenshotUrls[filePath];
  }
  if (filePath && window.api) {
    try {
      await window.api.screenshot.deleteFile({ filePath });
    } catch (e) {
      console.warn('删除文件失败:', e);
    }
  }
  debounceAutoSave(row);
}

function aiAnalyze(row: any) {
  if (!aiConsentGiven.value) {
    aiCurrentRow.value = row;
    aiConsentPendingAction.value = 'single';
    showAiConsentDialog.value = true;
    return;
  }
  executeAiAnalyze(row);
}

async function executeAiAnalyze(row: any) {
  if (!window.api) {
    ElMessage.error('AI功能不可用');
    return;
  }

  const hasScreenshots = row.screenshots && row.screenshots.length > 0;
  const hasEvidence = row.evidence && row.evidence.trim().length > 0;
  if (!hasEvidence && !hasScreenshots) {
    ElMessage.warning('请先在关键证据点中填写内容或上传截图');
    return;
  }

  aiCurrentRow.value = row;
  aiAnalysisResult.value = null;
  aiDialogVisible.value = true;
  aiLoading.value = true;
  aiStep.value = 1;
  aiLoadingText.value = '正在准备分析数据...';

  try {
    await new Promise(resolve => setTimeout(resolve, 400));
    aiStep.value = 2;
    aiLoadingText.value = hasScreenshots ? 'AI正在识别截图内容...' : 'AI正在分析关键证据点...';

    await new Promise(resolve => setTimeout(resolve, 400));
    aiStep.value = 3;
    aiLoadingText.value = 'AI正在提取关键证据点...';

    await new Promise(resolve => setTimeout(resolve, 400));
    aiStep.value = 4;
    aiLoadingText.value = 'AI正在判定合规性...';

    await new Promise(resolve => setTimeout(resolve, 400));
    aiStep.value = 5;
    aiLoadingText.value = 'AI正在生成详实测评结论...';

    const params = {
      controlPoint: row.controlPoint || '',
      requirement: row.requirement || '',
      command: '',
      result: row.evidence || '',
      screenshots: (row.screenshots || []).filter((s: any) => typeof s === 'string' && s.length > 0),
    };
    console.log('[aiAnalyze] 准备调用, params:', JSON.stringify({
      ...params,
      screenshots: params.screenshots.length + ' items',
    }));
    
    let res;
    try {
      const timeoutMs = 120000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('AI分析超时，请检查网络连接或稍后重试')), timeoutMs);
      });
      res = await Promise.race([
        window.api.ai.analyzeAssessment(params),
        timeoutPromise,
      ]);
    } catch (ipcError: any) {
      console.error('[aiAnalyze] IPC调用失败:', ipcError.message, ipcError.stack);
      throw ipcError;
    }
    
    console.log('[aiAnalyze] IPC调用成功, success:', res?.success, 'hasData:', !!res?.data);

    aiStep.value = 6;

    if (res.success && res.data) {
      try {
        const content = res.data.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          aiAnalysisResult.value = {
            controlPoint: row.controlPoint || '',
            requirement: row.requirement || '',
            evidence: row.evidence || '',
            actualOutput: analysis.actualOutput || row.evidence || '',
            keyEvidencePoints: analysis.keyEvidencePoints || [],
            compliance: analysis.compliance || '待判定',
            conclusion: analysis.conclusion || '',
          };
          aiLoading.value = false;
        } else {
          aiAnalysisResult.value = {
            controlPoint: row.controlPoint || '',
            requirement: row.requirement || '',
            evidence: row.evidence || '',
            actualOutput: row.evidence || '',
            keyEvidencePoints: [],
            compliance: '待判定',
            conclusion: content,
          };
          aiLoading.value = false;
        }
      } catch {
        aiAnalysisResult.value = {
          controlPoint: row.controlPoint || '',
          requirement: row.requirement || '',
          evidence: row.evidence || '',
          actualOutput: row.evidence || '',
          keyEvidencePoints: [],
          compliance: '待判定',
          conclusion: res.data.content,
        };
        aiLoading.value = false;
      }
    } else {
      aiLoading.value = false;
      ElMessage.error(res.error?.message || 'AI分析失败');
    }
  } catch (error: any) {
    aiLoading.value = false;
    ElMessage.error('AI分析失败：' + (error.message || error));
  }
}

function applyAiResult() {
  if (!aiCurrentRow.value || !aiAnalysisResult.value) return;

  const row = aiCurrentRow.value;
  const result = aiAnalysisResult.value;

  const resultMap: Record<string, string> = {
    '符合': 'conform',
    '部分符合': 'partial',
    '不符合': 'nonconform',
    '不适用': 'na',
  };

  row.compliance = resultMap[result.compliance] || '';
  row.conclusion = result.conclusion || '';

  if (result.keyEvidencePoints && result.keyEvidencePoints.length > 0) {
    const existingEvidence = row.evidence ? row.evidence + '\n' : '';
    const newPoints = result.keyEvidencePoints
      .filter((p: string) => !row.evidence?.includes(p))
      .join('\n');
    if (newPoints) {
      row.evidence = existingEvidence + newPoints;
    }
  }

  aiDialogVisible.value = false;
  ElMessage.success('AI分析结果已填入记录表');
}

async function saveClipboardImage(row: any, blob: Blob) {
  if (!window.api) {
    ElMessage.error('截图功能不可用');
    return;
  }

  try {
    const reader = new FileReader();
    const base64Data: string = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const projectId = route.params.id as string;
    const itemId = row?.itemId || 'general';

    const res = await window.api.screenshot.saveFromBase64({
      projectId,
      itemId,
      base64Data,
    });

    if (res.success && res.data) {
      if (!row.screenshots) {
        row.screenshots = [];
      }
      row.screenshots.push(res.data.path);
      await loadScreenshotDataUrl(row, res.data.path);
      ElMessage.success('图片已粘贴');
      debounceAutoSave(row);
    } else {
      throw new Error(res.error?.message || '保存失败');
    }
  } catch (error: any) {
    console.error('保存粘贴图片失败:', error);
    const msg = error?.message || error?.error?.message || '未知错误';
    ElMessage.error('图片粘贴失败: ' + msg);
  }
}

function setupGlobalPasteHandler() {
  document.addEventListener('paste', async (event: ClipboardEvent) => {
    if (tableRows.value.length === 0) return;
    const currentRow = tableRows.value[currentRowIndex.value];
    if (!currentRow) return;

    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;

    // 检查剪贴板是否包含文本（如Excel复制时会同时包含文本和图片）
    const hasText = event.clipboardData?.getData('text/plain')?.trim();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        // 如果剪贴板包含文本，说明可能是Excel复制，不自动粘贴图片
        if (hasText) continue;

        event.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          await saveClipboardImage(currentRow, blob);
        }
        return;
      }
    }

    const target = event.target as HTMLElement;
    const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    if (isEditable) return;

    const text = event.clipboardData?.getData('text/plain');
    if (text) {
      event.preventDefault();
      if (currentRow.evidence) {
        currentRow.evidence += '\n' + text;
      } else {
        currentRow.evidence = text;
      }
      ElMessage.success('已粘贴到关键证据点');
    }
  });
}

function quoteCommand(cmd: any) {
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

async function loadProgress() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  const res = await window.api.assessment.getProgress(projectId, project.value?.standardId || 'gb-t-22239-2019-l3');
  if (res.success && res.data) {
    progress.value = res.data;
  }
}

async function handleExportCommand(command: string) {
  if (command === 'excel') {
    const projectId = route.params.id as string;
    if (!projectId || !window.api) return;
    
    // 打开导出选择弹窗
    exportDialogVisible.value = true;
    loadExportSelection();
  } else if (command === 'pdf') {
    ElMessage.info('PDF导出功能开发中');
  }
}

// 导出选择弹窗
const exportDialogVisible = ref(false);
const selectedExportItems = ref<string[]>([]);
const expandedExportDomains = ref<string[]>([]);
const exporting = ref(false);

// 导入选择弹窗
const importDialogVisible = ref(false);
const selectedImportItems = ref<string[]>([]);
const expandedImportDomains = ref<string[]>([]);
const importing = ref(false);

const exportTreeData = computed(() => {
  return treeData.value.map(domain => ({
    id: domain.id,
    label: domain.label,
    children: domain.children || [],
  }));
});

const totalCount = computed(() => {
  let count = 0;
  for (const domain of exportTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      count++;
    } else {
      count += domain.children.length;
    }
  }
  return count;
});

const selectedTotalCount = computed(() => selectedExportItems.value.length);

const isAllSelected = computed(() => {
  return selectedExportItems.value.length === totalCount.value && totalCount.value > 0;
});

const isIndeterminate = computed(() => {
  return selectedExportItems.value.length > 0 && selectedExportItems.value.length < totalCount.value;
});

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedExportItems.value = [];
  } else {
    const allItems: string[] = [];
    for (const domain of exportTreeData.value) {
      if (!domain.children || domain.children.length === 0) {
        allItems.push(`domain:${domain.id}`);
      } else {
        for (const child of domain.children) {
          allItems.push(`asset:${child.id}`);
        }
      }
    }
    selectedExportItems.value = allItems;
  }
}

function isDomainAllSelected(domain: any) {
  if (!domain.children || domain.children.length === 0) {
    return selectedExportItems.value.includes(`domain:${domain.id}`);
  }
  return domain.children.every((child: any) => selectedExportItems.value.includes(`asset:${child.id}`));
}

function isDomainIndeterminate(domain: any) {
  if (!domain.children || domain.children.length === 0) return false;
  const selected = domain.children.filter((child: any) => selectedExportItems.value.includes(`asset:${child.id}`)).length;
  return selected > 0 && selected < domain.children.length;
}

function getDomainSelectedCount(domain: any) {
  if (!domain.children || domain.children.length === 0) return 0;
  return domain.children.filter((child: any) => selectedExportItems.value.includes(`asset:${child.id}`)).length;
}

function toggleDomainSelectAll(domain: any) {
  if (!domain.children || domain.children.length === 0) {
    const key = `domain:${domain.id}`;
    const idx = selectedExportItems.value.indexOf(key);
    if (idx > -1) {
      selectedExportItems.value.splice(idx, 1);
    } else {
      selectedExportItems.value.push(key);
    }
  } else {
    const allSelected = isDomainAllSelected(domain);
    if (allSelected) {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        const idx = selectedExportItems.value.indexOf(key);
        if (idx > -1) selectedExportItems.value.splice(idx, 1);
      }
    } else {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        if (!selectedExportItems.value.includes(key)) {
          selectedExportItems.value.push(key);
        }
      }
    }
  }
}

function toggleExportDomain(domainId: string) {
  const idx = expandedExportDomains.value.indexOf(domainId);
  if (idx > -1) {
    expandedExportDomains.value.splice(idx, 1);
  } else {
    expandedExportDomains.value.push(domainId);
  }
}

function loadExportSelection() {
  const allItems: string[] = [];
  for (const domain of exportTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      allItems.push(`domain:${domain.id}`);
    } else {
      for (const child of domain.children) {
        allItems.push(`asset:${child.id}`);
      }
    }
  }
  selectedExportItems.value = allItems;
  
  // 展开有资产的层面
  const domainsWithAssets = exportTreeData.value.filter(d => d.children && d.children.length > 0);
  expandedExportDomains.value = domainsWithAssets.map(d => d.id);
}

// 导入选择相关
const importTreeData = computed(() => {
  return treeData.value.map(domain => ({
    id: domain.id,
    label: domain.label,
    children: domain.children || [],
  }));
});

const importTotalCount = computed(() => {
  let count = 0;
  for (const domain of importTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      count++;
    } else {
      count += domain.children.length;
    }
  }
  return count;
});

const isImportAllSelected = computed(() => {
  return selectedImportItems.value.length === importTotalCount.value && importTotalCount.value > 0;
});

const isImportIndeterminate = computed(() => {
  return selectedImportItems.value.length > 0 && selectedImportItems.value.length < importTotalCount.value;
});

function toggleImportSelectAll() {
  if (isImportAllSelected.value) {
    selectedImportItems.value = [];
  } else {
    const allItems: string[] = [];
    for (const domain of importTreeData.value) {
      if (!domain.children || domain.children.length === 0) {
        allItems.push(`domain:${domain.id}`);
      } else {
        for (const child of domain.children) {
          allItems.push(`asset:${child.id}`);
        }
      }
    }
    selectedImportItems.value = allItems;
  }
}

function isImportDomainAllSelected(domain: any) {
  if (!domain.children || domain.children.length === 0) {
    return selectedImportItems.value.includes(`domain:${domain.id}`);
  }
  return domain.children.every((child: any) => selectedImportItems.value.includes(`asset:${child.id}`));
}

function isImportDomainIndeterminate(domain: any) {
  if (!domain.children || domain.children.length === 0) return false;
  const selected = domain.children.filter((child: any) => selectedImportItems.value.includes(`asset:${child.id}`)).length;
  return selected > 0 && selected < domain.children.length;
}

function getImportDomainSelectedCount(domain: any) {
  if (!domain.children || domain.children.length === 0) return 0;
  return domain.children.filter((child: any) => selectedImportItems.value.includes(`asset:${child.id}`)).length;
}

function toggleImportDomainSelectAll(domain: any) {
  if (!domain.children || domain.children.length === 0) {
    const key = `domain:${domain.id}`;
    const idx = selectedImportItems.value.indexOf(key);
    if (idx > -1) {
      selectedImportItems.value.splice(idx, 1);
    } else {
      selectedImportItems.value.push(key);
    }
  } else {
    const allSelected = isImportDomainAllSelected(domain);
    if (allSelected) {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        const idx = selectedImportItems.value.indexOf(key);
        if (idx > -1) selectedImportItems.value.splice(idx, 1);
      }
    } else {
      for (const child of domain.children) {
        const key = `asset:${child.id}`;
        if (!selectedImportItems.value.includes(key)) {
          selectedImportItems.value.push(key);
        }
      }
    }
  }
}

function toggleImportDomain(domainId: string) {
  const idx = expandedImportDomains.value.indexOf(domainId);
  if (idx > -1) {
    expandedImportDomains.value.splice(idx, 1);
  } else {
    expandedImportDomains.value.push(domainId);
  }
}

function loadImportSelection() {
  const allItems: string[] = [];
  for (const domain of importTreeData.value) {
    if (!domain.children || domain.children.length === 0) {
      allItems.push(`domain:${domain.id}`);
    } else {
      for (const child of domain.children) {
        allItems.push(`asset:${child.id}`);
      }
    }
  }
  selectedImportItems.value = allItems;
  
  const domainsWithAssets = importTreeData.value.filter(d => d.children && d.children.length > 0);
  expandedImportDomains.value = domainsWithAssets.map(d => d.id);
}

async function confirmExport() {
  if (selectedExportItems.value.length === 0) {
    ElMessage.warning('请至少选择一项导出内容');
    return;
  }
  
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  
  const domainIds: string[] = [];
  const assetIds: string[] = [];
  
  for (const item of selectedExportItems.value) {
    if (item.startsWith('domain:')) {
      domainIds.push(item.substring(7));
    } else if (item.startsWith('asset:')) {
      assetIds.push(item.substring(6));
    }
  }
  
  exporting.value = true;
  try {
    const res = await window.api.assessment.exportExcelByAssets(projectId, assetIds, domainIds);
    if (res.success) {
      ElMessage.success('导出成功');
      exportDialogVisible.value = false;
    } else if (res.error?.message !== '用户取消') {
      ElMessage.error(res.error?.message || '导出失败');
    }
  } catch (error: any) {
    console.error('导出失败:', error);
    ElMessage.error(error?.message || error?.toString() || '导出失败');
  } finally {
    exporting.value = false;
  }
}

// 导入测评结果
function handleImportExcel() {
  importDialogVisible.value = true;
  loadImportSelection();
}

async function confirmImport() {
  if (selectedImportItems.value.length === 0) {
    ElMessage.warning('请至少选择一项导入内容');
    return;
  }

  const projectId = route.params.id as string;
  if (!projectId || !window.api) {
    ElMessage.error('项目ID缺失或API未初始化');
    return;
  }

  try {
    const fileRes = await window.api.system.selectFile([
      { name: 'Excel文件', extensions: ['xlsx', 'xls'] },
    ]);
    if (!fileRes.success || !fileRes.data) return;

    const domainIds: string[] = [];
    const assetIds: string[] = [];
    for (const item of selectedImportItems.value) {
      if (item.startsWith('domain:')) {
        domainIds.push(item.substring(7));
      } else if (item.startsWith('asset:')) {
        assetIds.push(item.substring(6));
      }
    }

    importing.value = true;
    const res = await window.api.assessment.importExcel(projectId, fileRes.data, domainIds, assetIds);
    importing.value = false;

    if (res.success && res.data) {
      ElMessage.success(`成功导入 ${res.data.count} 条记录`);
      importDialogVisible.value = false;
      await loadProject();
      await loadAssetTree();
      await loadProgress();
    }
  } catch (error: any) {
    importing.value = false;
    ElMessage.error(error.message || '导入失败');
  }
}

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

async function loadProject() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  const res = await window.api.project.get(projectId);
  if (res.success) {
    project.value = res.data;
  }
}

// 加载测评对象树（按十大安全层面组织）
async function loadAssetTree() {
  if (!window.api) return;
  const projectId = route.params.id as string;
  if (!projectId) return;

  try {
    // 获取所有测评对象（isAssessmentTarget = true）
    const res = await window.api.asset.list({
      projectId,
      page: 1,
      pageSize: 500,
    });

    if (res.success && res.data) {
      const assets = res.data.list.filter((a: any) => a.isAssessmentTarget);

      // 按安全层面分组
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

      // 构建十大层面树结构
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

      // 展开有资产的第一个层面
      const firstDomainWithAssets = treeData.value.find(d => d.children && d.children.length > 0);
      if (firstDomainWithAssets) {
        expandedDomains.value = [firstDomainWithAssets.id];
      }

      // 自动选中第一个测评对象
      if (assets.length > 0 && !currentAsset.value) {
        const firstAsset = (firstDomainWithAssets?.children?.[0]) || assets[0];
        selectAsset(firstAsset);
      }
    }
  } catch (error) {
    console.error('加载测评对象失败:', error);
  }
}

onMounted(async () => {
  await loadProject();
  await loadAssetTree();
  await loadProgress();
  await loadKnowledgeBase();
  setupGlobalPasteHandler();
  window.api?.ai.onAnalysisProgress((data: any) => {
    batchAiProgress.value.percent = data.percent || 0;
    batchAiProgress.value.message = data.message || '';
    batchAiProgress.value.stage = data.stage || '';
    if (data.stage === 'done') {
      if (batchAiMinimized.value) {
        batchAiMinimized.value = false;
        ElMessage.success('AI批量分析已完成！');
      }
      setTimeout(() => { batchAiProgress.value.visible = false; }, 800);
    }
  });

  // 启动周期性备份保存
  startPeriodicSave();

  // Ctrl+S 快捷键
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      triggerManualSave();
    }
    // Delete/Backspace 清空选中单元格
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCells.value.size > 0) {
      // 如果焦点在input/textarea内且内容不为空，不处理（让用户正常编辑）
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        const inputEl = activeEl as HTMLInputElement | HTMLTextAreaElement;
        if (inputEl.value && inputEl.value.length > 0) return;
      }
      e.preventDefault();
      clearSelectedCells();
    }
    // Escape 取消选中
    if (e.key === 'Escape' && selectedCells.value.size > 0) {
      selectedCells.value.clear();
      selectionAnchor.value = null;
    }
  };
  document.addEventListener('keydown', handleKeyDown);

  // 关闭页面前未保存警告
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (hasUnsavedChanges.value) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', handleBeforeUnload);

  // 清理函数
  onBeforeUnmount(() => {
    stopPeriodicSave();
    document.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  });
});

onUpdated(() => {
  // 自动调整所有textarea高度以适应内容
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
  height: 44px;
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
  height: 48px;
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

    &.primary {
      border: none;
      background: var(--color-primary, #1B5FD9);
      color: #fff;
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
  width: 220px;
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
    min-width: 196px;

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
        background: var(--color-primary-light, #E8F0FE);
        color: var(--color-primary, #1B5FD9);
        font-weight: 500;

        .tree-icon {
          color: var(--color-primary, #1B5FD9);
        }
      }
    }

    .tree-chevron {
      color: var(--color-text-tertiary, #9CA3AF);
      transition: transform 0.2s;

      &.expanded {
        transform: rotate(90deg);
      }
    }

    .tree-icon {
      color: var(--color-text-secondary, #4B5563);
    }

    .tree-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .tree-children {
    padding-left: 22px;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-text-secondary, #4B5563);

    &:hover {
      background: var(--color-bg-page, #F5F6FA);
    }

    &.active {
      background: var(--color-primary-light, #E8F0FE);
      color: var(--color-primary, #1B5FD9);
      font-weight: 500;
    }

    .item-icon {
      color: var(--color-text-tertiary, #9CA3AF);
    }

    .tree-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tree-count {
      font-size: 11px;
      color: var(--color-text-tertiary, #9CA3AF);
      white-space: nowrap;

      &.count-complete {
        color: var(--color-success, #10B981);
      }
    }
  }
}

// 面板折叠按钮
.toggle-btn-left {
  position: absolute;
  left: 220px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default, #E5E7EB);
  border-left: none;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
  z-index: 10;
  font-size: 14px;
  color: var(--color-text-tertiary, #9CA3AF);
  transition: background 0.15s, color 0.15s, left 0.2s ease;

  &:hover {
    background: var(--color-primary-light, #E8F0FE);
    color: var(--color-primary, #1B5FD9);
  }
}

.left-panel.collapsed + .toggle-btn-left {
  left: 0;
  border-left: 1px solid var(--color-border-default, #E5E7EB);
  border-radius: 0 4px 4px 0;
}

// 中栏
.center-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 14px 20px;
    background: var(--color-bg-page, #F5F6FA);

    .section-title-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      flex-shrink: 0;

      .section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        white-space: nowrap;
      }

      .section-actions {
        display: flex;
        gap: 6px;
      }

      .section-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 10px;
        border: 1px solid var(--color-border-default, #E5E7EB);
        border-radius: 4px;
        background: var(--color-bg-card);
        color: var(--color-text-secondary, #4B5563);
        font-size: 12px;
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
            background: #1648C4;
          }
        }
      }
    }

    .batch-screenshot-bar {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border-default, #E5E7EB);
      border-radius: 4px;
      margin-bottom: 10px;
      flex-shrink: 0;
      
      &.collapsed {
        padding: 6px 12px;
        text-align: center;
        font-size: 12px;
        color: var(--color-text-secondary, #4B5563);
        cursor: pointer;
        background: var(--color-bg-page, #F5F6FA);
        
        &:hover {
          background: var(--color-bg-hover, #E8EEF9);
        }
      }
      
      .batch-screenshot-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-bottom: 1px solid var(--color-border-light, #F0F1F5);
        
        .batch-screenshot-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-primary, #111827);
        }
        
        .batch-screenshot-actions {
          display: flex;
          gap: 8px;
          
          .mini-btn {
            background: none;
            border: none;
            color: var(--color-text-secondary, #4B5563);
            font-size: 12px;
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            
            &:hover {
              color: var(--color-primary, #1B5FD9);
              background: var(--color-bg-hover, #E8EEF9);
            }
          }
        }
      }
      
      .batch-screenshot-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 8px 10px;
        max-height: 140px;
        overflow-y: auto;
      }
      
      .batch-screenshot-item {
        position: relative;
        width: 90px;
        height: 90px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--color-border-default, #E5E7EB);
        background: var(--color-bg-page, #F5F6FA);
        
        .batch-thumb {
          width: 100%;
          height: 70px;
          object-fit: cover;
          display: block;
        }

        .batch-file-icon {
          width: 100%;
          height: 70px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--color-bg-page, #F5F6FA);

          .batch-file-ext {
            font-size: 9px;
            font-weight: 700;
            color: var(--color-text-secondary, #4B5563);
            margin-top: 2px;
          }
        }
        
        .batch-screenshot-name {
          display: block;
          font-size: 10px;
          color: var(--color-text-secondary, #4B5563);
          text-align: center;
          padding: 2px 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          background: var(--color-bg-card);
          border-top: 1px solid var(--color-border-light, #F0F1F5);
        }
        
        .batch-screenshot-del {
          position: absolute;
          top: 2px;
          right: 2px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.6);
          color: #fff;
          border: none;
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          
          &:hover {
            background: rgba(220, 38, 38, 0.9);
          }
        }
      }
    }

  .table-container {
    flex: 1;
    overflow: auto;
    border: 1px solid var(--color-border-dark, #D1D5DB);
    border-radius: 0;
    background: var(--color-bg-card);
  }

  .excel-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    min-width: 1200px;
    font-size: 12px;

    thead tr {
      background: var(--color-bg-hover);
      position: sticky;
      top: 0;
      z-index: 1;

      th {
        padding: 8px 10px;
        font-weight: 600;
        font-size: 12px;
        color: var(--color-text-primary, #111827);
        text-align: center;
        border: 1px solid #D1D5DB;
        border-bottom: 2px solid #9CA3AF;
        white-space: nowrap;
        background: transparent;
      }
    }

    tbody tr {
      background: var(--color-bg-card);
      transition: background 0.15s;
      cursor: pointer;

      &:hover {
        background: var(--color-primary-light);

        .cell-control {
          background: var(--color-primary-light);
        }
      }

      &.active {
        background: var(--color-primary-light);

        .cell-control {
          background: var(--color-primary-light);
        }
      }

      &.extension-divider {
        td {
          border-top: 3px solid #18A957;
        }
      }

      td {
        padding: 6px 10px;
        border: 1px solid #D1D5DB;
        vertical-align: top;
      }

      .cell-control {
        background: var(--color-bg-page, #F5F6FA);
        color: var(--color-text-secondary, #4B5563);
        font-size: 11px;
        font-weight: 500;
        text-align: center;
        vertical-align: middle;
      }

      .cell-requirement {
        color: var(--color-text-primary, #1F2937);
        font-size: 12px;
        line-height: 1.5;
      }

      .cell-command, .cell-result {
        font-family: var(--font-family-mono, monospace);
      }

      .cell-compliance {
        text-align: center;
        vertical-align: middle;
      }

      // 单元格多选样式
      td.selected {
        background: rgba(37, 99, 235, 0.03) !important;
        outline: 1px solid rgba(37, 99, 235, 0.25);
        outline-offset: -1px;

        &.selection-anchor {
          outline: 1px solid rgba(37, 99, 235, 0.4);
          background: rgba(37, 99, 235, 0.05) !important;
        }

        .cell-textarea.cell-selected,
        .compliance-select.cell-selected {
          background: transparent;
        }
      }

      .cell-actions {
        text-align: center;
        vertical-align: middle;
        white-space: nowrap;
        background: var(--color-bg-page, #F5F6FA);
      }
    }
  }

  .cell-input {
    width: 100%;
    height: 26px;
    padding: 0 6px;
    border: none;
    outline: none;
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    background: transparent;
    font-family: inherit;

    &.mono {
      font-family: var(--font-family-mono, monospace);
    }

    &::placeholder {
      color: var(--color-text-tertiary, #9CA3AF);
    }
  }

  .cell-textarea {
    width: 100%;
    border: none;
    outline: none;
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    background: transparent;
    resize: none;
    line-height: 1.6;
    font-family: inherit;
    padding: 0;

    &.mono {
      font-family: var(--font-family-mono, monospace);
      font-size: 11px;
    }

    &.result-box {
      min-height: 72px;
      max-height: 120px;
      overflow-y: auto;
      padding: 6px 8px;
      background: var(--color-bg-base);
      border: 1px solid #F0F0F0;
      color: var(--color-text-secondary, #4B5563);
    }

    &.conclusion-box {
      min-height: 60px;
      padding: 4px 6px;
      overflow-y: hidden;
    }

    &.evidence-box {
      min-height: 80px;
      padding: 6px 8px;
      overflow-y: hidden;
    }
  }

  .screenshot-area {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;

    .screenshot-thumb {
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--color-border-default, #E5E7EB);
      cursor: pointer;
      flex-shrink: 0;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .thumb-loading {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg-base);
        color: #9ca3af;

        .spin {
          animation: spin 1s linear infinite;
        }
      }

      .thumb-error {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-danger-light);
        color: #DC2626;
        font-size: 9px;
        font-weight: 500;
      }

      .file-thumb-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg-base);
        color: #6b7280;
        font-size: 10px;
        font-weight: 600;
      }

      .remove-shot {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 16px;
        height: 16px;
        background: #EF4444;
        color: #fff;
        border-radius: 50%;
        font-size: 12px;
        line-height: 14px;
        text-align: center;
        display: none;
      }

      &:hover .remove-shot {
        display: block;
      }
    }
  }

  .screenshot-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    padding: 3px 8px;
    background: var(--color-bg-card);
    border: 1px dashed var(--color-border-default, #E5E7EB);
    border-radius: 4px;
    color: var(--color-text-tertiary, #9CA3AF);
    font-size: 11px;
    cursor: pointer;

    &:hover {
      border-color: var(--color-primary, #1B5FD9);
      color: var(--color-primary, #1B5FD9);
    }
  }

  &::placeholder {
    color: var(--color-text-tertiary, #9CA3AF);
  }

  .method-select, .compliance-select {
    width: 100%;
    height: 26px;
    padding: 0 4px;
    border: none;
    outline: none;
    font-size: 12px;
    background: transparent;
    cursor: pointer;
    text-align: center;
    appearance: none;
    color: var(--color-text-primary, #111827);

    &.conform {
      color: #16A34A;
      font-weight: 600;
    }

    &.nonconform {
      color: #DC2626;
      font-weight: 600;
    }

    &.partial {
      color: #D97706;
      font-weight: 600;
    }

    &.na {
      color: #6B7280;
      font-weight: 500;
    }
  }

  .action-btn {
    width: 24px;
    height: 24px;
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: 4px;
    background: var(--color-bg-card);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    margin-right: 3px;
    color: var(--color-text-tertiary, #9CA3AF);
    transition: all 0.15s;

    &.ai {
      color: var(--color-primary, #1B5FD9);

      &:hover {
        background: var(--color-primary-light, #E8F0FE);
        border-color: var(--color-primary, #1B5FD9);
      }
    }

    &.add {
      color: var(--color-text-secondary, #4B5563);

      &:hover {
        background: var(--color-bg-page, #F5F6FA);
        border-color: var(--color-border-default, #D1D5DB);
      }
    }
  }

  .table-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    flex-shrink: 0;

    .add-row-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 10px;
      border: 1px dashed var(--color-border-default, #E5E7EB);
      border-radius: 4px;
      background: transparent;
      color: var(--color-text-secondary, #4B5563);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;

      &:hover {
        border-color: var(--color-primary, #1B5FD9);
        color: var(--color-primary, #1B5FD9);
        background: var(--color-primary-light, #E8F0FE);
      }
    }

    .row-count {
      font-size: 12px;
      color: var(--color-text-tertiary, #9CA3AF);
    }
  }
}

// 右栏
.right-panel {
  width: 280px;
  flex-shrink: 0;
  background: var(--color-bg-card);
  border-left: 1px solid var(--color-border-default, #E5E7EB);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;

  &.collapsed {
    width: 0;
    border-left: none;

    .panel-header,
    .knowledge-tabs,
    .panel-search,
    .knowledge-list {
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.1s ease, visibility 0.1s ease;
    }
  }

  .panel-header {
    padding: 16px 16px 0;
    flex-shrink: 0;
    transition: opacity 0.1s ease, visibility 0.1s ease;
    min-width: 248px;

    .panel-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary, #111827);
      margin-bottom: 12px;
    }
  }

  .knowledge-tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border-light, #F0F0F3);
    padding: 0 16px;
    flex-shrink: 0;
    transition: opacity 0.1s ease, visibility 0.1s ease;
    min-width: 248px;

    .tab-btn {
      flex: 1;
      height: 40px;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--color-text-secondary, #4B5563);
      font-size: 12px;
      cursor: pointer;

      &.active {
        border-bottom-color: var(--color-primary, #1B5FD9);
        color: var(--color-primary, #1B5FD9);
        font-weight: 500;
      }
    }
  }

  .panel-search {
    padding: 12px 16px 8px;
    position: relative;
    flex-shrink: 0;
    transition: opacity 0.1s ease, visibility 0.1s ease;
    min-width: 248px;

    .search-icon {
      position: absolute;
      left: 26px;
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

  .knowledge-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: opacity 0.1s ease, visibility 0.1s ease;
    min-width: 248px;
  }

  /* 核查命令卡片 - 简洁列表式 */
  .command-card {
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--color-bg-card);
    cursor: pointer;
    transition: all 0.15s;
    position: relative;

    &:hover {
      border-color: var(--color-primary, #1B5FD9);
      background: var(--color-primary-light);
      box-shadow: 0 1px 4px rgba(27, 95, 217, 0.08);
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 4px;

      .card-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .card-badge {
        flex-shrink: 0;
        font-size: 9px;
        color: #6B7280;
        background: var(--color-bg-base);
        padding: 1px 5px;
        border-radius: 2px;
        line-height: 1.4;
      }
    }

    .card-code {
      font-size: 11px;
      font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
      color: #374151;
      background: var(--color-bg-base);
      border: 1px solid #F3F4F6;
      border-radius: 3px;
      padding: 4px 6px;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }

    .card-desc {
      font-size: 10px;
      color: #9CA3AF;
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card-actions {
      position: absolute;
      top: 6px;
      right: 6px;
      display: none;
      gap: 2px;
      background: rgba(255, 255, 255, 0.95);
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
      padding: 2px;

      button {
        font-size: 10px;
        padding: 2px 8px;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-weight: 500;
        white-space: nowrap;
        transition: background 0.1s;
      }

      .btn-quote {
        color: #fff;
        background: var(--color-primary, #1B5FD9);
        &:hover { background: #1748B8; }
      }

      .btn-copy {
        color: #4B5563;
        background: #E5E7EB;
        &:hover { background: #D1D5DB; }
      }
    }

    &:hover .card-actions {
      display: flex;
    }
  }

  /* 作业指导书卡片 - 保持原有样式 */
  .document-card {
    border: 1px solid var(--color-border-default, #E5E7EB);
    border-radius: 8px;
    overflow: hidden;
    background: var(--color-bg-card);
    transition: box-shadow 0.2s, border-color 0.2s;

    &:hover {
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
      border-color: var(--color-border-hover, #D1D5DB);
    }

    .doc-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 10px 12px 4px;

      .doc-card-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .doc-card-category {
        flex-shrink: 0;
        font-size: 10px;
        color: #92400E;
        background: var(--color-warning-light);
        padding: 1px 6px;
        border-radius: 3px;
      }
    }

    .doc-card-summary {
      font-size: 11px;
      color: var(--color-text-tertiary, #9CA3AF);
      padding: 0 12px 4px;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .doc-card-preview {
      padding: 0 12px 6px;

      .preview-content {
        font-size: 11px;
        color: var(--color-text-secondary, #4B5563);
        background: var(--color-bg-base);
        border: 1px solid var(--color-border-light, #F0F0F3);
        border-radius: 4px;
        padding: 8px 10px;
        line-height: 1.6;
        max-height: 60px;
        overflow: hidden;
        position: relative;
        transition: max-height 0.3s ease;

        &.expanded {
          max-height: 300px;
          overflow-y: auto;
        }
      }

      .expand-toggle {
        display: block;
        width: 100%;
        text-align: center;
        font-size: 10px;
        color: var(--color-primary, #1B5FD9);
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 0 0;
        margin-top: 2px;

        &:hover {
          text-decoration: underline;
        }
      }
    }

    .doc-card-footer {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      padding: 6px 12px 10px;

      .doc-btn-view,
      .doc-btn-copy-text {
        font-size: 10px;
        padding: 3px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.15s;
      }

      .doc-btn-view {
        color: #059669;
        background: var(--color-success-light);
        border: none;

        &:hover {
          background: var(--color-success-light);
        }
      }

      .doc-btn-copy-text {
        color: var(--color-text-secondary, #4B5563);
        background: transparent;
        border: 1px solid var(--color-border-default, #E5E7EB);

        &:hover {
          background: var(--color-bg-page, #F5F6FA);
        }
      }
    }
  }

  /* 空状态 */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--color-text-tertiary, #9CA3AF);
    font-size: 12px;

    svg { opacity: 0.4; }
  }
}

// 右面板折叠按钮
.toggle-btn-right {
  position: absolute;
  right: 280px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default, #E5E7EB);
  border-right: none;
  border-radius: 4px 0 0 4px;
  cursor: pointer;
  z-index: 10;
  font-size: 14px;
  color: var(--color-text-tertiary, #9CA3AF);
  transition: background 0.15s, color 0.15s, right 0.2s;

  &:hover {
    background: var(--color-primary-light, #E8F0FE);
    color: var(--color-primary, #1B5FD9);
  }
}

// 右面板浮动按钮
.right-float-btn {
  position: absolute;
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
  border: none;
  border-radius: 4px 0 0 4px;
  cursor: pointer;
  z-index: 20;
}

// 导出选择弹窗
.export-dialog {
  .export-tree-container {
    padding: 5px 0;
  }

  .export-tree-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--color-bg-base);
    border-radius: 6px;

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;

      input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
        flex-shrink: 0;
      }
    }

    .selected-count {
      color: #8c8c8c;
      font-size: 13px;
    }
  }

  .export-tree {
    max-height: 400px;
    overflow-y: auto;

    .tree-group {
      margin-bottom: 2px;
    }

    .tree-node-header {
      display: flex;
      align-items: center;
      padding: 6px 10px;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.15s;

      &:hover {
        background: var(--color-bg-hover);
      }

      .tree-chevron {
        flex-shrink: 0;
        width: 12px;
        height: 12px;
        margin-right: 4px;
        color: #bfbfbf;
        transition: transform 0.2s;

        &.expanded {
          transform: rotate(90deg);
        }
      }

      .tree-item-label {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-right: 6px;

        input[type="checkbox"] {
          width: 15px;
          height: 15px;
          cursor: pointer;
          flex-shrink: 0;
        }
      }

      .item-text {
        flex: 1;
        font-size: 14px;
        color: #333;

        &.parent-text {
          font-weight: 500;
        }
      }

      .item-count {
        font-size: 12px;
        color: #999;
        margin-left: 8px;
      }
    }

    .tree-leaf {
      .tree-item-label {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px 6px 32px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.15s;

        &:hover {
          background: var(--color-bg-hover);
        }

        input[type="checkbox"] {
          width: 15px;
          height: 15px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .item-text {
          font-size: 14px;
          color: #333;
        }
      }
    }
  }
}

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

/* File Preview Dialog */
.file-preview-dialog {
  .file-preview-container {
    min-height: 400px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: auto;
    
    .preview-loading,
    .preview-error {
      padding: 40px;
      text-align: center;
      color: #6B7280;
    }
    
    .preview-error {
      color: #DC2626;
    }
    
    .preview-image-wrapper {
      width: 100%;
      text-align: center;
      
      .preview-image {
        max-width: 100%;
        max-height: 70vh;
        object-fit: contain;
        border-radius: 4px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      }
    }
    
    .preview-pdf-wrapper {
      width: 100%;
      height: 70vh;
      
      .preview-pdf {
        width: 100%;
        height: 100%;
        border: none;
        border-radius: 4px;
      }
    }
    
    .preview-word-wrapper {
      padding: 40px;
      text-align: center;
      width: 100%;
      
      .word-placeholder {
        svg {
          margin-bottom: 16px;
        }
        
        .word-title {
          font-size: 16px;
          font-weight: 600;
          color: #1F2937;
          margin: 0 0 8px;
          word-break: break-all;
        }
        
        .word-desc {
          font-size: 14px;
          color: #6B7280;
          margin: 0 0 20px;
        }
      }
    }
    
    .preview-unsupported {
      padding: 40px;
      text-align: center;
      color: #6B7280;
    }
    
    .preview-text-wrapper {
      width: 100%;
      height: 70vh;
      overflow: auto;
      background: #1F2937;
      border-radius: 4px;
      
      .preview-text-content {
        margin: 0;
        padding: 20px;
        color: #E5E7EB;
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-all;
        text-align: left;
      }
    }
  }
}

/* File Thumb Placeholder (in evidence cell) */
.file-thumb-placeholder {
  width: 60px;
  height: 60px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: #6B7280;
  
  &.pdf {
    background: linear-gradient(135deg, #E74C3C, #C0392B);
  }
  
  &.word {
    background: linear-gradient(135deg, #2B5797, #1E3F6F);
  }
  
  &.text {
    background: linear-gradient(135deg, #10B981, #059669);
  }
}

/* AI使用合规确认弹窗 */
.ai-consent-content {
  text-align: center;
  padding: 8px 0;
}

.ai-consent-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.ai-consent-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
}

.ai-consent-body {
  text-align: left;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.ai-consent-body p {
  margin: 0 0 8px 0;
}

.ai-consent-body ul {
  margin: 8px 0 12px 0;
  padding-left: 20px;
  list-style: none;
}

.ai-consent-body li {
  margin-bottom: 6px;
  font-size: 13px;
}

.ai-consent-hint {
  font-size: 12px;
  color: #e6a23c;
  background: rgba(230, 162, 60, 0.08);
  padding: 8px 12px;
  border-radius: 4px;
  margin-top: 8px;
}
</style>