// @vitest-environment happy-dom
/**
 * AI 关联文件（attachedFiles）回填关键证据点测试。
 *
 * 回归点：提示词要求 AI 把与测评项相关的截图/文档文件名填入 attachedFiles，
 * 但前端回填循环此前只消费 compliance/conclusion，把文件名整个丢掉了。
 * 这里守住：文件名并入 evidence、幂等去重、不破坏已有证据文本。
 */
import { describe, it, expect, vi } from 'vitest';

const { ElMessage } = vi.hoisted(() => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('element-plus', () => ({ ElMessage }));

import {
  mergeAttachedFilesIntoEvidence,
  extractFileNameFromAttached,
  resolveValidAttachedFiles,
} from '../../src/views/onsite-verification/composables/useAiAnalysis';

const reqLog = '应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖';
const reqFw = '应在网络边界部署访问控制设备，启用访问控制功能';

describe('resolveValidAttachedFiles 附件错配校验', () => {
  it('新格式：对象带 requirement 且匹配本条条款 → 保留', () => {
    const files = [{ file: '截图：日志配置.png', requirement: reqLog }];
    expect(resolveValidAttachedFiles(files, reqLog)).toEqual(['日志配置.png']);
  });

  it('新格式：对象 requirement 与本条不符（防火墙图配给日志项）→ 丢弃', () => {
    const files = [{ file: '截图：防火墙特征库.png', requirement: reqFw }];
    expect(resolveValidAttachedFiles(files, reqLog)).toEqual([]);
  });

  it('旧格式：字符串数组无 requirement → 保留（兼容旧 AI）', () => {
    expect(resolveValidAttachedFiles(['截图：a.png', '文档：b.docx'], reqLog))
      .toEqual(['a.png', 'b.docx']);
  });

  it('混合：一半匹配一半错配 → 只保留匹配的', () => {
    const files = [
      { file: '截图：日志配置.png', requirement: reqLog },
      { file: '截图：防火墙特征库.png', requirement: reqFw },
    ];
    expect(resolveValidAttachedFiles(files, reqLog)).toEqual(['日志配置.png']);
  });
});

describe('extractFileNameFromAttached 解析关联文件名', () => {
  it('剥离"截图：/文档："前缀', () => {
    expect(extractFileNameFromAttached('截图：拓扑图.png')).toBe('拓扑图.png');
    expect(extractFileNameFromAttached('文档：审计日志.docx')).toBe('审计日志.docx');
  });
  it('裸文件名原样返回', () => {
    expect(extractFileNameFromAttached('a.png')).toBe('a.png');
  });
  it('带路径时只取文件名', () => {
    expect(extractFileNameFromAttached('截图：C:\\tmp\\拓扑图.png')).toBe('拓扑图.png');
  });
});

describe('mergeAttachedFilesIntoEvidence 关联文件回填', () => {
  it('空证据直接写入文件列表', () => {
    expect(mergeAttachedFilesIntoEvidence('', ['截图：拓扑图.png', '文档：审计日志.docx']))
      .toBe('关联证据文件：截图：拓扑图.png；文档：审计日志.docx');
  });

  it('保留已有证据，追加到新行', () => {
    expect(mergeAttachedFilesIntoEvidence('经核查，配置正常。', ['截图：a.png']))
      .toBe('经核查，配置正常。\n关联证据文件：截图：a.png');
  });

  it('幂等：二次分析不重复堆叠', () => {
    const once = mergeAttachedFilesIntoEvidence('', ['截图：a.png']);
    expect(mergeAttachedFilesIntoEvidence(once, ['截图：a.png'])).toBe(once);
  });

  it('数组内重名去重', () => {
    expect(mergeAttachedFilesIntoEvidence('', ['截图：a.png', '截图：a.png', '截图：b.png']))
      .toBe('关联证据文件：截图：a.png；截图：b.png');
  });

  it('缺少/空 attachedFiles 不改原文', () => {
    expect(mergeAttachedFilesIntoEvidence('原文', [])).toBe('原文');
    expect(mergeAttachedFilesIntoEvidence('原文', undefined as any)).toBe('原文');
  });
});
