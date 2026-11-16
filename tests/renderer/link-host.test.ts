/** 卡片副标题的域名提取：URL 含上下文变量时不能抛错（现场内网模板地址常见） */
import { describe, it, expect } from 'vitest';
import { linkHost } from '../../src/utils/link-host';

describe('linkHost', () => {
  it('提取域名并保留端口', () => {
    expect(linkHost('https://std.samr.gov.cn')).toBe('std.samr.gov.cn');
    expect(linkHost('https://www.soer.ccwu.cc/JSecTopo')).toBe('www.soer.ccwu.cc');
    expect(linkHost('http://192.168.10.24:8443/login')).toBe('192.168.10.24:8443');
  });

  it('无协议地址也能显示主机', () => {
    expect(linkHost('192.168.1.1')).toBe('192.168.1.1');
    expect(linkHost('bastion.intra/admin')).toBe('bastion.intra');
  });

  it('含上下文变量或非法格式时安全兜底，不抛错', () => {
    expect(linkHost('http://{assetIp}/check')).toBe('{assetIp}');
    expect(linkHost('https://host/q?p={projectName}')).toBe('host');
    expect(linkHost('')).toBe('');
  });
});
