<template>
  <div class="page-container">
    <div class="page-header">
      <div class="page-header-title">系统设置</div>
      <div class="page-header-desc">配置系统参数与偏好设置</div>
    </div>

    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 常规设置 -->
    <template v-if="activeTab === 'settings'">
      <el-row :gutter="16">
        <el-col :span="12">
          <div class="card p-md">
            <div class="settings-section-title">外观设置</div>
            
            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">主题模式</div>
                <div class="settings-item-desc">选择浅色或深色主题</div>
              </div>
              <el-radio-group v-model="themeMode" @change="handleThemeChange">
                <el-radio-button value="light">浅色</el-radio-button>
                <el-radio-button value="dark">深色</el-radio-button>
                <el-radio-button value="auto">跟随系统</el-radio-button>
              </el-radio-group>
            </div>

            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">主题色</div>
                <div class="settings-item-desc">设置主色调</div>
              </div>
              <el-color-picker v-model="primaryColor" @change="handlePrimaryColorChange" show-alpha />
            </div>
          </div>

          <div class="card p-md mt-md">
            <div class="settings-section-title">数据管理</div>
            
            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">数据备份</div>
                <div class="settings-item-desc">将所有数据导出为备份文件</div>
              </div>
              <el-button type="primary" :icon="Download" @click="handleBackup">
                立即备份
              </el-button>
            </div>

            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">数据恢复</div>
                <div class="settings-item-desc">从备份文件恢复数据（将覆盖现有数据）</div>
              </div>
              <el-button type="warning" :icon="Upload" @click="handleRestore">
                恢复数据
              </el-button>
            </div>

            <div class="settings-item">
              <div class="settings-item-info">
                <div class="settings-item-name">数据存储位置</div>
                <div class="settings-item-desc">数据库文件所在目录</div>
              </div>
              <div class="data-path-actions">
                <el-button text type="primary" @click="handleOpenDataFolder" class="path-display-btn">
                  {{ dataPath || '加载中...' }}
                </el-button>
                <el-button size="small" type="warning" @click="handleChangeDataPath">
                  更改
                </el-button>
              </div>
            </div>
          </div>
        </el-col>

        <el-col :span="12">
          <div class="card p-md">
            <div class="settings-section-title">系统信息</div>
            
            <div class="info-list">
              <div class="info-item">
                <span class="info-label">应用版本</span>
                <span class="info-value">
                  {{ systemInfo.appVersion || '-' }}
                  <el-button
                    text
                    type="primary"
                    size="small"
                    :loading="updateStatus.status === 'checking'"
                    @click="handleCheckUpdate"
                    style="margin-left: 8px"
                  >
                    检查更新
                  </el-button>
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">更新状态</span>
                <span class="info-value">
                  <template v-if="updateStatus.status === 'idle'">未检查</template>
                  <template v-else-if="updateStatus.status === 'checking'">正在检查...</template>
                  <template v-else-if="updateStatus.status === 'notavailable'">
                    <el-tag type="success" size="small">已是最新版本</el-tag>
                  </template>
                  <template v-else-if="updateStatus.status === 'available'">
                    <el-tag type="warning" size="small">
                      发现新版本 v{{ updateStatus.version }}
                    </el-tag>
                    <el-button
                      type="primary"
                      size="small"
                      @click="handleDownloadUpdate"
                      style="margin-left: 8px"
                    >
                      立即更新
                    </el-button>
                  </template>
                  <template v-else-if="updateStatus.status === 'downloading'">
                    <el-progress
                      :percentage="updateStatus.downloadProgress || 0"
                      :stroke-width="6"
                      style="width: 120px"
                    />
                  </template>
                  <template v-else-if="updateStatus.status === 'downloaded'">
                    <el-tag type="success" size="small">下载完成</el-tag>
                    <el-button
                      type="primary"
                      size="small"
                      @click="handleInstallUpdate"
                      style="margin-left: 8px"
                    >
                      立即安装
                    </el-button>
                  </template>
                  <template v-else-if="updateStatus.status === 'error'">
                    <el-tag type="danger" size="small">{{ updateStatus.error }}</el-tag>
                  </template>
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">Electron 版本</span>
                <span class="info-value">{{ systemInfo.electronVersion || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Node.js 版本</span>
                <span class="info-value">{{ systemInfo.nodeVersion || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">运行平台</span>
                <span class="info-value">{{ systemInfo.platform || '-' }}</span>
              </div>
            </div>
          </div>

          <div class="card p-md mt-md">
            <div class="settings-section-title">关于</div>
            <div class="about-content">
              <p>
                <strong>JSecProbe</strong>
              </p>
              <p>
                本系统依据《GB/T 22239-2019 信息安全技术 网络安全等级保护基本要求》开发，
                用于辅助测评人员完成等级保护现场测评工作。
              </p>
              <p class="about-tip">
                <el-icon><InfoFilled /></el-icon>
                测评过程中请严格遵守相关法律法规和保密规定。
              </p>
            </div>
          </div>
        </el-col>
      </el-row>
    </template>

    <!-- 用户管理 -->
    <template v-if="activeTab === 'users'">
      <div class="card p-md">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="settings-section-title" style="margin-bottom: 0">用户列表</div>
          </div>
          <div class="toolbar-right">
            <el-button type="primary" :icon="Plus" @click="showUserDialog = true">
              新增用户
            </el-button>
          </div>
        </div>

        <el-table :data="userList" v-loading="userLoading" stripe>
          <el-table-column prop="username" label="用户名" width="140" />
          <el-table-column prop="realName" label="姓名" width="120" />
          <el-table-column prop="email" label="邮箱" min-width="180" />
          <el-table-column prop="phone" label="电话" width="140" />
          <el-table-column prop="role" label="角色" width="100">
            <template #default="{ row }">
              <el-tag :type="row.role === 'admin' ? 'danger' : 'primary'" size="small">
                {{ row.role === 'admin' ? '管理员' : '测评师' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="isActive" label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.isActive ? 'success' : 'info'" size="small">
                {{ row.isActive ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="lastLoginAt" label="最后登录" width="160">
            <template #default="{ row }">
              {{ row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN') : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link size="small" @click="handleEditUser(row)">
                编辑
              </el-button>
              <el-button
                :type="row.isActive ? 'warning' : 'success'"
                link
                size="small"
                @click="handleToggleUser(row)"
              >
                {{ row.isActive ? '禁用' : '启用' }}
              </el-button>
              <el-button
                v-if="row.role !== 'admin'"
                type="danger"
                link
                size="small"
                @click="handleDeleteUser(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog v-model="showUserDialog" :title="editingUser ? '编辑用户' : '新增用户'" width="460px" destroy-on-close>
        <el-form :model="userForm" label-width="90px">
          <el-form-item label="用户名" required>
            <el-input v-model="userForm.username" placeholder="请输入用户名" :disabled="!!editingUser" />
          </el-form-item>
          <el-form-item label="密码" :required="!editingUser">
            <el-input v-model="userForm.password" type="password" show-password :placeholder="editingUser ? '留空则不修改' : '请输入密码'" />
          </el-form-item>
          <el-form-item label="姓名" required>
            <el-input v-model="userForm.realName" placeholder="请输入真实姓名" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="userForm.email" placeholder="请输入邮箱" />
          </el-form-item>
          <el-form-item label="电话">
            <el-input v-model="userForm.phone" placeholder="请输入电话" />
          </el-form-item>
          <el-form-item label="角色">
            <el-select v-model="userForm.role" style="width: 100%">
              <el-option label="管理员" value="admin" />
              <el-option label="测评师" value="assessor" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showUserDialog = false">取消</el-button>
          <el-button type="primary" @click="handleSaveUser" :loading="userSaving">保存</el-button>
        </template>
      </el-dialog>
    </template>

    <!-- 操作日志 -->
    <template v-if="activeTab === 'logs'">
      <div class="card p-md">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="settings-section-title" style="margin-bottom: 0">操作日志</div>
          </div>
          <div class="toolbar-right">
            <el-select v-model="logModule" style="width: 140px" placeholder="模块筛选" clearable @change="loadLogs">
              <el-option v-for="m in logModules" :key="m.value" :label="m.label" :value="m.value" />
            </el-select>
            <el-select v-model="logAction" style="width: 120px" placeholder="操作筛选" clearable @change="loadLogs">
              <el-option v-for="a in logActions" :key="a.value" :label="a.label" :value="a.value" />
            </el-select>
            <el-button :icon="Refresh" @click="loadLogs">刷新</el-button>
          </div>
        </div>

        <el-table :data="logList" v-loading="logLoading" stripe>
          <el-table-column prop="createdAt" label="时间" width="160">
            <template #default="{ row }">
              {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
            </template>
          </el-table-column>
          <el-table-column prop="username" label="用户" width="100" />
          <el-table-column prop="module" label="模块" width="100" />
          <el-table-column prop="action" label="操作" width="100" />
          <el-table-column prop="targetName" label="目标" width="150" />
          <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        </el-table>

        <div class="pagination-wrapper">
          <span class="total-text">共 {{ logTotal }} 条</span>
          <el-pagination
            v-model:current-page="logPage"
            :total="logTotal"
            size="small"
            :page-size="30"
            layout="prev, pager, next"
            @current-change="loadLogs"
          />
        </div>
      </div>
    </template>

    <!-- 标准库管理 -->
    <template v-if="activeTab === 'standards'">
      <div class="card p-md">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="settings-section-title" style="margin-bottom: 0">标准库列表</div>
          </div>
          <div class="toolbar-right">
            <el-input
              v-model="standardKeyword"
              placeholder="搜索标准库名称..."
              clearable
              style="width: 220px"
              @input="filterStandards"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-button :icon="Refresh" @click="loadStandards">刷新</el-button>
          </div>
        </div>

        <el-table :data="filteredStandardList" v-loading="standardLoading" stripe>
          <el-table-column prop="name" label="名称" min-width="180" />
          <el-table-column prop="version" label="版本" width="100" align="center" />
          <el-table-column prop="itemCount" label="控制点数量" width="110" align="center" />
          <el-table-column prop="isDefault" label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.isDefault ? 'success' : 'info'" size="small">
                {{ row.isDefault ? '默认' : '非默认' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right" align="center">
            <template #default="{ row }">
              <el-button
                v-if="!row.isDefault"
                type="primary"
                link
                size="small"
                @click="handleSetDefault(row)"
              >
                设为默认
              </el-button>
              <el-button
                v-if="!row.isDefault"
                type="danger"
                link
                size="small"
                @click="handleDeleteStandard(row)"
              >
                删除
              </el-button>
              <span v-else style="color: var(--text-secondary); font-size: 12px">-</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>

    <el-dialog
      v-model="showRestoreDialog"
      title="数据恢复"
      width="420px"
      :close-on-click-modal="false"
      @close="clearAllProjects"
    >
      <div class="restore-dialog-content">
        <div v-if="backupPreview" class="backup-preview-section">
          <div class="preview-time">备份时间: {{ formatBackupTime(backupPreview.manifest?.timestamp) }}</div>
          <div class="preview-summary">
            包含 {{ backupPreview.projects?.length || 0 }} 个项目，{{ backupPreview.totalRecords || 0 }} 条测评记录
          </div>
        </div>

        <div class="restore-mode-section">
          <el-radio-group v-model="restoreMode">
            <el-radio value="incremental">
              <span class="mode-name">增量恢复</span>
              <span class="mode-tag recommended">推荐</span>
            </el-radio>
            <el-radio value="full">
              <span class="mode-name">完全恢复</span>
              <span class="mode-tag dangerous">危险</span>
            </el-radio>
          </el-radio-group>
        </div>

        <div v-if="backupPreview?.projects?.length" class="project-selection">
          <div class="selection-title">选择项目:</div>
          <el-checkbox-group v-model="selectedProjectIds" class="project-checkboxes">
            <el-checkbox
              v-for="project in backupPreview.projects"
              :key="project.id"
              :label="project.id"
              :disabled="restoreMode === 'full'"
            >
              <span class="project-name">{{ project.name }}</span>
              <span class="project-level">({{ project.level }}级)</span>
              <span class="project-count">{{ project.recordCount }}条记录</span>
            </el-checkbox>
          </el-checkbox-group>
        </div>
      </div>

      <template #footer>
        <el-button @click="showRestoreDialog = false; clearAllProjects()">取消</el-button>
        <el-button
          type="primary"
          :disabled="restoreMode === 'incremental' && selectedProjectIds.length === 0"
          @click="confirmRestore"
        >
          确认恢复
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';
import { Download, Upload, InfoFilled, Plus, Refresh, Search } from '@element-plus/icons-vue';
import type { UpdateStatus } from '../../../shared/types';

const tabs = [
  { key: 'settings', label: '常规设置' },
  { key: 'users', label: '用户管理' },
  { key: 'logs', label: '操作日志' },
  { key: 'standards', label: '标准库管理' },
];
const activeTab = ref('settings');

const themeMode = ref('light');
const primaryColor = ref('#409EFF');
const dataPath = ref('');
const systemInfo = reactive({
  appVersion: '',
  electronVersion: '',
  nodeVersion: '',
  platform: '',
  dataPath: '',
});

// User management
const userList = ref<any[]>([]);
const userLoading = ref(false);
const userSaving = ref(false);
const showUserDialog = ref(false);
const editingUser = ref<any>(null);
const userForm = reactive({
  username: '',
  password: '',
  realName: '',
  email: '',
  phone: '',
  role: 'assessor',
});

// Log management
const logList = ref<any[]>([]);
const logLoading = ref(false);
const logTotal = ref(0);
const logPage = ref(1);
const logModule = ref('');
const logAction = ref('');
const logModules = [
  { value: 'project', label: '项目管理' },
  { value: 'asset', label: '资产管理' },
  { value: 'assessment', label: '现场核查' },
  { value: 'issue', label: '问题管理' },
  { value: 'knowledge', label: '知识库' },
  { value: 'auth', label: '认证管理' },
  { value: 'system', label: '系统管理' },
];
const logActions = [
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'login', label: '登录' },
  { value: 'logout', label: '登出' },
  { value: 'export', label: '导出' },
  { value: 'import', label: '导入' },
  { value: 'backup', label: '备份' },
  { value: 'restore', label: '恢复' },
];

function handleThemeChange(val: string) {
  localStorage.setItem('themeMode', val);
  applyTheme(val);
  ElMessage.success('主题设置已保存');
}

function handlePrimaryColorChange(val: string) {
  localStorage.setItem('primaryColor', val);
  document.documentElement.style.setProperty('--primary-color', val);
  ElMessage.success('主题色已更新');
}

function applyTheme(mode: string) {
  const html = document.documentElement;
  if (mode === 'dark') {
    html.classList.add('dark');
    html.setAttribute('data-theme', 'dark');
  } else if (mode === 'light') {
    html.classList.remove('dark');
    html.setAttribute('data-theme', 'light');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      html.classList.add('dark');
      html.setAttribute('data-theme', 'dark');
    } else {
      html.classList.remove('dark');
      html.setAttribute('data-theme', 'light');
    }
  }
}

const backupPreview = ref<any>(null);
const showRestoreDialog = ref(false);
const selectedBackupPath = ref('');
const restoreMode = ref<'full' | 'incremental'>('full');
const selectedProjectIds = ref<string[]>([]);

async function handleBackup() {
  try {
    const now = new Date();
    const defaultFileName = `JSecProbe_backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.zip`;
    
    const saveRes = await window.api.system.saveFile(defaultFileName, [
      { name: '备份文件', extensions: ['zip'] },
    ]);
    
    if (!saveRes.success || !saveRes.data) {
      return;
    }
    
    const backupRes = await window.api.system.backupData(saveRes.data);
    if (backupRes.success && backupRes.data) {
      ElMessage.success(`备份成功，文件已保存至: ${backupRes.data}`);
    } else {
      ElMessage.error(backupRes.error?.message || '备份失败');
    }
  } catch (err: any) {
    ElMessage.error(err.message || '备份失败');
  }
}

async function handleRestore() {
  try {
    const fileRes = await window.api.system.selectFile([
      { name: '备份文件', extensions: ['zip', 'db', 'sqlite', 'sqlite3'] },
    ]);
    
    if (!fileRes.success || !fileRes.data) {
      return;
    }
    
    const filePath = String(fileRes.data);
    selectedBackupPath.value = filePath;
    backupPreview.value = null;
    selectedProjectIds.value = [];
    restoreMode.value = 'full';
    
    if (filePath.endsWith('.zip')) {
      const previewRes = await window.api.system.previewBackup(filePath);
      if (previewRes.success && previewRes.data) {
        backupPreview.value = previewRes.data;
      }
    }
    
    showRestoreDialog.value = true;
  } catch {
    // User cancelled
  }
}

function formatBackupTime(timestamp?: string): string {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

watch(restoreMode, (newMode) => {
  if (!backupPreview.value?.projects) return;
  
  if (newMode === 'full') {
    selectedProjectIds.value = backupPreview.value.projects.map((p: any) => p.id);
  } else if (newMode === 'incremental' && selectedProjectIds.value.length === 0) {
    selectedProjectIds.value = backupPreview.value.projects.length > 0 
      ? [backupPreview.value.projects[0].id] 
      : [];
  }
});

async function confirmRestore() {
  try {
    const confirmMessage = restoreMode.value === 'full' 
      ? '完整恢复将覆盖当前所有数据，此操作不可撤销，确定继续吗？'
      : '增量恢复将合并备份中的项目数据，确定继续吗？';
    
    await ElMessageBox.confirm(confirmMessage, '确认恢复', {
      type: 'warning',
      confirmButtonText: '确定恢复',
      cancelButtonText: '取消',
    });
    
    let options: { incremental: boolean; projectIds?: string[] } | undefined;
    if (restoreMode.value === 'incremental') {
      options = {
        incremental: true,
        projectIds: selectedProjectIds.value.length > 0 
          ? JSON.parse(JSON.stringify(selectedProjectIds.value)) 
          : undefined,
      };
    }
    
    const backupPath = String(selectedBackupPath.value);
    
    const restoreRes = await window.api.system.restoreData(backupPath, options);
    if (restoreRes.success) {
      showRestoreDialog.value = false;
      ElMessage.success('恢复成功，应用即将重启...');
    } else {
      ElMessage.error(restoreRes.error?.message || '恢复失败');
    }
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      console.error('Restore error:', err);
      ElMessage.error(err?.message || '恢复失败');
    }
  }
}

function clearAllProjects() {
  selectedProjectIds.value = [];
}

async function handleOpenDataFolder() {
  await window.api.system.openDataFolder();
}

async function handleChangeDataPath() {
  try {
    const dialogRes = await window.api.dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择数据存储目录',
    });

    if (!dialogRes.success) {
      ElMessage.error(dialogRes.error?.message || '打开选择对话框失败');
      return;
    }

    if (dialogRes.data?.canceled || !dialogRes.data?.filePaths?.length) {
      return;
    }

    const newPath = dialogRes.data.filePaths[0];

    await ElMessageBox.confirm(
      `确定将数据存储位置更改为:\n${newPath}\n\n系统将自动复制数据库文件并重启应用。`,
      '确认更改',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );

    const changeRes = await window.api.system.changeDataPath(newPath);
    if (changeRes.success) {
      ElMessage.success('数据存储位置已更改，应用即将重启...');
    } else {
      ElMessage.error(changeRes.error?.message || '更改失败');
    }
  } catch (err: any) {
    ElMessage.error(err.message || '更改数据存储位置时发生错误');
  }
}

async function loadSystemInfo() {
  if (!window.api) return;
  const res = await window.api.system.getInfo();
  if (res.success && res.data) {
    Object.assign(systemInfo, res.data);
    dataPath.value = res.data.dataPath;
  }
}

const updateStatus = reactive<UpdateStatus>({
  status: 'idle',
});

let removeStatusListener: (() => void) | null = null;

async function handleCheckUpdate() {
  if (!window.api?.update) return;
  try {
    await window.api.update.check();
  } catch (err: any) {
    ElMessage.error(err.message || '检查更新失败');
  }
}

async function handleDownloadUpdate() {
  if (!window.api?.update) return;
  try {
    await ElMessageBox.confirm(
      `发现新版本 v${updateStatus.version}，是否立即下载更新？`,
      '发现新版本',
      {
        type: 'info',
        confirmButtonText: '立即下载',
        cancelButtonText: '稍后再说',
      }
    );
    await window.api.update.download();
  } catch {
    // User cancelled
  }
}

async function handleInstallUpdate() {
  if (!window.api?.update) return;
  try {
    await ElMessageBox.confirm(
      '更新包已下载完成，是否立即安装并重启应用？',
      '安装更新',
      {
        type: 'success',
        confirmButtonText: '立即安装',
        cancelButtonText: '稍后安装',
      }
    );
    await window.api.update.install();
  } catch {
    // User cancelled
  }
}

function initUpdateListener() {
  if (!window.api?.update) return;
  removeStatusListener = window.api.update.onStatusChange((status: UpdateStatus) => {
    Object.assign(updateStatus, status);
    if (status.status === 'error') {
      ElMessage.error(status.error || '更新出错');
    } else if (status.status === 'notavailable') {
      ElMessage.success('当前已是最新版本');
    } else if (status.status === 'downloaded') {
      ElMessage.success('更新包下载完成');
    } else if (status.status === 'available') {
      const releaseNotesText = status.releaseNotes ? `\n\n更新内容：\n${status.releaseNotes}` : '';
      ElNotification({
        title: '发现新版本',
        message: `新版本 v${status.version} 已发布${releaseNotesText}`,
        type: 'info',
        duration: 10000,
        position: 'bottom-right',
      });
    }
  });
}

// User management
async function loadUsers() {
  if (!window.api) return;
  userLoading.value = true;
  try {
    const res = await window.api.user.list();
    if (res.success && res.data) {
      userList.value = res.data;
    }
  } finally {
    userLoading.value = false;
  }
}

function handleEditUser(user: any) {
  editingUser.value = user;
  Object.assign(userForm, {
    username: user.username,
    password: '',
    realName: user.realName,
    email: user.email || '',
    phone: user.phone || '',
    role: user.role,
  });
  showUserDialog.value = true;
}

async function handleSaveUser() {
  if (!userForm.username || !userForm.realName) {
    ElMessage.warning('请填写用户名和姓名');
    return;
  }
  if (!editingUser.value && !userForm.password) {
    ElMessage.warning('请填写密码');
    return;
  }
  userSaving.value = true;
  try {
    if (editingUser.value) {
      const updateData: any = {
        realName: userForm.realName,
        email: userForm.email || undefined,
        phone: userForm.phone || undefined,
        role: userForm.role,
      };
      if (userForm.password) updateData.password = userForm.password;
      const res = await window.api.user.update(editingUser.value.id, updateData);
      if (res.success) {
        ElMessage.success('更新成功');
        showUserDialog.value = false;
        loadUsers();
      } else {
        ElMessage.error(res.error?.message || '更新失败');
      }
    } else {
      const res = await window.api.user.create({
        username: userForm.username,
        password: userForm.password,
        realName: userForm.realName,
        email: userForm.email || undefined,
        phone: userForm.phone || undefined,
        role: userForm.role,
      });
      if (res.success) {
        ElMessage.success('创建成功');
        showUserDialog.value = false;
        loadUsers();
      } else {
        ElMessage.error(res.error?.message || '创建失败');
      }
    }
  } finally {
    userSaving.value = false;
  }
}

async function handleToggleUser(user: any) {
  const res = await window.api.user.update(user.id, { isActive: !user.isActive });
  if (res.success) {
    ElMessage.success(user.isActive ? '已禁用' : '已启用');
    loadUsers();
  } else {
    ElMessage.error(res.error?.message || '操作失败');
  }
}

async function handleDeleteUser(user: any) {
  await ElMessageBox.confirm(`确定要删除用户「${user.realName}」吗？`, '确认删除', {
    type: 'warning',
  }).catch(() => {});
  const res = await window.api.user.delete(user.id);
  if (res.success) {
    ElMessage.success('删除成功');
    loadUsers();
  } else {
    ElMessage.error(res.error?.message || '删除失败');
  }
}

// Log management
async function loadLogs() {
  if (!window.api) return;
  logLoading.value = true;
  try {
    const params: any = { page: logPage.value, pageSize: 30 };
    if (logModule.value) params.module = logModule.value;
    if (logAction.value) params.action = logAction.value;
    const res = await window.api.log.list(params);
    if (res.success && res.data) {
      logList.value = res.data.list;
      logTotal.value = res.data.total;
    }
  } finally {
    logLoading.value = false;
  }
}

function loadSettings() {
  const savedTheme = localStorage.getItem('themeMode');
  if (savedTheme) {
    themeMode.value = savedTheme;
    applyTheme(savedTheme);
  }
  
  const savedColor = localStorage.getItem('primaryColor');
  if (savedColor) {
    primaryColor.value = savedColor;
    document.documentElement.style.setProperty('--primary-color', savedColor);
  }
}

// Standard library management
const standardList = ref<any[]>([]);
const filteredStandardList = ref<any[]>([]);
const standardLoading = ref(false);
const standardKeyword = ref('');

async function loadStandards() {
  if (!window.api) return;
  standardLoading.value = true;
  try {
    const res = await window.api.standard.list();
    if (res.success && res.data) {
      standardList.value = res.data;
      filterStandards();
    }
  } finally {
    standardLoading.value = false;
  }
}

function filterStandards() {
  const kw = standardKeyword.value.toLowerCase().trim();
  if (!kw) {
    filteredStandardList.value = [...standardList.value];
  } else {
    filteredStandardList.value = standardList.value.filter(
      (s: any) => s.name.toLowerCase().includes(kw) || s.code?.toLowerCase().includes(kw)
    );
  }
}

async function handleSetDefault(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定将「${row.name}」设为默认标准库吗？`,
      '确认设置',
      { type: 'info' }
    );
    const res = await window.api.standard.setDefault(row.id);
    if (res.success) {
      ElMessage.success('已设为默认标准库');
      loadStandards();
    } else {
      ElMessage.error(res.error?.message || '操作失败');
    }
  } catch {
    // User cancelled
  }
}

async function handleDeleteStandard(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定要删除标准库「${row.name}」吗？此操作不可撤销。`,
      '确认删除',
      { type: 'warning' }
    );
    const res = await window.api.standard.remove(row.id);
    if (res.success) {
      ElMessage.success('删除成功');
      loadStandards();
    } else {
      ElMessage.error(res.error?.message || '删除失败');
    }
  } catch {
    // User cancelled
  }
}

onMounted(() => {
  loadSystemInfo();
  loadUsers();
  loadLogs();
  loadSettings();
  loadStandards();
  initUpdateListener();
});

onUnmounted(() => {
  if (removeStatusListener) {
    removeStatusListener();
  }
});
</script>

<style scoped lang="scss">
.settings-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: var(--spacing-md);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 4px 16px;

  .tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: var(--text-base, 13px);
    font-weight: 500;
    color: var(--color-text-tertiary);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
    font-family: var(--font-family);

    &.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
    }
  }
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
  gap: 12px;

  &-left, &-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.pagination-wrapper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  margin-top: 12px;
  border-top: 1px solid var(--color-border-light);

  .total-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
}

.settings-section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.settings-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--bg-hover);
  
  &:last-child {
    border-bottom: none;
  }
}

.settings-item-info {
  flex: 1;
}

.settings-item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.settings-item-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.data-path-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.path-display-btn {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mt-md {
  margin-top: 16px;
}

.info-list {
  .info-item {
    display: flex;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--bg-hover);
    
    &:last-child {
      border-bottom: none;
    }
  }
  
  .info-label {
    font-size: 14px;
    color: var(--text-secondary);
  }
  
  .info-value {
    font-size: 14px;
    color: var(--text-primary);
    font-family: 'Consolas', monospace;
  }
}

.about-content {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-primary);
  
  p {
    margin-bottom: 12px;
  }
  
  .about-tip {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 13px;
    margin-top: 16px;
    padding: 12px;
    background: var(--bg-hover);
    border-radius: 6px;
  }
}

.restore-dialog-content {
  padding: 8px 0;
}

.backup-preview-section {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);

  .preview-time {
    font-size: 14px;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .preview-summary {
    font-size: 13px;
    color: var(--text-secondary);
  }
}

.restore-mode-section {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);

  :deep(.el-radio) {
    display: block;
    margin-bottom: 10px;

    .mode-name {
      font-size: 14px;
      color: var(--text-primary);
      margin-right: 8px;
    }

    .mode-tag {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;

      &.recommended {
        background: #f0f9ff;
        color: #3b82f6;
      }

      &.dangerous {
        background: #fef2f2;
        color: #ef4444;
      }
    }
  }
}

.project-selection {
  .selection-title {
    font-size: 13px;
    color: var(--text-primary);
    margin-bottom: 10px;
  }

  .project-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;

    :deep(.el-checkbox) {
      .project-name {
        font-size: 14px;
        color: var(--text-primary);
        margin-right: 6px;
      }

      .project-level {
        font-size: 12px;
        color: var(--color-primary);
        margin-right: 8px;
      }

      .project-count {
        font-size: 12px;
        color: var(--text-secondary);
      }
    }
  }
}
</style>
