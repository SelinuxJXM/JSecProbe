/**
 * AI 分析结果回填后的落库收口。
 *
 * 历史缺陷：单条 / 批量 AI 分析直接改 tableRows 里的行对象，然后调用
 * autoSave.saveAllRows()。但 saveAllRows 走的是「脏行快照」机制 ——
 * dirtyMap 为空时 runSave() 直接 return false，一次 IPC 都不会发。
 * 回填没有标脏，界面上看着填好了，切换测评对象 / 页面后整表从数据库重建，
 * 内容全部消失；批量分支还把 saveAllRows 的返回值丢掉，连失败提示都没有。
 *
 * 这里把「标脏 → 立即同步落库 → 竞态确认」收成一个不依赖组件实例的纯函数，
 * 且不启动防抖定时器：AI 回填是离散操作，用户很可能马上切页面。
 */
export interface SaveAppliedRowsDeps {
  /** 只标脏、不启动防抖定时器 */
  markDirty: (row: any) => void;
  /** 立即落库（现场核查的 autoSave.saveAllRows） */
  saveAllRows: () => Promise<boolean>;
  /** 落库往返结束后是否仍有未保存改动 */
  hasUnsavedChanges: () => boolean;
}

const RETRY_INTERVAL_MS = 80;
const MAX_RETRY_WAIT_MS = 640;

export async function saveAppliedRows(rows: any[], deps: SaveAppliedRowsDeps): Promise<boolean> {
  if (rows.length === 0) return true;

  for (const row of rows) deps.markDirty(row);
  const ok = await deps.saveAllRows();
  if (ok) return true;

  // runSave 撞上「正在保存」时会排队补跑并先返回 false；补跑是微任务 + IPC 往返，
  // 不能只看本次返回值。以「脏标记是否清空」为准，短暂等补跑结束。
  // 真正失败时脏标记保留，切页前的 flush 会拦住用户，不会静默丢数据。
  let waited = 0;
  while (deps.hasUnsavedChanges() && waited < MAX_RETRY_WAIT_MS) {
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
    waited += RETRY_INTERVAL_MS;
  }
  return !deps.hasUnsavedChanges();
}
