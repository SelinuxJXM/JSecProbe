<template>
  <Teleport to="body">
    <Transition name="onboarding-fade">
      <div v-if="visible" class="onboarding-overlay">
        <!-- 聚光灯高亮区域 -->
        <div
          v-if="currentStep?.target"
          class="spotlight"
          :style="spotlightStyle"
        ></div>

        <!-- 引导卡片 -->
        <div
          class="onboarding-card"
          :class="currentStep?.target ? 'with-target' : 'welcome'"
          :style="cardStyle"
        >
          <!-- 进度指示器 -->
          <div class="onboarding-progress" v-if="currentStep?.target">
            <div class="progress-dots">
              <span
                v-for="(_step, idx) in steps"
                :key="idx"
                class="progress-dot"
                :class="{ active: idx === currentStepIndex, completed: idx < currentStepIndex }"
              ></span>
            </div>
            <span class="progress-text">{{ currentStepIndex + 1 }} / {{ steps.length }}</span>
          </div>

          <!-- 图标 -->
          <div class="onboarding-icon" v-if="currentStep?.icon">
            <el-icon :size="32"><component :is="iconMap[currentStep.icon]" /></el-icon>
          </div>

          <!-- 标题 -->
          <h3 class="onboarding-title">{{ currentStep?.title }}</h3>

          <!-- 内容 -->
          <p class="onboarding-content">{{ currentStep?.content }}</p>

          <!-- 操作按钮 -->
          <div class="onboarding-actions">
            <el-button v-if="currentStepIndex > 0 && currentStep?.target" @click="prevStep">
              上一步
            </el-button>
            <el-button type="primary" @click="nextStep">
              {{ isLastStep ? '开始使用' : '下一步' }}
            </el-button>
            <el-button v-if="!isLastStep && currentStep?.target" link @click="skipGuide">
              跳过引导
            </el-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import {
  DataLine,
  Folder,
  MagicStick,
  Reading,
  Bell,
  Pointer,
} from '@element-plus/icons-vue';

// 图标映射
const iconMap: Record<string, any> = {
  DataLine,
  Folder,
  MagicStick,
  Reading,
  Bell,
  Pointer,
};

interface OnboardingStep {
  target?: string; // CSS 选择器
  icon?: string;
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const visible = ref(false);
const currentStepIndex = ref(0);
const spotlightStyle = ref<Record<string, string>>({});
const cardStyle = ref<Record<string, string>>({});

const steps: OnboardingStep[] = [
  {
    icon: 'Pointer',
    title: '欢迎使用 JSecProbe',
    content: '等级保护现场测评系统，支持等保2.0标准，提供智能AI辅助测评、一键生成分析报告等功能。接下来带您快速了解系统的主要功能。',
    position: 'center',
  },
  {
    target: '.sidebar-menu',
    icon: 'DataLine',
    title: '导航菜单',
    content: '通过左侧导航栏可以快速切换各个功能模块：工作台查看数据概览、项目管理测评项目、AI助手辅助分析、知识库查阅标准文档。',
    position: 'right',
  },
  {
    target: '.stats-row',
    icon: 'DataLine',
    title: '数据概览',
    content: '工作台展示项目统计数据和趋势图表，包括项目总数、进行中、已完成等状态分布，帮助您快速掌握整体测评进度。',
    position: 'bottom',
  },
  {
    target: '.toolbar',
    icon: 'Folder',
    title: '项目管理',
    content: '在项目列表中创建、导入、导出项目。支持批量操作和自定义字段，方便管理多个测评项目。',
    position: 'bottom',
  },
  {
    target: '.header-right',
    icon: 'Bell',
    title: '功能入口',
    content: '顶部栏提供系统通知、帮助文档和个人中心入口。个人中心可以修改密码和查看账户信息。',
    position: 'left',
  },
  {
    icon: 'MagicStick',
    title: '开始您的测评之旅',
    content: '现在您已经了解了系统的基本功能，可以开始创建您的第一个测评项目了！如需再次查看引导，可以在个人中心中重新触发。',
    position: 'center',
  },
];

const currentStep = computed(() => steps[currentStepIndex.value]);
const isLastStep = computed(() => currentStepIndex.value === steps.length - 1);

function calculatePosition() {
  const step = currentStep.value;
  if (!step?.target) {
    // 居中显示（欢迎页和完成页）
    spotlightStyle.value = {};
    cardStyle.value = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
    return;
  }

  const targetEl = document.querySelector(step.target);
  if (!targetEl) {
    spotlightStyle.value = {};
    cardStyle.value = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  const position = step.position || 'bottom';

  // 聚光灯样式
  spotlightStyle.value = {
    top: `${rect.top - 8}px`,
    left: `${rect.left - 8}px`,
    width: `${rect.width + 16}px`,
    height: `${rect.height + 16}px`,
  };

  // 卡片位置
  const cardWidth = 380;
  const gap = 20;

  switch (position) {
    case 'right':
      cardStyle.value = {
        top: `${rect.top}px`,
        left: `${rect.right + gap}px`,
      };
      break;
    case 'bottom':
      cardStyle.value = {
        top: `${rect.bottom + gap}px`,
        left: `${rect.left + rect.width / 2 - cardWidth / 2}px`,
      };
      break;
    case 'left':
      cardStyle.value = {
        top: `${rect.top}px`,
        left: `${rect.left - cardWidth - gap}px`,
      };
      break;
    case 'top':
      cardStyle.value = {
        bottom: `${window.innerHeight - rect.top + gap}px`,
        left: `${rect.left + rect.width / 2 - cardWidth / 2}px`,
      };
      break;
    default:
      cardStyle.value = {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
  }
}

function nextStep() {
  if (currentStepIndex.value < steps.length - 1) {
    currentStepIndex.value++;
    nextTick(() => {
      calculatePosition();
    });
  } else {
    completeGuide();
  }
}

function prevStep() {
  if (currentStepIndex.value > 0) {
    currentStepIndex.value--;
    nextTick(() => {
      calculatePosition();
    });
  }
}

function skipGuide() {
  completeGuide();
}

function completeGuide() {
  visible.value = false;
  localStorage.setItem('jsecprobe_onboarding_completed', 'true');
}

function startGuide() {
  if (localStorage.getItem('jsecprobe_onboarding_completed') === 'true') {
    return;
  }
  visible.value = true;
  currentStepIndex.value = 0;
  nextTick(() => {
    calculatePosition();
  });
}

function restartGuide() {
  visible.value = true;
  currentStepIndex.value = 0;
  nextTick(() => {
    calculatePosition();
  });
}

defineExpose({
  start: startGuide,
  restart: restartGuide,
});

onMounted(() => {
  window.addEventListener('resize', calculatePosition);
});
</script>

<style scoped>
.onboarding-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9999;
  pointer-events: none;
}

.onboarding-overlay::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  pointer-events: auto;
}

.spotlight {
  position: absolute;
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5), 0 0 20px rgba(27, 95, 217, 0.3);
  transition: all 0.4s ease;
  pointer-events: auto;
  z-index: 10000;
}

.onboarding-card {
  position: absolute;
  width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  z-index: 10001;
  transition: all 0.4s ease;
}

.onboarding-card.welcome {
  text-align: center;
}

.onboarding-card.welcome .onboarding-icon {
  margin: 0 auto 16px;
}

.onboarding-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.progress-dots {
  display: flex;
  gap: 6px;
}

.progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e5e7eb;
  transition: all 0.3s ease;
}

.progress-dot.active {
  background: #1B5FD9;
  width: 20px;
  border-radius: 4px;
}

.progress-dot.completed {
  background: #18A957;
}

.progress-text {
  font-size: 12px;
  color: #909399;
}

.onboarding-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: linear-gradient(135deg, #1B5FD9 0%, #154DB0 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  margin-bottom: 16px;
}

.onboarding-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 12px;
}

.onboarding-content {
  font-size: 14px;
  line-height: 1.7;
  color: #6b7280;
  margin: 0 0 24px;
}

.onboarding-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.onboarding-actions .el-button:first-child {
  margin-right: auto;
}

/* 过渡动画 */
.onboarding-fade-enter-active,
.onboarding-fade-leave-active {
  transition: opacity 0.3s ease;
}

.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
  opacity: 0;
}
</style>
