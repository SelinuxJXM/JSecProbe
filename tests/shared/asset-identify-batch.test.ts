import { describe, it, expect } from 'vitest';
import { planAssetIdentifyBatches } from '../../shared/asset-identify-batch';

describe('planAssetIdentifyBatches 资产识别分批规划', () => {
  it('纯图片 12 张 → 3 批(5/5/2)，文档区间全空', () => {
    const plans = planAssetIdentifyBatches(12, 0);
    expect(plans).toHaveLength(3);
    expect(plans.map(p => [p.imageStart, p.imageEnd])).toEqual([[0, 5], [5, 10], [10, 12]]);
    expect(plans.every(p => p.docStart === 0 && p.docEnd === 0)).toBe(true);
  });

  it('纯文档 10 份 → 5 批(每批2)，图片区间全空', () => {
    const plans = planAssetIdentifyBatches(0, 10);
    expect(plans).toHaveLength(5);
    expect(plans.map(p => [p.docStart, p.docEnd])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]]);
    expect(plans.every(p => p.imageStart === 0 && p.imageEnd === 0)).toBe(true);
  });

  it('混合 12 图 + 10 文档 → 批数取较大值 5，图片只有前 3 批有', () => {
    const plans = planAssetIdentifyBatches(12, 10);
    expect(plans).toHaveLength(5);
    expect(plans.map(p => p.imageEnd - p.imageStart)).toEqual([5, 5, 2, 0, 0]);
    expect(plans.map(p => p.docEnd - p.docStart)).toEqual([2, 2, 2, 2, 2]);
  });

  it('纯描述（无图无文档）→ 1 个空批，保证仍调用一次 AI', () => {
    const plans = planAssetIdentifyBatches(0, 0);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({ imageStart: 0, imageEnd: 0, docStart: 0, docEnd: 0 });
  });

  it('每批区间连续、不重叠、完整覆盖输入（混合 7 图 + 5 文档）', () => {
    const imgCount = 7, docCount = 5;
    const plans = planAssetIdentifyBatches(imgCount, docCount);
    // 图片区间连续覆盖 0..7
    let imgCursor = 0, docCursor = 0;
    for (const p of plans) {
      expect(p.imageStart).toBe(imgCursor);
      expect(p.docStart).toBe(docCursor);
      expect(p.imageEnd).toBeGreaterThanOrEqual(p.imageStart);
      expect(p.docEnd).toBeGreaterThanOrEqual(p.docStart);
      imgCursor = p.imageEnd;
      docCursor = p.docEnd;
    }
    expect(imgCursor).toBe(imgCount);
    expect(docCursor).toBe(docCount);
  });

  it('支持自定义批大小，且非负/非法尺寸安全降级', () => {
    const plans = planAssetIdentifyBatches(6, 9, 3, 3);
    expect(plans).toHaveLength(3);
    expect(plans.map(p => [p.imageStart, p.imageEnd])).toEqual([[0, 3], [3, 6], [6, 6]]);
    // 批大小传 0 或负数被夹紧为 1，不产生死循环
    const fallback = planAssetIdentifyBatches(2, 2, 0, -5);
    expect(fallback.length).toBe(2);
    expect(fallback[0].imageEnd - fallback[0].imageStart).toBe(1);
  });
});
