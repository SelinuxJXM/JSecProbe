<template>
  <Transition name="page-hint-fade">
    <div v-if="show" class="page-hint" role="note">
      <el-icon class="page-hint-icon" :size="18"><InfoFilled /></el-icon>

      <div class="page-hint-body">
        <div class="page-hint-title">{{ title }}</div>
        <ul v-if="tips && tips.length" class="page-hint-list">
          <li v-for="(tip, index) in tips" :key="index">{{ tip }}</li>
        </ul>
      </div>

      <div class="page-hint-actions">
        <el-button size="small" text @click="dismiss">知道了</el-button>
        <el-icon class="page-hint-close" :size="16" @click="dismiss"><Close /></el-icon>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { InfoFilled, Close } from '@element-plus/icons-vue';
import {
  onboardingRunning,
  isHintSeen,
  markHintSeen,
  type PageHintKey,
} from '@/utils/onboarding-state';

const props = withDefaults(
  defineProps<{
    /** 页面唯一键，各页面独立记住是否已读 */
    hintKey: PageHintKey;
    title: string;
    tips?: string[];
    /** 延迟多久出现（等页面数据与动画落定，避免和入场动画抢注意力） */
    delay?: number;
  }>(),
  { delay: 700 },
);

const show = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleShow() {
  clearTimer();
  if (isHintSeen(props.hintKey) || onboardingRunning.value) return;
  timer = setTimeout(() => {
    // 计时器到点时引导可能刚好开始，再确认一次
    show.value = !onboardingRunning.value && !isHintSeen(props.hintKey);
  }, props.delay);
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
}

function dismiss() {
  clearTimer();
  show.value = false;
  markHintSeen(props.hintKey);
}

// 引导正在播时先不出现——两层提示叠在一起只会互相干扰；
// 引导结束（完成或跳过）后再补上一次判断。
watch(onboardingRunning, (running) => {
  if (running) {
    clearTimer();
    show.value = false;
  } else {
    scheduleShow();
  }
});

onMounted(scheduleShow);
onBeforeUnmount(clearTimer);
</script>

<style scoped>
.page-hint {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: var(--spacing-base);
  background: var(--color-primary-lighter);
  border: 1px solid var(--color-primary-light);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-lg);
}

.page-hint-icon {
  color: var(--color-primary);
  flex-shrink: 0;
  margin-top: 1px;
}

.page-hint-body {
  flex: 1;
  min-width: 0;
}

.page-hint-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}

.page-hint-list {
  margin: 0;
  padding-left: 18px;
  font-size: var(--font-size-xs);
  line-height: 1.8;
  color: var(--color-text-secondary);
}

.page-hint-list li {
  list-style: disc;
}

.page-hint-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.page-hint-close {
  cursor: pointer;
  color: var(--color-text-tertiary);
  padding: 4px;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
}

.page-hint-fade-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.page-hint-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.page-hint-fade-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.page-hint-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .page-hint-fade-enter-active,
  .page-hint-fade-leave-active {
    transition: none;
  }
}
</style>
