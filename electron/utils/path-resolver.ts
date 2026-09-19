import * as path from 'path';
import * as fs from 'fs';
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

/**
 * 校验「用户通过系统目录选择对话框选中的导出目录」。
 *
 * 与 `validateDataPath()` 的定位区别：
 * - `validateDataPath()` 用于应用**受管数据**（知识库、截图、证据），强制落在 appData 内。
 * - 本函数用于**用户主动导出**（采集文档等），必须允许 appData 外的任意目录，
 *   否则用户无法导出到桌面/移动盘。但它仍要挡住"渲染层被挟持后往系统目录写文件"：
 *   拒绝空字节、相对路径、盘符/根目录与系统保护目录。
 */
const PROTECTED_DIR_WINDOWS = [
  'windows', 'program files', 'program files (x86)', 'programdata',
  'system32', 'syswow64', 'winnt', 'recovery', '$recycle.bin', 'perflogs',
];
const PROTECTED_DIR_POSIX = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/proc', '/sys', '/dev', '/lib', '/var', '/root'];

export function validateUserSelectedDir(inputPath: string, label = '目录'): string {
  if (!inputPath) throw new Error(`${label}不能为空`);
  if (inputPath.includes('\0')) throw new Error(`${label}包含非法字符`);

  const resolved = path.resolve(inputPath);
  // 盘符根目录（C:\）或 POSIX 根（/）：直接拒绝，避免在系统盘根散落文件
  if (/^[A-Za-z]:[\\/]*$/.test(resolved) || resolved === '/' || resolved === path.parse(resolved).root) {
    throw new Error(`${label}不能是磁盘根目录`);
  }

  if (process.platform === 'win32') {
    const lower = resolved.toLowerCase().replace(/\//g, '\\');
    const segments = lower.split('\\').filter(Boolean);
    const hit = segments.find(s => PROTECTED_DIR_WINDOWS.includes(s));
    if (hit) throw new Error(`${label}位于系统保护路径，禁止写入：${hit}`);
  } else {
    const posix = resolved.replace(/\\/g, '/');
    const hit = PROTECTED_DIR_POSIX.find(p => posix === p || posix.startsWith(p + '/'));
    if (hit) throw new Error(`${label}位于系统保护路径，禁止写入：${hit}`);
  }

  return resolved;
}

/**
 * 安全解析路径（受管数据目录）：将输入解析为绝对路径，并强制其落在 appData 数据目录内。
 * 用于读取/写入应用受管数据（知识库文档、截图、证据等），防止 `..` 路径穿越与越界绝对路径访问。
 * - 相对路径：基于 appData 解析。
 * - 绝对路径：若不在 appData 内则拒绝（避免读取/删除任意文件）。
 */
/**
 * 「用户亲手挑选的文件」登记表。
 *
 * 为什么需要它：有些功能要把用户挑的文件内容读进来喂给 AI（批量 AI 分析的附件），
 * 但这些文件既不是测评证据、也不必留档。此前只有两条路，各有硬伤：
 *   ① 直接传外部绝对路径 → 被 validateDataPath 拒绝，附件内容**静默丢失**；
 *   ② 先拷贝进数据目录   → 内容可靠，但每用一次数据目录就永久性长大一点。
 *
 * 登记表给出第三条路：**不拷贝、不留档，但来源必须是用户亲手挑选**。
 * 路径只能由主进程的文件对话框回填（见 system.ipc.ts 的登记调用），
 * 渲染层凭空构造的路径永远不在表内，所以不会退化成「可读任意文件」。
 *
 * 登记表会持久化到 appData/data/authorized-files.json —— 存的只是**路径字符串**
 * （不含任何文件内容），因此既不会像拷贝那样撑大数据目录，又能保证
 * 「上次选过的附件，重开软件还能读」，不会出现时灵时不灵的现象。
 */
const AUTHORIZED_FILE_LIMIT = 512;
const authorizedFiles = new Set<string>();
let authorizedFilesLoaded = false;

function normalizeKey(inputPath: string): string {
  try {
    return path.resolve(inputPath).toLowerCase();
  } catch {
    return inputPath.toLowerCase();
  }
}

function getAuthorizedRegistryPath(): string {
  return path.join(getAppDataPathSync(), 'data', 'authorized-files.json');
}

/** 首次查询时从磁盘载入历史登记表（仅路径字符串，懒惰加载，失败即视为空表） */
function ensureAuthorizedFilesLoaded(): void {
  if (authorizedFilesLoaded) return;
  authorizedFilesLoaded = true;
  try {
    const registryPath = getAuthorizedRegistryPath();
    if (!fs.existsSync(registryPath)) return;
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (typeof item === 'string') authorizedFiles.add(normalizeKey(item));
    }
    // 载入后同样服从容量上限，避免旧表无限膨胀
    trimAuthorizedFiles();
  } catch {
    // 登记表损坏不应影响正常业务：退化为本次会话从零登记即可
  }
}

function trimAuthorizedFiles(): void {
  if (authorizedFiles.size <= AUTHORIZED_FILE_LIMIT) return;
  const keep = Array.from(authorizedFiles).slice(Math.floor(AUTHORIZED_FILE_LIMIT / 2));
  authorizedFiles.clear();
  for (const p of keep) authorizedFiles.add(p);
}

function persistAuthorizedFiles(): void {
  try {
    fs.writeFileSync(getAuthorizedRegistryPath(), JSON.stringify(Array.from(authorizedFiles)), 'utf-8');
  } catch {
    // 写盘失败不阻断业务流程（内存中的登记表本次会话仍然有效）
  }
}

/**
 * 登记用户通过文件对话框选中的文件（持久化，跨会话保留）。
 * 仅在**主进程**拿到 dialog 返回值后调用，渲染进程无法直接写入。
 */
export function authorizeUserFiles(filePaths: readonly (string | undefined | null)[]): void {
  ensureAuthorizedFilesLoaded();
  let changed = false;
  for (const filePath of filePaths) {
    if (!filePath || typeof filePath !== 'string') continue;
    const key = normalizeKey(filePath);
    if (!authorizedFiles.has(key)) {
      authorizedFiles.add(key);
      changed = true;
    }
  }
  if (!changed) return;
  // 登记表本身也要防膨胀：溢出时丢弃最早登记的一半（集合按插入顺序迭代）
  trimAuthorizedFiles();
  persistAuthorizedFiles();
}

export function isUserAuthorizedFile(inputPath: string): boolean {
  if (!inputPath || typeof inputPath !== 'string') return false;
  ensureAuthorizedFilesLoaded();
  return authorizedFiles.has(normalizeKey(inputPath));
}

/**
 * 校验「仅供读取」的文件来源：受管数据目录内，或用户亲手挑选并登记的文件（含历史登记）。
 *
 * 适用场景：把用户挑选的附件读进来做 OCR / 文本提取 / AI 分析——用完即弃，
 * 因此不要求文件位于数据目录内，也**不做任何拷贝**，不会让数据目录增长。
 * 写入类操作请勿使用本函数（那类操作应用 validateFsPath / validateDataPath）。
 */
export async function validateReadablePath(inputPath: string, label = '文件'): Promise<string> {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error(`${label}路径不能为空`);
  }
  if (inputPath.includes('\0')) {
    throw new Error(`${label}路径包含非法字符`);
  }
  // 在 path.resolve() 折叠之前按路径段检查：解析后再判 '..' 恒为 false，形同虚设
  if (inputPath.split(/[\\/]/).includes('..')) {
    throw new Error('路径访问被拒绝: 非法的路径格式');
  }

  const base = path.resolve(await getAppDataPath());
  const resolved = path.resolve(base, inputPath);

  // ① 受管数据目录内（知识库、截图、证据等）：维持原有语义
  if (resolved === base || resolved.startsWith(base + path.sep)) {
    return resolved;
  }

  // ② 本次会话用户亲手挑选的文件：不拷贝、不留档，但来源可核查
  if (isUserAuthorizedFile(resolved)) {
    return resolved;
  }

  throw new Error('路径访问被拒绝：该文件不在数据目录内，且未经当前会话的文件选择授权');
}

/**
 * 不允许被「系统默认程序打开 / 被写出」的文件扩展名。
 *
 * `shell.openPath` 会调用系统关联程序，若放行 .exe/.bat/.ps1 等，
 * 渲染层一旦被挟持即可直接启动任意程序（等价于任意代码执行）。
 * 业务上只用于打开目录、报告(docx/xlsx/pdf)与知识库文档，因此直接拒绝这些扩展名。
 */
const BLOCKED_OPEN_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.msp',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1', '.psd1',
  '.lnk', '.dll', '.sys', '.drv', '.hta', '.jar', '.appref-ms', '.reg', '.inf', '.scf',
]);

/** 校验路径可以被系统默认程序安全打开（拒绝可执行/脚本类文件） */
export function assertOpenablePath(resolvedPath: string): void {
  const ext = path.extname(resolvedPath).toLowerCase();
  if (BLOCKED_OPEN_EXTENSIONS.has(ext)) {
    throw new Error(`出于安全原因，不允许通过本应用打开 ${ext} 类型的文件`);
  }
}

/**
 * 通用文件读写路径校验（原先只存在于 system.ipc.ts，现上移到路径工具供各处复用）。
 *
 * 只接受两类路径：
 *   ① 应用受管数据目录内（`validateDataPath`）—— 知识库、截图、证据等受管文件；
 *   ② 用户主动选择的非保护目录（`validateUserSelectedDir`）—— 导出到桌面/移动盘，
 *      但仍拒绝磁盘根目录与系统保护目录（Windows / Program Files / System32 …）。
 * 其余一律拒绝。
 *
 * `forWrite` 额外拒绝可执行/脚本类扩展名，堵住"写出 exe/bat/ps1 再借 shell 打开"的链路。
 */
export async function validateFsPath(inputPath: string, opts: { forWrite?: boolean } = {}): Promise<string> {
  if (!inputPath) {
    throw new Error('路径不能为空');
  }
  // 空字节截断：Node 的 fs 会截断其后内容，可用于绕过扩展名校验
  if (inputPath.includes('\0')) {
    throw new Error('路径访问被拒绝: 非法的路径格式');
  }
  // 解析前按段检查：path.resolve 会折叠 '../'，解析后再查 '..' 恒不命中
  if (inputPath.split(/[\\/]/).includes('..')) {
    throw new Error('路径访问被拒绝: 非法的路径格式');
  }

  // ① 受管数据目录内
  try {
    return await validateDataPath(inputPath);
  } catch {
    // 不在受管目录内 → 落到 ② 用户自选目录判定
  }

  // ② 用户自选目录（拒绝磁盘根目录与系统保护路径）
  const resolved = validateUserSelectedDir(inputPath, '路径');
  if (opts.forWrite) {
    assertOpenablePath(resolved);
  }
  return resolved;
}

export async function validateDataPath(inputPath: string): Promise<string> {
  if (!inputPath) {
    throw new Error('路径不能为空');
  }
  const base = path.resolve(await getAppDataPath());
  const resolved = path.resolve(base, inputPath); // 绝对 inputPath 会覆盖 base，再由下方校验拦截
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('路径访问被拒绝：超出允许的数据目录范围');
  }
  return resolved;
}
