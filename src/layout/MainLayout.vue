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
          background-color="#1A1D2E"
          text-color="#A0AEC0"
          active-text-color="#FFFFFF"
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
      
      <div class="sidebar-footer">
        <div class="version" v-if="!appStore.sidebarCollapsed">
          v1.2.1
        </div>
        <div class="copyright" v-if="!appStore.sidebarCollapsed">
          © 2025 景景
        </div>
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
          <el-icon class="header-icon"><Bell /></el-icon>
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
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>
      
      <main class="main-content">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const userStore = useUserStore();

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
  background: #1A1D2E;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  flex-shrink: 0;
  
  &.collapsed {
    width: var(--sidebar-width-collapsed);
  }

  // el-menu active bar styling
  :deep(.el-menu) {
    border-right: none;

    .el-menu-item {
      height: 40px;
      line-height: 40px;
      margin: 2px 8px;
      padding: 0 12px !important;
      border-radius: 6px;
      position: relative;

      &.is-active {
        background: rgba(255,255,255,0.08);

        &::before {
          content: '';
          position: absolute;
          left: -8px;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 18px;
          background: #1B5FD9;
          border-radius: 0 2px 2px 0;
        }
      }

      &:hover {
        background: #252840 !important;
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
  }
  
  .logo-text {
    margin-left: var(--spacing-sm);
    color: #fff;
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
      margin: 2px var(--spacing-sm);
      border-radius: var(--radius-base);

      &:hover {
        background: var(--color-sidebar-bg-hover) !important;
        color: var(--color-sidebar-text-hover) !important;
      }

      .el-icon {
        font-size: 18px;
      }
    }

    .el-menu-item.is-active {
      background: var(--color-sidebar-bg-active) !important;
      color: var(--color-sidebar-text-active) !important;
    }

    .el-sub-menu {
      .el-menu-item {
        padding-left: 48px !important;
      }
    }

    // 折叠状态下居中图标
    &.el-menu--collapse {
      .el-menu-item,
      .el-sub-menu__title {
        margin: 2px auto;
        padding: 0 !important;
        justify-content: center;
      }
    }
  }
}

.sidebar-footer {
  padding: var(--spacing-sm) var(--spacing-md);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  
  .version {
    color: var(--color-sidebar-text);
    font-size: var(--font-size-xs);
    text-align: center;
  }

  .copyright {
    color: var(--color-sidebar-text);
    font-size: var(--font-size-xs);
    text-align: center;
    margin-top: var(--spacing-xs);
    opacity: 0.6;
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
