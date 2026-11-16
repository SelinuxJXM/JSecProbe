/**
 * 外链模块纯逻辑单测。
 *
 * 覆盖三条「坏了会静默出错」的链路：
 *  1. URL 校验：漏过非 http(s) / userinfo 就等于把 shell.openExternal 暴露成任意 scheme 入口；
 *  2. sites.txt 解析：分组错位或逗号切错，手动导入会静默丢链接；
 *  3. 三层合并：优先级错了会在升级内置清单时冲掉用户的排序与隐藏。
 */
import { describe, it, expect } from 'vitest';
import { normalizeExternalUrl } from '../../electron/utils/external-url';
import { BUILTIN_LINKS } from '../../electron/services/external-link.seed';
import {
  applyLinkContext,
  inferNetworkZone,
  mergeLinks,
  parseBookmarkHtml,
  parseImportJson,
  parseLinkId,
  parseSitesTxt,
  type LinkRow,
  type LinkSeed,
} from '../../electron/services/external-link-core';

function seed(partial: Partial<LinkSeed> & { key: string; url: string }): LinkSeed {
  return { title: '标题', groupName: '分组', ...partial };
}

function row(partial: Partial<LinkRow> & { id: string }): LinkRow {
  return {
    linkKey: null,
    title: '标题',
    url: 'https://example.com',
    groupName: '分组',
    description: '',
    iconText: null,
    networkZone: 'internet',
    isBuiltin: 0,
    isHidden: 0,
    isFavorite: 0,
    isStale: 0,
    sortOrder: 0,
    scope: 'global',
    ownerId: null,
    lastOpenedAt: null,
    ...partial,
  };
}

describe('normalizeExternalUrl：统一出口校验', () => {
  it('规范化合法地址', () => {
    expect(normalizeExternalUrl('https://std.samr.gov.cn')).toBe('https://std.samr.gov.cn/');
    expect(normalizeExternalUrl('  https://www.tc260.org.cn/  ')).toBe('https://www.tc260.org.cn/');
  });

  it('无协议时补 http://（内网系统大量是 http）', () => {
    expect(normalizeExternalUrl('192.168.10.24:8443')).toBe('http://192.168.10.24:8443/');
    expect(normalizeExternalUrl('bastion.intra')).toBe('http://bastion.intra/');
  });

  it('不拦内网 IP —— 与 ai-url.ts 的 SSRF 黑名单刻意解耦', () => {
    expect(() => normalizeExternalUrl('http://10.0.0.8/login')).not.toThrow();
    expect(() => normalizeExternalUrl('http://127.0.0.1:8080')).not.toThrow();
  });

  it('拒绝非 http(s) scheme', () => {
    for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/notepad.exe', 'data:text/html,x', 'ftp://example.com']) {
      expect(() => normalizeExternalUrl(bad)).toThrow();
    }
  });

  it('拒绝 userinfo 钓鱼写法与空值', () => {
    expect(() => normalizeExternalUrl('https://trusted.com@evil.com/')).toThrow(/用户名/);
    expect(() => normalizeExternalUrl('')).toThrow(/不能为空/);
  });

  it('拒绝空白、反斜杠与控制字符', () => {
    expect(() => normalizeExternalUrl('https://example.com/a b')).toThrow();
    expect(() => normalizeExternalUrl('https:\\evil.com')).toThrow();
    expect(() => normalizeExternalUrl('https://example.com/\u0001')).toThrow();
  });

});

describe('parseSitesTxt：导航站清单解析', () => {
  const sample = [
    '# 学习资料',
    '## 标准学习',
    '标准服务平台, https://std.samr.gov.cn, 可查询国标、行标、地标、团体标准，提供公告与文本查阅',
    '中国等保网, https://www.djbh.net, 等保政策与通知',
    '',
    '## 等保密评',
    '等保测评学习, https://www.modb.pro/u/480195, Windows/Linux 测评要点',
    '',
    '# 技术论坛',
    '黑海洋论坛,https://blog.upx8.com,网络安全技术交流社区',
    '# 不该同步的分类',
    '敏感条目, https://example.com/bad, 描述',
  ].join('\n');

  it('按一级/二级生成分组，并保留描述里的逗号', () => {
    const result = parseSitesTxt(sample);
    expect(result.sites).toHaveLength(5);
    expect(result.sites[0].groupName).toBe('学习资料 / 标准学习');
    expect(result.sites[0].description).toContain('团体标准');
    expect(result.sites[2].groupName).toBe('学习资料 / 等保密评');
    expect(result.sites[3].groupName).toBe('技术论坛');
    expect(result.availableGroups).toContain('不该同步的分类');
  });

  it('分类白名单只放行被勾选的分组（合规：不把无关条目灌进工具）', () => {
    const result = parseSitesTxt(sample, ['学习资料 / 标准学习', '技术论坛']);
    expect(result.sites).toHaveLength(3);
    expect(result.sites.every((s) => s.groupName !== '不该同步的分类')).toBe(true);
    // availableGroups 仍是全量，便于核对分类过滤结果
    expect(result.availableGroups).toContain('不该同步的分类');
  });

  it('key 稳定且重复同名不冲突', () => {
    const dup = 'A, https://example.com/1, x\nA, https://example.com/2, y\nA, https://example.com/3, z';
    const result = parseSitesTxt(dup);
    expect(new Set(result.sites.map((s) => s.key)).size).toBe(3);
    expect(result.sites[0].key).toBe(result.sites[0].key);
  });

  it('空内容与非链接行安全跳过', () => {
    expect(parseSitesTxt('').sites).toEqual([]);
    expect(parseSitesTxt('# 只有标题\n这是一行说明文字').sites).toEqual([]);
  });
});

describe('书签 HTML 与 JSON 导入', () => {
  it('解析 Netscape 书签的 H3 分组与 A 链接', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>测评相关</H3>
  <DL><p>
    <DT><A HREF="https://www.cnvd.org.cn/">CNVD &amp; 漏洞库</A>
  </DL><p>
</DL><p>`;
    const sites = parseBookmarkHtml(html);
    expect(sites).toHaveLength(1);
    expect(sites[0].groupName).toBe('测评相关');
    expect(sites[0].title).toBe('CNVD & 漏洞库');
    expect(sites[0].url).toBe('https://www.cnvd.org.cn/');
  });

  it('JSON 支持数组与 {links:[]} 两种结构', () => {
    const arr = parseImportJson('[{"title":"A","url":"https://a.com","groupName":"G"}]');
    expect(arr).toHaveLength(1);
    const obj = parseImportJson('{"links":[{"name":"B","url":"http://192.168.1.1"}]}');
    expect(obj[0].title).toBe('B');
    expect(obj[0].networkZone).toBe('intranet');
    expect(() => parseImportJson('{bad')).toThrow(/JSON 格式/);
    expect(() => parseImportJson('{}')).toThrow(/links/);
  });
});

describe('mergeLinks：只读层 + 用户层', () => {
  const builtin: LinkSeed[] = [
    seed({ key: 'std.samr', title: '标准平台', url: 'https://std.samr.gov.cn', sortOrder: 100 }),
    seed({ key: 'djbh', title: '等保网', url: 'https://www.djbh.net', sortOrder: 110 }),
  ];

  it('内置与自定义两类同时存在且来源正确', () => {
    const items = mergeLinks({
      builtin,
      rows: [row({ id: 'c1', title: '客户漏扫', url: 'http://192.168.1.9', groupName: '现场系统' })],
    });
    expect(items.map((i) => i.source).sort()).toEqual(['builtin', 'builtin', 'custom']);
    expect(items.find((i) => i.id === 'builtin:std.samr')).toBeTruthy();
  });

  it('用户覆盖优先于 seed，且升级时不会冲掉排序与隐藏', () => {
    const items = mergeLinks({
      builtin,
      rows: [row({
        id: 'ov1', linkKey: 'std.samr', isBuiltin: 1,
        title: '我改过的名字', url: 'https://std.samr.gov.cn/new',
        isHidden: 1, isFavorite: 1, sortOrder: -50, isStale: 1,
      })],
    });
    const item = items.find((i) => i.id === 'builtin:std.samr')!;
    expect(item.title).toBe('我改过的名字');
    expect(item.url).toBe('https://std.samr.gov.cn/new');
    expect(item.isHidden).toBe(true);
    expect(item.isFavorite).toBe(true);
    expect(item.isStale).toBe(true);
    expect(item.hasOverride).toBe(true);
    expect(items[0].id).toBe('builtin:std.samr'); // 收藏置顶
  });

  it('内置项从 seed 移除后，用户覆盖行与自定义行都不丢', () => {
    const items = mergeLinks({
      builtin: [builtin[0]],
      rows: [
        row({ id: 'ov1', linkKey: 'djbh', isBuiltin: 1, isHidden: 1 }),
        row({ id: 'c1', title: '自定义', url: 'https://custom.com' }),
      ],
    });
    expect(items.some((i) => i.id === 'builtin:djbh')).toBe(false);
    expect(items.find((i) => i.id === 'c1')).toBeTruthy();
  });

  it('parseLinkId 只识别内置项', () => {
    expect(parseLinkId('builtin:std.samr')).toEqual({ source: 'builtin', key: 'std.samr' });
    expect(parseLinkId('remote:nav:abc')).toBeNull();
    expect(parseLinkId('uuid-custom')).toBeNull();
  });
});

describe('上下文变量与内网标记', () => {
  it('变量值做 URL 编码，缺失变量记入 missing', () => {
    const full = applyLinkContext('https://host/q?p={projectName}&ip={assetIp}', {
      projectName: '某单位 三级', assetIp: '10.0.0.1',
    });
    expect(full.url).toContain(encodeURIComponent('某单位 三级'));
    expect(full.missing).toEqual([]);

    const partial = applyLinkContext('https://host/{standardCode}/x', {});
    expect(partial.url).toBe('https://host//x');
    expect(partial.missing).toEqual(['standardCode']);
  });

  it('内网地址打标但不拦截', () => {
    expect(inferNetworkZone('http://192.168.10.24:8443')).toBe('intranet');
    expect(inferNetworkZone('http://10.1.2.3')).toBe('intranet');
    expect(inferNetworkZone('https://bastion.intra')).toBe('intranet');
    expect(inferNetworkZone('https://std.samr.gov.cn')).toBe('internet');
  });
});

describe('内置外链清单', () => {
  it('key 唯一，且每条 URL 都能通过统一出口校验', () => {
    expect(BUILTIN_LINKS.length).toBeGreaterThan(0);
    expect(new Set(BUILTIN_LINKS.map((l) => l.key)).size).toBe(BUILTIN_LINKS.length);
    for (const link of BUILTIN_LINKS) {
      expect(() => normalizeExternalUrl(link.url)).not.toThrow();
    }
  });

  it('三个 JSec 配套工具都在「测评工具箱」分组', () => {
    const tools = BUILTIN_LINKS.filter((l) => l.groupName === '测评工具箱');
    expect(tools.map((l) => l.key).sort()).toEqual(['jsec-cmd', 'jsec-risk', 'jsec-topo']);
    expect(tools.map((l) => l.url)).toEqual([
      'https://www.soer.ccwu.cc/JSecRisk',
      'https://www.soer.ccwu.cc/JSecCmd',
      'https://www.soer.ccwu.cc/JSecTopo',
    ]);
  });
});
