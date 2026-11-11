// @vitest-environment happy-dom
/**
 * AI 分析结果回填的落库回归测试。
 *
 * 历史缺陷：单条 / 批量 AI 分析直接改 tableRows 里的行对象，界面看着填好了，
 * 但保存入口走的是「脏行快照」机制 —— 没标脏就一次 IPC 都不会发。
 * 切换测评对象后整表从数据库重建，回填内容全部消失；批量分支还把保存返回值
 * 丢掉，用户连「保存失败」都看不到。单条分支虽有直接 saveRecord 兜底，却漏了
 * 后端必填的 projectId，兜底同样从未生效。
 *
 * 这里守住三件事：① 纯函数必须标脏 + 立即落库；② 两条 AI 路径都必须把改动行
 * 交给保存入口；③ 保存失败时必须明确报错，且不再绕过统一保存直接写库。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed } from 'vue';

const { ElMessage } = vi.hoisted(() => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('element-plus', () => ({ ElMessage }));

import { saveAppliedRows } from '../../src/views/onsite-verification/utils/ai-result-save';
import { useAiAnalysis } from '../../src/views/onsite-verification/composables/useAiAnalysis';

describe('saveAppliedRows：回填后必须标脏并立即落库', () => {
  it('改动行全部标脏，并同步调用一次 saveAllRows（不等防抖）', async () => {
    const rows = [{ itemId: 'i1' }, { itemId: 'i2' }];
    const markDirty = vi.fn();
    const saveAllRows = vi.fn(async () => true);
    const hasUnsavedChanges = vi.fn(() => false);

    const ok = await saveAppliedRows(rows, { markDirty, saveAllRows, hasUnsavedChanges });

    expect(ok).toBe(true);
    expect(markDirty).toHaveBeenCalledTimes(2);
    expect(markDirty).toHaveBeenNthCalledWith(1, rows[0]);
    expect(markDirty).toHaveBeenNthCalledWith(2, rows[1]);
    expect(saveAllRows).toHaveBeenCalledTimes(1);
  });

  it('没有改动行时不标脏、不落库', async () => {
    const markDirty = vi.fn();
    const saveAllRows = vi.fn(async () => true);

    const ok = await saveAppliedRows([], {
      markDirty,
      saveAllRows,
      hasUnsavedChanges: () => false,
    });

    expect(ok).toBe(true);
    expect(markDirty).not.toHaveBeenCalled();
    expect(saveAllRows).not.toHaveBeenCalled();
  });

  it('saveAllRows 返回 false 但脏标记已清空（并发补跑抢先完成）视为成功', async () => {
    const ok = await saveAppliedRows([{ itemId: 'i1' }], {
      markDirty: vi.fn(),
      saveAllRows: async () => false,
      hasUnsavedChanges: () => false,
    });
    expect(ok).toBe(true);
  });

  it('保存失败且脏标记一直保留时返回 false（脏数据留给切页 flush 兜底）', async () => {
    const ok = await saveAppliedRows([{ itemId: 'i1' }], {
      markDirty: vi.fn(),
      saveAllRows: async () => false,
      hasUnsavedChanges: () => true,
    });
    expect(ok).toBe(false);
  });
});

describe('useAiAnalysis：回填必须把改动行交给保存入口', () => {
  let apiMock: any;
  let batchAnalyze: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    batchAnalyze = vi.fn(async () => ({
      success: true,
      data: {
        content: JSON.stringify({
          results: [
            { itemId: 'i1', compliance: '不符合', conclusion: '结论A' },
            // 没有对应行的结果不应计入改动，也不能被拿去标脏
            { itemId: 'missing', compliance: '符合', conclusion: '无人认领' },
          ],
        }),
      },
    }));
    (window as any).api = {
      ai: {
        onAnalysisProgress: vi.fn(() => () => {}),
        getConfig: vi.fn(async () => ({ success: true, data: {} })),
        batchAnalyzeScreenshots: batchAnalyze,
        cancelBatchScreenshots: vi.fn(async () => {}),
        cancelSingleAnalysis: vi.fn(async () => {}),
      },
      document: { extractText: vi.fn(async () => ({ success: true, data: [] })) },
      screenshot: { readText: vi.fn(async () => ({ success: true, data: { content: '' } })) },
      // 旧兜底会直接调它，缺 projectId 必被后端拒；修复后两条路径都不应再碰
      assessment: { saveRecord: vi.fn(async () => ({ success: false })) },
    };
    apiMock = (window as any).api;
  });

  afterEach(() => {
    (window as any).api = undefined;
  });

  function setup(rows: any[], saveAllRows: (rows?: any[]) => Promise<boolean>) {
    return useAiAnalysis({
      tableRows: computed(() => rows) as any,
      saveAllRows,
      loadScreenshotDataUrl: vi.fn(async () => null),
    });
  }

  it('批量分析：只把真正改动的行传给 saveAllRows，并在提示中确认已保存', async () => {
    const rows = [
      { itemId: 'i1', compliance: '', conclusion: '' },
      { itemId: 'i2', compliance: 'na', conclusion: '' },
    ];
    const saveAllRows = vi.fn(async (_rows?: any[]) => true);
    const ai = setup(rows, saveAllRows);
    ai.batchFiles.value.push({ id: 'f1', path: 'C:/x.png', name: 'x.png', fileType: 'image' });

    await ai.executeBatchAiAnalyze();

    expect(batchAnalyze).toHaveBeenCalledTimes(1);
    expect(rows[0].compliance).toBe('nonconform');
    expect(rows[0].conclusion).toBe('结论A');
    expect(saveAllRows).toHaveBeenCalledTimes(1);
    expect(saveAllRows.mock.calls[0][0]).toEqual([rows[0]]);
    expect(ElMessage.success).toHaveBeenCalledWith(expect.stringContaining('已自动填入并保存 1 条'));
    expect(apiMock.assessment.saveRecord).not.toHaveBeenCalled();
  });

  it('批量分析保存失败：明确报错，不再静默假装成功', async () => {
    const rows = [{ itemId: 'i1', compliance: '', conclusion: '' }];
    const saveAllRows = vi.fn(async (_rows?: any[]) => false);
    const ai = setup(rows, saveAllRows);
    ai.batchFiles.value.push({ id: 'f1', path: 'C:/x.png', name: 'x.png', fileType: 'image' });

    await ai.executeBatchAiAnalyze();

    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('保存失败'));
    expect(ElMessage.success).not.toHaveBeenCalled();
    expect(ai.batchAiProgress.value.message).toBe('填入完成但保存失败');
  });

  it('单条应用结果：传入改动行，不再走字段不全的直接 saveRecord 兜底', async () => {
    const rows = [{ itemId: 'i1', compliance: '', conclusion: '', evidence: '' }];
    const saveAllRows = vi.fn(async (_rows?: any[]) => true);
    const ai = setup(rows, saveAllRows);
    ai.aiCurrentRow.value = rows[0];
    ai.aiAnalysisResult.value = {
      compliance: '符合',
      conclusion: '结论B',
      keyEvidencePoints: [],
    };

    await ai.applyAiResult();

    expect(rows[0].conclusion).toBe('结论B');
    expect(saveAllRows).toHaveBeenCalledWith([rows[0]]);
    expect(apiMock.assessment.saveRecord).not.toHaveBeenCalled();
    expect(ElMessage.success).toHaveBeenCalledWith('AI分析结果已填入记录表并保存');
  });
});
