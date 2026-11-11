/**
 * Excel 按资产/全局层面导出的范围判定回归 + 接线反漂移门禁。
 *
 * 锁住的 bug：只勾选 1 个资产时前端传 domainIds=[]（一个全局层面都没选），
 * 旧实现把空数组当成「全量」，于是每个域都多出一张 _全局层面 sheet，
 * 里面还带着用户未勾选的全局测评记录。这类静默越界不会报错，只能靠断言拦住。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { shouldIncludeGlobalSheet } from '../../shared/export-scope';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('shouldIncludeGlobalSheet', () => {
  it('参数根本没传时回落为全量，兼容只传两个参数的旧调用', () => {
    expect(shouldIncludeGlobalSheet(undefined, 'secure_computing')).toBe(true);
    expect(shouldIncludeGlobalSheet(null, 'security_management')).toBe(true);
  });

  it('显式空数组表示没勾任何全局层面，任何域都不生成', () => {
    for (const key of ['secure_computing', 'secure_physical', 'security_management', 'security_maintenance']) {
      expect(shouldIncludeGlobalSheet([], key)).toBe(false);
    }
  });

  it('只勾一个全局层面时精确匹配该域', () => {
    expect(shouldIncludeGlobalSheet(['security_management'], 'security_management')).toBe(true);
    expect(shouldIncludeGlobalSheet(['security_management'], 'security_maintenance')).toBe(false);
    expect(shouldIncludeGlobalSheet(['security_management'], 'secure_computing')).toBe(false);
  });

  it('勾多个全局层面时按集合匹配，仍不波及其他域', () => {
    const picked = ['security_management', 'security_personnel'];
    expect(shouldIncludeGlobalSheet(picked, 'security_management')).toBe(true);
    expect(shouldIncludeGlobalSheet(picked, 'security_personnel')).toBe(true);
    expect(shouldIncludeGlobalSheet(picked, 'secure_computing')).toBe(false);
  });

  it('资产所属域在只选资产时也不额外生成全局层面表', () => {
    // 运维终端归属 secure_computing；用户只选它时 domainIds=[]
    expect(shouldIncludeGlobalSheet([], 'secure_computing')).toBe(false);
  });
});

describe('接线反漂移', () => {
  const ipc = readSource('electron/ipc/assessment.ipc.ts');

  it('导出 handler 必须调用公共判定，且不得再把空数组当全量', () => {
    expect(ipc).toContain("from '../../shared/export-scope'");
    expect(ipc).toContain('shouldIncludeGlobalSheet(domainIds, domainKey)');
    expect(ipc).not.toContain('domainIds.length === 0');
  });

  it('全局层面 sheet 仍受 hasGlobalData 保护，资产 sheet 分支保持独立', () => {
    expect(ipc).toContain('if (!hasGlobalData && !hasAssetData) continue;');
    expect(ipc).toContain('if (hasGlobalData)');
    expect(ipc).toContain('for (const asset of assetsInDomain)');
  });

  it('混合选择的文件名分支必须先于单个全局层面分支，不能是死代码', () => {
    const mixed = ipc.indexOf('contentLabel = `混合内容_现场核查记录`');
    const single = ipc.indexOf("contentLabel = `${DOMAIN_NAMES[domainIds[0]]");
    expect(mixed).toBeGreaterThan(-1);
    expect(single).toBeGreaterThan(-1);
    expect(mixed).toBeLessThan(single);
  });
});
