<template>
  <Teleport to="body">
    <Transition name="onboarding-fade">
      <div v-if="visible" class="onboarding-overlay">
        <!-- 聚光灯高亮区域 -->
        <div
          v-if="targetFound"
          class="spotlight"
          :style="spotlightStyle"
        ></div>

        <!-- 引导卡片 -->
        <div
          ref="cardRef"
          class="onboarding-card"
          :class="[
            currentStep?.guid && targetFound ? 'with-target' : 'welcome',
            { 'is-entering': isEntering, 'no-spotlight': !targetFound },
          ]"
          :style="cardStyle"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          :aria-label="currentStep?.title || '新手引导'"
        >
          <!-- 进度指示器 -->
          <div class="onboarding-progress" v-if="currentStep?.guid">
            <div class="progress-dots">
              <span
                v-for="(step, idx) in steps"
                :key="step.key"
                class="progress-dot"
                :class="{ active: idx === currentStepIndex, completed: idx < currentStepIndex }"
              ></span>
            </div>
            <span class="progress-text">{{ currentStepIndex + 1 }} / {{ steps.length }}</span>
          </div>

          <!-- 步骤序号 + 图标 -->
          <div class="onboarding-head">
            <div class="onboarding-icon" v-if="currentStep?.icon">
              <el-icon :size="32"><component :is="iconMap[currentStep.icon]" /></el-icon>
            </div>
            <span class="onboarding-step-tag" v-if="currentStep?.stepLabel">
              {{ currentStep.stepLabel }}
            </span>
          </div>

          <!-- 标题 -->
          <h3 class="onboarding-title">{{ currentStep?.title }}</h3>

          <!-- 内容 -->
          <p class="onboarding-content">{{ currentStep?.content }}</p>

          <!-- 操作按钮 -->
          <div class="onboarding-actions">
            <el-button v-if="currentStepIndex > 0 && currentStep?.guid" @click="prevStep">
              上一步
            </el-button>

            <template v-if="!isLastStep">
              <el-button type="primary" @click="nextStep">下一步</el-button>
              <el-button link @click="skipGuide">跳过</el-button>
            </template>

            <template v-else>
              <el-button type="primary" @click="handleFinishAction">
                {{ finishActionLabel }}
              </el-button>
              <el-button @click="handleGoDashboard">回到工作台</el-button>
            </template>
          </div>

          <!-- 键盘提示 -->
          <div class="onboarding-hint">
            <kbd>Enter</kbd> 下一步 · <kbd>←</kbd> <kbd>→</kbd> 切换 · <kbd>Esc</kbd> 跳过
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';
import { ElMessage } from 'element-plus';
import {
  Folder,
  Monitor,
  EditPen,
  WarningFilled,
  Document,
  Pointer,
  MagicStick,
  Guide,
} from '@element-plus/icons-vue';
import {
  onboardingRunning,
  readGuideState,
  writeGuideState,
} from '@/utils/onboarding-state';

const router = useRouter();
const appStore = useAppStore();

// 图标映射
const iconMap: Record<string, any> = {
  Folder,
  Monitor,
  EditPen,
  WarningFilled,
  Document,
  Pointer,
  MagicStick,
  Guide,
};

type StepPosition = 'top' | 'bottom' | 'left' | 'right';

interface OnboardingStep {
  key: string;
  /** data-guide 锚点名，最终选择器为 [data-guide="<guid>"] */
  guid?: string;
  /** 目标路由，支持 :id 占位符（用当前项目 id 替换） */
  route?: string;
  icon?: string;
  /** 「第 N 步」角标，只在主线步骤上给 */
  stepLabel?: string;
  title: string;
  content: string;
  position?: StepPosition;
  /** 高亮侧边栏时需要先展开，折叠态只有 64px 宽，高亮看不出来 */
  expandSidebar?: boolean;
}

const visible = ref(false);
const currentStepIndex = ref(0);
const isEntering = ref(false);
const spotFoundRef = ref(false);
const targetFound = computed(() => spotFoundRef.value);
const spotlightStyle = ref<Record<string, string>>({});
const cardStyle = ref<Record<string, string>>({});
const cardRef = ref<HTMLElement | null>(null);
const steps = ref<OnboardingStep[]>([]);
/** 引导期间要演示的项目；没有项目时流程步被折叠成一步总览 */
const projectId = ref('');
/** 打开引导前获得焦点的元素，关闭后还回去 */
let lastFocused: HTMLElement | null = null;

const currentStep = computed(() => steps.value[currentStepIndex.value]);
const isLastStep = computed(
  () => steps.value.length > 0 && currentStepIndex.value === steps.value.length - 1,
);

const finishActionLabel = computed(() =>
  projectId.value ? '打开项目资产台账' : '立即创建项目',
);

// ==================== 步骤清单 ====================

/**
 * 按真实测评顺序组织：建项目 → 录资产 → 现场核查 → 问题汇总 → 出报告。
 * 旧版本是按模块（工作台/AI/知识库/通知栏）绕一圈，看完知道有哪些菜单，
 * 却不知道手上这个活该怎么往下做 —— 这也是这次重写要修正的核心。
 */
function buildSteps(pid: string): OnboardingStep[] {
  const welcome: OnboardingStep = {
    key: 'welcome',
    icon: 'Pointer',
    title: '欢迎使用 JSecProbe',
    content:
      '等级保护现场测评工具，覆盖等保 2.0 全流程。接下来用两分钟带您走一遍「完成一次测评」的完整顺序：建项目 → 录资产 → 现场核查 → 问题汇总 → 出报告。',
  };

  const finish: OnboardingStep = {
    key: 'finish',
    icon: 'Guide',
    title: '就这些，可以开工了',
    content: projectId.value
      ? '您已经有项目了，可以直接从「系统构成」继续登记资产。之后每一页顶部都有 1-2-3 阶段指示器，随时能在三个环节之间跳转。想重看这段引导，点右上角头像 → 查看引导。'
      : '流程就五步。点下方按钮，系统会立刻在项目列表新建一条记录，填上项目名称与被测单位即可往下走，之后每一页顶部都有 1-2-3 阶段指示器可供跳转。想重看引导时，点右上角头像 → 查看引导。',
  };

  const createProject: OnboardingStep = {
    key: 'create-project',
    guid: 'project-create',
    route: '/projects/list',
    icon: 'Folder',
    stepLabel: '第 1 步 · 建项目',
    title: '先建一个测评项目',
    content:
      '点这里新建项目，项目信息直接写在表格里：项目编号、项目名称、被测单位、标准体系。标准体系决定了后面现场核查出哪些测评项，新建时选好，保存后不能再改。已有项目双击该行即可进入。',
    position: 'bottom',
  };

  // 没有项目时进不去那三个项目页，把第 2-5 步合并成一步「流程总览」挂在侧边栏上，
  // 至少让用户知道建好项目后该往哪走，而不是对着一堆进不去的菜单发懵
  if (!pid) {
    return [
      welcome,
      createProject,
      {
        key: 'flow-overview',
        guid: 'nav-menu',
        icon: 'Guide',
        stepLabel: '第 2-5 步 · 完整流程',
        title: '建好项目后，走这四步',
        content:
          '先在这里新建或双击打开一个项目，随后按顺序走完四个环节：① 系统构成 —— 按机房、网络设备、安全设备、服务器、终端、数据资源等 12 类登记资产，支持 Excel 导入与 AI 识别；② 现场核查 —— 按标准逐项测评、记录证据截图，改动自动保存；③ 问题汇总 —— 一键把不符合项汇总成问题清单；④ 生成项目报告 —— 直接输出测评报告。',
        position: 'right',
        expandSidebar: true,
      },
      finish,
    ];
  }

  return [
    welcome,
    createProject,
    {
      key: 'assets',
      guid: 'asset-category',
      route: '/projects/:id/assets',
      icon: 'Monitor',
      stepLabel: '第 2 步 · 录资产',
      title: '登记被测系统的资产',
      content:
        '资产按 12 类分栏管理（机房、网络边界、网络设备、安全设备、服务器与存储、终端、业务应用、系统文档、数据资源、密码产品、安全人员、其他），点分类标签切换。可以 Excel 批量导入，也可以用「AI 识别」从拓扑图/设备清单里提取，「AI 缺失提醒」会提示容易漏登记的关键资产。',
      position: 'bottom',
    },
    {
      key: 'assessment',
      guid: 'check-phase',
      route: '/projects/:id/assessment',
      icon: 'EditPen',
      stepLabel: '第 3 步 · 现场核查',
      title: '按标准逐项核查',
      content:
        '核查表按所选标准分层展开到测评项，逐条填写结果并附上证据截图。这一页的改动会自动保存（也可按 Ctrl+S 立即保存，右上角有保存状态提示），AI 分析能给出现状描述和整改建议。顶部阶段指示器可随时在系统构成 / 现场核查 / 问题汇总之间切换。',
      position: 'bottom',
    },
    {
      key: 'issues',
      guid: 'issue-generate',
      route: '/projects/:id/issues',
      icon: 'WarningFilled',
      stepLabel: '第 4 步 · 问题汇总',
      title: '汇总发现的问题',
      content:
        '点「从测评记录生成」，系统会把现场核查中判定为不符合 / 部分符合的项自动转成问题清单，按高中低风险分级，支持新增、编辑和导出。',
      position: 'bottom',
    },
    {
      key: 'report',
      guid: 'report-generate',
      route: '/projects/:id/issues',
      icon: 'Document',
      stepLabel: '第 5 步 · 出报告',
      title: '一键生成测评报告',
      content:
        '最后点「生成项目报告」，按报告配置里选好的章节与模板直接输出测评报告；同一份问题清单可以同时导出给客户。',
      position: 'bottom',
    },
    finish,
  ];
}

// ==================== 定位 ====================

function selectorOf(step: OnboardingStep): string {
  return step.guid ? `[data-guide="${step.guid}"]` : '';
}

function resolveRoute(route?: string): string {
  if (!route) return '';
  // 只有真正带项目 id 的路由才需要有项目；「/projects/list」这类静态路由
  // 在没有项目时（恰恰是新手最常见的状态）也必须能跳过去
  if (route.includes(':id') && !projectId.value) return '';
  return route.replace(':id', projectId.value);
}

async function waitForTarget(step: OnboardingStep): Promise<boolean> {
  const selector = selectorOf(step);
  if (!selector) return false;
  // 轮询等待：路由 enter 过渡 + 页面自身的数据加载都可能让目标晚一点出现
  for (let i = 0; i < 24; i++) {
    const el = document.querySelector(selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function ensureRoute(step: OnboardingStep) {
  const target = resolveRoute(step.route);
  if (!target) {
    await waitForTarget(step);
    return;
  }
  if (router.currentRoute.value.path !== target) {
    try {
      await router.push(target);
    } catch {
      // 路由跳转失败（例如项目被删）时仍继续展示文案，让用户至少有说明可读
    }
    // 等 page-fade（leave 90ms + enter 200ms）跑完再测量，否则量到的是动画中间态
    await new Promise((resolve) => setTimeout(resolve, 320));
  }
  await waitForTarget(step);
}

function centerCard(): Record<string, string> {
  return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
}

function calculatePosition() {
  const step = currentStep.value;
  const selector = selectorOf(step);
  const targetEl = selector ? document.querySelector(selector) : null;

  if (!targetEl) {
    spotFoundRef.value = false;
    spotlightStyle.value = {};
    cardStyle.value = centerCard();
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    spotFoundRef.value = false;
    spotlightStyle.value = {};
    cardStyle.value = centerCard();
    return;
  }

  spotFoundRef.value = true;
  spotlightStyle.value = {
    top: `${rect.top - 8}px`,
    left: `${rect.left - 8}px`,
    width: `${rect.width + 16}px`,
    height: `${rect.height + 16}px`,
  };

  const cardWidth = 400;
  const cardHeight = cardRef.value?.offsetHeight || 320;
  const gap = 20;
  const margin = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 首选位置放不下时翻到反面：优先用上/下，其次左/右
  let position = step.position || 'bottom';
  const fitsBottom = rect.bottom + gap + cardHeight + margin <= vh;
  const fitsTop = cardHeight + gap + margin <= rect.top;
  if (position === 'bottom' && !fitsBottom && fitsTop) position = 'top';
  else if (position === 'top' && !fitsTop && fitsBottom) position = 'bottom';
  else if (position === 'bottom' && !fitsBottom && !fitsTop) position = 'left';

  const clampLeft = (left: number) => Math.max(margin, Math.min(left, vw - cardWidth - margin));
  const clampTop = (top: number) => Math.max(margin, Math.min(top, vh - cardHeight - margin));

  switch (position) {
    case 'right':
      cardStyle.value = {
        top: `${clampTop(rect.top)}px`,
        left: `${clampLeft(rect.right + gap)}px`,
      };
      break;
    case 'left':
      cardStyle.value = {
        top: `${clampTop(rect.top)}px`,
        left: `${clampLeft(rect.left - cardWidth - gap)}px`,
      };
      break;
    case 'top':
      cardStyle.value = {
        top: `${clampTop(rect.top - cardHeight - gap)}px`,
        left: `${clampLeft(rect.left + rect.width / 2 - cardWidth / 2)}px`,
      };
      break;
    default:
      cardStyle.value = {
        top: `${clampTop(rect.bottom + gap)}px`,
        left: `${clampLeft(rect.left + rect.width / 2 - cardWidth / 2)}px`,
      };
  }
}

let rafId: number | null = null;
function scheduleRecalc() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (visible.value) calculatePosition();
  });
}

// ==================== 步进 ====================

function persistProgress(status?: 'in_progress' | 'skipped' | 'completed') {
  writeGuideState({
    status: status || 'in_progress',
    step: currentStepIndex.value,
    total: steps.value.length,
  });
}

function focusCard() {
  // rAF 之后再聚焦：过渡刚开始时卡片可能还没拿到最终位置，直接 focus 会滚动页面
  requestAnimationFrame(() => {
    cardRef.value?.focus({ preventScroll: true });
  });
}

async function enterStep() {
  const step = currentStep.value;
  if (!step) return;
  isEntering.value = false;
  persistProgress();
  if (step.expandSidebar && appStore.sidebarCollapsed) {
    appStore.toggleSidebar();
  }
  await nextTick();
  await ensureRoute(step);
  isEntering.value = true;
  await nextTick();
  calculatePosition();
  focusCard();
}

function nextStep() {
  if (currentStepIndex.value < steps.value.length - 1) {
    currentStepIndex.value++;
    enterStep();
  } else {
    completeGuide();
  }
}

function prevStep() {
  if (currentStepIndex.value > 0) {
    currentStepIndex.value--;
    enterStep();
  }
}

function closeGuide() {
  visible.value = false;
  onboardingRunning.value = false;
  removeKeyListener();
  document.removeEventListener('scroll', scheduleRecalc, true);
  // 焦点还回原处，避免关闭后焦点丢失导致键盘用户从页头重新 Tab
  if (lastFocused && document.contains(lastFocused)) {
    lastFocused.focus({ preventScroll: true });
  }
  lastFocused = null;
}

function skipGuide() {
  persistProgress('skipped');
  closeGuide();
}

function completeGuide() {
  persistProgress('completed');
  closeGuide();
}

async function handleFinishAction() {
  completeGuide();
  if (projectId.value) {
    router.push(`/projects/${projectId.value}/assets`).catch(() => {});
    return;
  }
  await router.push('/projects/list').catch(() => {});
  // 复用列表页自己的新建逻辑（它会插入可编辑新行并处理默认值），
  // 这里只触发它，避免把一套表单逻辑在引导组件里再抄一遍
  setTimeout(() => {
    const btn = document.querySelector<HTMLElement>('[data-guide="project-create"]');
    if (btn) btn.click();
    else ElMessage.info('请点击工具栏的「新建项目」开始');
  }, 400);
}

function handleGoDashboard() {
  completeGuide();
  router.push('/dashboard').catch(() => {});
}

// ==================== 键盘 ====================

function isTextInput(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable;
}

function trapFocus(e: KeyboardEvent) {
  const card = cardRef.value;
  if (!card) return;
  const items = Array.from(
    card.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea'),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) {
    e.preventDefault();
    card.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || active === card)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!visible.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    skipGuide();
    return;
  }
  if (e.key === 'Tab') {
    trapFocus(e);
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    if (e.key === 'ArrowRight') nextStep();
    else prevStep();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    const target = e.target as HTMLElement | null;
    // 焦点已经在按钮上时交给浏览器原生行为，否则 Enter 会同时触发按钮点击和步进
    const onControl = !!target && (target.tagName === 'BUTTON' || target.tagName === 'A');
    if (onControl || isTextInput(target)) return;
    e.preventDefault();
    nextStep();
  }
}

function addKeyListener() {
  document.addEventListener('keydown', handleKeydown, true);
}
function removeKeyListener() {
  document.removeEventListener('keydown', handleKeydown, true);
}

// ==================== 生命周期 ====================

/**
 * 挑一个用于演示的项目：优先当前正在做的，其次第一个未归档项目。
 * 取不到就说明这是全新环境，流程步自动退化成一步总览。
 */
async function resolveProjectId(): Promise<string> {
  try {
    const res = await window.api?.project?.list({ page: 1, pageSize: 20, excludeArchived: true });
    const list = res?.data?.list || [];
    if (!list.length) return '';
    const current = appStore.currentProjectId;
    if (current && list.some((p: { id: string }) => p.id === current)) return current;
    return list[0].id;
  } catch {
    return '';
  }
}

async function open(startIndex: number, expectedTotal?: number) {
  projectId.value = await resolveProjectId();
  steps.value = buildSteps(projectId.value);
  // 步骤条数变了（在「无项目」与「有项目」两种情况之间切换）时，旧的进度序号已经不对应同一件事，
  // 这时宁可从第一步重来，也不要跳到一个语义完全不同的步骤上
  const resumable = expectedTotal !== undefined && expectedTotal === steps.value.length;
  const start = resumable ? startIndex : 0;
  currentStepIndex.value = Math.min(Math.max(start, 0), steps.value.length - 1);
  lastFocused = document.activeElement as HTMLElement | null;
  visible.value = true;
  onboardingRunning.value = true;
  addKeyListener();
  document.addEventListener('scroll', scheduleRecalc, true);
  await enterStep();
}

async function startGuide() {
  const state = readGuideState();
  // 已完成 / 主动跳过都不再自动打扰；只有「播了一半」才续播
  if (state.status === 'completed' || state.status === 'skipped') return;
  // 续播只对短期内的中断有意义：隔了很久才回来，中间可能已经自己摸熟了界面，
  // 中途弹出半年前的第三步反而莫名其妙，这种情况从头播
  const staleMs = 7 * 24 * 60 * 60 * 1000;
  const stale = !state.updatedAt || Date.now() - state.updatedAt > staleMs;
  const resume = state.status === 'in_progress' && !stale ? state.step : 0;
  await open(resume, state.total);
}

async function restartGuide() {
  await open(0);
}

defineExpose({
  start: startGuide,
  restart: restartGuide,
});

onMounted(() => {
  window.addEventListener('resize', calculatePosition);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', calculatePosition);
  document.removeEventListener('scroll', scheduleRecalc, true);
  removeKeyListener();
  onboardingRunning.value = false;
  if (rafId) cancelAnimationFrame(rafId);
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
  border-radius: var(--radius-lg);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5), 0 0 20px rgba(27, 95, 217, 0.3);
  transition: all 0.4s ease;
  pointer-events: auto;
  z-index: 10000;
}

.onboarding-card {
  position: absolute;
  width: 400px;
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  padding: 28px;
  box-shadow: var(--shadow-xl);
  pointer-events: auto;
  z-index: 10001;
  transition: top 0.4s ease, left 0.4s ease;
  outline: none;
}

.onboarding-card.welcome {
  text-align: center;
}

.onboarding-card.welcome .onboarding-head {
  justify-content: center;
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
  background: var(--color-border-base);
  transition: all 0.3s ease;
}

.progress-dot.active {
  background: var(--color-primary);
  width: 20px;
  border-radius: var(--radius-sm);
}

.progress-dot.completed {
  background: var(--color-success);
}

.progress-text {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.onboarding-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.onboarding-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, #1b5fd9 0%, #154db0 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}

.onboarding-card.welcome .onboarding-icon {
  margin: 0 auto;
}

.onboarding-step-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-primary-lighter);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.onboarding-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 12px;
}

.onboarding-content {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text-secondary);
  margin: 0 0 20px;
  text-align: left;
}

.onboarding-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.onboarding-actions > :first-child {
  margin-right: auto;
}

.onboarding-hint {
  margin-top: 16px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  text-align: center;
}

.onboarding-hint kbd {
  display: inline-block;
  min-width: 18px;
  padding: 1px 5px;
  margin: 0 1px;
  border: 1px solid var(--color-border-base);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
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

/* 步骤内容进入动效：fade + 上移 8px + 轻微缩放 */
.onboarding-card.is-entering {
  animation: onboarding-card-in 0.2s ease;
}

@keyframes onboarding-card-in {
  from {
    opacity: 0;
    translate: 0 8px;
    scale: 0.96;
  }
  to {
    opacity: 1;
    translate: 0 0;
    scale: 1;
  }
}

/* 欢迎图标上下浮动 */
.onboarding-card.welcome .onboarding-icon {
  animation: onboarding-icon-float 2.4s ease-in-out infinite;
}

@keyframes onboarding-icon-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

/* 尊重系统减弱动效偏好 */
@media (prefers-reduced-motion: reduce) {
  .onboarding-card.is-entering {
    animation: none;
  }
  .onboarding-card.welcome .onboarding-icon {
    animation: none;
  }
}
</style>
