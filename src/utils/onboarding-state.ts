/**
 * 引导 / 页面首访提示的状态存储与跨组件协调。
 *
 * 拆成独立模块而不是塞进 OnboardingGuide 组件内部，是因为有两个消费者：
 *  - OnboardingGuide：读写「引导播到哪了」
 *  - PageHint：读写「这个页面的提示看过没有」，并且要在引导播放时避让
 *
 * localStorage 结构（键 jsecprobe_onboarding_state）：
 *   { status, step, total, updatedAt }
 * status 四种取值见 GuideStatus；step/total 只在 status === 'in_progress'
 * 且 total 与当前实际步骤数一致时才用于续播 —— 步骤清单会随「有没有项目」变化，
 * 条数对不上时宁可从第 0 步重来，也不要跳到一个语义完全不同的步骤上。
 */

import { ref } from 'vue';

export type GuideStatus = 'not_started' | 'in_progress' | 'skipped' | 'completed';

export interface GuideState {
  status: GuideStatus;
  step: number;
  total: number;
  updatedAt: number;
}

const STORAGE_KEY = 'jsecprobe_onboarding_state';
// v2.4.x 之前只写了一个布尔量，读到这里时按「已完成」处理，避免老用户被重新引导一遍
const LEGACY_KEY = 'jsecprobe_onboarding_completed';
const HINT_PREFIX = 'jsecprobe_page_hint_';

/** 引导是否正在播放。页面首访提示用它避让，避免两层提示叠加。 */
export const onboardingRunning = ref(false);

const DEFAULT_STATE: GuideState = {
  status: 'not_started',
  step: 0,
  total: 0,
  updatedAt: 0,
};

export function readGuideState(): GuideState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GuideState>;
      const status = parsed.status || 'not_started';
      return {
        status,
        step: Number(parsed.step) || 0,
        total: Number(parsed.total) || 0,
        updatedAt: Number(parsed.updatedAt) || 0,
      };
    }
    if (localStorage.getItem(LEGACY_KEY) === 'true') {
      return { ...DEFAULT_STATE, status: 'completed' };
    }
  } catch {
    // 存储被禁用或内容损坏：当作从未引导，不影响主流程
  }
  return { ...DEFAULT_STATE };
}

export function writeGuideState(state: Partial<GuideState>): void {
  try {
    const next: GuideState = { ...readGuideState(), ...state, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // 忽略写入失败（隐私模式 / 配额用尽），引导仍可在本次会话内正常工作
  }
}

// ==================== 页面首访提示 ====================

/** 已接入首访提示的页面键，重置入口按这份清单清理 */
export const PAGE_HINT_KEYS = ['system-composition', 'onsite-verification', 'issues'] as const;
export type PageHintKey = (typeof PAGE_HINT_KEYS)[number];

export function isHintSeen(key: PageHintKey): boolean {
  try {
    return localStorage.getItem(HINT_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

export function markHintSeen(key: string): void {
  try {
    localStorage.setItem(HINT_PREFIX + key, '1');
  } catch {
    // 同上，忽略
  }
}

/** 清空所有页面提示的「已读」记录，供「重置页面提示」入口调用 */
export function resetAllHints(keys: readonly PageHintKey[] = PAGE_HINT_KEYS): void {
  try {
    for (const key of keys) {
      localStorage.removeItem(HINT_PREFIX + key);
    }
  } catch {
    // 忽略
  }
}
