<template>
  <div class="app-layout">
    <aside class="sidebar" :class="{ collapsed: appStore.sidebarCollapsed }">
      <div class="sidebar-logo">
        <img src="@/assets/Logo.png" class="logo-icon" alt="logo" />
        <span v-if="!appStore.sidebarCollapsed" class="logo-text">JSecProbe</span>
      </div>
      
      <nav class="sidebar-menu">
        <el-menu
          :default-active="activeMenu"
          :collapse="appStore.sidebarCollapsed"
          :collapse-transition="false"
          @select="handleMenuSelect"
        >
          <el-menu-item index="/dashboard">
            <el-icon><DataLine /></el-icon>
            <template #title>工作台</template>
          </el-menu-item>
          
          <el-menu-item index="/projects/list">
            <el-icon><Folder /></el-icon>
            <template #title>项目列表</template>
          </el-menu-item>
          
          <el-sub-menu index="/project-detail">
            <template #title>
              <el-icon><FolderAdd /></el-icon>
              <span>项目详情</span>
            </template>
            <el-menu-item index="/projects/assets">
              <el-icon><Monitor /></el-icon>
              <template #title>系统构成</template>
            </el-menu-item>
            <el-menu-item index="/projects/assessment">
              <el-icon><List /></el-icon>
              <template #title>现场核查</template>
            </el-menu-item>
            <el-menu-item index="/projects/issues">
              <el-icon><Warning /></el-icon>
              <template #title>问题清单</template>
            </el-menu-item>
          </el-sub-menu>
          
          <el-menu-item index="/ai-assistant">
            <el-icon><MagicStick /></el-icon>
            <template #title>AI智能辅助</template>
          </el-menu-item>
          
          <el-menu-item index="/knowledge">
            <el-icon><Reading /></el-icon>
            <template #title>知识库</template>
          </el-menu-item>
          
          <el-menu-item index="/settings">
            <el-icon><Setting /></el-icon>
            <template #title>系统设置</template>
          </el-menu-item>
        </el-menu>
      </nav>
      
      <div class="sidebar-footer" v-if="!appStore.sidebarCollapsed">
        <div class="sidebar-footer-card">
          <div class="sf-version">v2.0.7</div>
          <a href="https://github.com/SelinuxJXM/JSecProbe" target="_blank" class="sf-github" title="访问 GitHub 仓库">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
            <span>源码仓库</span>
          </a>
        </div>
        <div class="sf-divider"></div>
        <div class="sf-copyright">
          <span>© 2025 景景 · 版权所有</span>
        </div>
      </div>
      
      <div class="sidebar-footer-mini" v-if="appStore.sidebarCollapsed">
        <a href="https://github.com/SelinuxJXM/JSecProbe" target="_blank" class="sfm-github" title="访问 GitHub 仓库">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
        </a>
      </div>
    </aside>
    
    <div class="main-wrapper">
      <header class="header">
        <div class="header-left">
          <el-icon class="toggle-btn" @click="appStore.toggleSidebar()">
            <Fold v-if="!appStore.sidebarCollapsed" />
            <Expand v-else />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/projects' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item>{{ currentPageTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        
        <div class="header-right">
          <div class="notification-bell" @click="showUpdateDialog = true">
            <el-icon class="header-icon"><Bell /></el-icon>
            <span v-if="hasUpdate" class="bell-badge"></span>
          </div>
          <el-icon class="header-icon"><QuestionFilled /></el-icon>
          <el-dropdown trigger="click">
            <div class="user-info">
              <el-avatar :size="32" class="user-avatar">
                {{ userStore.user?.realName?.charAt(0) || 'A' }}
              </el-avatar>
              <span class="username">{{ userStore.user?.realName || '管理员' }}</span>
              <el-icon><CaretBottom /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/personal-center')">个人中心</el-dropdown-item>
                <el-dropdown-item @click="onboardingRef?.restart()">查看引导</el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      
      <main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </transition>
        </router-view>
      </main>
    </div>

    <!-- 新手引导 -->
    <OnboardingGuide ref="onboardingRef" />

    <!-- 更新通知对话框 -->
    <el-dialog
      v-model="showUpdateDialog"
      title="系统更新"
      width="480px"
      :close-on-click-modal="false"
      :show-close="true"
      class="update-dialog"
    >
      <div v-if="updateStatus.status === 'idle' || updateStatus.status === 'notavailable'" class="update-content">
        <div class="update-icon no-update">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#67C23A" stroke-width="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <h3>当前已是最新版本</h3>
        <p>当前版本：v{{ currentVersion }}</p>
        <el-button type="primary" @click="checkForUpdates">检查更新</el-button>
      </div>

      <div v-else-if="updateStatus.status === 'checking'" class="update-content">
        <div class="update-icon checking">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#409EFF" stroke-width="1.5" class="spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
        <h3>正在检查更新...</h3>
        <p>请稍候，正在连接服务器检查新版本</p>
      </div>

      <div v-else-if="updateStatus.status === 'available'" class="update-content">
        <div class="update-icon available">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#E6A23C" stroke-width="1.5">
            <path d="M12 2v4"/>
            <path d="M12 18v4"/>
            <path d="M4.93 4.93l2.83 2.83"/>
            <path d="M16.24 16.24l2.83 2.83"/>
            <path d="M2 12h4"/>
            <path d="M18 12h4"/>
            <path d="M6.34 17.66l2.83-2.83"/>
            <path d="M13.41 6.59l2.83-2.83"/>
          </svg>
        </div>
        <h3>发现新版本！</h3>
        <p>当前版本：v{{ currentVersion }}</p>
        <p>最新版本：v{{ updateStatus.version }}</p>
        <div v-if="updateStatus.releaseNotes" class="release-notes">
          <h4>更新内容：</h4>
          <div class="release-notes-content" v-html="updateStatus.releaseNotes"></div>
        </div>
        <el-button type="primary" @click="downloadUpdate">下载更新</el-button>
      </div>

      <div v-else-if="updateStatus.status === 'downloading'" class="update-content">
        <div class="download-header">
          <div class="download-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#409EFF" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div class="download-info">
            <h3>正在下载更新</h3>
            <p class="download-version">版本 v{{ updateStatus.version }}</p>
          </div>
        </div>

        <div class="download-progress-container">
          <div class="progress-bar-wrapper">
            <div class="progress-bar-track">
              <div 
                class="progress-bar-fill" 
                :style="{ width: (updateStatus.downloadProgress || 0) + '%' }"
              ></div>
            </div>
            <span class="progress-percent">{{ Math.round(updateStatus.downloadProgress || 0) }}%</span>
          </div>

          <div class="download-stats">
            <div class="stat-item">
              <span class="stat-label">下载速度</span>
              <span class="stat-value">{{ formatSpeed(updateStatus.downloadSpeed) }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">已下载</span>
              <span class="stat-value">{{ formatSize(updateStatus.downloadTransferred) }} / {{ formatSize(updateStatus.downloadTotal) }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">剩余时间</span>
              <span class="stat-value">{{ formatRemainingTime(updateStatus.downloadSpeed, updateStatus.downloadTotal, updateStatus.downloadTransferred) }}</span>
            </div>
          </div>
        </div>

        <p class="download-tip">下载过程中请不要关闭应用，下载完成后将自动安装</p>
      </div>

      <div v-else-if="updateStatus.status === 'downloaded'" class="update-content">
        <div class="update-icon downloaded">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#67C23A" stroke-width="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <h3>更新包已下载完成</h3>
        <p>最新版本：v{{ updateStatus.version }}</p>
        <p>点击下方按钮安装更新并重启应用</p>
        <el-button type="primary" @click="installUpdate">立即安装并重启</el-button>
      </div>

      <div v-else-if="updateStatus.status === 'error'" class="update-content">
        <div class="update-icon error">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#F56C6C" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3>检查更新失败</h3>
        <p>{{ updateStatus.error }}</p>
        <el-button type="primary" @click="checkForUpdates">重试</el-button>
      </div>

      <div class="update-footer">
        <img src="@/assets/wechat-qr.png" alt="微信联系" class="wechat-qr" />
        <p class="qr-text">扫码联系开发者</p>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import {
  DataLine,
  Folder,
  FolderAdd,
  Monitor,
  List,
  Warning,
  MagicStick,
  Reading,
  Setting,
  Bell,
  QuestionFilled,
  CaretBottom,
  Fold,
  Expand,
} from '@element-plus/icons-vue';
import OnboardingGuide from '@/components/OnboardingGuide/index.vue';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const userStore = useUserStore();
const onboardingRef = ref<InstanceType<typeof OnboardingGuide>>();

// 更新相关状态
const showUpdateDialog = ref(false);
const currentVersion = ref('');
const updateStatus = ref<{
  status: 'idle' | 'checking' | 'downloading' | 'available' | 'notavailable' | 'downloaded' | 'error';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  downloadSpeed?: number;
  downloadTransferred?: number;
  downloadTotal?: number;
  error?: string;
}>({ status: 'idle' });

const hasUpdate = computed(() => updateStatus.value.status === 'available');

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '计算中...';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let speed = bytesPerSecond;
  let unitIndex = 0;
  while (speed >= 1024 && unitIndex < units.length - 1) {
    speed /= 1024;
    unitIndex++;
  }
  return `${speed.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatRemainingTime(speed?: number, total?: number, transferred?: number): string {
  if (!speed || !total || !transferred || speed <= 0) return '计算中...';
  const remainingBytes = total - transferred;
  if (remainingBytes <= 0) return '即将完成';
  const remainingSeconds = Math.ceil(remainingBytes / speed);
  if (remainingSeconds < 60) return `${remainingSeconds} 秒`;
  if (remainingSeconds < 3600) return `${Math.ceil(remainingSeconds / 60)} 分钟`;
  return `${(remainingSeconds / 3600).toFixed(1)} 小时`;
}

async function checkForUpdates() {
  if (!window.api) return;
  try {
    await window.api.update.check();
  } catch (err: any) {
    ElMessage.error(err.message || '检查更新失败');
  }
}

async function downloadUpdate() {
  if (!window.api) return;
  const res = await window.api.update.download();
  if (!res.success) {
    ElMessage.error(res.error?.message || '下载更新失败');
  }
}

async function installUpdate() {
  if (!window.api) return;
  const res = await window.api.update.install();
  if (!res.success) {
    ElMessage.error(res.error?.message || '安装更新失败');
  }
}

function handleUpdateStatus(status: any) {
  updateStatus.value = status;
}

let unsubscribe: () => void;

onMounted(async () => {
  if (window.api) {
    const versionRes = await window.api.update.getCurrentVersion();
    if (versionRes.success && versionRes.data) {
      currentVersion.value = versionRes.data;
    }
    const statusRes = await window.api.update.getStatus();
    if (statusRes.success && statusRes.data) {
      updateStatus.value = statusRes.data;
    }
    unsubscribe = window.api.update.onStatusChange(handleUpdateStatus);
  }

  // 启动新手引导
  setTimeout(() => {
    onboardingRef.value?.start();
  }, 500);
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
});

watch(showUpdateDialog, (visible) => {
  if (visible) {
    updateStatus.value = { status: 'idle' };
  }
});

const activeMenu = computed(() => {
  const path = route.path;
  // 匹配项目子路由（如 /projects/xxx/assets）
  if (path.startsWith('/projects/') && path.includes('/assets')) return '/projects/assets';
  if (path.startsWith('/projects/') && path.includes('/assessment')) return '/projects/assessment';
  if (path.startsWith('/projects/') && path.includes('/issues')) return '/projects/issues';
  // 项目列表页
  if (path === '/projects/list' || path === '/projects') return '/projects/list';
  return path;
});

const currentPageTitle = computed(() => {
  return route.meta.title as string || '';
});

function handleMenuSelect(index: string) {
  // 一级菜单直接跳转
  if (index === '/dashboard' || index === '/projects/list' ||
      index === '/ai-assistant' || index === '/knowledge' ||
      index === '/settings') {
    router.push(index);
    return;
  }
  
  // 项目子菜单：需要先检查是否有当前项目
  if (index.startsWith('/projects/')) {
    const pid = appStore.currentProjectId;
    if (!pid) {
      ElMessage.warning('请先选择项目');
      router.push('/projects/list');
      return;
    }
    const subPath = index.replace('/projects/', '');
    router.push(`/projects/${pid}/${subPath}`);
  }
}

function handleLogout() {
  userStore.logout();
  router.push('/login');
}
</script>

<style lang="scss" scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: var(--sidebar-width);
  background: var(--color-sidebar-bg);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  flex-shrink: 0;
  
  &.collapsed {
    width: var(--sidebar-width-collapsed);
  }

  // el-menu active bar styling
  :deep(.el-menu) {
    --el-menu-bg-color: var(--color-sidebar-bg);
    --el-menu-text-color: var(--color-sidebar-text);
    --el-menu-active-color: var(--color-sidebar-text-active);
    border-right: none;

    .el-menu-item {
      height: 40px;
      line-height: 40px;
      margin: 2px 8px;
      padding: 0 12px !important;
      border-radius: 6px;
      position: relative;

      &.is-active {
        background: var(--color-sidebar-bg-active);

        &::before {
          content: '';
          position: absolute;
          left: -8px;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 18px;
          background: var(--color-primary);
          border-radius: 0 2px 2px 0;
        }
      }

      &:hover {
        background: var(--color-sidebar-bg-hover) !important;
      }
    }
  }
}

.sidebar-logo {
  height: var(--header-height);
  display: flex;
  align-items: center;
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  
  .logo-icon {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.1);
    padding: 3px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    object-fit: cover;
  }
  
  .logo-text {
    margin-left: var(--spacing-sm);
    color: var(--color-sidebar-text-active);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    overflow: hidden;
  }
}

.sidebar-menu {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-xs) 0;

  :deep(.el-menu) {
    border-right: none;

    .el-menu-item,
    .el-sub-menu__title {
      height: 44px;
      line-height: 44px;
      margin: 2px 0;
      padding: 0 var(--spacing-md) !important;
      border-radius: 0;
      display: flex;
      align-items: center;

      &:hover {
        background: var(--color-sidebar-bg-hover) !important;
        color: var(--color-sidebar-text-hover) !important;
      }

      .el-icon {
        font-size: 18px;
        flex-shrink: 0;
        width: 24px;
        text-align: center;
        margin-right: var(--spacing-sm);
      }
    }

    .el-menu-item.is-active {
      background: var(--color-sidebar-bg-active) !important;
      color: var(--color-sidebar-text-active) !important;
    }

    .el-sub-menu {
      .el-menu-item {
        padding-left: calc(var(--spacing-md) + 24px + var(--spacing-sm)) !important;
      }
    }

    // 折叠状态下居中图标
    &.el-menu--collapse {
      .el-menu-item,
      .el-sub-menu__title {
        margin: 2px auto;
        padding: 0 !important;
        justify-content: center;
        
        .el-icon {
          margin-right: 0;
          width: auto;
        }
      }
    }
  }
}

.sidebar-footer {
  padding: 0;
  border-top: none;
  
  .sidebar-footer-card {
    margin: 0 var(--spacing-md) var(--spacing-sm);
    padding: var(--spacing-md);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    
    .sf-version {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      color: var(--color-sidebar-text);
      text-align: center;
      letter-spacing: 0.05em;
      margin-bottom: var(--spacing-sm);
    }
    
    .sf-github {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: var(--spacing-xs) var(--spacing-sm);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.06);
      font-size: var(--font-size-xs);
      color: var(--color-sidebar-text);
      text-decoration: none;
      opacity: 0.8;
      transition: all 0.25s ease;
      
      svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        opacity: 0.8;
        transition: all 0.25s ease;
      }
      
      &:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.1);
        color: var(--color-sidebar-text-active);
        
        svg {
          opacity: 1;
          transform: scale(1.15);
        }
      }
    }
  }
  
  .sf-divider {
    height: 1px;
    margin: 0 var(--spacing-lg);
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.1) 50%,
      transparent 100%
    );
  }
  
  .sf-copyright {
    padding: var(--spacing-sm) 0;
    font-size: var(--font-size-xs);
    color: var(--color-sidebar-text);
    text-align: center;
    opacity: 0.45;
    letter-spacing: 0.02em;
  }
}

.sidebar-footer-mini {
  display: flex;
  justify-content: center;
  padding-top: var(--spacing-md);
  padding-bottom: var(--spacing-lg);
  border-top: 1px solid rgba(255, 255, 255, 0.08);

  .sfm-github {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: #fff;
    background: linear-gradient(135deg, #24292e 0%, #404448 100%);
    text-decoration: none;
    opacity: 0.9;
    transition: all 0.3s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    
    svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      transition: all 0.3s ease;
    }
    
    &:hover {
      opacity: 1;
      transform: scale(1.1);
      box-shadow: 0 4px 16px rgba(36, 41, 46, 0.5);
      
      svg {
        transform: scale(1.1);
      }
    }
  }
}

.main-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.header {
  height: var(--header-height);
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-lg);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.toggle-btn {
  font-size: 20px;
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: var(--spacing-xs);
  border-radius: var(--radius-sm);
  
  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.header-icon {
  font-size: 18px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: var(--spacing-xs);
  border-radius: var(--radius-sm);
  
  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
}

.user-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  cursor: pointer;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-base);
  
  &:hover {
    background: var(--color-bg-hover);
  }
  
  .user-avatar {
    background: var(--color-primary);
  }
  
  .username {
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }
}

.main-content {
  flex: 1;
  overflow: hidden;
  background: var(--color-bg-base);
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.page-fade-enter-to,
.page-fade-leave-from {
  opacity: 1;
  transform: translateX(0);
}

.notification-bell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xs);
  border-radius: var(--radius-sm);
  
  &:hover {
    background: var(--color-bg-hover);
    
    .header-icon {
      color: var(--color-text-primary);
    }
  }
  
  .bell-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #F56C6C;
  }
}

.update-dialog {
  :deep(.el-dialog__body) {
    padding: 0;
  }
  
  .update-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 30px 20px;
    
    .update-icon {
      margin-bottom: 20px;
      
      .spin {
        animation: spin 1s linear infinite;
      }
    }
    
    h3 {
      margin: 0 0 10px 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text-primary);
    }
    
    p {
      margin: 5px 0;
      font-size: 14px;
      color: var(--color-text-secondary);
    }
    
    .release-notes {
        width: 100%;
        margin-top: 15px;
        padding: 15px;
        background: var(--color-bg-hover);
        border-radius: var(--radius-base);
        
        h4 {
          margin: 0 0 10px 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-primary);
        }
        
        .release-notes-content {
          font-size: 13px;
          color: var(--color-text-secondary);
          max-height: 180px;
          overflow-y: auto;
          line-height: 1.8;
          
          :deep(h2) {
            font-size: 14px;
            font-weight: 600;
            color: var(--color-text-primary);
            margin: 10px 0 8px 0;
          }
          
          :deep(ul) {
            margin: 0;
            padding-left: 20px;
          }
          
          :deep(li) {
            margin: 4px 0;
          }
        }
      }
    
    .el-button {
      margin-top: 20px;
    }
    
    .el-progress {
      width: 100%;
      max-width: 300px;
      margin-top: 10px;
    }
    
    // 下载进度样式
    .download-header {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 100%;
      margin-bottom: 24px;
      
      .download-icon {
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-primary-light-9);
        border-radius: var(--radius-base);
      }
      
      .download-info {
        flex: 1;
        
        h3 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--color-text-primary);
        }
        
        .download-version {
          margin: 0;
          font-size: 13px;
          color: var(--color-text-secondary);
        }
      }
    }
    
    .download-progress-container {
      width: 100%;
      
      .progress-bar-wrapper {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
        
        .progress-bar-track {
          flex: 1;
          height: 8px;
          background: var(--color-bg-hover);
          border-radius: 4px;
          overflow: hidden;
          
          .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #409EFF 0%, #67C23A 100%);
            border-radius: 4px;
            transition: width 0.3s ease;
          }
        }
        
        .progress-percent {
          min-width: 50px;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-primary);
          text-align: right;
        }
      }
      
      .download-stats {
        display: flex;
        justify-content: space-between;
        padding: 12px 16px;
        background: var(--color-bg-hover);
        border-radius: var(--radius-base);
        
        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          
          .stat-label {
            font-size: 12px;
            color: var(--color-text-secondary);
          }
          
          .stat-value {
            font-size: 13px;
            font-weight: 600;
            color: var(--color-text-primary);
          }
        }
      }
    }
    
    .download-tip {
      margin-top: 20px;
      font-size: 12px;
      color: var(--color-text-secondary);
      text-align: center;
    }
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.update-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border-light);
  margin-top: 10px;
  
  .wechat-qr {
    width: 100px;
    height: 100px;
    border-radius: var(--radius-base);
    border: 2px solid var(--color-border-light);
    background: white;
    object-fit: contain;
  }
  
  .qr-text {
    margin-top: 8px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
}
</style>
