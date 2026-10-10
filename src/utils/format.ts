/**
 * 日期/时长格式化。
 *
 * 此前 8 处各写一份：同样是 `new Date(x)` 后拼字符串，有的补零用 `padStart(2,'0')`、
 * 有的直接 `toLocaleString('zh-CN')`，空值分别返回 `''`、`'-'`、`undefined`，
 * 同一个时间戳在项目列表显示 `2026-09-24 10:00`、在知识库显示 `2026-09-24`。
 * 这里统一入口，参数显式化。
 */

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `2026-09-24` */
export function formatDate(value: DateInput, empty = ''): string {
  const d = toDate(value);
  if (!d) return empty;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `2026-09-24 10:05` */
export function formatDateTime(value: DateInput, empty = ''): string {
  const d = toDate(value);
  if (!d) return empty;
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 按中文习惯的完整时间（`2026/9/24 10:05:03`）。
 * 用于需要精确到秒的场景；解析失败时退回原始字符串，不显示 "Invalid Date"。
 */
export function formatLocalDateTime(value: DateInput, empty = ''): string {
  const d = toDate(value);
  if (!d) return empty;
  try {
    return d.toLocaleString('zh-CN');
  } catch {
    return String(value ?? empty);
  }
}

/** 把秒数说人话：`45秒` / `3分05秒` / `1小时05分`，用于 AI 批处理进度与耗时提示 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.floor(seconds)}秒`;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}小时${pad2(mins)}分`;
  return `${mins}分${pad2(secs)}秒`;
}
