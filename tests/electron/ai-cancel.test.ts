/**
 * runWithFailover 取消语义测试
 *
 * 为什么值得测：为「AI 分析可取消」给 runWithFailover 新增了第 4 个参数 externalSignal。
 * 取消要同时满足两点才算正确：
 *  1. 请求仍在发送阶段（fetch 挂起未返回）时，外部 abort 能立刻中断，抛「用户已取消」，而不是干等超时；
 *  2. 云端故障转移循环遇到取消后立即停止，绝不继续尝试下一个端点。
 * 这两点都属于"取消路径"的静默失败区——不主动断言，回归是看不出错的。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 可被 vi.mock factory 捕获的运行时引用（factory 在 hoist 阶段执行，不能直接引用外层变量）
const state = vi.hoisted(() => ({
  aiFetchMock: vi.fn(),
  getDbMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() },
  app: { getPath: vi.fn(() => ''), isPackaged: true, getAppPath: vi.fn(() => '') },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  session: {},
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('sharp', () => ({ __esModule: true, default: vi.fn() }));

// aiFetch 发真实网络请求：mock 成"挂起直至 signal abort 才 reject"的 fetch，
// 这样请求永远停在发送阶段，正好可以在中途 cancel 来验证"立即中断"。
// 关键点：必须让它监听 signal（像真实 fetch 那样 abort → reject），
// 纯 `new Promise(() => {})` 会让 abort 无法穿透，cancel 语义验证不起来。
vi.mock('../../electron/services/ai-net.service', () => ({
  aiFetch: state.aiFetchMock,
  isValidProxyMode: vi.fn(() => true),
  parseProxyUrl: vi.fn(),
  syncAiProxyFromDb: vi.fn(),
}));

// ocr.service 顶层引入 tesseract.js（原生/wasm 加载，node 单测环境不必要且易碎），
// runWithFailover 不经过它，整模块 mock 掉即可。
vi.mock('../../electron/services/ocr.service', () => ({
  extractTextFromImage: vi.fn(),
  extractTextFromMultipleImages: vi.fn(),
  isOCREnabled: vi.fn(),
  getSharedWorker: vi.fn(),
  withOcrLock: vi.fn(),
}));

// resolveCloudEndpoints 的云端端点列表来自 getDb；cloud 分支的用例需要控制它返回 ≥1 个端点。
vi.mock('../../electron/db', () => ({
  getDb: state.getDbMock,
}));

import { runWithFailover } from '../../electron/ipc/ai.ipc';

/** 最近一次传给 aiFetch 的 options（含 signal），供断言 abort 是否穿透到请求 */
let opts: { signal?: AbortSignal } | undefined;

const buildEndpoint = (ep: { model: string; apiBase: string }) => ({
  body: JSON.stringify({ model: ep.model, messages: [] }),
  timeoutMs: 30000,
});

/** 造一条 getDb 返回的 aiCloudModels 记录（apiKey 用明文，decryptSecret 对无前缀值原样返回） */
function cloudRow(id: string, priority: number) {
  return {
    id,
    configId: 'default',
    name: `模型${id}`,
    model: id,
    apiBase: 'https://api.example.com',
    apiKey: `key-${id}`,
    enabled: 1,
    priority,
  };
}

beforeEach(() => {
  // restoreMocks:true 会在每个用例前清空上个用例留下的实现/调用记录，这里统一重建
  state.aiFetchMock.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
    opts = options;
    return new Promise<void>((_resolve, reject) => {
      const onAbort = () => reject((options?.signal?.reason as Error) ?? new Error('用户已取消'));
      if (options?.signal?.aborted) onAbort();
      else options?.signal?.addEventListener('abort', onAbort, { once: true });
    });
  });
  state.getDbMock.mockReset();
  opts = undefined;
});

describe('runWithFailover 取消语义', () => {
  it('local 模式：请求进行中外部 cancel → 立即中断，抛「用户已取消」', async () => {
    const config = { mode: 'local', ollamaUrl: 'http://api.example.com:11434', ollamaModel: 'qwen2.5' };
    const ctr = new AbortController();

    const p = runWithFailover(config, 'local', { build: buildEndpoint }, ctr.signal);

    // 确保已进入发送阶段（aiFetch 已被调用、且正处于挂起）
    await new Promise((r) => setTimeout(r, 10));
    expect(state.aiFetchMock).toHaveBeenCalledTimes(1);
    expect(opts?.signal?.aborted).toBe(false);

    ctr.abort();

    await expect(p).rejects.toThrow('用户已取消');
    // 单端点本地模式，无故障转移
    expect(state.aiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('cloud 模式：取消后立即停止，不再故障转移到下一个端点', async () => {
    state.getDbMock.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              all: async () => [cloudRow('m1', 1), cloudRow('m2', 2)],
            }),
          }),
        }),
      }),
    });

    const ctr = new AbortController();
    const p = runWithFailover({ mode: 'cloud' }, 'cloud', { build: buildEndpoint }, ctr.signal);

    // 已进入第一个端点（m1）的发送阶段
    await new Promise((r) => setTimeout(r, 10));
    expect(state.aiFetchMock).toHaveBeenCalledTimes(1);

    ctr.abort();

    await expect(p).rejects.toThrow('用户已取消');
    // 取消后只尝试过 m1，绝未继续尝试 m2
    expect(state.aiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('cloud 模式：进入循环前已取消 → 直接抛「用户已取消」，一个请求都不发', async () => {
    state.getDbMock.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              all: async () => [cloudRow('m1', 1)],
            }),
          }),
        }),
      }),
    });

    const ctr = new AbortController();
    ctr.abort(); // 进入循环前已取消

    await expect(
      runWithFailover({ mode: 'cloud' }, 'cloud', { build: buildEndpoint }, ctr.signal),
    ).rejects.toThrow('用户已取消');
    expect(state.aiFetchMock).not.toHaveBeenCalled();
  });

  it('未取消时正常返回：local 模式请求成功路径不受影响', async () => {
    // 正常路径：aiFetch 返回一个成功的 Response
    state.aiFetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '正常回复' } }] }),
    } as any));

    const config = { mode: 'local', ollamaUrl: 'http://api.example.com:11434', ollamaModel: 'qwen2.5' };
    const result = await runWithFailover(config, 'local', { build: buildEndpoint });
    expect(result).toEqual({ content: '正常回复', modelName: 'qwen2.5' });
  });
});