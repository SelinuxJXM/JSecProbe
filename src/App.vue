<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, onErrorCaptured } from 'vue';
import { useUserStore } from '@/stores/user';
import { ElNotification, ElMessage } from 'element-plus';

const userStore = useUserStore();
let removeStatusListener: (() => void) | null = null;

onErrorCaptured((err: Error, instance: any, info: string) => {
  console.error('[全局错误边界] 捕获到未处理错误:', err);
  console.error('  组件:', instance?.$options?.__name || '未知');
   console.error('  位置:', info);
  ElMessage.error(`界面渲染异常: ${err.message?.slice(0, 100) || '未知错误'}`);
  return false;
});

onMounted(() => {
  userStore.clearSession();

  if (window.api?.update) {
    removeStatusListener = window.api.update.onStatusChange((status: any) => {
      if (status.status === 'available') {
        const releaseNotesHtml = status.releaseNotes ? `<br/><br/>更新内容：<br/>${status.releaseNotes}` : '';
        ElNotification({
          title: '发现新版本',
          message: `新版本 v${status.version} 已发布${releaseNotesHtml}`,
          type: 'info',
          duration: 10000,
          position: 'bottom-right',
          dangerouslyUseHTMLString: true,
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
