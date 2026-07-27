import * as path from 'path';
import { getAppDataPath, getAppDataPathSync } from '../main/paths';

/**
 * 将绝对路径转换为相对路径（相对于 appDataPath）
 */
export async function toRelativePath(absolutePath: string): Promise<string> {
  const appDataPath = await getAppDataPath();
  const resolved = path.resolve(absolutePath);
  const resolvedBase = path.resolve(appDataPath);

  if (resolved.startsWith(resolvedBase + path.sep) || resolved === resolvedBase) {
    const relative = path.relative(resolvedBase, resolved);
    return relative.replace(/\\/g, '/');
  }

  return absolutePath;
}

/**
 * 将相对路径转换为绝对路径
 */
export async function toAbsolutePath(relativePath: string): Promise<string> {
  const appDataPath = await getAppDataPath();
  const normalized = relativePath.replace(/\//g, path.sep);
  return path.join(appDataPath, normalized);
}

/**
 * 批量转换绝对路径数组为相对路径数组
 */
export async function toRelativePaths(absolutePaths: string[]): Promise<string[]> {
  return Promise.all(absolutePaths.map(p => toRelativePath(p)));
}

/**
 * 批量转换相对路径数组为绝对路径数组
 */
export async function toAbsolutePaths(relativePaths: string[]): Promise<string[]> {
  return Promise.all(relativePaths.map(p => toAbsolutePath(p)));
}

/**
 * 同步解析路径：如果是相对路径则转为绝对路径，否则直接返回
 */
export function resolvePathSync(inputPath: string): string {
  if (!inputPath) return '';

  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const appDataPath = getAppDataPathSync();
  const normalized = inputPath.replace(/\//g, path.sep);
  const fullPath = path.join(appDataPath, normalized);
  return fullPath;
}

/**
 * 解析路径：如果是相对路径则转为绝对路径，否则直接返回
 */
export async function resolvePath(inputPath: string): Promise<string> {
  if (!inputPath) return '';

  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const appDataPath = await getAppDataPath();
  const normalized = inputPath.replace(/\//g, path.sep);
  const fullPath = path.join(appDataPath, normalized);
  return fullPath;
}

/**
 * 批量解析路径数组
 */
export async function resolvePaths(inputPaths: string[]): Promise<string[]> {
  return Promise.all(inputPaths.map(p => resolvePath(p)));
}
