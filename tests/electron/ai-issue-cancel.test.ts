/**
 * ai:cancelIssue / 单条整改建议分析取消语义测试
 *
 * 为什么值得测：为「单条整改建议」分析 `ai:analyzeIssue` 接上了模块级 AbortController，
 * 并新增 `ai:cancelIssue` 取消通道。要验证两点：
 *  1. 无正在运行的分析时，cancelIssue 返回 canceled:false，不误报；
 *  2. 分析请求仍在发送阶段时，cancelIssue 能立即 abort 底层云端请求（aiFetch 收到 aborted），
 *     返回 canceled:true，且 ai:analyzeIssue 随之以"取消被静默吞掉"的失败态落回（前端据此不弹错误）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

// vi.mock factory 阶段可捕获的运行时引用
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

vi.mock('../../electron/services/ai-net.service', () => ({
  aiFetch: state.aiFetchMock,
  isValidProxyMode: vi.fn(() => true),
  parseProxyUrl: vi.fn(),
  syncAiProxyFromDb: vi.fn(),
}));

vi.mock('../../electron/services/ocr.service', () => ({
  extractTextFromImage: vi.fn(),
  extractTextFromMultipleImages: vi.fn(),
  isOCREnabled: vi.fn(),
  getSharedWorker: vi.fn(),
  withOcrLock: vi.fn(),
}));

// registerAIHandlers 在注册期不触库；仅在 handler 执行时调 getDb。
vi.mock('../../electron/db', () => ({ getDb: state.getDbMock }));

// 鉴权守卫：测试里直接放行，聚焦取消语义本身（来源/会话校验已在别处覆盖）。
vi.mock('../../electron/utils/auth-guard', () => ({
  requireAuth: vi.fn(),
  requireSession: vi.fn(),
  requirePasswordChanged: vi.fn(),
  requireRole: vi.fn(),
}));

// prompt 服务：屏蔽真实模板库，返回占位模板。
vi.mock('../../electron/services/ai-prompt.service', () => ({
  getPromptTemplate: vi.fn(async () => 'RECTIFY_TEMPLATE'),
  renderTemplate: vi.fn(() => 'rendered-system-prompt'),
  isValidPromptKey: vi.fn(() => true),
  validateTemplate: vi.fn(() => true),
  MAX_PROMPT_LENGTH: 4000,
  BUILTIN_PROMPTS: [],
}));

// 操作日志：取消路径不会走到，但注册即可避免缺失。
vi.mock('../../electron/utils/operation-log', () => ({
  writeOperationLog: vi.fn(),
}));

import { registerAIHandlers } from '../../electron/ipc/ai.ipc';

/** 捕获 ipcMain.handle 注册的 (channel, handler) 映射 */
function captureHandlers(): Record<string, (event: any, ...args: any[]) => Promise<any>> {
  const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>;
  const map: Record<string, (event: any, ...args: any[]) => Promise<any>> = {};
  for (const [channel, handler] of handleMock.mock.calls) {
    map[channel as string] = handler;
  }
  return map;
}

/** aiConfigs 表返回本地模式的配置（避开云端 resolveCloudEndpoints） */
function localConfigDb() {
  state.getDbMock.mockReturnValue({
    select: () => ({
      from: () => ({
        limit: async () => [
          { mode: 'local', ollamaUrl: 'http://api.example.com:11434', ollamaModel: 'qwen2.5', apiKey: '', temperature: 0.3 },
        ],
      }),
    }),
  });
}

describe('ai:cancelIssue 单条整改建议取消语义', () => {
  let handlers: ReturnType<typeof captureHandlers>;

  beforeEach(() => {
    (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mockClear();
    // aiFetch 挂起直至 signal abort 才 reject，便于中途 cancel 验证"立即中断"
    state.aiFetchMock.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
      return new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject((options?.signal?.reason as Error) ?? new Error('用户已取消'));
        if (options?.signal?.aborted) onAbort();
        else options?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    registerAIHandlers();
    handlers = captureHandlers();
  });

  const fakeEvent = { senderFrame: { url: 'http://localhost:5173' } };

  it('无正在运行的分析时，cancelIssue 返回 canceled:false', async () => {
    const res = await handlers['ai:cancelIssue'](fakeEvent);
    expect(res).toEqual({ success: true, data: { canceled: false } });
  });

  it('分析请求发送中 cancelIssue → 立即中断底层请求并返回 canceled:true', async () => {
    localConfigDb();
    const params = { issueId: 'i1', issueTitle: 'T', issueDescription: 'D', securityDomain: 'SD', controlPoint: 'CP', controlName: 'CN' };

    const p = handlers['ai:analyzeIssue'](fakeEvent, params);

    // 确保已进入 aiFetch 发送阶段（请求挂起、未取消）
    await vi.waitFor(() => {
      expect(state.aiFetchMock).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });

    const cancelRes = await handlers['ai:cancelIssue'](fakeEvent);
    expect(cancelRes).toEqual({ success: true, data: { canceled: true } });

    // 底层请求被 abort → analyzeIssue 静默失败（前端据此不弹"分析失败"）
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AI_ANALYZE_ISSUE_ERROR');
    expect(result.error?.message).toBe('用户已取消');
    expect(state.aiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('取消后 controller 已复位：再次 cancelIssue 返回 canceled:false', async () => {
    localConfigDb();
    const params = { issueId: 'i1', issueTitle: 'T', issueDescription: 'D', securityDomain: 'SD', controlPoint: 'CP', controlName: 'CN' };

    const p = handlers['ai:analyzeIssue'](fakeEvent, params);
    await vi.waitFor(() => {
      expect(state.aiFetchMock).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
    await handlers['ai:cancelIssue'](fakeEvent);
    await p; // 让 finally 完成复位
    await new Promise((r) => setTimeout(r, 5));

    const res = await handlers['ai:cancelIssue'](fakeEvent);
    expect(res).toEqual({ success: true, data: { canceled: false } });
  });
});