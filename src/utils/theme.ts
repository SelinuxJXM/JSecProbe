/**
 * 主题色全局应用工具
 *
 * 应用一个主题色时需要联动三层变量：
 * 1. --color-primary 系列（全应用 76+ 处引用及 hover/active/light 派生色）
 * 2. --primary-color 别名（AI 助手聊天 UI 等处引用）
 * 3. --el-color-primary 系列（Element Plus 组件：按钮、开关、单选框、菜单高亮等）
 *
 * 派生色由主题色实时计算得出，与明暗主题无关（明暗主题的默认值仅在没有
 * 用户自定义色时生效）。
 */

const STORAGE_KEY = 'primaryColor';

export const DEFAULT_PRIMARY_COLOR = '#1B5FD9';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function getSavedPrimaryColor(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function clearPrimaryColor(): void {
  localStorage.removeItem(STORAGE_KEY);
  const html = document.documentElement;
  [
    '--primary-color',
    '--color-primary',
    '--color-primary-hover',
    '--color-primary-active',
    '--color-primary-light',
    '--color-primary-lighter',
    '--color-sidebar-bg-active',
    '--color-bg-active',
    '--el-color-primary',
    '--el-color-primary-light-3',
    '--el-color-primary-light-5',
    '--el-color-primary-light-7',
    '--el-color-primary-light-8',
    '--el-color-primary-light-9',
    '--el-color-primary-dark-2',
  ].forEach((name) => html.style.removeProperty(name));
}

function parseColor(input: string): Rgb | null {
  const val = input.trim();
  const hex = val.replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  const rgbaMatch = val.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
  }
  return null;
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`;
}

function mix(base: Rgb, target: Rgb, ratio: number): string {
  return toHex({
    r: base.r + (target.r - base.r) * ratio,
    g: base.g + (target.g - base.g) * ratio,
    b: base.b + (target.b - base.b) * ratio,
  });
}

function withAlpha({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

export function applyPrimaryColor(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return false;
  const base = toHex(rgb);
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const black: Rgb = { r: 0, g: 0, b: 0 };
  const html = document.documentElement;

  html.style.setProperty('--primary-color', base);
  html.style.setProperty('--color-primary', base);
  html.style.setProperty('--color-primary-hover', mix(rgb, white, 0.15));
  html.style.setProperty('--color-primary-active', mix(rgb, black, 0.2));
  html.style.setProperty('--color-primary-light', withAlpha(rgb, 0.12));
  html.style.setProperty('--color-primary-lighter', withAlpha(rgb, 0.06));
  html.style.setProperty('--color-sidebar-bg-active', base);
  html.style.setProperty('--color-bg-active', withAlpha(rgb, 0.12));

  html.style.setProperty('--el-color-primary', base);
  html.style.setProperty('--el-color-primary-light-3', mix(rgb, white, 0.3));
  html.style.setProperty('--el-color-primary-light-5', mix(rgb, white, 0.5));
  html.style.setProperty('--el-color-primary-light-7', mix(rgb, white, 0.7));
  html.style.setProperty('--el-color-primary-light-8', mix(rgb, white, 0.8));
  html.style.setProperty('--el-color-primary-light-9', mix(rgb, white, 0.9));
  html.style.setProperty('--el-color-primary-dark-2', mix(rgb, black, 0.2));
  return true;
}

/** 启动时调用：恢复用户保存的主题色 */
export function restorePrimaryColor(): void {
  const saved = getSavedPrimaryColor();
  if (saved) applyPrimaryColor(saved);
}
