import { ElMessage } from 'element-plus';
import type { ExternalLinkItem, LinkOpenContext } from '../../shared/types';

/** 与主进程 applyLinkContext() 保持一致的前端替换（只用于复制与预览展示） */
export function resolveLinkUrl(rawUrl: string, context: LinkOpenContext = {}): string {
  return rawUrl.replace(/\{(projectName|assetIp|standardCode)\}/gi, (_match, name: string) => {
    const key = (['projectName', 'assetIp', 'standardCode'] as const)
      .find((k) => k.toLowerCase() === name.toLowerCase());
    const value = key ? context[key] : '';
    return value ? encodeURIComponent(String(value)) : '';
  });
}

/**
 * 打开外链的唯一前端入口。
 * 真正的校验与 shell.openExternal 在主进程 externalLink:open，这里只负责
 * 「结果提示」「上下文缺失提示」这些交互层的事。
 */
export async function openExternalLink(
  item: ExternalLinkItem,
  context: LinkOpenContext = {}
): Promise<boolean> {
  if (!window.api?.externalLink) {
    ElMessage.error('外链功能不可用，请重启应用');
    return false;
  }
  const res = await window.api.externalLink.open(item.id, context);
  if (!res.success) {
    ElMessage.error(res.error?.message || '打开链接失败');
    return false;
  }
  const missing = res.data?.missing || [];
  if (missing.length) {
    const labels: Record<string, string> = {
      projectName: '项目名称',
      assetIp: '资产 IP',
      standardCode: '标准编号',
    };
    ElMessage.warning(`未取到 ${missing.map((m) => labels[m] || m).join('、')}，链接中的变量已按空值打开`);
  }
  return true;
}

/** 复制到剪贴板：优先 Clipboard API，Electron file:// 下不可用时回退 execCommand */
export async function copyExternalLink(item: ExternalLinkItem, context: LinkOpenContext = {}): Promise<void> {
  const text = resolveLinkUrl(item.url, context);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('clipboard api unavailable');
    }
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    if (!ok) {
      ElMessage.error('复制失败，请在编辑框中手动复制');
      return;
    }
  }
  ElMessage.success('链接已复制');
}

export function sourceLabel(source: ExternalLinkItem['source']): string {
  return source === 'builtin' ? '内置' : '自定义';
}
