/**
 * 云端模型失败降权的回归 + 接线反漂移门禁。
 *
 * 降权只许动「失败分支」：没有失败记录时尝试顺序、超时必须和改动前逐字节一致；
 * 一旦某模型失败，它要退到健康模型之后，且下次只给短探活，不再让用户白等一整个超时。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MODEL_COOLDOWN_MS,
  MODEL_PROBE_TIMEOUT_MS,
  ModelHealthTracker,
  effectiveTimeout,
  orderByHealth,
} from '../../shared/ai-model-health';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

interface Endpoint { id: string; name: string }
const eps: Endpoint[] = [
  { id: 'a', name: '首选' },
  { id: 'b', name: '备用1' },
  { id: 'c', name: '备用2' },
];
const keyOf = (e: Endpoint) => e.id;
const T0 = 1_700_000_000_000;

describe('orderByHealth', () => {
  it('无失败记录时顺序完全不变，且不修改入参', () => {
    const tracker = new ModelHealthTracker();
    const result = orderByHealth(eps, keyOf, tracker, T0);
    expect(result.map(e => e.id)).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(eps);
    expect(eps.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('近期失败的首选模型退到健康模型之后', () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure('a', T0);
    expect(orderByHealth(eps, keyOf, tracker, T0).map(e => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('多个失败模型仍保持各自原相对顺序', () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure('a', T0);
    tracker.recordFailure('b', T0);
    expect(orderByHealth(eps, keyOf, tracker, T0).map(e => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('全部失败时顺序不变——不剔除任何模型，仍有尝试机会', () => {
    const tracker = new ModelHealthTracker();
    eps.forEach(e => tracker.recordFailure(e.id, T0));
    expect(orderByHealth(eps, keyOf, tracker, T0).map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('冷却窗口过期后自动恢复原优先级', () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure('a', T0);
    expect(tracker.isCoolingDown('a', T0)).toBe(true);
    expect(tracker.isCoolingDown('a', T0 + MODEL_COOLDOWN_MS)).toBe(false);
    expect(orderByHealth(eps, keyOf, tracker, T0 + MODEL_COOLDOWN_MS).map(e => e.id))
      .toEqual(['a', 'b', 'c']);
  });
});

describe('ModelHealthTracker', () => {
  it('成功即清除降权，下一轮回到原优先级', () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure('a', T0);
    tracker.recordSuccess('a');
    expect(tracker.isCoolingDown('a', T0)).toBe(false);
    expect(orderByHealth(eps, keyOf, tracker, T0).map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('连续失败累加次数，空 key 不产生记录', () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure('a', T0);
    tracker.recordFailure('a', T0 + 1000);
    tracker.recordFailure('', T0);
    expect(tracker.getFailures('a')).toBe(2);
    expect(tracker.isCoolingDown('', T0)).toBe(false);
  });

  it('prune 清掉过期记录但不误删冷却中的记录', () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure('a', T0);
    tracker.recordFailure('b', T0 + MODEL_COOLDOWN_MS - 1);
    tracker.prune(T0 + MODEL_COOLDOWN_MS + 10);
    expect(tracker.getFailures('a')).toBe(0);
    expect(tracker.isCoolingDown('b', T0 + MODEL_COOLDOWN_MS + 10)).toBe(true);
  });

  it('clear 清空全部状态', () => {
    const tracker = new ModelHealthTracker();
    tracker.recordFailure('a', T0);
    tracker.clear();
    expect(tracker.getFailures('a')).toBe(0);
  });
});

describe('effectiveTimeout', () => {
  it('健康模型超时原样返回（成功路径零变化）', () => {
    expect(effectiveTimeout(120_000, false)).toBe(120_000);
    expect(effectiveTimeout(195_000, false)).toBe(195_000);
  });

  it('冷却中的模型截到探活上限', () => {
    expect(effectiveTimeout(120_000, true)).toBe(MODEL_PROBE_TIMEOUT_MS);
    expect(effectiveTimeout(195_000, true)).toBe(MODEL_PROBE_TIMEOUT_MS);
  });

  it('原本就比探活更短的超时不会被放大', () => {
    expect(effectiveTimeout(8_000, true)).toBe(8_000);
  });

  it('支持自定义探活窗口', () => {
    expect(effectiveTimeout(120_000, true, 3_000)).toBe(3_000);
  });
});

describe('故障转移接线反漂移', () => {
  const main = readSource('electron/ipc/ai.ipc.ts');

  it('两套故障转移执行器都接了降权排序与成功/失败记录', () => {
    // callWithFailover（ai:chat）与 runWithFailover（其余 AI 功能）各一处
    expect((main.match(/orderByHealth\(/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((main.match(/aiModelHealth\.recordSuccess\(/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((main.match(/aiModelHealth\.recordFailure\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('两套执行器的超时都走 effectiveTimeout，没有绕过降权', () => {
    expect(main).toContain('effectiveTimeout(AI_FETCH_TIMEOUT_MS, coolingDown)');
    expect(main).toContain('effectiveTimeout(timeoutMs || 30000, coolingDown)');
  });
});
