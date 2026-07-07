<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();

onMounted(() => {
  // 应用启动时清除之前的登录状态，强制重新登录
  userStore.clearSession();
});
</script>
