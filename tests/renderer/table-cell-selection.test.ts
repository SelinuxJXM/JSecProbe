// @vitest-environment happy-dom
/**
 * 单元格选区「清空 / 批量设置符合性」的落库回归测试。
 *
 * 历史缺陷：这两个操作直接改写 tableRows 内存行对象，却从未标脏，
 * 还试图给只读的 hasUnsavedChanges（computed）赋值（无效）。
 * 结果 dirtyMap 始终为空 → runSave 判定无改动直接 return false，
 * 一次 IPC 都不发：界面显示「未保存」，手动点保存却又提示
 * 「没有需要保存的修改」，用户以为删了就没保存。
 *
 * 这里守住：只要内存值真的变化，就必须标脏并触发保存；值未变则不空跑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import {
  createTableCellSelection,
  type TableRow,
} from '../../src/views/onsite-verification/utils/table-cell-selection';

function setup(rows: TableRow[]) {
  const tableRows = ref<TableRow[]>(rows);
  const markDirty = vi.fn();
  const triggerSave = vi.fn();
  const selection = createTableCellSelection({
    tableRows,
    markDirty,
    triggerSave,
  });
  return { tableRows, markDirty, triggerSave, selection };
}

describe('clearSelectedCells：清空必须标脏并触发保存', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('清空的行全部标脏，并调用一次保存', () => {
    const { tableRows, markDirty, triggerSave, selection } = setup([
      { itemId: 'a', conclusion: '结论A', evidence: '证据A', compliance: '符合' },
      { itemId: 'b', conclusion: '结论B', evidence: '证据B', compliance: '不符合' },
    ]);

    selection.selectedCells.value.add('0:conclusion');
    selection.selectedCells.value.add('1:evidence');
    selection.clearSelectedCells();

    expect(tableRows.value[0].conclusion).toBe('');
    expect(tableRows.value[1].evidence).toBe('');
    // 两行都改了 → 两行都要标脏，否则未标脏的行切页即丢
    expect(markDirty).toHaveBeenCalledTimes(2);
    expect(markDirty).toHaveBeenNthCalledWith(1, tableRows.value[0]);
    expect(markDirty).toHaveBeenNthCalledWith(2, tableRows.value[1]);
    expect(triggerSave).toHaveBeenCalledTimes(1);
  });

  it('值本来就是空 → 不标脏、不空跑保存', () => {
    const { markDirty, triggerSave, selection } = setup([
      { itemId: 'a', conclusion: '', evidence: '', compliance: '符合' },
    ]);

    selection.selectedCells.value.add('0:conclusion');
    selection.selectedCells.value.add('0:evidence');
    selection.clearSelectedCells();

    expect(markDirty).not.toHaveBeenCalled();
    expect(triggerSave).not.toHaveBeenCalled();
  });

  it('无选中时不做任何事', () => {
    const { markDirty, triggerSave, selection } = setup([{ itemId: 'a', conclusion: 'x' }]);
    selection.clearSelectedCells();
    expect(markDirty).not.toHaveBeenCalled();
    expect(triggerSave).not.toHaveBeenCalled();
  });
});

describe('batchSetCompliance：批量设置必须逐行标脏并触发保存', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('每个被改动的行都标脏，并调用一次保存', () => {
    const { tableRows, markDirty, triggerSave, selection } = setup([
      { itemId: 'a', compliance: '不符合' },
      { itemId: 'b', compliance: '部分符合' },
      { itemId: 'c', compliance: '符合' },
    ]);

    selection.selectedCells.value.add('0:compliance');
    selection.selectedCells.value.add('1:compliance');
    selection.selectedCells.value.add('2:compliance');
    selection.batchSetCompliance('符合');

    expect(tableRows.value.map(r => r.compliance)).toEqual(['符合', '符合', '符合']);
    // 第 3 行本来就是「符合」，值未变 → 只标脏前两行
    expect(markDirty).toHaveBeenCalledTimes(2);
    expect(markDirty).toHaveBeenNthCalledWith(1, tableRows.value[0]);
    expect(markDirty).toHaveBeenNthCalledWith(2, tableRows.value[1]);
    expect(triggerSave).toHaveBeenCalledTimes(1);
  });

  it('未选中符合性单元格时不做任何事', () => {
    const { markDirty, triggerSave, selection } = setup([{ itemId: 'a', compliance: '不符合' }]);
    selection.selectedCells.value.add('0:conclusion');
    selection.batchSetCompliance('符合');
    expect(markDirty).not.toHaveBeenCalled();
    expect(triggerSave).not.toHaveBeenCalled();
  });
});
