/**
 * 外链 URL 与内置项 id 的渲染层唯一来源。
 *
 * 登录页是未登录状态，不能调用强制会话的 externalLink:open，只能保留 <a target="_blank">；
 * 它走的 setWindowOpenHandler 已在主进程接入 normalizeExternalUrl()，与主流程同一套校验。
 * 其余页面一律通过 LINK_BUILTIN_IDS 走统一出口，不再各自拼 URL。
 */
export const GITHUB_REPO_URL = 'https://github.com/SelinuxJXM/JSecProbe';

export const LINK_BUILTIN_IDS = {
  whitepaper: 'builtin:whitepaper',
  repo: 'builtin:repo',
  ollamaDownload: 'builtin:ollama-download',
} as const;
