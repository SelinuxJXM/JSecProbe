/**
 * 自动保存公共核。
 *
 * 三张可编辑表格（项目列表 / 资产台账 / 现场核查）各有一份自动保存 composable，
 * 此前把「防抖定时器 + 周期保存 + 并发互斥 + 状态机 + 卸载 flush」整套机制各写了一遍，
 * 合计 760 行做同一件事，且行为各不相同：项目与资产的 `saveInProgress` 冲突时直接丢弃
 * 本次保存，现场核查则补跑一次——同样的操作在不同页面丢数据的概率不一样。
 *
 * 本模块抽出**与业务无关**的那一半：定时器、互斥、排队重试、状态机、手动保存、卸载 flush。
 * 各 composable 只保留两件事：判断"有没有待保存改动"（hasDirty）、真正落库（persist）。
 */
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unsaved';

export interface AutoSaveCoreOptions {
  /** 是否存在待保存改动。由调用方按自己的脏标记结构判定。 */
  hasDirty: () => boolean;
  /**
   * 真正落库。
   * @returns 本次是否全部成功。返回 false 时未落库的行**必须仍留在脏标记里**，
   *          由周期保存或下一次触发重试，否则等于静默丢数据。
   */
  persist: () => Promise<boolean>;
  /** 防抖窗口（毫秒）：停手多久算填完 */
  debounceDelay?: number;
  /** 周期保存间隔（毫秒）：脏标记没清干净时的兜底重试 */
  periodicInterval?: number;
  /** 手动保存撞上"正在保存中"时的提示级别 */
  busyMessageType?: 'warning' | 'info';
}

export function useAutoSaveCore(options: AutoSaveCoreOptions) {
  const {
    hasDirty,
    persist,
    debounceDelay = 8000,
    periodicInterval = 45000,
    busyMessageType = 'info',
  } = options;

  const saveStatus = ref<SaveStatus>('idle');
  const lastSavedTime = ref<Date | null>(null);
  const isSaving = ref(false);

  // 派生而非独立维护：此前脏标记与"是否显示未保存"是两个状态，
  // 出现过"改完了但标记没同步"导致周期保存跳过、改动被静默丢弃的情况。
  const hasUnsavedChanges = computed(() => hasDirty());

  let autoSaveTimer: number | null = null;
  let periodicSaveTimer: number | null = null;

  let saveInProgress = false;
  /** 保存期间又产生了新改动时置位，本轮结束后立刻补跑，而不是丢弃 */
  let saveQueued = false;

  /**
   * 执行一次保存。三处调用方（防抖 / 周期 / 手动）都走这里，互斥集中在这。
   */
  async function runSave(): Promise<boolean> {
    if (saveInProgress) {
      // 不丢弃：置位后本轮收尾立刻补跑一次。
      // 此前项目/资产两处直接 return false，保存期间敲的字只能等下一次击键
      // 或 45 秒周期才落库，用户若此时切页就等于白填。
      saveQueued = true;
      return false;
    }
    if (!hasDirty()) return false;

    saveInProgress = true;
    isSaving.value = true;
    saveStatus.value = 'saving';

    let ok = false;
    try {
      ok = await persist();
      return ok;
    } catch (error) {
      console.error('[自动保存] 落库异常:', error);
      ok = false;
      return false;
    } finally {
      // 状态以"落库后还剩多少改动"为准，而不是只看本次调用返回值：
      // ok=false 但改动已清空（例如并发补跑抢先完成）也该显示已保存。
      if (hasDirty()) {
        saveStatus.value = ok ? 'unsaved' : 'error';
      } else {
        saveStatus.value = 'saved';
      }
      if (ok || !hasDirty()) {
        lastSavedTime.value = new Date();
      }

      saveInProgress = false;
      isSaving.value = false;

      if (saveQueued) {
        saveQueued = false;
        // 让出一个微任务再补跑，避免与本次的响应式刷新挤在同一帧
        void Promise.resolve().then(() => {
          runSave();
        });
      }
    }
  }

  /**
   * 防抖触发保存。
   * @param delay 不传用默认延迟（文本输入）；勾选项/下拉这类离散操作传短延迟。
   */
  function scheduleSave(delay?: number): void {
    saveStatus.value = 'unsaved';
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = window.setTimeout(() => {
      autoSaveTimer = null;
      runSave();
    }, delay ?? debounceDelay);
  }

  function startPeriodicSave(): void {
    stopPeriodicSave();
    periodicSaveTimer = window.setInterval(() => {
      if (hasDirty()) {
        runSave();
      }
    }, periodicInterval);
  }

  function stopPeriodicSave(): void {
    if (periodicSaveTimer) {
      clearInterval(periodicSaveTimer);
      periodicSaveTimer = null;
    }
  }

  async function triggerManualSave(): Promise<boolean> {
    if (saveInProgress) {
      busyMessageType === 'warning'
        ? ElMessage.warning('正在保存中，请稍候')
        : ElMessage.info('正在保存中，请稍候');
      return false;
    }
    // "没有待保存改动"不是失败：此前会一路落到 runSave() 的 !hasDirty() 分支返回 false，
    // 再被下面的 else 报成"保存失败，请重试"——用户只是点了一下保存（或改动已被防抖/周期
    // 保存落库），却以为刚填的内容没写进库。
    if (!hasDirty()) {
      ElMessage.info('没有需要保存的修改');
      return true;
    }
    const success = await runSave();
    if (success) {
      ElMessage.success('保存成功');
    } else {
      ElMessage.error('保存失败，请重试');
    }
    return success;
  }

  /**
   * 组件卸载 / 切换上下文前的收尾。
   *
   * 原先三处都只 clearTimeout + clearInterval —— 防抖窗口内的改动被直接丢弃，
   * 用户填完就切页等于白填。这里统一先尝试落盘再走。
   * 不 await（卸载钩子等不了），IPC 在主进程执行，不依赖组件实例存活。
   */
  function cleanup(contextLabel = '自动保存'): void {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    stopPeriodicSave();
    if (hasDirty() && !saveInProgress) {
      runSave().catch(() => {
        // 卸载阶段失败不打扰用户；脏标记仍在，回到页面由周期保存重试
        console.warn(`[${contextLabel}] 离开页面时自动保存失败`);
      });
    }
  }

  return {
    saveStatus,
    hasUnsavedChanges,
    lastSavedTime,
    isSaving,
    runSave,
    scheduleSave,
    startPeriodicSave,
    stopPeriodicSave,
    triggerManualSave,
    cleanup,
  };
}

/**
 * 定长并发池。
 *
 * 现场核查一个域动辄上百行，全量 `Promise.all` 会瞬间打出上百个 IPC；
 * 串行又太慢。取固定并发数在两者之间平衡。
 */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<boolean>
): Promise<boolean[]> {
  const results: boolean[] = new Array(items.length).fill(false);
  let cursor = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
