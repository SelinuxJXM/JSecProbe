/**
 * Markdown → 安全 HTML 的统一实现。
 *
 * 背景：此前三处各写各的——ai-assistant 与 file-preview-dialog 用 marked，
 * knowledge-base 用一串正则手写（不支持表格/引用/多级列表，且会把 `<ul>` 整个套进 `<p>`，
 * 属于无效 HTML）。同一份文档在两个页面渲染结果不一致。
 *
 * 这里统一：marked 负责解析，DOMPurify 负责净化。
 * **顺序不能反**——AI 生成内容与知识库文档都可能夹带 `<script>`/`onerror=`，
 * 先 sanitize 再 parse 等于没有防护。
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 选项放这里而不是各调用方：marked 的配置是**全局单例**的，
// 由某个页面随手写 setOptions 会让本工具函数的输出取决于模块加载顺序
// （原先 ai-assistant 里 setOptions 后，其它页面的渲染规则也跟着变了）。
marked.setOptions({
  breaks: true, // 单换行即 <br>，中文文档里这是默认预期
  gfm: true,    // 支持表格、删除线等 GFM 扩展
});

export function renderMarkdown(content: string): string {
  if (!content) return '';
  const html = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
