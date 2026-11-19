/**
 * 资产识别分批规划（纯函数，便于单测）。
 *
 * 图片与文档各自按固定大小切批，再合并成统一的批次序列：
 * - 图片每批 IMAGE_BATCH_SIZE 张，文档每批 DOC_BATCH_SIZE 份
 * - 总批数取两者较大值，不足的一侧在后续批次为空切片
 * - 每批的 [start, end) 均为闭开区间，连续、不重叠、完整覆盖输入
 *
 * 这样无论上传纯图片、纯文档还是混合，都被纳入分批：
 * 每批输出短，不会因 AI max_tokens 截断；进度条也能逐批推进。
 */
export interface AssetIdentifyBatchPlan {
  /** 本批图片在预处理后图片数组中的起始索引（含） */
  imageStart: number;
  /** 本批图片的结束索引（不含） */
  imageEnd: number;
  /** 本批文档在文档数组中的起始索引（含） */
  docStart: number;
  /** 本批文档的结束索引（不含） */
  docEnd: number;
}

export function planAssetIdentifyBatches(
  imageCount: number,
  docCount: number,
  imageBatchSize = 5,
  docBatchSize = 2,
): AssetIdentifyBatchPlan[] {
  const iSize = Math.max(1, Math.floor(imageBatchSize));
  const dSize = Math.max(1, Math.floor(docBatchSize));
  const imageBatchCount = Math.ceil(Math.max(0, imageCount) / iSize);
  const docBatchCount = Math.ceil(Math.max(0, docCount) / dSize);
  // 无附件（纯描述）也要跑一批
  const total = Math.max(1, imageBatchCount, docBatchCount);

  const nImg = Math.max(0, imageCount);
  const nDoc = Math.max(0, docCount);
  const plans: AssetIdentifyBatchPlan[] = [];
  for (let i = 0; i < total; i++) {
    // start 与 end 都 clamp 到总数：当某一侧批次用完后，剩余批该侧区间为空
    // （start === end === 总数），保证区间连续、不出现 start > end 的倒置。
    plans.push({
      imageStart: Math.min(i * iSize, nImg),
      imageEnd: Math.min((i + 1) * iSize, nImg),
      docStart: Math.min(i * dSize, nDoc),
      docEnd: Math.min((i + 1) * dSize, nDoc),
    });
  }
  return plans;
}
