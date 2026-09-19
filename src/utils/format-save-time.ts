/**
 * 「最近保存时间」的展示格式化（P3-1）。
 *
 * 此前 `useAutoSave` / `useProjectAutoSave` / `useAssetAutoSave` 三个 composable 里
 * 各有一份**逐字相同**的实现。自动保存的展示口径必须一致，否则同一个界面里
 * 不同区块会出现"刚刚 / 12秒前 / 10:35"三种风格；改文案时要改三处也必然漏。
 * 这里抽为单一实现，三个 composable 直接引用。
 */
export function formatSaveTime(date: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
