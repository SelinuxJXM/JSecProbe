/**
 * 云端模型健康记录（纯内存、纯函数，不依赖 Electron / 数据库）。
 *
 * 背景：故障转移是「串行叫号」，而失败最常见的原因是超时。首选模型一旦挂掉，
 * 用户要先白等一整个超时周期才开始试下一个；下次请求又会重复这段等待。
 * 这里只做两件保守的事，均不触碰成功路径：
 *   1) 近期失败过的模型在冷却窗口内排到健康模型之后（不剔除，全挂时仍会尝试）；
 *   2) 对处于冷却中的模型用更短的「探活」超时，尽快切到下一个或明确报错。
 * 模型一旦成功立刻清除记录；记录只在进程内有效，重启即归零，不会持久化影响用户配置。
 */

/** 失败后降权窗口：5 分钟内不再把该模型排在最前 */
export const MODEL_COOLDOWN_MS = 5 * 60 * 1000;
/** 冷却中模型的探活超时上限：15 秒（原云端默认 120 秒 / 批量按内容动态计算） */
export const MODEL_PROBE_TIMEOUT_MS = 15 * 1000;

export interface ModelHealthState {
  failures: number;
  lastFailedAt: number;
}

export class ModelHealthTracker {
  private states = new Map<string, ModelHealthState>();

  /** 记录一次「模型侧」失败。用户主动取消、缺 Key、地址无效不应由调用方传入。 */
  recordFailure(key: string, now = Date.now()): void {
    if (!key) return;
    const prev = this.states.get(key);
    this.states.set(key, { failures: (prev?.failures ?? 0) + 1, lastFailedAt: now });
  }

  /** 成功即恢复：清除降权，下一轮该模型回到原优先级。 */
  recordSuccess(key: string): void {
    if (key) this.states.delete(key);
  }

  isCoolingDown(key: string, now = Date.now(), cooldownMs = MODEL_COOLDOWN_MS): boolean {
    const state = this.states.get(key);
    if (!state || state.failures <= 0) return false;
    return now - state.lastFailedAt < cooldownMs;
  }

  getFailures(key: string): number {
    return this.states.get(key)?.failures ?? 0;
  }

  /** 清理过期记录，避免长期运行的进程里 Map 无限增长。 */
  prune(now = Date.now(), cooldownMs = MODEL_COOLDOWN_MS): void {
    for (const [key, state] of this.states) {
      if (now - state.lastFailedAt >= cooldownMs) this.states.delete(key);
    }
  }

  clear(): void {
    this.states.clear();
  }
}

/**
 * 稳定分区排序：健康模型保持原相对顺序在前，冷却中模型保持原相对顺序在后。
 * 不修改入参；没有降权记录时返回结果与原数组顺序完全一致（成功路径零变化）。
 */
export function orderByHealth<T>(
  items: T[],
  keyOf: (item: T) => string,
  tracker: ModelHealthTracker,
  now = Date.now(),
  cooldownMs = MODEL_COOLDOWN_MS,
): T[] {
  const healthy: T[] = [];
  const cooling: T[] = [];
  for (const item of items) {
    (tracker.isCoolingDown(keyOf(item), now, cooldownMs) ? cooling : healthy).push(item);
  }
  return [...healthy, ...cooling];
}

/** 冷却中的模型用短探活；健康模型原样返回（成功路径超时不变）。 */
export function effectiveTimeout(
  baseMs: number,
  coolingDown: boolean,
  probeMs = MODEL_PROBE_TIMEOUT_MS,
): number {
  if (!coolingDown) return baseMs;
  return Math.min(baseMs, probeMs);
}
