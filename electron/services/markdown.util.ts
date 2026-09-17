import type { CollectionResult } from '../../shared/types';

export interface MarkdownData {
  assetName: string;
  host: string;
  os: string;
  username: string;
  completedAt: string;
  results: CollectionResult[];
}

function escapeCode(code: string): string {
  // 防止 Markdown 代码块被内容中的 ``` 破坏
  return code.replace(/```/g, '\\`\\`\\`');
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export function generateCollectionMarkdown(data: MarkdownData): string {
  const lines: string[] = [];
  lines.push(`# 自动采集报告`);
  lines.push('');
  lines.push(`> 生成时间：${new Date(data.completedAt).toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('## 一、基本信息');
  lines.push('');
  lines.push('| 项目 | 内容 |');
  lines.push('| --- | --- |');
  lines.push(`| 资产名称 | ${data.assetName || '-'} |`);
  lines.push(`| 目标主机 | ${data.host} |`);
  lines.push(`| 系统类型 | ${data.os || '-'} |`);
  lines.push(`| 连接用户 | ${data.username || '-'} |`);
  lines.push(`| 核查命令数 | ${data.results.length} |`);
  lines.push('');

  lines.push('## 二、核查结果明细');
  lines.push('');
  if (data.results.length === 0) {
    lines.push('（无采集结果）');
    lines.push('');
  } else {
    for (let i = 0; i < data.results.length; i++) {
      const r = data.results[i];
      const statusText = r.status === 'success' ? '成功' : r.status === 'failed' ? '失败（非零退出码）' : r.status === 'timeout' ? '超时' : '错误';
      lines.push(`### ${i + 1}. ${r.command}`);
      lines.push('');
      lines.push(`- 命令：\`${escapeCode(r.command)}\``);
      lines.push(`- 执行状态：${statusText}${r.exitCode != null ? `（退出码 ${r.exitCode}）` : ''}`);
      lines.push(`- 耗时：${r.durationMs} ms`);
      lines.push('');
      lines.push('**输出（stdout）：**');
      lines.push('');
      lines.push('```text');
      lines.push(r.stdout || '（无输出）');
      lines.push('```');
      lines.push('');
      if (r.stderr) {
        lines.push('**错误输出（stderr）：**');
        lines.push('');
        lines.push('```text');
        lines.push(r.stderr);
        lines.push('```');
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`*本报告由 JSecProbe 自动采集生成。*`);
  lines.push('');
  return lines.join('\n');
}