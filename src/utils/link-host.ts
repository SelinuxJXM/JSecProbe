/**
 * 从外链 URL 里取出「域名:端口」，用于卡片副标题（对齐官方导航站的卡片字段）。
 *
 * 刻意不依赖 element-plus / DOM，方便在 node 环境下单测。
 * URL 里可能带 {assetIp} 这类上下文变量导致 new URL() 解析失败，故保留字符串兜底：
 * 现场测评常把客户内网地址写成模板，不能因为展示逻辑就报错。
 */
export function linkHost(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  // 含上下文变量时不要交给 URL 解析：它会把主机名小写化，
  // `{assetIp}` 会显示成 `{assetip}`，看起来像变量被改坏了。
  if (!raw.includes('{')) {
    try {
      return new URL(raw).host;
    } catch {
      // 落到下面的字符串兜底
    }
  }
  const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return withoutScheme.split(/[/?#]/)[0] || raw;
}
