<template>
  <div class="not-found">
    <el-empty description="页面不存在或已被移除">
      <template #image>
        <div class="nf-code">404</div>
      </template>
      <p class="nf-tip">你访问的路径未在应用中注册，可能是旧版本遗留的链接。</p>
      <div class="nf-actions">
        <el-button type="primary" @click="goHome">回到工作台</el-button>
        <el-button @click="goBack">返回上一页</el-button>
      </div>
    </el-empty>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goHome() {
  router.replace('/dashboard');
}

function goBack() {
  // 没有历史记录时（直接打开不存在的 hash）退回工作台，避免退出后卡在空白页
  if (window.history.length > 1) {
    router.back();
  } else {
    goHome();
  }
}
</script>

<style lang="scss" scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: var(--spacing-xl, 24px);
}

.nf-code {
  font-size: 72px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--el-text-color-secondary);
  opacity: 0.6;
}

.nf-tip {
  margin: 0 0 var(--spacing-md, 16px);
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.nf-actions {
  display: flex;
  gap: var(--spacing-sm, 12px);
  justify-content: center;
}
</style>
