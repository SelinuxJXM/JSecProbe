import { describe, it, expect } from 'vitest';
import {
  normalizeRequirement, toDomainKey, toDeviceKey, buildSemanticKey,
  detectHeaderFields, splitCheckpoints, fuzzyRequirementMatch, cellText,
} from '../../electron/services/checkpoint-core';

describe('测评点知识库核心逻辑', () => {
  describe('cellText 兼容多种单元格格式', () => {
    it('普通字符串/数字', () => {
      expect(cellText('abc')).toBe('abc');
      expect(cellText(123)).toBe('123');
      expect(cellText(null)).toBe('');
    });
    it('richText 拼接', () => {
      expect(cellText({ richText: [{ text: '应核查' }, { text: '配置' }] })).toBe('应核查配置');
    });
    it('formula result', () => {
      expect(cellText({ formula: 'A1', result: '结果' })).toBe('结果');
    });
  });

  describe('normalizeRequirement 归一化', () => {
    it('去序号、空白、全半角标点', () => {
      const a = normalizeRequirement('a）应对登录的用户进行身份标识和鉴别；');
      const b = normalizeRequirement('a) 应对登录的用户进行身份标识和鉴别，');
      // 全角；与，都归一为同一个半角符号
      expect(normalizeRequirement('a）身份鉴别；')).toBe(normalizeRequirement('a) 身份鉴别,'));
      expect(a).toContain('应对登录的用户进行身份标识和鉴别');
      expect(b).toContain('应对登录的用户进行身份标识和鉴别');
    });
  });

  describe('toDomainKey / toDeviceKey', () => {
    it('中文域名映射到域 id', () => {
      expect(toDomainKey('安全物理环境')).toBe('secure_physical');
      expect(toDomainKey('安全计算环境')).toBe('secure_computing');
    });
    it('设备类型从 sheet 名/文件名提取，最具体优先', () => {
      expect(toDeviceKey('Linux（三级）')).toBe('linux');
      expect(toDeviceKey('Nginx中间件（三级）')).toBe('nginx');
      expect(toDeviceKey('MySQL数据库（三级）')).toBe('mysql');
      expect(toDeviceKey('网络设备（二级）')).toBe('network_device');
      expect(toDeviceKey('二级')).toBe('');
    });
  });

  describe('buildSemanticKey 语义键', () => {
    it('同条款不同序号前缀生成相同键', () => {
      const k1 = buildSemanticKey('安全计算环境', '身份鉴别', 'a) 应对登录用户进行身份鉴别；');
      const k2 = buildSemanticKey('secure_computing', '身份鉴别', 'a）应对登录用户进行身份鉴别,');
      expect(k1).toBe(k2);
    });
    it('不同要求生成不同键', () => {
      const k1 = buildSemanticKey('安全计算环境', '身份鉴别', '应核查身份唯一性');
      const k2 = buildSemanticKey('安全计算环境', '身份鉴别', '应核查口令复杂度');
      expect(k1).not.toBe(k2);
    });
  });

  describe('detectHeaderFields 识别 4 类表头同义异名', () => {
    it('标准 6 列（测评方法 + 预期结果）', () => {
      const f = detectHeaderFields(['序号', '类别', '测评项', '测评方法', '预期结果', '备注']);
      expect(f.get(3)).toBe('requirement');
      expect(f.get(4)).toBe('checkpoints');
      expect(f.get(5)).toBe('resultTemplate');
    });
    it('MySQL 变体（测评要求 + 结果记录）', () => {
      const f = detectHeaderFields(['序号', '类别', '测评项', '测评要求', '结果记录', '备注']);
      expect(f.get(4)).toBe('checkpoints');
      expect(f.get(5)).toBe('resultTemplate');
    });
    it('14 列中间件模板（英文条款号 + 设备类型）', () => {
      const f = detectHeaderFields(['ObjectType', 'RelatedAssets', 'TestItemNumber', 'StdCode', '安全控制点', '控制项', '测评方法', '结果记录']);
      expect(f.get(1)).toBe('deviceType');
      expect(f.get(3)).toBe('catalogNo');
      expect(f.get(5)).toBe('controlPoint');
      expect(f.get(6)).toBe('requirement');
      expect(f.get(7)).toBe('checkpoints');
    });
    it('扩展要求 5 列（要求解读）', () => {
      const f = detectHeaderFields(['控制点', '安全要求', '要求解读', '测评方法', '预期结果或主要证据']);
      expect(f.get(2)).toBe('requirement');
      expect(f.get(3)).toBe('interpretation');
      expect(f.get(4)).toBe('checkpoints');
    });
  });

  describe('splitCheckpoints 拆分测评点', () => {
    it('编号列表拆成多条', () => {
      const pts = splitCheckpoints('1) 应核查用户列表；2) 应核查口令复杂度；3) 应核查登录失败处理');
      expect(pts).toHaveLength(3);
      expect(pts[0]).toContain('应核查用户列表');
    });
    it('无编号的单条原样返回', () => {
      expect(splitCheckpoints('应核查是否采用加密方式')).toEqual(['应核查是否采用加密方式']);
    });
    it('纯编号标记（无实质内容）被过滤，不入库污染召回', () => {
      const pts = splitCheckpoints('1) 2) 3)');
      // 去掉编号后全为空，不能把 '1)' '2)' '3)' 当有效测评点
      expect(pts.every(p => p.replace(/^[（(]?\d{1,2}\s*[)）、]\s*/, '').trim().length > 0)).toBe(true);
    });
    it('混合列表：有效点保留、纯编号点剔除', () => {
      const pts = splitCheckpoints('1) 应核查用户列表；2) 3) 应核查口令复杂度');
      expect(pts).toHaveLength(2);
      expect(pts[0]).toContain('应核查用户列表');
      expect(pts[1]).toContain('应核查口令复杂度');
    });
  });

  describe('fuzzyRequirementMatch 模糊匹配', () => {
    it('精确匹配', () => {
      expect(fuzzyRequirementMatch('a) 应对登录用户进行身份鉴别；', 'a）应对登录用户进行身份鉴别,')).toBe('exact');
    });
    it('插入词（鉴别信息 vs 身份鉴别信息）判为 fuzzy', () => {
      expect(fuzzyRequirementMatch(
        'a) 应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，鉴别信息具有复杂度要求并定期更换；',
        'a）应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换；',
      )).toBe('fuzzy');
    });
    it('完全不相关返回 null', () => {
      expect(fuzzyRequirementMatch('应核查机房防火', '应核查用户口令复杂度')).toBeNull();
    });
  });
});

// ── 审查修复回归测试（2026-11-19）──
describe('测评点知识库审查修复回归', () => {
  describe('S2：资产分类 id → 设备键映射（此前全断）', () => {
    it('分类 id 命中映射，不再返回空串', () => {
      expect(toDeviceKey('network_device')).toBe('network_device');
      expect(toDeviceKey('security_device')).toBe('security_device');
      expect(toDeviceKey('business_app')).toBe('business_app');
      expect(toDeviceKey('terminal')).toBe('terminal');
    });
    it('安全设备不再并入网络设备', () => {
      expect(toDeviceKey('安全设备')).toBe('security_device');
      expect(toDeviceKey('网络设备')).toBe('network_device');
    });
    it('server_storage 用 os 二次细分为 linux/windows', () => {
      expect(toDeviceKey('server_storage', 'CentOS 7.x')).toBe('linux');
      expect(toDeviceKey('server_storage', 'Windows Server 2019')).toBe('windows');
      expect(toDeviceKey('server_storage')).toBe('');
    });
  });

  describe('M3：归一化遗漏修复', () => {
    it('结尾句号与分号归一为同键', () => {
      expect(normalizeRequirement('应核查远程管理采用加密协议。'))
        .toBe(normalizeRequirement('应核查远程管理采用加密协议；'));
    });
    it('1、与 a、序号前缀被剥离', () => {
      expect(normalizeRequirement('1、应核查身份鉴别')).toBe(normalizeRequirement('应核查身份鉴别'));
      expect(normalizeRequirement('a、应核查身份鉴别')).toBe(normalizeRequirement('应核查身份鉴别'));
    });
    it('波浪号全半角归一', () => {
      expect(normalizeRequirement('口令长度8～16位')).toBe(normalizeRequirement('口令长度8~16位'));
    });
    it('2019 域名映射（安全建设/安全运维）', () => {
      expect(toDomainKey('安全建设管理')).toBe('security_construction');
      expect(toDomainKey('安全运维管理')).toBe('security_maintenance');
    });
    it('未知域名降级为空而非原样入键', () => {
      expect(toDomainKey('访谈')).toBe('');
      expect(toDomainKey('7.1.4')).toBe('');
    });
  });

  describe('M1：测评点拆分不误切 IP/版本号，且认全角编号', () => {
    it('IP 地址不被切成测评点', () => {
      expect(splitCheckpoints('应核查 DNS 服务器 8.8.8.8 配置是否正确')).toHaveLength(1);
      expect(splitCheckpoints('限制登录IP为 192.168.1.1 是否正确')).toHaveLength(1);
    });
    it('版本号与层级号不被切成测评点', () => {
      expect(splitCheckpoints('应核查版本是否为 2.0.1 以上')).toHaveLength(1);
    });
    it('全角编号（1）（2）正确拆分', () => {
      const pts = splitCheckpoints('（1）应核查用户列表（2）应核查口令复杂度');
      expect(pts).toHaveLength(2);
      expect(pts[0]).toContain('应核查用户列表');
    });
    it('1、2、编号正确拆分且无前导标点', () => {
      const pts = splitCheckpoints('1、应核查A；2、应核查B');
      expect(pts).toHaveLength(2);
      expect(pts[1]).not.toMatch(/^[；;，,]/);
    });
  });

  describe('M2：模糊匹配不再误判不同条款', () => {
    it('口令复杂度 vs 口令长度 不判为同一条', () => {
      expect(fuzzyRequirementMatch('应核查口令复杂度', '应核查口令长度')).toBeNull();
    });
    it('终端接入 vs 无线接入 不判为同一条', () => {
      expect(fuzzyRequirementMatch('应核查是否限制终端接入', '应核查是否限制无线接入')).toBeNull();
    });
    it('短标题不被长条款 contains 误判', () => {
      expect(fuzzyRequirementMatch('应核查身份鉴别', '应对登录的用户进行身份标识和鉴别并定期更换口令')).toBeNull();
    });
    it('长条款插入词（身份鉴别信息）仍可模糊匹配', () => {
      expect(fuzzyRequirementMatch(
        '应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，鉴别信息具有复杂度要求并定期更换；',
        '应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换。',
      )).not.toBeNull();
    });
  });
});
