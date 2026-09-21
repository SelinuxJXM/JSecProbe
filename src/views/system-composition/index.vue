<template>
  <div class="page-container">
    <!-- 项目上下文栏 -->
    <div class="project-context-bar">
      <div class="breadcrumb">
        <el-icon class="back-btn" @click="goBack"><ArrowLeft /></el-icon>
        <el-icon><HomeFilled /></el-icon>
        <span class="customer-name">{{ project?.name || '未选择项目' }}</span>
        <el-icon><DArrowRight /></el-icon>
        <span class="current-page">系统构成</span>
      </div>
      <div class="phase-indicators">
        <div class="phase-pill active">
          <span class="pill-num">1</span>
          系统构成
        </div>
        <div class="phase-pill" @click="goToPhase('assessment')">
          <span class="pill-num">2</span>
          现场核查
        </div>
        <div class="phase-pill" @click="goToPhase('issues')">
          <span class="pill-num">3</span>
          问题汇总
        </div>
      </div>
    </div>

    <!-- 资产分类导航栏（带图标） -->
    <div class="category-nav-bar" data-guide="asset-category">
      <div
        v-for="cat in categories"
        :key="cat.id"
        class="category-tab"
        :class="{ active: currentCategory === cat.id }"
        @click="handleCategoryChange(cat.id)"
      >
        <svg class="cat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="CATEGORY_ICONS[cat.id] || CATEGORY_ICONS.machine_room"></svg>
        <span>{{ cat.name }}</span>
      </div>
    </div>

    <!-- 首访提示：只在该页面首次进入时出现，关闭后不再打扰 -->
    <PageHint
      hint-key="system-composition"
      title="第一次登记资产？看这三点"
      :tips="[
        '上方分类导航共 12 类资产（机房、网络边界、网络设备、安全设备、服务器与存储、终端、业务应用、数据资源、密码产品、安全人员等），逐类登记即可。',
        '已有设备台账就用「导入资产」按模板批量导入；来不及整理可以先试「AI 识别」。',
        '标为「测评对象」的资产才会被现场核查引用，与测评无关的资产可以不勾。',
      ]"
    />

    <!-- 数据表格卡片 -->
    <div class="data-table-card">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <span class="category-title">{{ currentCategoryName }}</span>
          <span class="asset-badge">{{ pagination.total }}</span>
        </div>
        <div class="toolbar-right">
          <button class="toolbar-btn ai-btn" @click="openAiIdentify" :disabled="aiIdentifyLoading || aiImportLoading">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2m0 12v-2m4.77-7.77l-1.42 1.42M5.65 5.65L4.24 4.24m12.02 12.02l1.41 1.41M4.24 19.76l1.42-1.42M12 12l3-3"/><path d="M9.76 14.24a4 4 0 1 0 4.48-4.48"/></svg>
            AI 识别
          </button>
          <button class="toolbar-btn ai-btn" @click="openAiMissing" :disabled="aiMissingLoading">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            AI 缺失提醒
          </button>
          <button class="toolbar-btn" data-guide="asset-import" @click="handleImport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            导入资产
          </button>
          <button class="toolbar-btn" @click="handleDownloadTemplate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            下载导入模板
          </button>
          <button class="toolbar-btn" @click="handleExport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出资产
          </button>
          <button class="toolbar-btn" @click="handleExportAll">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出全部
          </button>
          <div class="toolbar-sep"></div>
          <div class="search-box">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input v-model="keyword" type="text" placeholder="搜索资产" class="search-input" @input="onSearch" />
          </div>
          <button class="toolbar-icon-btn" title="筛选" :class="{ active: showFilter }" @click="showFilter = !showFilter">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          </button>
        </div>
      </div>

      <!-- 筛选面板：作用于当前页已加载的资产 -->
      <div v-if="showFilter" class="filter-panel">
        <div class="filter-item">
          <label class="filter-label">重要程度</label>
          <select v-model="filterImportance" class="filter-select">
            <option value="">全部</option>
            <option value="high">关键</option>
            <option value="medium">重要</option>
            <option value="low">一般</option>
          </select>
        </div>
        <div class="filter-item">
          <label class="filter-label">设备形态</label>
          <select v-model="filterVirtual" class="filter-select">
            <option value="">全部</option>
            <option value="yes">虚拟设备</option>
            <option value="no">物理设备</option>
          </select>
        </div>
        <div class="filter-item">
          <label class="filter-label">测评对象</label>
          <select v-model="filterTarget" class="filter-select">
            <option value="">全部</option>
            <option value="yes">是</option>
            <option value="no">否</option>
          </select>
        </div>
        <button class="filter-reset" :disabled="activeFilterCount === 0" @click="resetFilter">清除筛选</button>
        <span class="filter-summary">筛选出 {{ visibleAssets.length }} / {{ assetList.length }} 条（当前页）</span>
      </div>

      <div ref="tableWrapperRef" class="table-wrapper">
      <el-table
        :data="visibleAssets"
        style="width: 100%"
        :row-height="44"
        v-loading="loading"
        header-cell-class-name="design-header-cell"
      >
        <el-table-column type="index" label="序号" width="50" align="center" />
        <!--
          以下 6 组列的共同点：同一个资产字段在不同类别下叫不同名字。
          原先是 25 个几乎逐字相同的 <el-table-column v-if="currentCategory === ...">，
          兜底分支还写成一长串 `!== 'a' && !== 'b' && ...`，改一个类别要在模板里复制粘贴整块。
          现在收敛为「配置表 + 单个列」（见脚本区 VARIANT_COLUMN 相关定义）。
        -->
        <el-table-column v-if="nameColumn" :label="nameColumn.label" :min-width="nameColumn.minWidth">
          <template #default="{ row }">
            <el-input v-model="row.name" :placeholder="nameColumn.label" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 虚拟设备（仅设备类资产区分虚拟/物理） -->
        <el-table-column v-if="isDeviceCategory" label="虚拟设备" width="80" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.isVirtual" @change="markModified(row, true)" />
          </template>
        </el-table-column>
        <el-table-column v-if="osColumn" :label="osColumn.label" :min-width="osColumn.minWidth">
          <template #default="{ row }">
            <el-input v-model="row.os" :placeholder="osColumn.label" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="versionColumn" :label="versionColumn.label" :min-width="versionColumn.minWidth">
          <template #default="{ row }">
            <el-input v-model="row.version" :placeholder="versionColumn.label" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="dbSystemColumn" :label="dbSystemColumn.label" :min-width="dbSystemColumn.minWidth">
          <template #default="{ row }">
            <el-input v-model="row.dbSystem" :placeholder="dbSystemColumn.placeholder" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="middlewareColumn" :label="middlewareColumn.label" :min-width="middlewareColumn.minWidth">
          <template #default="{ row }">
            <el-input v-model="row.middleware" :placeholder="middlewareColumn.placeholder" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="usageColumn" :label="usageColumn.label" :min-width="usageColumn.minWidth">
          <template #default="{ row }">
            <el-input v-model="row.deviceUsage" :placeholder="usageColumn.placeholder" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 备注 -->
        <el-table-column v-if="currentCategory !== 'data_resource' && currentCategory !== 'management_platform' && currentCategory !== 'crypto_product' && currentCategory !== 'security_personnel' && currentCategory !== 'other_asset'" label="备注" min-width="120">
          <template #default="{ row }">
            <el-input v-model="row.description" placeholder="备注" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 数量 -->
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'business_app' && currentCategory !== 'data_resource' && currentCategory !== 'management_platform' && currentCategory !== 'sys_doc' && currentCategory !== 'other_asset' && currentCategory !== 'crypto_product' && currentCategory !== 'security_personnel'" label="数量" width="70" align="center">
          <template #default="{ row }">
            <el-input-number v-model="row.quantity" :min="1" :max="999" size="small" controls-position="right" style="width: 68px" @change="markModified(row, true)" />
          </template>
        </el-table-column>
        <!-- IP地址 -->
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'sys_doc' && currentCategory !== 'business_app' && currentCategory !== 'data_resource' && currentCategory !== 'crypto_product' && currentCategory !== 'security_personnel'" label="IP地址" min-width="130">
          <template #default="{ row }">
            <el-input v-model="row.ip" placeholder="IP地址" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 备注 (其他系统或设备专属，放IP地址后) -->
        <el-table-column v-if="currentCategory === 'other_asset'" label="备注" min-width="120">
          <template #default="{ row }">
            <el-input v-model="row.description" placeholder="备注" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'security_personnel'" label="联系方式" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.ip" placeholder="联系方式" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'security_personnel'" label="所属单位" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="所属单位" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory !== 'sys_doc' && currentCategory !== 'security_personnel'" label="重要程度" width="100" align="center">
          <template #default="{ row }">
            <el-select v-model="row.importance" size="small" style="width: 100%" @change="markModified(row, true)">
              <el-option label="关键" value="high" />
              <el-option label="重要" value="medium" />
              <el-option label="一般" value="low" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="测评对象" width="80" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.isAssessmentTarget" size="small" :active-value="true" :inactive-value="false" @change="markModified(row, true)" />
            <span style="font-size:12px; color:#4B5563; margin-left:4px;">是</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="openEditDialog(row)">
              编辑
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>

      <div class="pagination-bar">
        <div class="footer-left">
          <span class="total-text">共 {{ pagination.total }} 条</span>
          <span v-if="modifiedCount > 0" class="modified-badge">{{ modifiedCount }} 项已修改</span>
          <span v-if="saveStatus === 'saving'" class="save-status saving">
            <span class="save-dot"></span>保存中...
          </span>
          <span v-else-if="saveStatus === 'saved' && lastSavedTime" class="save-status saved">
            <span class="save-dot"></span>已保存 {{ formatSaveTime(lastSavedTime) }}
          </span>
          <span v-else-if="saveStatus === 'unsaved'" class="save-status unsaved">
            <span class="save-dot"></span>有未保存的修改
          </span>
          <span v-else-if="saveStatus === 'error'" class="save-status error">
            <span class="save-dot"></span>保存失败
          </span>
        </div>
        <div class="pagination-btns">
          <button class="page-btn" :disabled="pagination.page <= 1" @click="pagination.page--; reloadAssets()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button v-for="p in visiblePages" :key="p" class="page-btn" :class="{ active: pagination.page === p }" @click="pagination.page = p; reloadAssets()">
            {{ p }}
          </button>
          <button class="page-btn" :disabled="pagination.page >= totalPages" @click="pagination.page++; reloadAssets()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="footer-right">
          <button class="footer-btn" @click="refreshData">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>刷新</span>
          </button>
          <button class="footer-btn" @click="addEmptyRow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>新增一行</span>
          </button>
          <button class="footer-btn primary" @click="saveAllChanges" :disabled="modifiedCount === 0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>保存修改</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 编辑资产对话框（新增入口已移除：资产通过「导入资产 / AI 识别 / 新增一行」产生） -->
    <el-dialog
      v-model="showAddDialog"
      title="编辑资产"
      width="560px"
      :close-on-click-modal="false"
    >
      <el-form :model="formData" label-width="120px" class="asset-form">
        <el-form-item label="设备名称" required>
          <el-input v-model="formData.name" placeholder="请输入设备名称" />
        </el-form-item>
        <el-form-item label="操作系统">
          <el-input v-model="formData.os" placeholder="如 Windows Server 2019" />
        </el-form-item>
        <el-form-item label="版本">
          <el-input v-model="formData.version" placeholder="如 Enterprise" />
        </el-form-item>
        <el-form-item label="设备类别/用途">
          <el-input v-model="formData.deviceUsage" placeholder="如 核心网络设备" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="formData.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="数量">
              <el-input-number v-model="formData.quantity" :min="1" :max="999" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="重要程度">
              <el-select v-model="formData.importance" style="width: 100%">
                <el-option label="关键" value="high" />
                <el-option label="重要" value="medium" />
                <el-option label="一般" value="low" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="IP地址">
              <el-input v-model="formData.ip" placeholder="如 10.10.1.1" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="虚拟设备">
              <el-switch v-model="formData.isVirtual" :active-value="true" :inactive-value="false" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- AI 资产识别对话框 -->
    <el-dialog v-model="aiIdentifyVisible" title="AI 资产识别" width="720px" :close-on-click-modal="false" append-to-body>
      <div v-if="aiIdentifyResults.length === 0">
        <div class="ai-tip">粘贴系统描述信息（如网络拓扑描述、建设方案节选、资产清单文字等），或添加图片/文档附件（截图、照片、拓扑图、PDF/Word/Excel 等），AI 将识别出应纳入测评范围的资产生成预览清单，勾选确认后导入系统构成。AI 仅提取您提供内容有明确依据的资产，不会凭经验猜测补充；若描述无实质内容将返回空清单。</div>
        <el-input
          v-model="aiIdentifyDescription"
          type="textarea"
          :rows="6"
          maxlength="20000"
          show-word-limit
          placeholder="示例：本系统核心机房部署在 A 楼 3 层，出口部署山石网科防火墙 1 台；核心交换机为华为 S5735 共 2 台，接入交换机为 H3C S5130S 共 6 台；业务应用系统部署在 2 台华为 RH2288H V3 服务器上，数据库为 Oracle 11g；另有运维终端 2 台、业务终端 20 台，均为 Windows 10 操作系统……"
        />
        <!-- 附件上传区 -->
        <div class="ai-attachments">
          <div class="ai-attachments-header">
            <span class="ai-attachments-title">附件（可选）</span>
            <span class="ai-attachments-hint">图片用于多模态识别/OCR 提取，文档提取文本</span>
          </div>
          <div class="ai-attachments-actions">
            <el-button size="small" :loading="aiIdentifyAttachmentsLoading" @click="aiIdentifyImageInput?.click()">
              <el-icon><Picture /></el-icon> 添加图片
            </el-button>
            <el-button size="small" :loading="aiIdentifyAttachmentsLoading" @click="aiIdentifyDocInput?.click()">
              <el-icon><Document /></el-icon> 添加文档
            </el-button>
            <input
              ref="aiIdentifyImageInput"
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.bmp,.webp"
              multiple
              style="display:none"
              @change="onImageFileSelect"
            />
            <input
              ref="aiIdentifyDocInput"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.md,.txt,.csv,.log,.json,.xml,.html"
              multiple
              style="display:none"
              @change="onDocFileSelect"
            />
          </div>
          <div v-if="aiIdentifyAttachments.length > 0" class="ai-attachments-list">
            <div v-for="(att, idx) in aiIdentifyAttachments" :key="att.path + att.name" class="ai-attachment-item">
              <el-icon class="ai-att-icon" :class="att.type === 'image' ? 'is-image' : 'is-doc'">
                <Picture v-if="att.type === 'image'" />
                <Document v-else />
              </el-icon>
              <span class="ai-att-name" :title="att.name">{{ att.name }}</span>
              <span class="ai-att-size">{{ formatAttachmentSize(att.size) }}</span>
              <el-button text class="ai-att-remove" @click="removeAttachment(idx)">
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
        <div class="ai-identify-footer-left">
          <el-button type="primary" :loading="aiIdentifyLoading" @click="handleAiIdentify">
            {{ aiIdentifyLoading ? '识别中…' : '开始识别' }}
          </el-button>
        </div>
      </div>
      <div v-else class="ai-id-results">
        <div class="ai-id-header">
          <span class="ai-id-count">共识别 {{ aiIdentifyResults.length }} 个资产，请勾选需要导入的资产（可在导入前修改分类与名称）</span>
          <el-button text type="primary" @click="aiIdentifyResults = []">重新识别</el-button>
        </div>
        <div class="ai-id-list">
          <div v-for="(item, idx) in aiIdentifyResults" :key="idx" class="ai-id-item" :class="{ checked: item.selected, expanded: item.expanded }">
            <div class="ai-id-row">
              <el-checkbox v-model="item.selected" />
              <el-select v-model="item.category" size="small" class="ai-id-cat" filterable>
                <el-option v-for="cat in ASSET_CATEGORIES" :key="cat.id" :label="cat.name" :value="cat.id" />
              </el-select>
              <el-input v-model="item.name" size="small" class="ai-id-name" placeholder="资产名称" @click.stop />
              <el-select v-model="item.importance" size="small" class="ai-id-imp">
                <el-option label="关键" value="high" />
                <el-option label="重要" value="medium" />
                <el-option label="一般" value="low" />
              </el-select>
              <span class="ai-id-usage" :title="item.deviceUsage">{{ item.deviceUsage || '—' }}</span>
              <el-button text size="small" class="ai-id-toggle" @click.stop="item.expanded = !item.expanded">
                详情{{ item.expanded ? ' ▲' : ' ▼' }}
              </el-button>
            </div>
            <div v-show="item.expanded" class="ai-id-detail">
              <div class="ai-id-detail-grid">
                <div class="ai-id-field">
                  <label>操作系统</label>
                  <el-input v-model="item.os" size="small" placeholder="如 Windows Server 2016 / CentOS 7.9" />
                </div>
                <div class="ai-id-field">
                  <label>版本</label>
                  <el-input v-model="item.version" size="small" placeholder="如 V3R5 / 11g" />
                </div>
                <div class="ai-id-field">
                  <label>IP 地址</label>
                  <el-input v-model="item.ip" size="small" placeholder="如 192.168.1.10 或 192.168.1.0/24" />
                </div>
                <div class="ai-id-field">
                  <label>数量</label>
                  <el-input-number v-model="item.quantity" size="small" :min="1" :max="999" />
                </div>
                <div class="ai-id-field">
                  <label>虚拟设备</label>
                  <el-switch v-model="item.isVirtual" size="small" />
                </div>
                <div class="ai-id-field">
                  <label>数据库系统</label>
                  <el-input v-model="item.dbSystem" size="small" placeholder="如 Oracle 11g（数据库类资产填写）" />
                </div>
                <div class="ai-id-field">
                  <label>中间件</label>
                  <el-input v-model="item.middleware" size="small" placeholder="如 Tomcat 9.0（承载中间件时填写）" />
                </div>
                <div class="ai-id-field ai-id-field-full">
                  <label>用途说明</label>
                  <el-input v-model="item.deviceUsage" size="small" placeholder="一句话说明资产用途" />
                </div>
                <div class="ai-id-field ai-id-field-full">
                  <label>备注描述</label>
                  <el-input v-model="item.description" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="补充说明信息" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="aiIdentifyVisible = false">取消</el-button>
        <el-button v-if="aiIdentifyResults.length > 0" type="primary" :loading="aiImportLoading" @click="handleImportIdentified">
          导入选中（{{ selectedIdentifyCount }}）
        </el-button>
      </template>
    </el-dialog>

    <!-- AI 缺失资产提醒对话框 -->
    <el-dialog v-model="aiMissingVisible" title="AI 缺失资产提醒" width="640px" :close-on-click-modal="false" append-to-body>
      <div v-loading="aiMissingLoading" class="ai-missing-body" element-loading-text="AI 分析中…">
        <template v-if="!aiMissingLoading">
          <div v-if="aiMissingResults.length === 0" class="ai-missing-empty">AI 认为当前资产构成已较完整，未发现明显缺失的资产类别。</div>
          <div v-else class="ai-missing-list">
            <div class="ai-tip">基于当前项目已录入的资产分布，AI 识别出以下可能缺失的资产类别：</div>
            <div v-for="(m, idx) in aiMissingResults" :key="idx" class="ai-missing-item">
              <div class="ai-missing-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                缺失：{{ m.categoryName }}
              </div>
              <div class="ai-missing-row"><span class="ai-missing-label">风险影响</span><span>{{ m.risk || '—' }}</span></div>
              <div class="ai-missing-row"><span class="ai-missing-label">补充建议</span><span>{{ m.suggestion || '—' }}</span></div>
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="aiMissingVisible = false">关闭</el-button>
        <el-button type="primary" :loading="aiMissingLoading" @click="handleAiMissing">重新检查</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  HomeFilled,
  DArrowRight,
  ArrowLeft,
  Close,
  Picture,
  Document,
} from '@element-plus/icons-vue';
import type { Asset, AssetCategory, AssetListResult } from '@shared/types';
import { ASSET_CATEGORIES } from '@shared/asset-categories';
import { useAssetAutoSave } from './composables/useAssetAutoSave';
import PageHint from '@/components/PageHint/index.vue';

const route = useRoute();
const router = useRouter();

// 状态
const loading = ref(false);
const saving = ref(false);
const project = ref<any>(null);
const assetList = ref<Asset[]>([]);
const tableWrapperRef = ref<HTMLElement | null>(null);
const categories = ref<AssetCategory[]>([]);
const showAddDialog = ref(false);
const editingAsset = ref<Asset | null>(null);
const currentCategory = ref('machine_room');
const keyword = ref('');

// 筛选（此前筛选图标是纯装饰，没有任何 @click，也无消费者）
const showFilter = ref(false);
const filterImportance = ref('');
const filterVirtual = ref('');
const filterTarget = ref('');

const visibleAssets = computed(() => {
  return assetList.value.filter((row: any) => {
    if (filterImportance.value && row.importance !== filterImportance.value) return false;
    if (filterVirtual.value === 'yes' && !row.isVirtual) return false;
    if (filterVirtual.value === 'no' && row.isVirtual) return false;
    if (filterTarget.value === 'yes' && !row.isAssessmentTarget) return false;
    if (filterTarget.value === 'no' && row.isAssessmentTarget) return false;
    return true;
  });
});

const activeFilterCount = computed(
  () =>
    (filterImportance.value ? 1 : 0) +
    (filterVirtual.value ? 1 : 0) +
    (filterTarget.value ? 1 : 0)
);

function resetFilter() {
  filterImportance.value = '';
  filterVirtual.value = '';
  filterTarget.value = '';
}

// 记录修改过的行ID（新增行用临时负数ID标记）
const modifiedRows = reactive(new Set<string>());
const deletedIds = reactive(new Set<string>());
const modifiedCount = computed(() => modifiedRows.size + deletedIds.size);

/**
 * 轻量刷新：只取总数与分类计数，不重建列表。
 * 常规自动保存走这条路，避免把用户正在填写的单元格重排掉。
 */
async function loadCategoryStats() {
  const projectId = route.params.id as string;
  if (!projectId || !window.api) return;
  try {
    const res = await window.api.asset.list({
      projectId,
      category: currentCategory.value,
      keyword: keyword.value || undefined,
      page: 1,
      pageSize: 1,
    });
    if (res.success && res.data) {
      const data = res.data as AssetListResult;
      pagination.total = data.total;
      categories.value = data.categoryStats;
    }
  } catch (err) {
    console.error('刷新资产统计失败:', err);
  }
}

/**
 * 临时行落库成功后的回写。
 * 只写「身份字段」——名称/用途/备注这些用户可能正在敲的字段以浏览器值为准，
 * 否则保存往返期间继续输入的内容会被服务端回显覆盖掉。
 */
function handleRowCreated(row: Asset, created: any) {
  const anyRow = row as any;
  anyRow.id = created.id;
  anyRow.projectId = created.projectId || anyRow.projectId;
  anyRow.category = created.category || anyRow.category;
  anyRow.createdAt = created.createdAt || anyRow.createdAt;
  anyRow.updatedAt = created.updatedAt || anyRow.updatedAt;
  anyRow.sortOrder = created.sortOrder ?? anyRow.sortOrder;
  anyRow.quantity = created.quantity ?? anyRow.quantity;
}

// 自动保存
const autoSave = useAssetAutoSave({
  assetList,
  modifiedRows,
  deletedIds,
  currentCategory,
  route,
  loadAssets,
  loadStats: loadCategoryStats,
  onRowCreated: handleRowCreated,
});
const { saveStatus, lastSavedTime, debounceAutoSave, startPeriodicSave, formatSaveTime, cleanup, markClean } = autoSave;

// 离散操作（勾选/选择/计数步进）不是连续输入，操作完即可落库
const QUICK_SAVE_DELAY = 1200;

const pagination = reactive({
  page: 1,
  pageSize: 50,
  total: 0,
});

const totalPages = computed(() => Math.ceil(pagination.total / pagination.pageSize) || 1);
const visiblePages = computed(() => {
  const pages: number[] = [];
  const start = Math.max(1, pagination.page - 1);
  const end = Math.min(totalPages.value, pagination.page + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
});

const formData = reactive({
  name: '',
  os: '',
  version: '',
  deviceUsage: '',
  description: '',
  quantity: 1,
  ip: '',
  importance: 'medium' as 'high' | 'medium' | 'low',
  isVirtual: false,
  isAssessmentTarget: true,
});

// AI 资产识别 / 缺失提醒
const aiIdentifyVisible = ref(false);
const aiIdentifyLoading = ref(false);
const aiIdentifyDescription = ref('');
const aiIdentifyResults = ref<any[]>([]);
const aiImportLoading = ref(false);
// AI 资产识别附件
interface AiIdentifyAttachment {
  name: string;
  path: string;
  type: 'image' | 'document';
  size: number;
}
const aiIdentifyAttachments = ref<AiIdentifyAttachment[]>([]);
const aiIdentifyAttachmentsLoading = ref(false);
const aiIdentifyImageInput = ref<HTMLInputElement | null>(null);
const aiIdentifyDocInput = ref<HTMLInputElement | null>(null);
const aiMissingVisible = ref(false);
const aiMissingLoading = ref(false);
const aiMissingResults = ref<Array<{ category: string; categoryName: string; risk: string; suggestion: string }>>([]);
const selectedIdentifyCount = computed(() => aiIdentifyResults.value.filter(a => a.selected).length);

// 分类名称映射（统一引用共享资产分类，避免与后端定义漂移）
const CATEGORY_NAMES: Record<string, string> = Object.fromEntries(
  ASSET_CATEGORIES.map((c) => [c.id, c.name]),
);

// 分类图标映射 (SVG innerHTML)
const CATEGORY_ICONS: Record<string, string> = {
  machine_room: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/>',
  network_boundary: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  network_device: '<rect x="2" y="14" width="20" height="6" rx="1"/><circle cx="6" cy="17" r="1"/><circle cx="12" cy="17" r="1"/><rect x="8" y="4" width="8" height="6" rx="1"/><line x1="12" y1="10" x2="12" y2="14"/>',
  security_device: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  server_storage: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  sys_doc: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  management_platform: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/>',
  business_app: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  terminal: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  other_asset: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  data_resource: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  crypto_product: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 1 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  security_personnel: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
};

const currentCategoryName = computed(() => CATEGORY_NAMES[currentCategory.value] || currentCategory.value);

// ==================== 表格「同字段异名」列配置（P3-2） ====================
/**
 * 资产表里大量列其实是同一个字段、只是随类别换了个名字：
 * `os` 在机房叫「机房位置」、在服务器叫「操作系统及版本」、在文档叫「文档主要内容」……
 * 原实现把每种叫法写成一个独立的 <el-table-column v-if="...">，共 25 个几乎逐字相同的块，
 * 兜底分支还是 `!== 'a' && !== 'b' && ...` 的长串 —— 既读不出到底排除了哪些类别，
 * 加新类别时也必然要回来复制粘贴。改成本配置表后，模板只剩 6 个列，改文案只动这里。
 */
interface VariantColumnDef {
  /** 绑定的资产字段名 */
  field: 'name' | 'os' | 'version' | 'dbSystem' | 'middleware' | 'deviceUsage';
  label: string;
  placeholder: string;
  minWidth: number;
}

type VariantSpec = { label: string; placeholder: string; minWidth: number };

/** 名称列：所有类别都有，仅叫法不同 */
const NAME_COLUMN: Record<string, VariantSpec> = {
  machine_room: { label: '机房名称', placeholder: '机房名称', minWidth: 140 },
  network_boundary: { label: '边界名称', placeholder: '边界名称', minWidth: 180 },
  sys_doc: { label: '文档名称', placeholder: '文档名称', minWidth: 160 },
  management_platform: { label: '系统名称', placeholder: '系统名称', minWidth: 160 },
  business_app: { label: '应用系统名称', placeholder: '应用系统名称', minWidth: 180 },
  data_resource: { label: '数据类别', placeholder: '数据类别', minWidth: 180 },
  crypto_product: { label: '产品/模块名称', placeholder: '产品/模块名称', minWidth: 180 },
  security_personnel: { label: '姓名', placeholder: '姓名', minWidth: 140 },
};
const NAME_COLUMN_FALLBACK: VariantSpec = { label: '设备名称', placeholder: '设备名称', minWidth: 140 };

/** os 列：机房/边界/密码产品/人员这四类不在此处渲染（人员的「所属单位」在表尾单独一列） */
const OS_COLUMN: Record<string, VariantSpec> = {
  machine_room: { label: '机房位置', placeholder: '机房位置', minWidth: 130 },
  network_device: { label: '系统及版本', placeholder: '系统及版本', minWidth: 140 },
  security_device: { label: '系统及版本', placeholder: '系统及版本', minWidth: 140 },
  server_storage: { label: '操作系统及版本', placeholder: '操作系统及版本', minWidth: 160 },
  sys_doc: { label: '文档主要内容', placeholder: '文档主要内容', minWidth: 160 },
  management_platform: { label: '所在设备名称', placeholder: '所在设备名称', minWidth: 160 },
  business_app: { label: '软件及版本', placeholder: '软件及版本', minWidth: 160 },
  data_resource: { label: '所属业务应用', placeholder: '所属业务应用', minWidth: 180 },
  terminal: { label: '操作系统及版本', placeholder: '操作系统及版本', minWidth: 160 },
  other_asset: { label: '系统及版本', placeholder: '系统及版本', minWidth: 140 },
};
const OS_COLUMN_FALLBACK: VariantSpec = { label: '操作系统', placeholder: '操作系统', minWidth: 130 };
/** 这些类别在本位置不显示 os 列 */
const OS_COLUMN_EXCLUDED = new Set(['network_boundary', 'crypto_product', 'security_personnel']);

/** version 列 */
const VERSION_COLUMN: Record<string, VariantSpec> = {
  network_device: { label: '品牌及型号', placeholder: '品牌及型号', minWidth: 140 },
  security_device: { label: '品牌及型号', placeholder: '品牌及型号', minWidth: 140 },
  management_platform: { label: '版本', placeholder: '版本', minWidth: 140 },
  crypto_product: { label: '生产厂商', placeholder: '生产厂商', minWidth: 140 },
};

/** dbSystem 列（服务器/存储设备、密码产品） */
const DBSYSTEM_COLUMN: Record<string, VariantSpec> = {
  server_storage: { label: '数据库系统及版本', placeholder: '如 MySQL 8.0', minWidth: 160 },
  crypto_product: { label: '证书编号', placeholder: '如 GM/T 00xx-20xx', minWidth: 160 },
};

/** middleware 列 */
const MIDDLEWARE_COLUMN: Record<string, VariantSpec> = {
  server_storage: { label: '中间件及版本', placeholder: '如 Tomcat 9.0', minWidth: 150 },
  crypto_product: { label: '密码算法', placeholder: '如 SM2/SM3/SM4', minWidth: 140 },
};

/** deviceUsage 列 */
const USAGE_COLUMN: Record<string, VariantSpec> = {
  network_device: { label: '设备用途', placeholder: '设备用途', minWidth: 100 },
  security_device: { label: '设备用途', placeholder: '设备用途', minWidth: 100 },
  management_platform: { label: '主要功能', placeholder: '主要功能描述', minWidth: 160 },
  business_app: { label: '主要功能', placeholder: '主要功能描述', minWidth: 160 },
  data_resource: { label: '安全防护需求', placeholder: '如 保密性、完整性', minWidth: 200 },
  crypto_product: { label: '用途', placeholder: '如 数据加密、签名验签', minWidth: 160 },
  security_personnel: { label: '岗位/角色', placeholder: '如 安全管理员', minWidth: 140 },
};
const USAGE_COLUMN_FALLBACK: VariantSpec = { label: '设备类别/用途', placeholder: '设备用途', minWidth: 140 };

/** 非设备类资产：不区分虚拟/物理，不显示「虚拟设备」列 */
const NON_DEVICE_CATEGORIES = new Set([
  'machine_room', 'network_boundary', 'sys_doc', 'management_platform',
  'business_app', 'data_resource', 'crypto_product', 'security_personnel',
]);

function resolveVariantColumn(
  table: Record<string, VariantSpec>,
  fallback: VariantSpec | null,
  excluded: Set<string> | null,
  field: VariantColumnDef['field'],
): VariantColumnDef | null {
  const category = currentCategory.value;
  if (excluded?.has(category)) return null;
  const spec = table[category] ?? fallback;
  if (!spec) return null;
  return { field, ...spec };
}

// 列顺序与 EDITABLE_COLUMNS 保持一致：name → isVirtual → os → version → dbSystem → middleware → deviceUsage。
// 粘贴导入（handlePaste）按 EDITABLE_COLUMNS 的顺序往右铺开，两者错位会导致数据串列。
const nameColumn = computed(() => resolveVariantColumn(NAME_COLUMN, NAME_COLUMN_FALLBACK, null, 'name'));
const osColumn = computed(() => resolveVariantColumn(OS_COLUMN, OS_COLUMN_FALLBACK, OS_COLUMN_EXCLUDED, 'os'));
const versionColumn = computed(() => resolveVariantColumn(VERSION_COLUMN, null, null, 'version'));
const dbSystemColumn = computed(() => resolveVariantColumn(DBSYSTEM_COLUMN, null, null, 'dbSystem'));
const middlewareColumn = computed(() => resolveVariantColumn(MIDDLEWARE_COLUMN, null, null, 'middleware'));
const usageColumn = computed(() => resolveVariantColumn(USAGE_COLUMN, USAGE_COLUMN_FALLBACK, null, 'deviceUsage'));
const isDeviceCategory = computed(() => !NON_DEVICE_CATEGORIES.has(currentCategory.value));

const EDITABLE_COLUMNS: Record<string, string[]> = {
  machine_room: ['name', 'os', 'description', 'importance', 'isAssessmentTarget'],
  network_boundary: ['name', 'description', 'importance', 'isAssessmentTarget'],
  network_device: ['name', 'isVirtual', 'os', 'version', 'deviceUsage', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  security_device: ['name', 'isVirtual', 'os', 'version', 'deviceUsage', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  server_storage: ['name', 'isVirtual', 'os', 'dbSystem', 'middleware', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  sys_doc: ['name', 'os', 'description', 'isAssessmentTarget'],
  management_platform: ['name', 'os', 'version', 'deviceUsage', 'ip', 'importance', 'isAssessmentTarget'],
  business_app: ['name', 'os', 'deviceUsage', 'description', 'importance', 'isAssessmentTarget'],
  terminal: ['name', 'isVirtual', 'os', 'deviceUsage', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  other_asset: ['name', 'isVirtual', 'os', 'deviceUsage', 'ip', 'description', 'importance', 'isAssessmentTarget'],
  data_resource: ['name', 'os', 'deviceUsage', 'importance', 'isAssessmentTarget'],
  crypto_product: ['name', 'version', 'dbSystem', 'middleware', 'deviceUsage', 'importance', 'isAssessmentTarget'],
  security_personnel: ['name', 'deviceUsage', 'ip', 'os', 'isAssessmentTarget'],
};

function getEditableColumns() {
  return EDITABLE_COLUMNS[currentCategory.value] || ['name', 'isVirtual', 'os', 'deviceUsage', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'];
}

function handlePaste(event: ClipboardEvent, row: Asset, field: string) {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return;
  
  const pastedText = clipboardData.getData('text');
  if (!pastedText) return;
  
  const rows = pastedText.split(/\r?\n/).filter(r => r.trim().length > 0);
  if (rows.length === 0) return;
  
  const cols = rows.map(r => r.split('\t'));
  if (cols[0].length === 1 && rows.length === 1) return;
  
  event.preventDefault();
  
  const editableCols = getEditableColumns();
  const startColIndex = editableCols.indexOf(field);
  if (startColIndex === -1) return;
  
  const startRowIndex = assetList.value.findIndex(r => r.id === row.id);
  if (startRowIndex === -1) return;
  
  for (let r = 0; r < cols.length; r++) {
    let targetRowIndex = startRowIndex + r;
    
    if (targetRowIndex >= assetList.value.length) {
      const newRow = {
        id: 'temp_' + Date.now() + '_' + r,
        projectId: route.params.id as string,
        category: currentCategory.value,
        name: '',
        os: '',
        version: '',
        deviceUsage: '',
        description: '',
        quantity: 1,
        ip: '',
        importance: 'medium' as 'high' | 'medium' | 'low',
        isVirtual: false,
        dbSystem: '',
        middleware: '',
        isAssessmentTarget: !['sys_doc', 'other_asset', 'crypto_product', 'security_personnel'].includes(currentCategory.value),
        sortOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      assetList.value.push(newRow);
      modifiedRows.add(String(newRow.id));
    }
    
    const targetRow = assetList.value[targetRowIndex];
    
    for (let c = 0; c < cols[r].length; c++) {
      const targetColIndex = startColIndex + c;
      if (targetColIndex >= editableCols.length) break;
      
      const targetField = editableCols[targetColIndex];
      const value = cols[r][c];
      
      if (targetField === 'isVirtual') {
        (targetRow as any)[targetField] = value === 'true' || value === '是' || value === '1';
      } else if (targetField === 'quantity') {
        const num = parseInt(value, 10);
        (targetRow as any)[targetField] = isNaN(num) ? 1 : Math.max(1, num);
      } else if (targetField === 'importance') {
        if (value === '关键' || value === 'high') (targetRow as any)[targetField] = 'high';
        else if (value === '重要' || value === 'medium') (targetRow as any)[targetField] = 'medium';
        else if (value === '一般' || value === 'low') (targetRow as any)[targetField] = 'low';
      } else if (targetField === 'isAssessmentTarget') {
        (targetRow as any)[targetField] = value === 'true' || value === '是' || value === '1';
      } else {
        (targetRow as any)[targetField] = value;
      }
    }
    
    modifiedRows.add(String(targetRow.id));
  }
}

function goToPhase(phase: string) {
  const projectId = route.params.id as string;
  if (projectId) {
    router.push(`/projects/${projectId}/${phase}`);
  }
}

function goBack() {
  router.back();
}

// 加载项目信息
async function loadProject() {
  const projectId = route.params.id as string;
  if (!projectId) {
    ElMessage.warning('请先选择项目');
    router.push('/projects');
    return;
  }
  if (!window.api) return;
  
  const res = await window.api.project.get(projectId);
  if (res.success && res.data) {
    project.value = res.data;
  }
}

// 加载资产列表
async function loadAssets() {
  const projectId = route.params.id as string;
  if (!projectId) return;
  if (!window.api) return;
  
  loading.value = true;
  try {
    const res = await window.api.asset.list({
      projectId,
      category: currentCategory.value,
      keyword: keyword.value || undefined,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
    
    if (res.success && res.data) {
      const data = res.data as AssetListResult;
      assetList.value = data.list.map(row => ({
        ...row,
        isVirtual: Boolean(row.isVirtual),
        isAssessmentTarget: Boolean(row.isAssessmentTarget),
      }));
      pagination.total = data.total;
      categories.value = data.categoryStats;
      // 列表整个重建了：行对象已换新，旧的脏标记不再有意义
      markClean();
      
      if (currentCategory.value === 'data_resource' && data.total === 0) {
        const defaults = [
          { name: '鉴别数据', deviceUsage: '保密性、完整性' },
          { name: '重要业务数据', deviceUsage: '保密性、完整性' },
          { name: '重要审计数据', deviceUsage: '保密性、完整性' },
          { name: '重要配置数据', deviceUsage: '完整性' },
          { name: '重要视频数据', deviceUsage: '完整性' },
          { name: '重要个人信息', deviceUsage: '保密性、完整性' },
        ];
        for (const item of defaults) {
          await window.api.asset.create({
            projectId,
            category: 'data_resource',
            name: item.name,
            os: '',
            deviceUsage: item.deviceUsage,
            description: '',
            quantity: 1,
            ip: '',
            importance: 'high',
            isVirtual: false,
            isAssessmentTarget: true,
          });
        }
        const res2 = await window.api.asset.list({
          projectId,
          category: 'data_resource',
          page: pagination.page,
          pageSize: pagination.pageSize,
        });
        if (res2.success && res2.data) {
          const data2 = res2.data as AssetListResult;
          assetList.value = data2.list.map(row => ({
            ...row,
            isVirtual: Boolean(row.isVirtual),
            isAssessmentTarget: Boolean(row.isAssessmentTarget),
          }));
          pagination.total = data2.total;
        }
      }
      
      if (currentCategory.value === 'terminal' && data.total === 0) {
        const defaults = [
          { name: '运维终端', os: 'Windows10 专业版', deviceUsage: '运维管理' },
          { name: '业务终端', os: 'Windows10 专业版', deviceUsage: '业务使用' },
        ];
        for (const item of defaults) {
          await window.api.asset.create({
            projectId,
            category: 'terminal',
            name: item.name,
            os: item.os,
            deviceUsage: item.deviceUsage,
            description: '',
            quantity: 1,
            ip: '',
            importance: 'medium',
            isVirtual: false,
            isAssessmentTarget: true,
          });
        }
        const res3 = await window.api.asset.list({
          projectId,
          category: 'terminal',
          page: pagination.page,
          pageSize: pagination.pageSize,
        });
        if (res3.success && res3.data) {
          const data3 = res3.data as AssetListResult;
          assetList.value = data3.list.map(row => ({
            ...row,
            isVirtual: Boolean(row.isVirtual),
            isAssessmentTarget: Boolean(row.isAssessmentTarget),
          }));
          pagination.total = data3.total;
        }
      }
    }
  } finally {
    loading.value = false;
  }
}

/**
 * 翻页 / 切分类前的重载入口：先把待保存的资产编辑落盘。
 * loadAssets 会清空 modifiedRows，直接调用会让这一页的编辑凭空消失。
 */
async function reloadAssets() {
  if (autoSave.hasUnsavedChanges.value) {
    await autoSave.saveAllChanges();
  }
  await loadAssets();
}

// 切换分类
function handleCategoryChange(categoryId: string) {
  currentCategory.value = categoryId;
  pagination.page = 1;
  reloadAssets();
}

// AI 资产识别
function openAiIdentify() {
  aiIdentifyDescription.value = '';
  aiIdentifyResults.value = [];
  aiIdentifyAttachments.value = [];
  aiIdentifyVisible.value = true;
}

// 附件类型常量（与后端 attachment.ipc.ts 的 IMAGE/DOCUMENT 白名单一致）
const IDENTIFY_IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const IDENTIFY_DOC_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.md', '.txt', '.csv', '.log', '.json', '.xml', '.html'];
const IDENTIFY_IMAGE_MAX = 10 * 1024 * 1024;
const IDENTIFY_DOC_MAX = 20 * 1024 * 1024;
const IDENTIFY_MAX_IMAGES = 20;
const IDENTIFY_MAX_DOCS = 10;

function getFileNameExt(name: string): string {
  return name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
}

function isDuplicateAttachment(name: string, size: number): boolean {
  return aiIdentifyAttachments.value.some(a => a.name === name && a.size === size);
}

async function addAttachmentFiles(files: File[], kind: 'image' | 'document') {
  const max = kind === 'image' ? IDENTIFY_MAX_IMAGES : IDENTIFY_MAX_DOCS;
  const exts = kind === 'image' ? IDENTIFY_IMAGE_EXT : IDENTIFY_DOC_EXT;
  const maxSize = kind === 'image' ? IDENTIFY_IMAGE_MAX : IDENTIFY_DOC_MAX;
  const currentKindCount = aiIdentifyAttachments.value.filter(a => a.type === kind).length;
  let accepted = 0;
  for (const file of files) {
    if (currentKindCount + accepted >= max) {
      ElMessage.warning(`附件「${file.name}」已达数量上限（${max} 个），未添加`);
      continue;
    }
    const ext = getFileNameExt(file.name);
    if (!exts.includes(ext)) {
      ElMessage.warning(`不支持的文件类型：${file.name}`);
      continue;
    }
    if (file.size > maxSize) {
      ElMessage.warning(`「${file.name}」超过大小限制（${maxSize / 1024 / 1024}MB）`);
      continue;
    }
    if (isDuplicateAttachment(file.name, file.size)) {
      ElMessage.warning(`附件「${file.name}」已存在`);
      continue;
    }
    if (!window.api) {
      ElMessage.warning('应用未初始化，请在 Electron 环境中运行');
      return;
    }
    try {
      aiIdentifyAttachmentsLoading.value = true;
      const base64Data = await readFileAsBase64(file);
      const res = await window.api.attachment.save({ name: file.name, base64Data });
      if (res.success && res.data) {
        aiIdentifyAttachments.value.push({
          name: res.data.name,
          path: res.data.path,
          type: res.data.type,
          size: res.data.size,
        });
        accepted++;
      } else {
        ElMessage.error(`附件「${file.name}」保存失败：${res.error?.message || '未知错误'}`);
      }
    } catch (error: any) {
      ElMessage.error(`附件「${file.name}」处理失败：${error.message || '未知错误'}`);
    } finally {
      aiIdentifyAttachmentsLoading.value = false;
    }
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      if (!base64) reject(new Error('文件内容读取失败'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function onImageFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files ? Array.from(target.files) : [];
  if (files.length > 0) addAttachmentFiles(files, 'image');
  target.value = '';
}

function onDocFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files ? Array.from(target.files) : [];
  if (files.length > 0) addAttachmentFiles(files, 'document');
  target.value = '';
}

function removeAttachment(index: number) {
  aiIdentifyAttachments.value.splice(index, 1);
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function handleAiIdentify() {
  if (!aiIdentifyDescription.value.trim() && aiIdentifyAttachments.value.length === 0) {
    ElMessage.warning('请先粘贴系统描述信息或添加附件');
    return;
  }
  aiIdentifyLoading.value = true;
  try {
    const imagePaths = aiIdentifyAttachments.value.filter(a => a.type === 'image').map(a => a.path);
    const documents = aiIdentifyAttachments.value.filter(a => a.type === 'document').map(a => a.path);
    let ocrPreprocess = false;
    try {
      const cfgRes = await window.api.ai.getConfig();
      if (cfgRes.success && cfgRes.data) {
        ocrPreprocess = Boolean((cfgRes.data as any).ocrPreprocess);
      }
    } catch { /* 配置读取失败时按默认关闭处理 */ }
    const res = await window.api.ai.identifyAssets({
      projectId: route.params.id as string,
      description: aiIdentifyDescription.value,
      imagePaths,
      documents,
      ocrPreprocess,
    });
    if (res.success && res.data) {
      aiIdentifyResults.value = (res.data.assets || []).map(a => ({ ...a, selected: true }));
      if (aiIdentifyResults.value.length === 0) ElMessage.info('AI 未识别出资产，请补充系统描述细节或附件');
    } else {
      ElMessage.error(res.error?.message || 'AI 资产识别失败');
    }
  } finally {
    aiIdentifyLoading.value = false;
  }
}

function isNonTargetCategory(cat: string) {
  return ['sys_doc', 'other_asset', 'crypto_product', 'security_personnel'].includes(cat);
}

async function handleImportIdentified() {
  const selected = aiIdentifyResults.value.filter(a => a.selected);
  if (selected.length === 0) {
    ElMessage.warning('请至少勾选一个资产');
    return;
  }
  aiImportLoading.value = true;
  try {
    const projectId = route.params.id as string;
    let failCount = 0;
    for (const a of selected) {
      try {
        await window.api.asset.create({
          projectId,
          category: a.category,
          name: a.name,
          os: a.os || '',
          version: a.version || '',
          deviceUsage: a.deviceUsage || '',
          description: a.description || '',
          quantity: a.quantity || 1,
          ip: a.ip || '',
          importance: a.importance || 'medium',
          isVirtual: a.isVirtual === true,
          dbSystem: a.dbSystem || '',
          middleware: a.middleware || '',
          isAssessmentTarget: !isNonTargetCategory(a.category),
        });
      } catch {
        failCount += 1;
      }
    }
    if (failCount > 0) {
      ElMessage.warning(`已导入 ${selected.length - failCount} 个资产，${failCount} 个失败`);
    } else {
      ElMessage.success(`成功导入 ${selected.length} 个资产`);
    }
    aiIdentifyVisible.value = false;
    loadAssets();
  } finally {
    aiImportLoading.value = false;
  }
}

// AI 缺失资产提醒
async function openAiMissing() {
  aiMissingVisible.value = true;
  await handleAiMissing();
}

async function handleAiMissing() {
  aiMissingLoading.value = true;
  try {
    const res = await window.api.ai.checkMissingAssets({ projectId: route.params.id as string });
    if (res.success && res.data) {
      aiMissingResults.value = (res.data.missing || []).map(m => ({
        ...m,
        categoryName: CATEGORY_NAMES[m.category] || m.category,
      }));
      if (aiMissingResults.value.length === 0) ElMessage.info('AI 认为当前资产构成已较完整');
    } else {
      ElMessage.error(res.error?.message || 'AI 缺失资产提醒失败');
    }
  } finally {
    aiMissingLoading.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    pagination.page = 1;
    loadAssets();
  }, 300);
}

// 保存（编辑弹窗）。弹窗已不提供新增，editingAsset 为空属于异常情况，直接关闭不做写入。
async function handleSave() {
  if (!formData.name.trim()) {
    ElMessage.warning('请输入设备名称');
    return;
  }
  if (!editingAsset.value) {
    showAddDialog.value = false;
    return;
  }

  saving.value = true;
  try {
    const res = await window.api.asset.update(editingAsset.value.id, {
      ...formData,
      category: currentCategory.value,
    });
    if (res.success) {
      ElMessage.success('保存成功');
      showAddDialog.value = false;
      editingAsset.value = null;
      resetForm();
      loadAssets();
    } else {
      ElMessage.error(res.error?.message || '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

// 新增一行（直接在表格末尾添加空行）
function addEmptyRow() {
  const newRow: any = {
    id: 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    projectId: route.params.id as string,
    category: currentCategory.value,
    name: '',
    os: '',
    version: '',
    deviceUsage: '',
    description: '',
    quantity: 1,
    ip: '',
    importance: 'medium',
    isVirtual: false,
    dbSystem: '',
    middleware: '',
    isAssessmentTarget: !['sys_doc', 'other_asset', 'crypto_product', 'security_personnel'].includes(currentCategory.value),
  };
  modifiedRows.add(String(newRow.id));
  assetList.value.unshift(newRow);
}

// 标记行为已修改
/**
 * 标记一行已修改，并把保存倒计时推后。
 *
 * 计时口径是「最后一次改动」而非「第一次进页面」：每次输入都会重置倒计时，
 * 正在填写的行不会在填到一半时被落库，更不会被重排掉焦点。
 * @param quick true = 勾选框/下拉/开关这类离散操作，用短延迟（不是连续输入行为）
 */
function markModified(row: Asset, quick = false) {
  if (row.id) {
    modifiedRows.add(String(row.id));
    debounceAutoSave(quick ? QUICK_SAVE_DELAY : undefined);
  }
}

// 保存所有修改
async function saveAllChanges() {
  saving.value = true;
  try {
    const success = await autoSave.saveAllChanges();
    if (success) {
      ElMessage.success('保存成功');
    } else if (autoSave.hasUnsavedChanges.value) {
      // 有行没落库（如接口报错）：必须说清楚，否则用户以为万事大吉
      ElMessage.error('部分修改保存失败，请检查内容后重试');
    } else {
      ElMessage.info('没有需要保存的修改');
    }
  } finally {
    saving.value = false;
  }
}

// 刷新数据
function refreshData() {
  loadAssets();
}

// 删除
async function handleDelete(row: Asset) {
  try {
    await ElMessageBox.confirm('确定要删除该资产吗？', '确认删除', {
      type: 'warning',
    });
  } catch {
    return;
  }
  
  if (String(row.id).startsWith('temp_')) {
    // 临时行（尚未保存到服务器）：直接从列表中移除
    assetList.value = assetList.value.filter(r => r.id !== row.id);
    modifiedRows.delete(String(row.id));
    return;
  }
  // 服务器已存在的行：标记为待删除，等待"保存修改"时统一删除
  deletedIds.add(String(row.id));
  modifiedRows.delete(String(row.id));
  assetList.value = assetList.value.filter(r => r.id !== row.id);
  // 必须触发自动保存：周期保存的门槛 hasUnsavedChanges 只在 debounceAutoSave 中置位，
  // 此前删除后不调用它，导致删除不手动保存就会被静默丢弃（切分类/翻页后"复活"）
  debounceAutoSave();
}

// 导出全部
async function handleExportAll() {
  const projectId = route.params.id as string;
  const res = await window.api.asset.exportExcel(projectId, 'all');

  if (res.success && res.data) {
    ElMessage.success('导出成功');
  } else if (res.success) {
    // 4.2「半假成功」：success=true 但 data 为空时，上面的两个分支都不命中，
    // 界面完全零反馈 —— 用户点了导出，既没成功提示也没失败提示，只能反复点
    ElMessage.warning('导出已返回成功但未携带文件信息，请确认导出目录是否已生成文件');
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '导出失败');
  }
}

// 下载导入模板
async function handleDownloadTemplate() {
  const projectId = route.params.id as string;
  const res = await window.api.asset.downloadTemplate(projectId);
  if (res.success && res.data) {
    ElMessage.success('模板下载成功');
  } else if (res.success) {
    // 同上：success=true 但 data 为空时原本零反馈
    ElMessage.warning('模板下载已返回成功但未携带文件信息，请确认保存目录');
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '下载模板失败');
  }
}

// 导入
async function handleImport() {
  const res = await window.api.system.selectFile([
    { name: 'Excel文件', extensions: ['xlsx', 'xls'] },
  ]);
  
  if (!res.success || !res.data) {
    return;
  }
  
  const projectId = route.params.id as string;
  const importRes = await window.api.asset.importExcel(projectId, res.data);
  
  if (importRes.success && importRes.data) {
    const { count, results } = importRes.data;
    const detail = results && results.length > 1
      ? `共 ${count} 条资产（${(results || []).map((r: { sheet: string; count: number }) => `${r.sheet}: ${r.count}条`).join('，')}）`
      : `成功导入 ${count} 条资产`;
    ElMessage.success(detail);
    loadAssets();
  } else {
    ElMessage.error(importRes.error?.message || '导入失败');
  }
}

// 导出
async function handleExport() {
  if (assetList.value.length === 0) {
    ElMessage.warning('没有可导出的数据');
    return;
  }
  
  const projectId = route.params.id as string;
  const res = await window.api.asset.exportExcel(projectId, currentCategory.value);
  
  if (res.success && res.data) {
    ElMessage.success('导出成功');
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '导出失败');
  }
}

function resetForm() {
  Object.assign(formData, {
    name: '',
    os: '',
    version: '',
    deviceUsage: '',
    description: '',
    quantity: 1,
    ip: '',
    importance: 'medium',
    isVirtual: false,
    isAssessmentTarget: true,
  });
}

// 打开「编辑资产」弹窗：把表格行回填到表单，交给 handleSave() 更新。
// 弹窗只保留编辑用途 —— 新增资产走「导入资产 / AI 识别 / 新增一行」，不在此弹窗中新建。
function openEditDialog(row: Asset) {
  editingAsset.value = row;
  Object.assign(formData, {
    name: (row as any).name || '',
    os: (row as any).os || '',
    version: (row as any).version || '',
    deviceUsage: (row as any).deviceUsage || '',
    description: (row as any).description || '',
    quantity: (row as any).quantity ?? 1,
    ip: (row as any).ip || '',
    importance: (row as any).importance || 'medium',
    isVirtual: (row as any).isVirtual ?? false,
    isAssessmentTarget: (row as any).isAssessmentTarget ?? true,
  });
  showAddDialog.value = true;
}

function handleTablePaste(event: ClipboardEvent) {
  const target = event.target as HTMLElement;
  if (!target) return;
  
  const inputEl = target.closest('input') || target.closest('textarea');
  if (!inputEl) return;
  
  const td = inputEl.closest('td') as HTMLTableCellElement;
  const tr = inputEl.closest('tr') as HTMLTableRowElement;
  if (!td || !tr) return;
  
  const colIndex = Array.from(tr.cells).indexOf(td);
  const table = tr.closest('table');
  if (!table) return;
  
  let rowIndex = -1;
  const tbody = table.querySelector('tbody');
  if (tbody) {
    rowIndex = Array.from(tbody.rows).indexOf(tr);
  }
  
  if (rowIndex < 0 || colIndex < 0) return;
  if (rowIndex >= assetList.value.length) return;
  
  const editableCols = getEditableColumns();
  const fieldIndex = colIndex - 1;
  
  if (fieldIndex < 0 || fieldIndex >= editableCols.length) return;
  
  const field = editableCols[fieldIndex];
  const row = assetList.value[rowIndex];
  
  handlePaste(event, row, field);
}

let pasteHandler: ((e: Event) => void) | null = null;

// Ctrl+S 保存（由 MainLayout 统一派发 app:global-save）
function onGlobalSave() {
  if (saving.value) return;
  saveAllChanges();
}

onMounted(() => {
  loadProject();
  loadAssets();
  startPeriodicSave();
  window.addEventListener('app:global-save', onGlobalSave);
  
  nextTick(() => {
    pasteHandler = (e: Event) => {
      handleTablePaste(e as ClipboardEvent);
    };
    if (tableWrapperRef.value) {
      tableWrapperRef.value.addEventListener('paste', pasteHandler as EventListener);
    }
  });
});

onUnmounted(() => {
  cleanup();
  window.removeEventListener('app:global-save', onGlobalSave);
  // P2-12：搜索防抖定时器此前从未清理。组件卸载后若定时器仍在等待，
  // 回调里的 loadAssets() 会对已销毁的组件发起请求并写入响应式状态，
  // 快速切换页面时会打出"组件已卸载"类告警，甚至用旧页面的结果覆盖新数据。
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  if (pasteHandler && tableWrapperRef.value) {
    tableWrapperRef.value.removeEventListener('paste', pasteHandler as EventListener);
  }
});
</script>

<style lang="scss" scoped>
.project-context-bar {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 16px 24px;
  margin-bottom: 16px;

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--color-text-tertiary);
    margin-bottom: 12px;

    .back-btn {
      cursor: pointer;
      color: var(--color-text-tertiary);
      margin-right: 4px;
      transition: color 0.15s;

      &:hover {
        color: var(--color-primary);
      }
    }

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
      border-radius: var(--radius-full);
      background: var(--color-bg-base);
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
        background: var(--color-border-base);
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

.category-nav-bar {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 0 20px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  overflow-x: auto;
  white-space: nowrap;

  &::-webkit-scrollbar {
    display: none;
  }

  .category-tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--color-text-secondary);
    border-bottom: 2px solid transparent;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, border-color 0.15s;

    &:hover {
      color: var(--color-primary);
    }

    &.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
    }

    .cat-icon {
      flex-shrink: 0;
    }
  }
}

.data-table-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);

  .table-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px;
    border-bottom: 1px solid var(--color-border-light);

    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 10px;

      .category-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .asset-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: var(--radius-full);
        background: var(--color-primary-light);
        color: var(--color-primary);
        font-size: 11px;
        font-weight: 600;
      }
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 6px;

      .toolbar-sep {
        width: 1px;
        height: 22px;
        background: var(--color-border-light);
        margin: 0 4px;
      }

      .toolbar-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 32px;
        padding: 0 12px;
        border: 1px solid var(--color-border-default);
        border-radius: var(--radius-base);
        background: var(--color-bg-card);
        color: var(--color-text-secondary);
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
        font-family: inherit;
        transition: all 0.15s;

        &:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }

        &.btn-confirm {
          border-color: var(--color-success, #67C23A);
          color: var(--color-success, #67C23A);
          background: var(--color-success-light);

          &:hover {
            background: var(--color-success, #67C23A);
            color: #fff;
          }
        }

        &.btn-primary {
          border-color: var(--color-primary);
          background: var(--color-primary);
          color: #fff;

          &:hover {
            opacity: 0.9;
          }
        }

        &.btn-light {
          border-color: var(--color-primary);
          color: var(--color-primary);
          background: var(--color-primary-light);

          &:hover {
            background: var(--color-primary);
            color: #fff;
          }
        }
      }

      .toolbar-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: 1px solid transparent;
        border-radius: var(--radius-base);
        background: transparent;
        color: var(--color-text-tertiary);
        cursor: pointer;
        transition: all 0.15s;

        &:hover {
          background: var(--color-bg-page);
          color: var(--color-text-primary);
          border-color: var(--color-border-default);
        }

        &.active {
          background: var(--color-primary-light, rgba(27, 95, 217, 0.08));
          color: var(--color-primary);
          border-color: var(--color-primary);
        }
      }

      .search-box {
        position: relative;

        .search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--color-text-tertiary, #9CA3AF);
        }

        .search-input {
          height: 32px;
          padding: 0 12px 0 32px;
          border: 1px solid var(--color-border-default, #E5E7EB);
          border-radius: var(--radius-md, 6px);
          font-size: 12px;
          color: var(--color-text-primary, #111827);
          background: var(--color-bg-card);
          outline: none;
          width: 200px;
          transition: border-color 0.15s;

          &:focus {
            border-color: var(--color-primary, #1B5FD9);
          }
        }
      }
    }
  }

  :deep(.el-table) {
    th.el-table__cell {
      background: var(--color-bg-hover);
      color: var(--color-text-secondary);
      font-weight: 500;
      font-size: 12px;

      > .cell {
        padding: 6px 8px;
      }
    }

    td.el-table__cell {
      padding: 4px 0;

      > .cell {
        padding: 4px 8px;
      }
    }

    .el-table__body tr:hover > td {
      background: var(--color-bg-hover, #FAFBFD);
    }
  }

  .device-name {
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .ip-address {
    font-family: var(--font-family-mono, 'Consolas', monospace);
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .guide-text {
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .importance-tag {
    display: inline-block;
    padding: 0 8px;
    height: 22px;
    line-height: 22px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 500;

    &.tag-high {
      background: var(--color-danger-light);
      color: #dc2626;
    }

    &.tag-medium {
      background: var(--color-warning-light);
      color: #ea580c;
    }

    &.tag-low {
      background: var(--color-bg-base);
      color: #6b7280;
    }
  }

  .pagination-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid var(--color-border-light, #F0F0F3);
    background: var(--color-bg-base);

    .footer-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;

      .total-text {
        font-size: 12px;
        color: var(--color-text-tertiary, #9CA3AF);
        white-space: nowrap;
      }

      .modified-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: var(--radius-full);
        background: var(--color-warning-light);
        color: #D97706;
        font-size: 11px;
        font-weight: 500;
      }

      .save-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: var(--radius-full);
        font-size: 11px;
        font-weight: 500;

        .save-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          display: inline-block;
        }

        &.saving {
          background: var(--color-primary-light);
          color: var(--color-primary);
          .save-dot { background: var(--color-primary); animation: pulse 1s infinite; }
        }
        &.saved {
          background: var(--color-success-light);
          color: var(--color-success);
          .save-dot { background: var(--color-success); }
        }
        &.unsaved {
          background: var(--color-warning-light);
          color: var(--color-warning);
          .save-dot { background: var(--color-warning); }
        }
        &.error {
          background: var(--color-danger-light);
          color: var(--color-danger);
          .save-dot { background: var(--color-danger); }
        }
      }
    }

    .pagination-btns {
      display: flex;
      align-items: center;
      gap: 4px;

      .page-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 1px solid var(--color-border-default, #E5E7EB);
        border-radius: var(--radius-sm, 2px);
        background: var(--color-bg-card);
        cursor: pointer;
        color: var(--color-text-secondary, #4B5563);
        font-size: 12px;
        transition: all 0.15s;

        &:hover:not(:disabled) {
          border-color: var(--color-primary, #1B5FD9);
          color: var(--color-primary, #1B5FD9);
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          color: var(--color-text-tertiary, #9CA3AF);
        }

        &.active {
          border-color: var(--color-primary, #1B5FD9);
          background: var(--color-primary, #1B5FD9);
          color: #fff;
          font-weight: 500;
        }
      }
    }

    .footer-right {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .footer-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 10px;
      border: 1px solid var(--color-border-default, #E5E7EB);
        border-radius: var(--radius-md, 6px);
        background: var(--color-bg-card);
        color: var(--color-text-secondary, #4B5563);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;

      &:hover:not(:disabled) {
        border-color: var(--color-primary, #1B5FD9);
        color: var(--color-primary, #1B5FD9);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &.primary {
        border: none;
        background: var(--color-primary, #1B5FD9);
        color: #fff;

        &:hover:not(:disabled) {
          background: var(--color-primary-hover, #1550B8);
        }

        &:disabled {
          background: #9CA3AF;
        }
      }
    }
  }
}

// 单元格输入框样式
.cell-input {
  :deep(.el-input__wrapper) {
    box-shadow: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 0 8px;
    height: 30px;
    background: transparent;
    transition: border-color 0.15s, background 0.15s;

    &:hover {
      border-color: var(--color-border-default);
      background: var(--color-bg-card);
    }

    &.is-focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 1px var(--color-primary) inset;
      background: var(--color-bg-card);
    }
  }
}

// 对话框样式
.asset-form {
  :deep(.el-form-item) {
    margin-bottom: 16px;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

// AI 资产识别 / 缺失提醒
.toolbar-btn.ai-btn {
  color: var(--color-ai);
  border-color: rgba(139, 92, 246, 0.35);

  &:hover:not(:disabled) {
    color: var(--color-ai-hover);
    border-color: rgba(139, 92, 246, 0.65);
    background: rgba(139, 92, 246, 0.06);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.ai-tip {
  font-size: 13px;
  color: var(--color-text-tertiary);
  line-height: 1.6;
  margin-bottom: 10px;
}

.ai-id-results {
  .ai-id-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;

    .ai-id-count {
      font-size: 13px;
      color: var(--color-text-secondary);
    }
  }

  .ai-id-list {
    max-height: 420px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ai-id-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--color-border-base);
    border-radius: var(--radius-md);
    transition: border-color 0.15s, background 0.15s;

    &.checked {
      background: rgba(139, 92, 246, 0.04);
      border-color: rgba(139, 92, 246, 0.35);
    }

    .ai-id-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ai-id-cat {
      width: 150px;
      flex-shrink: 0;
    }

    .ai-id-name {
      flex: 1;
      min-width: 120px;
    }

    .ai-id-imp {
      width: 90px;
      flex-shrink: 0;
    }

    .ai-id-usage {
      width: 160px;
      flex-shrink: 0;
      font-size: 12px;
      color: var(--color-text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ai-id-toggle {
      flex-shrink: 0;
      padding: 0 4px;
      font-size: 12px;
    }

    .ai-id-detail {
      padding: 8px 4px 2px;
      border-top: 1px dashed var(--color-border-base);
    }

    .ai-id-detail-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px 12px;
    }

    .ai-id-field {
      display: flex;
      flex-direction: column;
      gap: 2px;

      label {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }

      &.ai-id-field-full {
        grid-column: 1 / -1;
      }
    }
  }
}

.ai-attachments {
  margin-bottom: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 12px;

  .ai-attachments-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;

    .ai-attachments-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text);
    }

    .ai-attachments-hint {
      font-size: 12px;
      color: var(--color-text-tertiary);
    }
  }

  .ai-attachments-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .ai-attachments-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
  }

  .ai-attachment-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--color-bg-subtle);
    border-radius: var(--radius-base);
    font-size: 12px;

    .ai-att-icon {
      font-size: 16px;
      &.is-image { color: var(--color-primary); }
      &.is-doc { color: #8a6d3b; }
    }

    .ai-att-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--color-text-secondary);
    }

    .ai-att-size {
      color: var(--color-text-tertiary);
      font-size: 11px;
    }

    .ai-att-remove {
      padding: 2px;
      min-width: 0;
    }
  }
}

.ai-identify-footer-left {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.ai-missing-body {
  min-height: 120px;

  .ai-missing-empty {
    text-align: center;
    padding: 32px 0;
    font-size: 13px;
    color: var(--color-text-tertiary);
  }

  .ai-missing-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 440px;
    overflow-y: auto;
  }

  .ai-missing-item {
    border: 1px solid var(--color-border-base);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    background: var(--color-bg-base);

    .ai-missing-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: #d97706;
      margin-bottom: 8px;
    }

    .ai-missing-row {
      display: flex;
      gap: 8px;
      font-size: 13px;
      line-height: 1.7;
      color: var(--color-text-secondary);

      .ai-missing-label {
        flex-shrink: 0;
        color: var(--color-text-tertiary);

        &::after {
          content: '：';
        }
      }
    }
  }
}

.filter-panel {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 16px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  margin-bottom: 12px;

  .filter-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .filter-label {
    font-size: 12px;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .filter-select {
    height: 30px;
    min-width: 120px;
    padding: 0 8px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-base);
    font-size: 12px;
    color: var(--color-text-primary);
    background: var(--color-bg-card);
    outline: none;

    &:focus {
      border-color: var(--color-primary);
    }
  }

  .filter-reset {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-base);
    background: var(--color-bg-card);
    font-size: 12px;
    color: var(--color-text-secondary);
    cursor: pointer;

    &:hover:not(:disabled) {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .filter-summary {
    font-size: 12px;
    color: var(--color-text-tertiary);
  }
}
</style>
