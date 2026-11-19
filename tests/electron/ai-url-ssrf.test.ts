import { describe, it, expect, vi } from 'vitest';

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { ensureApiUrl } from '../../electron/services/ai-url';

describe('ensureApiUrl · SSRF 黑名单', () => {
  it('拒绝 IPv4 字面量的回环与元数据地址', () => {
    expect(() => ensureApiUrl('http://127.0.0.1:8080/v1', 'cloud')).toThrow(/禁止访问/);
    expect(() => ensureApiUrl('http://169.254.169.254/latest', 'cloud')).toThrow(/禁止访问/);
  });

  it('拒绝 IPv4-mapped IPv6 写法的回环与元数据地址（绕过修复）', () => {
    expect(() => ensureApiUrl('http://[::ffff:127.0.0.1]:8080/v1', 'cloud')).toThrow(/禁止访问/);
    expect(() => ensureApiUrl('http://[::ffff:169.254.169.254]/latest', 'cloud')).toThrow(/禁止访问/);
  });

  it('本地模式放行内网地址（Ollama 场景）', () => {
    expect(ensureApiUrl('http://127.0.0.1:11434', 'local')).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('公网地址正常补全', () => {
    expect(ensureApiUrl('https://api.example.com/v1', 'cloud')).toBe('https://api.example.com/v1/chat/completions');
  });
});
