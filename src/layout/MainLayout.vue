<template>
  <div class="app-layout">
    <aside class="sidebar" :class="{ collapsed: appStore.sidebarCollapsed }">
      <div class="sidebar-logo">
        <img src="@/assets/Logo.png" class="logo-icon" alt="logo" />
        <span v-if="!appStore.sidebarCollapsed" class="logo-text">JSecProbe</span>
      </div>
      
      <nav class="sidebar-menu" data-guide="nav-menu">
        <el-menu
          :default-active="activeMenu"
          :default-openeds="['/project-detail']"
          :collapse="appStore.sidebarCollapsed"
          :collapse-transition="false"
          @select="handleMenuSelect"
        >
          <el-menu-item index="/dashboard">
            <el-icon><SidebarIcon name="dashboard" /></el-icon>
            <template #title>工作台</template>
          </el-menu-item>
          
          <el-menu-item index="/projects/list">
            <el-icon><SidebarIcon name="folder" /></el-icon>
            <template #title>项目列表</template>
          </el-menu-item>
          
          <el-sub-menu index="/project-detail">
            <template #title>
              <el-icon><SidebarIcon name="folder-plus" /></el-icon>
              <span>项目详情</span>
            </template>
            <el-menu-item index="/projects/assets">
              <el-icon><SidebarIcon name="monitor" /></el-icon>
              <template #title>系统构成</template>
            </el-menu-item>
            <el-menu-item index="/projects/assessment">
              <el-icon><SidebarIcon name="clipboard" /></el-icon>
              <template #title>现场核查</template>
            </el-menu-item>
            <el-menu-item index="/projects/issues">
              <el-icon><SidebarIcon name="shield" /></el-icon>
              <template #title>问题清单</template>
            </el-menu-item>
          </el-sub-menu>
          
          <el-menu-item index="/ai-assistant">
            <el-icon><SidebarIcon name="sparkles" /></el-icon>
            <template #title>AI智能辅助</template>
          </el-menu-item>
          
          <el-menu-item index="/knowledge">
            <el-icon><SidebarIcon name="book" /></el-icon>
            <template #title>知识库</template>
          </el-menu-item>

          <el-menu-item index="/collection">
            <el-icon><SidebarIcon name="cpu" /></el-icon>
            <template #title>自动采集</template>
          </el-menu-item>

          <el-menu-item index="/settings">
            <el-icon><SidebarIcon name="settings" /></el-icon>
            <template #title>系统设置</template>
          </el-menu-item>
        </el-menu>
      </nav>
      
      <div class="sidebar-footer" v-if="!appStore.sidebarCollapsed">
        <div class="sidebar-footer-card">
          <!-- 版本号由主进程 app.getVersion() 提供，不在此硬编码 -->
          <div class="sf-version">v{{ currentVersion || '-' }}</div>
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
        <a href="https://github.com/SelinuxJXM/JSecProbe" target="_blank" rel="noopener noreferrer" class="sfm-github" title="访问 GitHub 仓库">
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
            <el-breadcrumb-item v-if="currentProjectName" class="bc-project">
              {{ currentProjectName }}
            </el-breadcrumb-item>
            <el-breadcrumb-item>{{ currentPageTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        
        <div class="header-right">
          <div class="notification-bell" @click="showUpdateDialog = true">
            <el-icon class="header-icon"><Bell /></el-icon>
            <span v-if="hasUpdate" class="bell-badge"></span>
          </div>
          <el-tooltip content="查看产品白皮书" placement="top" :show-after="300">
            <el-icon class="header-icon" @click="openWhitepaper"><QuestionFilled /></el-icon>
          </el-tooltip>
          <el-dropdown trigger="click">
            <div class="user-info" data-guide="user-menu">
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
                <el-dropdown-item @click="handleResetHints">重置页面提示</el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      
      <main class="main-content">
        <router-view v-slot="{ Component }">
          <!-- 页面过渡调参说明（手感是主观的，改这两个数即可）：
                 leave 决定「点击后多久新页面开始挂载」——它是纯等待，越长越显迟滞；
                 enter 决定动画本身能被看清的程度。
                 历史：各 300ms（合计 600ms，明显卡顿）→ leave 0（响应最快，但完全看不见
                 切换）→ 260/90（过场清晰，但整体偏慢）→ 两段均 90ms（偏快，几乎没有过渡
                 感）→ 现在 leave 90ms + enter 200ms：等待段保持在「即时」感知阈值（约
                 100ms）以内，把预算全给入场，过渡因此重新看得见而响应不迟滞。
                 若嫌慢：把 enter 降到 120~150ms；若想更明显：enter 提到 260~320ms、
                 位移改 16px（响应几乎不变，因为 leave 仍只有 90ms）。 -->
          <transition name="page-fade" mode="out-in" :duration="{ enter: 200, leave: 90 }">
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
          <div class="release-notes-content" v-html="sanitizedReleaseNotes"></div>
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
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Bell,
  QuestionFilled,
  CaretBottom,
  Fold,
  Expand,
} from '@element-plus/icons-vue';
import SidebarIcon from '@/components/SidebarIcon.vue';
import OnboardingGuide from '@/components/OnboardingGuide/index.vue';
import DOMPurify from 'dompurify';
import { resetAllHints } from '@/utils/onboarding-state';

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

const sanitizedReleaseNotes = computed(() => {
  if (!updateStatus.value.releaseNotes) return '';
  return DOMPurify.sanitize(updateStatus.value.releaseNotes);
});

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

const WHITEPAPER_URL = 'https://www.soer.ccwu.cc/JSecProbe/docs.html';

async function openWhitepaper() {
  if (!window.api) return;
  try {
    await window.api.shell.openExternal(WHITEPAPER_URL);
  } catch (err: any) {
    ElMessage.error(err?.message || '打开白皮书失败');
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

let unsubscribe: (() => void) | undefined;
let onboardingTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 全局 Ctrl+S：页面通过 `window.addEventListener('app:global-save', handler)`
 * 注册自己的保存逻辑即可。此前只有现场核查页有快捷键，而项目列表与资产台账
 * 恰恰是编辑量最大、却只能滚到页底点按钮的两个页面。
 * 页面未注册时不做任何事，避免误吞浏览器/系统的保存行为之外的操作。
 */
function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    const target = e.target as HTMLElement | null;
    // 输入框内的 Ctrl+S 同样视为保存（Excel 习惯），但要阻止默认行为
    e.preventDefault();
    const event = new CustomEvent('app:global-save', { detail: { source: target?.tagName || '' } });
    window.dispatchEvent(event);
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown);

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
  onboardingTimer = setTimeout(() => {
    onboardingRef.value?.start();
  }, 500);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  if (unsubscribe) {
    unsubscribe();
  }
  if (onboardingTimer) {
    clearTimeout(onboardingTimer);
  }
});

watch(showUpdateDialog, (visible) => {
  if (visible && updateStatus.value.status !== 'downloading') {
    updateStatus.value = { status: 'idle' };
  }
});

const activeMenu = computed(() => {
  const path = route.path;
  // 匹配项目子路由（如 /projects/xxx/assets）
  if (path.startsWith('/projects/') && /\/assets(\/|$)/.test(path)) return '/projects/assets';
  if (path.startsWith('/projects/') && /\/assessment(\/|$)/.test(path)) return '/projects/assessment';
  if (path.startsWith('/projects/') && /\/issues(\/|$)/.test(path)) return '/projects/issues';
  // 项目列表页
  if (path === '/projects/list' || path === '/projects') return '/projects/list';
  return path;
});

const currentPageTitle = computed(() => {
  return route.meta.title as string || '';
});

// 面包屑带上当前项目名：多项目并行时，单看「现场核查」无法确认在改哪个项目，
// 而核查记录是要出具正式文档的，认错项目的代价很高。
const currentProjectName = ref('');
let nameRequestToken = 0;

async function loadCurrentProjectName() {
  const pid = appStore.currentProjectId;
  const token = ++nameRequestToken;
  if (!pid || !window.api?.project) {
    currentProjectName.value = '';
    return;
  }
  try {
    const res = await window.api.project.get(pid);
    // 快速切换项目时，丢弃已过期的响应
    if (token !== nameRequestToken) return;
    currentProjectName.value = res.success && res.data ? (res.data.name || res.data.customerName || '') : '';
  } catch {
    if (token === nameRequestToken) currentProjectName.value = '';
  }
}

watch(
  () => [appStore.currentProjectId, route.fullPath],
  () => { loadCurrentProjectName(); },
  { immediate: true },
);

function handleResetHints() {
  // 提示按页面各自记住「看过了」，平时没有再看的入口；给一个重置开关，
  // 便于换新同事接手或事后想再确认时重新看一遍
  resetAllHints();
  ElMessage.success('页面提示已重置，重新进入对应页面时会再次显示');
}

function handleMenuSelect(index: string) {
  // 一级菜单直接跳转
  if (index === '/dashboard' || index === '/projects/list' ||
      index === '/ai-assistant' || index === '/knowledge' ||
      index === '/collection' || index === '/settings') {
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

async function handleLogout() {
  // 退出会中断当前项目上下文，且各编辑页的待保存改动会随组件卸载一起丢失，
  // 误点代价不小 —— 加一道确认，并在文案里明确提示未保存内容有风险
  try {
    await ElMessageBox.confirm(
      '退出后将返回登录页，未保存的修改可能会丢失。确定退出登录吗？',
      '退出登录',
      { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  userStore.logout();
  router.push('/login');
}
</script>

<style lang="scss" scoped>
.app-layout {
  display: flex;
  height: calc(100vh - var(--titlebar-height, 40px));
  overflow: hidden;
}

.sidebar {
  width: var(--sidebar-width);
  background: var(--color-sidebar-bg);
  border-right: 1px solid var(--color-border-light);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  flex-shrink: 0;
  
  &.collapsed {
    width: var(--sidebar-width-collapsed);
  }

  // 菜单主题变量（菜单项自身的尺寸/激活态由下方 .sidebar-menu 统一定义，
  // 此处不再重复一套 —— 两套规则特异性相同，后写的会把先写的 margin 覆盖掉，
  // 激活竖条因此被挤到 overflow:hidden 的裁剪区外，永远看不见）
  :deep(.el-menu) {
    --el-menu-bg-color: var(--color-sidebar-bg);
    --el-menu-text-color: var(--color-sidebar-text);
    --el-menu-active-color: var(--color-sidebar-text-active);
    border-right: none;
  }
}

.sidebar-logo {
  height: var(--header-height);
  display: flex;
  align-items: center;
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--color-sidebar-divider);
  
  .logo-icon {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    background: var(--color-sidebar-card-bg);
    padding: 3px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    object-fit: cover;
  }
  
  .logo-text {
    margin-left: var(--spacing-sm);
    color: var(--color-text-primary);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    overflow: hidden;
  }
}

.sidebar-menu {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
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
      position: relative;

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

        .sidebar-icon {
          transition: transform 0.18s ease;
        }
      }

      &:hover .sidebar-icon {
        transform: scale(1.1);
      }
    }

    .el-menu-item.is-active {
      background: var(--color-sidebar-bg-active) !important;
      color: var(--color-sidebar-text-active) !important;

      // 左侧激活竖条。菜单项自带 margin: 2px 0，竖条贴着 left: 0 正好落在可视区内
      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 18px;
        background: var(--color-primary);
        border-radius: 0 2px 2px 0;
      }
    }

    .el-sub-menu {
      .el-menu-item {
        padding-left: calc(var(--spacing-md) + 24px + var(--spacing-sm)) !important;
      }

      &.is-active > .el-sub-menu__title {
        color: var(--color-primary) !important;
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

      .el-menu-item .el-menu-tooltip__trigger {
        padding: 0 !important;
        justify-content: center;
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
    background: var(--color-sidebar-card-bg);
    border: 1px solid var(--color-sidebar-card-border);
    
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
      background: var(--color-sidebar-btn-bg);
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
        background: var(--color-sidebar-btn-bg-hover);
        color: var(--color-sidebar-text-hover);
        
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
    background: var(--color-sidebar-divider);
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
  border-top: 1px solid var(--color-sidebar-divider);

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
  background: var(--color-sidebar-bg);
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
  min-width: 0;

  /* 项目名可能很长，超出时截断，避免把右侧操作区挤走 */
  :deep(.bc-project) {
    max-width: 220px;
    overflow: hidden;

    .el-breadcrumb__inner {
      display: inline-block;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: bottom;
      font-weight: 500;
      color: var(--color-text-secondary);
    }
  }
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

/* 页面切换过渡。调参见模板中的「页面过渡调参说明」注释，此处只放呈现。
   离场 90ms / 缓入，向上收 6px；入场 200ms / quart 缓出，由下浮上 14px。
   两段同向（都是向上），读起来是一次连贯的「翻页」而不是两段各自独立的动画。
   离场刻意压在 100ms 的「即时」感知阈值内——多给它一毫秒，新页面的数据请求
   就晚一毫秒发出；入场才是用户真正欣赏的部分，所以预算优先给它。 */
.page-fade-enter-active {
  transition: opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.page-fade-leave-active {
  transition: opacity 0.09s ease-in, transform 0.09s ease-in;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(14px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.page-fade-enter-to,
.page-fade-leave-from {
  opacity: 1;
  transform: translateY(0);
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
        background: var(--color-primary-lighter);
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
          border-radius: var(--radius-sm);
          overflow: hidden;
          
          .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #409EFF 0%, #67C23A 100%);
            border-radius: var(--radius-sm);
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
