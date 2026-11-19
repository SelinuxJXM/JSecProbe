import { describe, it, expect } from 'vitest';
import { resolveAssetCategoryByName, resolveAssetCategoryFromSheet } from '../../shared/asset-categories';

describe('资产分类解析（用户实锤 bug：业务应用系统串到管理平台）', () => {
  it('业务应用系统的各种 sheet 名变体都判为 business_app', () => {
    for (const name of ['业务应用系统', '业务应用系统 ', '业务应用系统表', '业务应用平台', '业务应用系统（管理平台）', '应用系统清单']) {
      expect(resolveAssetCategoryFromSheet(name), name).toBe('business_app');
    }
  });

  it('系统管理平台变体判为 management_platform，不被「系统管理文档」抢先', () => {
    expect(resolveAssetCategoryFromSheet('系统管理平台')).toBe('management_platform');
    expect(resolveAssetCategoryFromSheet('系统管理平台V2')).toBe('management_platform');
    expect(resolveAssetCategoryFromSheet('系统管理文档')).toBe('sys_doc');
  });

  it('最具体优先：安全相关人员 / 业务终端 / 数据资源 不被宽泛词抢先', () => {
    expect(resolveAssetCategoryFromSheet('安全相关人员表')).toBe('security_personnel');
    expect(resolveAssetCategoryFromSheet('业务终端/运维终端')).toBe('terminal');
    expect(resolveAssetCategoryFromSheet('业务数据资源表')).toBe('data_resource');
  });

  it('文件名解析：含「平台」的业务应用系统文件名优先判为业务应用', () => {
    expect(resolveAssetCategoryByName('业务应用系统.xlsx')).toBe('business_app');
    expect(resolveAssetCategoryByName('业务应用管理平台清单.xlsx')).toBe('business_app');
    expect(resolveAssetCategoryByName('管理平台台账.xlsx')).toBe('management_platform');
  });

  it('官方标准 sheet 名（含斜杠变体）精确匹配', () => {
    expect(resolveAssetCategoryFromSheet('服务器/存储设备')).toBe('server_storage');
    expect(resolveAssetCategoryFromSheet('服务器-存储设备')).toBe('server_storage');
    expect(resolveAssetCategoryFromSheet('业务终端/运维终端')).toBe('terminal');
  });

  it('无法识别时返回 null，由调用方兜底', () => {
    expect(resolveAssetCategoryByName('')).toBeNull();
    expect(resolveAssetCategoryByName('zzz-unknown')).toBeNull();
  });
});
