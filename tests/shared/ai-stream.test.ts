/**
 * AI 流式响应的解析回归 + 接线反漂移门禁。
 *
 * 重点锁住「按 TCP 包到达」这个现实：一个 JSON 事件可能被切两半，也可能一个包里
 * 塞好几行 data:。解析错位会表现为「打字时漏字 / 冒出乱码 / 提前结束」，
 * 而且不会抛错，只能靠单测兜住。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseStreamPayload, SseDeltaParser } from '../../shared/ai-stream';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content }, index: 0 }] })}`;
}

describe('parseStreamPayload', () => {
  it('解析 OpenAI 兼容 SSE 增量', () => {
    expect(parseStreamPayload(delta('你好'))).toEqual({ type: 'delta', text: '你好' });
  });

  it('[DONE] 识别为结束，且不带 data 前缀也识别', () => {
    expect(parseStreamPayload('data: [DONE]')).toEqual({ type: 'done' });
    expect(parseStreamPayload('[DONE]')).toEqual({ type: 'done' });
  });

  it('忽略注释、心跳、event/id 行与半截 JSON', () => {
    for (const line of [
      '',
      ': ping',
      'event: message',
      'id: 42',
      'retry: 1000',
      'data: {"choices":[{"delta":{"content":"未闭合',
      'hello world',
    ]) {
      expect(parseStreamPayload(line), `line=[${line}]`).toBeNull();
    }
  });

  it('空 delta 不产生事件，避免前端无意义重渲染', () => {
    expect(parseStreamPayload(delta(''))).toBeNull();
  });

  it('模型在流中报错时给出可读的 error 事件', () => {
    expect(parseStreamPayload('data: {"error":{"message":"quota exceeded","type":"rate_limit"}}'))
      .toEqual({ type: 'error', message: 'quota exceeded' });
    expect(parseStreamPayload('data: {"error":"bad key"}'))
      .toEqual({ type: 'error', message: 'bad key' });
  });

  it('兼容 Ollama 原生 NDJSON 与 done 标记', () => {
    expect(parseStreamPayload('{"message":{"content":"本地模型"},"done":false}'))
      .toEqual({ type: 'delta', text: '本地模型' });
    expect(parseStreamPayload('{"message":{"content":""},"done":true}'))
      .toEqual({ type: 'done' });
  });

  it('兼容服务端忽略 stream:true 直接返回完整 JSON', () => {
    const full = 'data: {"choices":[{"message":{"content":"一次性完整回答"}}]}';
    expect(parseStreamPayload(full)).toEqual({ type: 'delta', text: '一次性完整回答' });
  });
});

describe('SseDeltaParser', () => {
  it('跨 chunk 拼接半个 JSON 事件', () => {
    const parser = new SseDeltaParser();
    const line = delta('跨包到达');
    const cut = Math.floor(line.length / 2);
    expect(parser.push(line.slice(0, cut))).toEqual([]);
    expect(parser.push(line.slice(cut) + '\n')).toEqual([{ type: 'delta', text: '跨包到达' }]);
  });

  it('一个 chunk 里多行按顺序产出，且 [DONE] 之后的事件不再处理', () => {
    const parser = new SseDeltaParser();
    const events = parser.push(`${delta('甲')}\n${delta('乙')}\ndata: [DONE]\n${delta('丙')}\n`);
    expect(events).toEqual([
      { type: 'delta', text: '甲' },
      { type: 'delta', text: '乙' },
      { type: 'done' },
    ]);
    expect(parser.isDone).toBe(true);
    expect(parser.push(delta('丁') + '\n')).toEqual([]);
  });

  it('flush 处理末尾没有换行的残余', () => {
    const parser = new SseDeltaParser();
    expect(parser.push(delta('尾部'))).toEqual([]);
    expect(parser.flush()).toEqual([{ type: 'delta', text: '尾部' }]);
    expect(parser.flush()).toEqual([]);
  });

  it('CRLF 与中文内容', () => {
    const parser = new SseDeltaParser();
    expect(parser.push(`${delta('第一条')}\r\n${delta('第二条')}\r\n`)).toEqual([
      { type: 'delta', text: '第一条' },
      { type: 'delta', text: '第二条' },
    ]);
  });

  it('error 事件会中断本次解析', () => {
    const parser = new SseDeltaParser();
    expect(parser.push(`${delta('部分')}\ndata: {"error":"断流"}\n`)).toEqual([
      { type: 'delta', text: '部分' },
      { type: 'error', message: '断流' },
    ]);
  });
});

describe('流式通道接线反漂移', () => {
  const main = readSource('electron/ipc/ai.ipc.ts');
  const preload = readSource('electron/preload/index.ts');
  const types = readSource('shared/types.ts');
  const page = readSource('src/views/ai-assistant/index.vue');

  it('主进程：注册流式通道、带 stream:true、URL 仍走统一入口', () => {
    expect(main).toContain("ipcMain.handle('ai:chatStream'");
    expect(main).toContain('stream: true');
    expect(main).toContain("event.sender.send('ai:chatChunk'");
    // 项目硬约定：任何 AI 请求地址都不得各自手拼
    expect(main).toContain('resolveLocalChatUrl(config, mode)');
    expect(main).toContain("ensureApiUrl(ep.apiBase, 'cloud')");
  });

  it('主进程：首块前失败可回退，且不会把半截回答拿去重试', () => {
    expect(main).toContain("code: 'AI_STREAM_FALLBACK'");
    expect(main).toContain('STREAM_FIRST_BYTE_TIMEOUT_MS');
    expect(main).toContain('生成中断，以上为已生成内容');
  });

  it('preload 与 ApiBridge 四处接线齐全', () => {
    expect(preload).toContain("chatStream: ipc<any>('ai:chatStream')");
    expect(preload).toContain("ipcRenderer.on('ai:chatChunk', handler)");
    expect(types).toContain('chatStream: (params:');
    expect(types).toContain('onChatChunk: (callback: (data: AiChatStreamChunk) => void) => () => void;');
  });

  it('前端：流式失败自动回退到原有一次性 chat', () => {
    expect(page).toContain('const streamOutcome = await runStreamChat(chatParams)');
    expect(page).toContain("if (streamOutcome !== 'fallback')");
    expect(page).toContain('await window.api.ai.chat(chatParams)');
    expect(page).toContain("res.error?.code === 'AI_STREAM_FALLBACK'");
  });
});
