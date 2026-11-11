/**
 * AI 等待期报活的回归 + 接线反漂移门禁。
 *
 * 这里锁住的不是「模型生成了多少」，而是「等待期间界面必须一直有真实变化」：
 * 秒数必须来自真实时钟、百分比只增不退且封顶、stop 之后不能再上报。
 * 抽成公共模块后，批量与单条共用同一套口径，避免一边改了另一边退化成假进度。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startWaitHeartbeat, type AiProgressTick } from '../../shared/ai-wait-progress';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('startWaitHeartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('每秒上报真实等待秒数，百分比只增不退且封顶', () => {
    vi.useFakeTimers();
    let clock = 0;
    const ticks: AiProgressTick[] = [];
    const stop = startWaitHeartbeat(t => ticks.push(t), {
      from: 34,
      to: 37,
      label: 'AI正在分析关键证据点',
      scope: 'single',
      now: () => clock,
    });

    for (let i = 1; i <= 4; i++) {
      clock = i * 1000;
      vi.advanceTimersByTime(1000);
    }
    stop();

    expect(ticks).toHaveLength(4);
    expect(ticks.map(t => t.percent)).toEqual([35, 36, 37, 37]);
    expect(ticks.map(t => t.message)).toEqual([
      'AI正在分析关键证据点，已等待 1s...',
      'AI正在分析关键证据点，已等待 2s...',
      'AI正在分析关键证据点，已等待 3s...',
      'AI正在分析关键证据点，已等待 4s...',
    ]);
    expect(ticks.every(t => t.stage === 'receiving' && t.scope === 'single')).toBe(true);
  });

  it('到顶后仍持续报活，stop 之后彻底停止', () => {
    vi.useFakeTimers();
    let clock = 0;
    const ticks: AiProgressTick[] = [];
    const stop = startWaitHeartbeat(t => ticks.push(t), {
      from: 60,
      to: 61,
      now: () => clock,
    });

    for (let i = 1; i <= 5; i++) {
      clock = i * 1000;
      vi.advanceTimersByTime(1000);
    }
    stop();

    expect(ticks).toHaveLength(5);
    expect(ticks.map(t => t.percent)).toEqual([61, 61, 61, 61, 61]);
    expect(ticks[0].message).toContain('AI正在分析中');
    expect(ticks[4].message).toContain('已等待 5s');

    clock = 6000;
    vi.advanceTimersByTime(1000);
    expect(ticks).toHaveLength(5);
  });

  it('不传 scope 时不带该字段，批量分析保持原有事件口径', () => {
    vi.useFakeTimers();
    let clock = 0;
    const ticks: AiProgressTick[] = [];
    const stop = startWaitHeartbeat(t => ticks.push(t), { from: 61, to: 90, now: () => clock });
    clock = 1000;
    vi.advanceTimersByTime(1000);
    stop();

    expect(ticks).toHaveLength(1);
    expect(ticks[0].scope).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(ticks[0], 'scope')).toBe(false);
  });

  it('stop 可重复调用，且时钟回拨时秒数不会变成负数', () => {
    vi.useFakeTimers();
    let clock = 5000;
    const ticks: AiProgressTick[] = [];
    const stop = startWaitHeartbeat(t => ticks.push(t), { from: 0, to: 100, now: () => clock });
    clock = 4000;
    vi.advanceTimersByTime(1000);
    stop();
    stop();

    expect(ticks).toHaveLength(1);
    expect(ticks[0].message).toContain('已等待 0s');
  });
});

describe('等待报活接线反漂移', () => {
  it('主进程批量与单条都走公共心跳，单条带 scope 且不污染轮询单例', () => {
    const source = readSource('electron/ipc/ai.ipc.ts');
    expect(source).toContain("scope: 'single'");
    expect(source.match(/startWaitHeartbeat\(/g)).toHaveLength(2);
    expect(source).toContain("event.sender.send('ai:progress', data)");
  });

  it('渲染层按 scope 过滤并统一退订，避免与批量弹窗串台', () => {
    expect(readSource('src/views/onsite-verification/index.vue')).toContain("data?.scope === 'single'");
    const composable = readSource('src/views/onsite-verification/composables/useAiAnalysis.ts');
    expect(composable).toContain("data?.scope !== 'single'");
    expect(composable).toContain('unsubscribeWait?.()');
    // 批量弹窗的订阅也必须过滤 single，否则并发时会被单条心跳覆盖
    expect(composable).toContain("(data as any)?.scope === 'single'");
  });
});
