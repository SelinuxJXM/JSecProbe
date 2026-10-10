// @vitest-environment happy-dom
/**
 * useAutoSaveCore 关键链路测试
 *
 * 这个核是三张可编辑表格（项目列表 / 资产台账 / 现场核查）共用的一半，
 * 测它就等于同时守住三处的落库行为。重点不在"能保存"，而在几个曾经真实丢过数据的边界：
 *  1. 保存进行中又来一次触发 —— 旧实现直接丢弃，本轮结束后必须补跑；
 *  2. 卸载 / 切页时防抖窗口内的改动 —— 旧实现只清定时器，用户填完切页等于白填；
 *  3. 落库抛异常后 isSaving 必须归位，否则手动保存会永久卡在"正在保存中"；
 *  4. 状态以"落库后还剩多少脏数据"为准，而不是只看本次 persist 的返回值。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const { ElMessage } = vi.hoisted(() => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('element-plus', () => ({ ElMessage }));

import { useAutoSaveCore, mapLimit } from '../../src/composables/useAutoSaveCore';

/**
 * 用真实定时器 + 极小间隔，而不是 vi.useFakeTimers()：
 * 被测代码走的是 window.setTimeout / window.setInterval（happy-dom 的实现），
 * 假定时器只接管全局函数，拦截不到它，用真实短间隔断言更稳。
 */
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** 让 runSave 内部排队补跑的 Promise.resolve().then 有机会执行 */
const flushMicrotasks = () => sleep(0);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runSave：并发与状态机', () => {
  it('没有待保存改动时不落库', async () => {
    const persist = vi.fn(async () => true);
    const core = useAutoSaveCore({ hasDirty: () => false, persist });

    await expect(core.runSave()).resolves.toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('保存进行中的再次触发不丢弃：本轮结束后立刻补跑一次', async () => {
    let resolveFirst!: (value: boolean) => void;
    let calls = 0;
    const persist = vi.fn(async () => {
      calls++;
      if (calls === 1) return await new Promise<boolean>(resolve => (resolveFirst = resolve));
      return true;
    });
    const core = useAutoSaveCore({ hasDirty: () => true, persist });

    const first = core.runSave();
    const second = core.runSave(); // 撞上互斥

    await expect(second).resolves.toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);

    resolveFirst(true);
    await expect(first).resolves.toBe(true);

    await flushMicrotasks();
    expect(persist).toHaveBeenCalledTimes(2); // 补跑了，而不是把这批改动丢掉
  });

  it('落库成功但仍有脏数据时状态为 unsaved（等周期保存重试）', async () => {
    const core = useAutoSaveCore({ hasDirty: () => true, persist: vi.fn(async () => true) });

    const ok = await core.runSave();

    expect(ok).toBe(true);
    expect(core.saveStatus.value).toBe('unsaved');
    expect(core.lastSavedTime.value).toBeInstanceOf(Date);
  });

  it('落库失败且仍有脏数据时状态为 error，且不刷新 lastSavedTime', async () => {
    const core = useAutoSaveCore({ hasDirty: () => true, persist: vi.fn(async () => false) });

    const ok = await core.runSave();

    expect(ok).toBe(false);
    expect(core.saveStatus.value).toBe('error');
    expect(core.lastSavedTime.value).toBeNull();
  });

  it('落库返回 false 但脏数据已清空时按已保存处理（并发补跑抢先完成的场景）', async () => {
    const dirty = ref(true);
    const core = useAutoSaveCore({
      hasDirty: () => dirty.value,
      persist: vi.fn(async () => {
        dirty.value = false;
        return false;
      }),
    });

    const ok = await core.runSave();

    expect(ok).toBe(false);
    expect(core.saveStatus.value).toBe('saved');
    expect(core.lastSavedTime.value).toBeInstanceOf(Date);
  });

  it('落库抛异常被吞掉并返回 false，且 isSaving 归位（否则手动保存永久卡住）', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const persist = vi.fn(async () => {
      throw new Error('IPC 断开');
    });
    const core = useAutoSaveCore({ hasDirty: () => true, persist });

    await expect(core.runSave()).resolves.toBe(false);

    expect(core.saveStatus.value).toBe('error');
    expect(core.isSaving.value).toBe(false);
    expect(consoleError).toHaveBeenCalled();

    // 归位之后必须还能再保存，否则一处异常会永久锁死自动保存
    persist.mockImplementation(async () => true);
    await expect(core.runSave()).resolves.toBe(true);
  });

  it('isSaving 在保存期间为 true，结束后归位', async () => {
    let resolvePersist!: (value: boolean) => void;
    const core = useAutoSaveCore({
      hasDirty: () => true,
      persist: () => new Promise<boolean>(resolve => (resolvePersist = resolve)),
    });

    const inflight = core.runSave();
    expect(core.isSaving.value).toBe(true);
    expect(core.saveStatus.value).toBe('saving');

    resolvePersist(true);
    await inflight;
    expect(core.isSaving.value).toBe(false);
  });
});

describe('scheduleSave：防抖', () => {
  it('调用后立即标记未保存，连续触发合并成一次落库', async () => {
    const persist = vi.fn(async () => true);
    const core = useAutoSaveCore({ hasDirty: () => true, persist, debounceDelay: 40 });

    core.scheduleSave();
    expect(core.saveStatus.value).toBe('unsaved'); // 脏标记与界面提示必须同步
    core.scheduleSave();
    core.scheduleSave();

    await sleep(250);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('离散操作可用显式短延迟，绕过默认防抖窗口', async () => {
    const persist = vi.fn(async () => true);
    const core = useAutoSaveCore({ hasDirty: () => true, persist, debounceDelay: 60000 });

    core.scheduleSave(10);
    await sleep(120);

    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe('周期保存：脏数据兜底重试', () => {
  it('只在有脏数据时保存，stop 之后不再触发', async () => {
    const dirty = ref(false);
    const persist = vi.fn(async () => true);
    const core = useAutoSaveCore({ hasDirty: () => dirty.value, persist, periodicInterval: 40 });

    core.startPeriodicSave();
    await sleep(250);
    expect(persist).not.toHaveBeenCalled(); // 干净时不空转

    dirty.value = true;
    await sleep(250);
    expect(persist).toHaveBeenCalled(); // 脏数据没清干净时兜底重试

    const count = persist.mock.calls.length;
    core.stopPeriodicSave();
    await sleep(250);
    expect(persist.mock.calls.length).toBe(count);
  });
});

describe('cleanup：卸载收尾', () => {
  it('防抖窗口内的改动在卸载时先落盘，不被直接丢弃', async () => {
    const dirty = ref(true);
    const persist = vi.fn(async () => true);
    const core = useAutoSaveCore({ hasDirty: () => dirty.value, persist, debounceDelay: 60000 });

    core.scheduleSave();
    expect(persist).not.toHaveBeenCalled(); // 还在防抖窗口里

    core.cleanup();
    await flushMicrotasks();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('cleanup 清掉防抖定时器，之后不会再多补一次落库', async () => {
    const dirty = ref(true);
    const persist = vi.fn(async () => true);
    const core = useAutoSaveCore({ hasDirty: () => dirty.value, persist, debounceDelay: 30 });

    core.scheduleSave();
    core.cleanup();
    await sleep(250);

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('正在保存中时 cleanup 不重复发起落库', async () => {
    const dirty = ref(true);
    let resolveFirst!: (value: boolean) => void;
    let calls = 0;
    const persist = vi.fn(async () => {
      calls++;
      if (calls === 1) return await new Promise<boolean>(resolve => (resolveFirst = resolve));
      return true;
    });
    const core = useAutoSaveCore({ hasDirty: () => dirty.value, persist });

    const inflight = core.runSave();
    core.cleanup();
    await flushMicrotasks();

    expect(persist).toHaveBeenCalledTimes(1);

    resolveFirst(true);
    await inflight;
  });
});

describe('triggerManualSave', () => {
  it('没有待保存改动时点保存：提示无改动而不是"保存失败"', async () => {
    const persist = vi.fn(async () => true);
    const core = useAutoSaveCore({ hasDirty: () => false, persist });

    await expect(core.triggerManualSave()).resolves.toBe(true);

    expect(persist).not.toHaveBeenCalled();
    expect(ElMessage.error).not.toHaveBeenCalled();
    expect(ElMessage.info).toHaveBeenCalledWith('没有需要保存的修改');
  });

  it('保存成功后提示成功并返回 true', async () => {
    const core = useAutoSaveCore({ hasDirty: () => true, persist: vi.fn(async () => true) });

    await expect(core.triggerManualSave()).resolves.toBe(true);
    expect(ElMessage.success).toHaveBeenCalledTimes(1);
    expect(ElMessage.error).not.toHaveBeenCalled();
  });

  it('保存失败时提示失败并返回 false', async () => {
    const core = useAutoSaveCore({ hasDirty: () => true, persist: vi.fn(async () => false) });

    await expect(core.triggerManualSave()).resolves.toBe(false);
    expect(ElMessage.error).toHaveBeenCalledTimes(1);
  });

  it('撞上正在保存中：不重入落库，按配置级别提示忙碌', async () => {
    let resolveFirst!: (value: boolean) => void;
    let calls = 0;
    const persist = vi.fn(async () => {
      calls++;
      if (calls === 1) return await new Promise<boolean>(resolve => (resolveFirst = resolve));
      return true;
    });
    const core = useAutoSaveCore({ hasDirty: () => true, persist, busyMessageType: 'warning' });

    const inflight = core.runSave();
    await expect(core.triggerManualSave()).resolves.toBe(false);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(ElMessage.warning).toHaveBeenCalledWith('正在保存中，请稍候');
    expect(ElMessage.success).not.toHaveBeenCalled();

    resolveFirst(true);
    await inflight;
  });
});

describe('hasUnsavedChanges', () => {
  it('派生自 hasDirty()，脏标记变化立即跟随', () => {
    const dirty = ref(false);
    const core = useAutoSaveCore({
      hasDirty: () => dirty.value,
      persist: vi.fn(async () => true),
    });

    expect(core.hasUnsavedChanges.value).toBe(false);
    dirty.value = true;
    expect(core.hasUnsavedChanges.value).toBe(true);
    dirty.value = false;
    expect(core.hasUnsavedChanges.value).toBe(false);
  });
});

describe('mapLimit：定长并发池', () => {
  it('结果顺序与输入一致', async () => {
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async n => n % 2 === 0);

    expect(results).toEqual([false, true, false, true, false]);
  });

  it('并发数不超过 limit（现场核查上百行不会一次打满 IPC）', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
      return true;
    });

    expect(peak).toBe(3);
  });

  it('limit 大于任务数时按任务数起协程，不留空结果位', async () => {
    await expect(mapLimit([1, 2], 10, async () => true)).resolves.toEqual([true, true]);
  });

  it('limit 非法（0 / 负数）时退化为串行，而不是并发打满', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapLimit([1, 2, 3, 4], 0, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
      return true;
    });

    expect(peak).toBe(1);
  });

  it('空列表直接返回空结果，不调用任务函数', async () => {
    const fn = vi.fn(async () => true);

    await expect(mapLimit([], 4, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});