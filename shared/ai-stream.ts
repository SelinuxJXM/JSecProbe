/**
 * AI 流式响应的分块解析（纯函数，不依赖 Electron / DOM，便于单测）。
 *
 * 为什么要单独成模块：SSE 数据是按 TCP 包到达的，一个 JSON 事件可能被切成两半，
 * 也可能一个包里塞了好几条 `data:` 行。解析逻辑必须能跨 chunk 拼行，且要同时兼容
 * OpenAI 兼容 SSE、Ollama 原生 NDJSON，以及「服务端忽略 stream:true 直接返回完整 JSON」。
 * 把它放在 shared 下，主进程只负责读字节，边界情况由单测锁住。
 */

export type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * 解析单行文本。返回 null 表示「不是有效事件」——注释行、心跳、`event:`/`id:` 行、
 * 半截 JSON 都走这里，调用方忽略即可，不要当成致命错误。
 */
export function parseStreamPayload(raw: string): AiStreamEvent | null {
  let payload = (raw || '').trim();
  if (!payload) return null;

  if (payload.startsWith('data:')) payload = payload.slice(5).trim();
  // 标准 SSE 是 `data: [DONE]`，个别中转站会漏掉前缀，这里一并兼容
  if (payload === '[DONE]') return { type: 'done' };
  if (!payload.startsWith('{')) {
    // SSE 注释 / event: / id: / retry: / `: ping` 心跳
    return null;
  }

  let json: any;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }

  if (json.error) {
    const message = typeof json.error === 'string'
      ? json.error
      : (json.error?.message || '模型返回流式错误');
    return { type: 'error', message: String(message) };
  }

  // OpenAI /chat/completions 流式：choices[0].delta.content
  const delta = json.choices?.[0]?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    return { type: 'delta', text: delta };
  }

  // Ollama 原生 /api/chat NDJSON：{"message":{"content":"..."},"done":false}
  const native = json.message?.content;
  if (typeof native === 'string' && native.length > 0 && json.done !== true) {
    return { type: 'delta', text: native };
  }
  if (json.done === true) return { type: 'done' };

  // 部分中转站忽略 stream:true，仍返回一次性完整响应。当成「一整块 delta」处理，
  // 至少能让用户看到内容，而不是误判成流式不支持而重复发起一次请求。
  const full = json.choices?.[0]?.message?.content;
  if (typeof full === 'string' && full.length > 0) {
    return { type: 'delta', text: full };
  }

  return null;
}

/** 增量式 SSE 解析器：push() 可跨任意字节边界，flush() 处理末尾没有换行的残余。 */
export class SseDeltaParser {
  private buffer = '';
  private finished = false;

  push(chunk: string): AiStreamEvent[] {
    if (this.finished || !chunk) return [];
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    // 最后一段可能只有半个 JSON，留给下一个 chunk
    this.buffer = lines.pop() ?? '';

    const events: AiStreamEvent[] = [];
    for (const line of lines) {
      const event = parseStreamPayload(line);
      if (!event) continue;
      events.push(event);
      if (event.type === 'done') {
        this.finished = true;
        this.buffer = '';
        break;
      }
    }
    return events;
  }

  flush(): AiStreamEvent[] {
    if (this.finished) return [];
    const tail = this.buffer;
    this.buffer = '';
    if (!tail.trim()) return [];
    const event = parseStreamPayload(tail);
    return event ? [event] : [];
  }

  get isDone(): boolean {
    return this.finished;
  }
}
