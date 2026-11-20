/**
 * 系统拓扑分区分域描述的文本序列化/反序列化（纯函数，便于单测与前后端一致）。
 *
 * 存储格式（人类可读、可直接编辑，报告/前端/DB 共用，保证"存的=看的=报告的=编辑的"）：
 *   [总述段：一段话概括，可选，段落内不含独占一行的"域名："标题]
 *
 *   安全边界区：
 *   正文第一行，可含"对接互联网方向：..."等行内冒号
 *   正文第二行
 *
 *   核心交换区：
 *   正文……
 *
 * 域标题的判定规则：独占一行、以中文/英文冒号结尾、长度<=40 且不含空白行内正文——
 * 用 `^([^：:\n]{1,40})[：:]\s*$` 匹配。正文中的行内冒号（如"对接互联网方向：xxx"）
 * 不会被当作域标题，因为冒号后还有内容。
 *
 * 兼容旧格式：旧版把域名和正文写在同一行（`域名：正文`）。parse 时若某段单行匹配
 * `^域名：正文$`，也识别为一个域，保证存量数据不丢。
 */
export interface TopologyDomain { name: string; description: string }

export interface TopologyDoc {
  /** 总述段（域标题之前的内容），可为空 */
  overview: string;
  domains: TopologyDomain[];
}

/** 域名长度上限：与解析正则 {1,40} 对齐 */
export const MAX_DOMAIN_NAME_LENGTH = 40;

/** 独占一行的域标题，如「安全边界区：」 */
const DOMAIN_TITLE_LINE = /^([^：:\n]{1,40})[：:]\s*$/;
/** 旧格式：域名与正文同行，如「安全边界区：该区域是...」 */
const DOMAIN_INLINE = /^([^：:\n]{1,40})[：:]\s*([\s\S]*)$/;

/**
 * 解析整段描述为 { overview, domains }。
 * - 以空行分段；每段若以独占一行的域标题开始，则为该域，其后所有行（含空行前的多行）为正文。
 * - 域标题之前的段落归入 overview（总述）。
 * - 无域标题的段落若出现在第一个域之后，则并入上一个域的正文（保持子项多行结构）。
 */
export function parseTopologyDoc(text: string | null | undefined): TopologyDoc {
  const raw = String(text || '').trim();
  if (!raw) return { overview: '', domains: [] };

  // 按空行切成块，但块内保留换行
  const blocks = raw.split(/\n\s*\n/).map(b => b.replace(/\s+$/g, '')).filter(Boolean);
  const doc: TopologyDoc = { overview: '', domains: [] };
  let seenDomain = false;

  for (const block of blocks) {
    const lines = block.split('\n');
    const firstLine = lines[0].trim();

    const titleMatch = DOMAIN_TITLE_LINE.exec(firstLine);
    if (titleMatch) {
      // 新格式：首行是独占的域标题，其后为正文
      const name = titleMatch[1].trim().slice(0, MAX_DOMAIN_NAME_LENGTH);
      const description = lines.slice(1).join('\n').trim();
      if (name && description) doc.domains.push({ name, description });
      seenDomain = true;
      continue;
    }

    // 旧格式兼容：整块只有单行且为「域名：正文」时识别为域。
    // 新格式子项（"对接互联网方向：xxx"）位于域标题之后的多行正文块内，不会走到这里。
    if (lines.length === 1) {
      const inline = DOMAIN_INLINE.exec(firstLine);
      if (inline) {
        const name = inline[1].trim().slice(0, MAX_DOMAIN_NAME_LENGTH);
        const description = inline[2].trim();
        if (name && description) {
          doc.domains.push({ name, description });
          seenDomain = true;
          continue;
        }
      }
    }

    if (!seenDomain) {
      // 第一个域标题之前 → 总述段（多段则用空行拼接）
      doc.overview = doc.overview ? `${doc.overview}\n\n${block}` : block;
    } else if (doc.domains.length > 0) {
      // 域之后的无标题段落 → 并入上一个域的正文（保留子项结构）
      const last = doc.domains[doc.domains.length - 1];
      last.description = `${last.description}\n\n${block}`;
    }
  }

  return doc;
}

/**
 * 兼容旧调用：只取域数组（忽略总述）。报告/前端展示若不需要总述可用此函数。
 */
export function parseTopologyDomainsText(text: string | null | undefined): TopologyDomain[] {
  return parseTopologyDoc(text).domains;
}

/**
 * 序列化为整段文本：总述段 + 空行 + 每个域「域名：\n正文」。
 * - 域名截断到 40 字（与解析正则一致），避免往返后被当成无标题段。
 * - 域标题独占一行，正文内的行内冒号原样保留（不影响解析）。
 * - 若域名本身含换行/冒号导致无法作为标题，回退为旧格式同行输出。
 */
export function serializeTopologyDoc(doc: TopologyDoc): string {
  const parts: string[] = [];
  const overview = String(doc?.overview || '').trim();
  if (overview) parts.push(overview);

  for (const d of doc?.domains || []) {
    if (!d) continue;
    const name = String(d.name || '').trim().replace(/[\r\n]/g, ' ').slice(0, MAX_DOMAIN_NAME_LENGTH);
    const description = String(d.description || '').trim();
    if (!name || !description) continue;
    // 域标题独占一行；正文保持原有换行（子项结构）
    parts.push(`${name}：\n${description}`);
  }
  return parts.join('\n\n');
}

/**
 * 兼容旧调用：仅序列化域数组（无总述）。
 */
export function serializeTopologyDomains(domains: TopologyDomain[]): string {
  return serializeTopologyDoc({ overview: '', domains: domains || [] });
}
