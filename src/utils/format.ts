/**
 * Format Utilities
 * 通用格式化函数
 */

/**
 * 格式化日期时间
 */
export function formatDateTime(date: string | Date, format = 'YYYY-MM-DD HH:mm:ss'): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * 格式化日期
 */
export function formatDate(date: string | Date): string {
  return formatDateTime(date, 'YYYY-MM-DD');
}

/**
 * 格式化时间
 */
export function formatTime(date: string | Date): string {
  return formatDateTime(date, 'HH:mm:ss');
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 30) return `${diffDay}天前`;
  return formatDate(d);
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 格式化数字（千分位）
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

/**
 * 格式化百分比
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * 截断文本
 */
export function truncateText(text: string, maxLength: number, suffix = '...'): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + suffix;
}

/**
 * 格式化等保级别
 */
export function formatLevel(level: number | string): string {
  const num = typeof level === 'string' ? parseInt(level) : level;
  const levelMap: Record<number, string> = {
    1: '第一级（自主保护级）',
    2: '第二级（指导保护级）',
    3: '第三级（监督保护级）',
    4: '第四级（强制保护级）',
    5: '第五级（专控保护级）',
  };
  return levelMap[num] || `第${num}级`;
}

/**
 * 格式化风险等级
 */
export function formatRiskLevel(level: string): string {
  const levelMap: Record<string, string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
  };
  return levelMap[level] || level;
}

/**
 * 格式化状态
 */
export function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    draft: '草稿',
    in_progress: '进行中',
    completed: '已完成',
    archived: '已归档',
    pending: '待整改',
    rectifying: '整改中',
    resolved: '已整改',
    closed: '已关闭',
  };
  return statusMap[status] || status;
}