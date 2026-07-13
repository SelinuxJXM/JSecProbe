<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useUserStore } from '@/stores/user';
import { ElNotification } from 'element-plus';

const userStore = useUserStore();
let removeStatusListener: (() => void) | null = null;

onMounted(() => {
  userStore.clearSession();
  
  if (window.api?.update) {
    removeStatusListener = window.api.update.onStatusChange((status: any) => {
      if (status.status === 'available') {
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
});

onUnmounted(() => {
  if (removeStatusListener) {
    removeStatusListener();
  }
});
</script>
