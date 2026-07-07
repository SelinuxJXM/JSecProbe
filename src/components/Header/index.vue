<template>
  <div class="app-header">
    <div class="header-left">
      <el-icon class="collapse-icon" @click="toggleCollapse">
        <component :is="isCollapsed ? 'Expand' : 'Fold'" />
      </el-icon>
      <el-breadcrumb separator="/" class="breadcrumb">
        <el-breadcrumb-item v-for="item in breadcrumbs" :key="item.path" :to="item.path">
          {{ item.title }}
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>
    <div class="header-right">
      <el-dropdown @command="handleCommand">
        <span class="user-info">
          <el-avatar :size="32" src="">{{ userInitial }}</el-avatar>
          <span class="username">{{ username }}</span>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">个人资料</el-dropdown-item>
            <el-dropdown-item command="settings">系统设置</el-dropdown-item>
            <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';

defineProps<{
  isCollapsed: boolean;
  breadcrumbs: Array<{ path: string; title: string }>;
}>();

const emit = defineEmits<{
  toggleCollapse: [];
}>();

const userStore = useUserStore();
const router = useRouter();

const username = computed(() => userStore.user?.realName || userStore.user?.username || '用户');
const userInitial = computed(() => username.value.charAt(0).toUpperCase());

function toggleCollapse() {
  emit('toggleCollapse');
}

function handleCommand(command: string) {
  switch (command) {
    case 'profile':
      router.push('/profile');
      break;
    case 'settings':
      router.push('/settings');
      break;
    case 'logout':
      userStore.logout();
      router.push('/login');
      break;
  }
}
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 20px;
  background-color: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-base);
  box-shadow: var(--shadow-sm);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.collapse-icon {
  cursor: pointer;
  font-size: 20px;
  color: var(--color-primary);
}

.breadcrumb {
  margin-left: 8px;
}

.header-right {
  display: flex;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
  color: var(--color-text-secondary);
}
</style>