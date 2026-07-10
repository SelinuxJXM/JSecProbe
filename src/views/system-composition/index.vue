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
    <div class="category-nav-bar">
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

    <!-- 数据表格卡片 -->
    <div class="data-table-card">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <span class="category-title">{{ currentCategoryName }}</span>
          <span class="asset-badge">{{ pagination.total }}</span>
        </div>
        <div class="toolbar-right">
          <button class="toolbar-btn" @click="handleImport">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            导入资产
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
          <button class="toolbar-icon-btn" title="筛选">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          </button>
        </div>
      </div>

      <div ref="tableWrapperRef" class="table-wrapper">
      <el-table
        :data="assetList"
        style="width: 100%"
        :row-height="44"
        v-loading="loading"
        header-cell-class-name="design-header-cell"
      >
        <el-table-column type="index" label="序号" width="50" align="center" />
        <!-- 机房名称 / 边界名称 / 数据库名称 / 设备名称 -->
        <el-table-column v-if="currentCategory === 'machine_room'" label="机房名称" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.name" placeholder="机房名称" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'network_boundary'" label="边界名称" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.name" placeholder="边界名称" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'dbms'" label="数据库名称" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.name" placeholder="数据库名称" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'management_platform'" label="系统名称" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.name" placeholder="系统名称" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'business_app'" label="应用系统名称" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.name" placeholder="应用系统名称" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'data_resource'" label="数据类别" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.name" placeholder="数据类别" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'dbms' && currentCategory !== 'management_platform' && currentCategory !== 'business_app' && currentCategory !== 'data_resource'" label="设备名称" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.name" placeholder="设备名称" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 虚拟设备 -->
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'dbms' && currentCategory !== 'management_platform' && currentCategory !== 'business_app' && currentCategory !== 'data_resource'" label="虚拟设备" width="80" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.isVirtual" @change="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 机房位置 -->
        <el-table-column v-if="currentCategory === 'machine_room'" label="机房位置" min-width="130">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="机房位置" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 系统及版本 -->
        <el-table-column v-if="currentCategory === 'network_device' || currentCategory === 'security_device'" label="系统及版本" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="系统及版本" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'server_storage'" label="操作系统及版本" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="操作系统及版本" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'dbms' || currentCategory === 'management_platform'" label="所在设备名称" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="所在设备名称" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'business_app'" label="软件及版本" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="软件及版本" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'data_resource'" label="所属业务应用" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="所属业务应用" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'terminal'" label="操作系统及版本" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="操作系统及版本" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'network_device' && currentCategory !== 'security_device' && currentCategory !== 'server_storage' && currentCategory !== 'dbms' && currentCategory !== 'management_platform' && currentCategory !== 'business_app' && currentCategory !== 'data_resource' && currentCategory !== 'terminal'" label="操作系统" min-width="130">
          <template #default="{ row }">
            <el-input v-model="row.os" placeholder="操作系统" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 品牌及型号+设备用途（网络设备/安全设备）/ 数据库系统及版本+中间件及版本（服务器）/ 类型/版本（数据库） -->
        <el-table-column v-if="currentCategory === 'network_device' || currentCategory === 'security_device'" label="品牌及型号" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.version" placeholder="品牌及型号" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'network_device' || currentCategory === 'security_device'" label="设备用途" min-width="100">
          <template #default="{ row }">
            <el-input v-model="row.deviceUsage" placeholder="设备用途" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'server_storage'" label="数据库系统及版本" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.dbSystem" placeholder="如 MySQL 8.0" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'server_storage'" label="中间件及版本" min-width="150">
          <template #default="{ row }">
            <el-input v-model="row.middleware" placeholder="如 Tomcat 9.0" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'dbms'" label="类型/版本" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.deviceUsage" placeholder="如 Oracle 19c" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'management_platform'" label="版本" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.version" placeholder="版本" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'business_app' || currentCategory === 'management_platform'" label="主要功能" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.deviceUsage" placeholder="主要功能描述" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory === 'data_resource'" label="安全防护需求" min-width="200">
          <template #default="{ row }">
            <el-input v-model="row.deviceUsage" placeholder="如 保密性、完整性" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'network_device' && currentCategory !== 'security_device' && currentCategory !== 'server_storage' && currentCategory !== 'dbms' && currentCategory !== 'management_platform' && currentCategory !== 'business_app' && currentCategory !== 'data_resource'" label="设备类别/用途" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.deviceUsage" placeholder="设备用途" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 备注 -->
        <el-table-column v-if="currentCategory !== 'data_resource' && currentCategory !== 'management_platform'" label="备注" min-width="120">
          <template #default="{ row }">
            <el-input v-model="row.description" placeholder="备注" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <!-- 数量 -->
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'business_app' && currentCategory !== 'data_resource' && currentCategory !== 'management_platform'" label="数量" width="70" align="center">
          <template #default="{ row }">
            <el-input-number v-model="row.quantity" :min="1" :max="999" size="small" controls-position="right" style="width: 68px" @change="markModified(row)" />
          </template>
        </el-table-column>
        <!-- IP地址 -->
        <el-table-column v-if="currentCategory !== 'machine_room' && currentCategory !== 'network_boundary' && currentCategory !== 'dbms' && currentCategory !== 'business_app' && currentCategory !== 'data_resource'" label="IP地址" min-width="130">
          <template #default="{ row }">
            <el-input v-model="row.ip" placeholder="IP地址" size="small" class="cell-input" @input="markModified(row)" />
          </template>
        </el-table-column>
        <el-table-column label="重要程度" width="100" align="center">
          <template #default="{ row }">
            <el-select v-model="row.importance" size="small" style="width: 100%" @change="markModified(row)">
              <el-option label="关键" value="high" />
              <el-option label="重要" value="medium" />
              <el-option label="一般" value="low" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="测评对象" width="80" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.isAssessmentTarget" size="small" @change="markModified(row)" />
            <span style="font-size:12px; color:#4B5563; margin-left:4px;">是</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
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
        </div>
        <div class="pagination-btns">
          <button class="page-btn" :disabled="pagination.page <= 1" @click="pagination.page--; loadAssets()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button v-for="p in visiblePages" :key="p" class="page-btn" :class="{ active: pagination.page === p }" @click="pagination.page = p; loadAssets()">
            {{ p }}
          </button>
          <button class="page-btn" :disabled="pagination.page >= totalPages" @click="pagination.page++; loadAssets()">
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

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="showAddDialog"
      :title="editingAsset ? '编辑资产' : '新增资产'"
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
              <el-switch v-model="formData.isVirtual" />
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
} from '@element-plus/icons-vue';
import type { Asset, AssetCategory, AssetListResult } from '@shared/types';

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

// 记录修改过的行ID（新增行用临时负数ID标记）
const modifiedRows = reactive(new Set<string>());
const deletedIds = reactive(new Set<string>());
const modifiedCount = computed(() => modifiedRows.size + deletedIds.size);

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

// 分类名称映射
const CATEGORY_NAMES: Record<string, string> = {
  machine_room: '管理机房',
  network_boundary: '区域边界',
  network_device: '网络设备',
  security_device: '安全设备',
  server_storage: '服务器/存储设备',
  dbms: '数据库管理系统',
  management_platform: '系统管理平台',
  business_app: '业务应用系统',
  terminal: '业务终端/运维终端',
  data_resource: '数据资源',
};

// 分类图标映射 (SVG innerHTML)
const CATEGORY_ICONS: Record<string, string> = {
  machine_room: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/>',
  network_boundary: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  network_device: '<rect x="2" y="14" width="20" height="6" rx="1"/><circle cx="6" cy="17" r="1"/><circle cx="12" cy="17" r="1"/><rect x="8" y="4" width="8" height="6" rx="1"/><line x1="12" y1="10" x2="12" y2="14"/>',
  security_device: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  server_storage: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  dbms: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  management_platform: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/>',
  business_app: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  terminal: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  data_resource: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
};

const currentCategoryName = computed(() => CATEGORY_NAMES[currentCategory.value] || currentCategory.value);

const EDITABLE_COLUMNS: Record<string, string[]> = {
  machine_room: ['name', 'os', 'description', 'importance', 'isAssessmentTarget'],
  network_boundary: ['name', 'description', 'importance', 'isAssessmentTarget'],
  network_device: ['name', 'isVirtual', 'os', 'version', 'deviceUsage', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  security_device: ['name', 'isVirtual', 'os', 'version', 'deviceUsage', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  server_storage: ['name', 'isVirtual', 'os', 'dbSystem', 'middleware', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  dbms: ['name', 'os', 'deviceUsage', 'description', 'quantity', 'importance', 'isAssessmentTarget'],
  management_platform: ['name', 'os', 'version', 'ip', 'deviceUsage', 'importance', 'isAssessmentTarget'],
  business_app: ['name', 'os', 'deviceUsage', 'description', 'ip', 'importance', 'isAssessmentTarget'],
  terminal: ['name', 'isVirtual', 'os', 'deviceUsage', 'description', 'quantity', 'ip', 'importance', 'isAssessmentTarget'],
  data_resource: ['name', 'os', 'deviceUsage', 'importance', 'isAssessmentTarget'],
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
        isAssessmentTarget: true,
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
      assetList.value = data.list.map(row => ({ ...row }));
      pagination.total = data.total;
      categories.value = data.categoryStats;
      modifiedRows.clear();
      deletedIds.clear();
      
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
          assetList.value = data2.list.map(row => ({ ...row }));
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
          assetList.value = data3.list.map(row => ({ ...row }));
          pagination.total = data3.total;
        }
      }
    }
  } finally {
    loading.value = false;
  }
}

// 切换分类
function handleCategoryChange(categoryId: string) {
  currentCategory.value = categoryId;
  pagination.page = 1;
  loadAssets();
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    pagination.page = 1;
    loadAssets();
  }, 300);
}

// 保存（弹窗）
async function handleSave() {
  if (!formData.name.trim()) {
    ElMessage.warning('请输入设备名称');
    return;
  }
  
  const projectId = route.params.id as string;
  saving.value = true;
  try {
    if (editingAsset.value) {
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
    } else {
      const res = await window.api.asset.create({
        ...formData,
        projectId,
        category: currentCategory.value,
      });
      if (res.success) {
        ElMessage.success('添加成功');
        showAddDialog.value = false;
        resetForm();
        loadAssets();
      } else {
        ElMessage.error(res.error?.message || '添加失败');
      }
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
    isAssessmentTarget: true,
  };
  modifiedRows.add(String(newRow.id));
  assetList.value.unshift(newRow);
}

// 标记行为已修改
function markModified(row: Asset) {
  if (row.id) {
    modifiedRows.add(String(row.id));
  }
}

// 保存所有修改
async function saveAllChanges() {
  const projectId = route.params.id as string;
  saving.value = true;
  let created = 0;
  let updated = 0;
  let deleted = 0;
  try {
    // 先执行待删除操作
    for (const id of deletedIds) {
      const res = await window.api.asset.remove(id);
      if (res.success) deleted++;
    }
    deletedIds.clear();

    for (const row of assetList.value) {
      const modified = modifiedRows.has(String(row.id));
      const isNewRow = String(row.id).startsWith('temp_');
      if (!modified && !isNewRow) continue;
      
      if (isNewRow) {
        // 新增行
        if (!row.name.trim()) continue;
        const res = await window.api.asset.create({
          projectId: row.projectId || projectId,
          category: row.category || currentCategory.value,
          name: row.name.trim(),
          os: row.os,
          version: row.version,
          deviceUsage: row.deviceUsage,
          description: row.description,
          quantity: row.quantity,
          ip: row.ip,
          importance: row.importance,
          isVirtual: row.isVirtual,
          dbSystem: row.dbSystem || undefined,
          middleware: row.middleware || undefined,
          isAssessmentTarget: row.isAssessmentTarget,
        });
        if (res.success) created++;
      } else {
        // 已有行更新
        const res = await window.api.asset.update(row.id, {
          name: row.name,
          os: row.os,
          version: row.version,
          deviceUsage: row.deviceUsage,
          description: row.description,
          quantity: row.quantity,
          ip: row.ip,
          importance: row.importance,
          isVirtual: row.isVirtual,
          dbSystem: row.dbSystem || undefined,
          middleware: row.middleware || undefined,
          isAssessmentTarget: row.isAssessmentTarget,
        });
        if (res.success) updated++;
      }
    }
    const messages: string[] = [];
    if (created > 0) messages.push(`新增 ${created} 条`);
    if (updated > 0) messages.push(`更新 ${updated} 条`);
    if (deleted > 0) messages.push(`删除 ${deleted} 条`);
    if (messages.length > 0) {
      ElMessage.success(messages.join('，'));
    } else {
      ElMessage.info('没有需要保存的修改');
    }
    modifiedRows.clear();
    await loadAssets();
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
}

// 导出全部
async function handleExportAll() {
  const projectId = route.params.id as string;
  const res = await window.api.asset.exportExcel(projectId, 'all');

  if (res.success && res.data) {
    ElMessage.success('导出成功');
  } else if (res.error?.message !== '用户取消') {
    ElMessage.error(res.error?.message || '导出失败');
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

onMounted(() => {
  loadProject();
  loadAssets();
  
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
      border-radius: 999px;
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
  padding: 0 24px;
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
    gap: 6px;
    padding: 12px 18px;
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
        border-radius: 999px;
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
        border-radius: 6px;
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
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-tertiary);
        cursor: pointer;
        transition: all 0.15s;

        &:hover {
          background: var(--color-bg-page);
          color: var(--color-text-primary);
          border-color: var(--color-border-default);
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
    border-radius: 4px;
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
        border-radius: 999px;
        background: var(--color-warning-light);
        color: #D97706;
        font-size: 11px;
        font-weight: 500;
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
    border-radius: 4px;
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
</style>
