/**
 * AI 等待期报活（纯逻辑，不依赖 Electron / DOM，便于单测）。
 *
 * 一次性 AI 请求在主进程里就是一个 await，期间渲染进程收不到任何事件，
 * 进度条与文案完全静止，用户会以为请求卡死而重复点击。这里只上报「真实经过的
 * 秒数」，不推测模型生成了多少内容；百分比仅用于让进度条有可见变化，只增不退
 * 且封顶，避免出现「进度条走满却迟迟不出结果」那种更像卡死的假象。
 */

export interface AiProgressTick {
  stage: string;
  message: string;
  percent: number;
  /** 区分单条 / 批量：两者共用 ai:progress 通道，订阅方据此过滤，避免串台 */
  scope?: string;
}

export interface WaitHeartbeatOptions {
  /** 起始百分比 */
  from: number;
  /** 封顶百分比；到顶后仍继续上报真实等待秒数 */
  to: number;
  /** 文案前缀，如「AI正在分析关键证据点」 */
  label?: string;
  /** 事件作用域 */
  scope?: string;
  intervalMs?: number;
  /** 注入时钟，便于单测 */
  now?: () => number;
}

export function startWaitHeartbeat(
  send: (tick: AiProgressTick) => void,
  options: WaitHeartbeatOptions,
): () => void {
  const {
    from,
    to,
    label = 'AI正在分析中',
    scope,
    intervalMs = 1000,
    now = () => Date.now(),
  } = options;
  let current = from;
  const startedAt = now();
  const timer = setInterval(() => {
    if (current < to) current += 1;
    const waited = Math.max(0, Math.floor((now() - startedAt) / 1000));
    send({
      stage: 'receiving',
      message: `${label}，已等待 ${waited}s...`,
      percent: current,
      ...(scope ? { scope } : {}),
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
