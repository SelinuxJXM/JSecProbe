/**
 * AI 资产识别结果的字段语义纠正，使其与系统构成表格列语义一致。
 *
 * 背景：表格里 sys_doc（系统管理文档）的 os 列显示名是"文档主要内容"，
 * description 列显示名是"备注"。旧提示词让 AI 把"主要内容"填进 description，
 * 结果内容跑到"备注"列、而"文档主要内容"列空着。提示词已改为让 AI 填 os，
 * 这里做导入前的兜底纠正，防止 AI 不遵守模板时仍然错位。
 *
 * 其它类别若后续发现同类错位，可在本函数按 category 扩展。
 */
export function normalizeIdentifiedAsset(a: any): any {
  const out = { ...a };
  if (out.category === 'sys_doc') {
    const os = String(out.os || '').trim();
    const desc = String(out.description || '').trim();
    // 主要内容错填进备注列：os 空而 description 有内容 → 搬到 os，备注清空
    if (!os && desc) {
      out.os = desc;
      out.description = '';
    }
  }
  return out;
}
