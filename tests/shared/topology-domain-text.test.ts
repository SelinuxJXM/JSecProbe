import { describe, it, expect } from 'vitest';
import {
  serializeTopologyDomains,
  parseTopologyDomainsText,
  serializeTopologyDoc,
  parseTopologyDoc,
  MAX_DOMAIN_NAME_LENGTH,
} from '../../shared/topology-domain-text';

describe('拓扑分区分域描述文本序列化/反序列化', () => {
  it('多段序列化后能无损反序列化（往返一致）', () => {
    const domains = [
      { name: '安全接入区', description: '位于网络边界，部署防火墙与接入交换机。' },
      { name: '生产控制区', description: '包含数据库服务器与应用服务器。' },
    ];
    const text = serializeTopologyDomains(domains);
    expect(text).toContain('安全接入区：');
    expect(parseTopologyDomainsText(text)).toEqual(domains);
  });

  it('空/无效段被过滤', () => {
    const text = serializeTopologyDomains([
      { name: '', description: '无名' },
      { name: '有区', description: '' },
      { name: '正常', description: '正常描述' },
    ]);
    expect(parseTopologyDomainsText(text)).toEqual([{ name: '正常', description: '正常描述' }]);
  });

  it('总述 + 域（域名独占一行）往返无损，正文内行内冒号不被当域标题', () => {
    const doc = {
      overview: '该拓扑图是某系统分级网络架构，严格按四个维度划分，实现隔离与分层防护。',
      domains: [
        {
          name: '安全边界区',
          description: '该区域是对外接入入口：\n对接互联网方向：部署数外防火墙；\n对接医保专网方向：部署医保防火墙；',
        },
        { name: '核心交换区', description: '部署主备冗余核心交换机，是流量转发中枢。' },
      ],
    };
    const text = serializeTopologyDoc(doc);
    expect(text).toContain('安全边界区：');
    expect(text).toContain('对接互联网方向：');
    const parsed = parseTopologyDoc(text);
    expect(parsed.overview).toBe(doc.overview);
    expect(parsed.domains).toEqual(doc.domains);
  });

  it('无总述时 overview 为空，仍正确解析各域', () => {
    const text = serializeTopologyDoc({
      overview: '',
      domains: [{ name: 'A区', description: '说明A' }, { name: 'B区', description: '说明B' }],
    });
    const parsed = parseTopologyDoc(text);
    expect(parsed.overview).toBe('');
    expect(parsed.domains).toHaveLength(2);
  });

  it('旧格式「域名：正文同行」兼容解析', () => {
    const parsed = parseTopologyDoc('管理区: 管理平台所在\n\n生产区：业务服务器集群');
    expect(parsed.domains).toEqual([
      { name: '管理区', description: '管理平台所在' },
      { name: '生产区', description: '业务服务器集群' },
    ]);
  });

  it('空输入返回空', () => {
    expect(parseTopologyDoc('')).toEqual({ overview: '', domains: [] });
    expect(parseTopologyDoc(null)).toEqual({ overview: '', domains: [] });
    expect(serializeTopologyDoc({ overview: '', domains: [] })).toBe('');
    expect(parseTopologyDomainsText('')).toEqual([]);
  });

  it('超长域名序列化时截断到上限，往返后仍是合法域标题', () => {
    const domains = [{ name: '域'.repeat(100), description: '一段说明' }];
    const parsed = parseTopologyDomainsText(serializeTopologyDomains(domains));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('域'.repeat(MAX_DOMAIN_NAME_LENGTH));
    expect(parsed[0].description).toBe('一段说明');
  });

  it('描述内部含空行时并入该域正文（保留子项），域数不膨胀', () => {
    const doc = {
      overview: '',
      domains: [{ name: '生产控制区', description: '第一行说明\n\n第二行说明' }],
    };
    const parsed = parseTopologyDoc(serializeTopologyDoc(doc));
    expect(parsed.domains).toHaveLength(1);
    expect(parsed.domains[0].name).toBe('生产控制区');
    expect(parsed.domains[0].description).toBe('第一行说明\n\n第二行说明');
  });
});
