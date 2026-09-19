import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import {
  checkOllamaRunning,
  listModels,
  validateLocalUrl,
  runPowerShellAsync,
  type OllamaModel,
  type OllamaStatus,
  type OllamaInstallGuide,
} from './ollama.service';

/**
 * Herdsman(牧马人) 本地推理引擎适配服务。
 * 实测其网关同时兼容 OpenAI(/v1/chat/completions、/v1/models) 与 Ollama(/api/tags、/api/chat) 协议，
 * 因此状态检测/模型列表直接复用 ollama.service 的通用实现；差异点：
 *  - 默认端口 8080（Ollama 为 11434）
 *  - 下载/删除模型不支持 API（实测 /api/pull、/api/delete 返回 404），由 Herdsman 客户端管理
 *  - 启动为 GUI 应用（无 serve 子命令）
 */

export const HERDSMAN_DEFAULT_URL = 'http://localhost:8080';

/**
 * Herdsman(牧马人) 的官方下载地址（E9）。
 *
 * 这是**第三方厂商站点**，不属于本项目。此前该域名在文件里以字面量散落 4 处
 * （下载链接、文档链接、Windows/macOS 引导文案），厂商一旦换域名就得改代码发版。
 * 这里收敛为单一常量，并允许用 JSECPROBE_HERDSMAN_SITE 覆盖（内网镜像/自建分发场景）。
 * 注意：本服务只会在用户明确请求时下载/引导安装，**不会**自动从该地址拉取任何可执行文件。
 */
export const HERDSMAN_OFFICIAL_SITE =
  (process.env.JSECPROBE_HERDSMAN_SITE || 'https://flowyaipc.cn/ai-engine').replace(/\/+$/, '');

let herdsmanProcess: ReturnType<typeof spawn> | null = null;
let startInProgress = false;

/** 常见安装路径（自定义目录由开始菜单快捷方式扫描兜底） */
export function getHerdsmanExePaths(): string[] {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
  return [
    path.join(localAppData, 'Programs', 'Herdsman', 'herdsman.exe'),
    path.join(programFiles, 'Herdsman', 'herdsman.exe'),
    path.join(programFilesX86, 'Herdsman', 'herdsman.exe'),
    'C:\\Program Files\\Herdsman\\herdsman.exe',
    'C:\\Program Files (x86)\\Herdsman\\herdsman.exe',
  ];
}

export function getHerdsmanExePath(): string {
  const paths = getHerdsmanExePaths();
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return paths[0];
}

/**
 * 通过开始菜单快捷方式反查 herdsman.exe 的真实路径，覆盖自定义安装目录。
 * 使用 WScript.Shell 解析 .lnk 的 TargetPath。
 */
async function findHerdsmanFromStartMenu(): Promise<string> {
  // 直接传 PowerShell 脚本本体（由 runPowerShellAsync 异步执行），不再拼接 powershell 命令前缀
  const script =
    '$shell=New-Object -ComObject WScript.Shell; ' +
    'foreach($d in @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs","$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs")){ ' +
    'Get-ChildItem -Path $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { ' +
    '$t=$shell.CreateShortcut($_.FullName).TargetPath; ' +
    "if($t -and $t -match 'herdsman\\.exe$'){ $t } } }";
  try {
    const output = await runPowerShellAsync(script, 8000);
    const lines = output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && fs.existsSync(l));
    return lines[0] || '';
  } catch {
    return '';
  }
}

// 「是否已安装」的探测代价最高（开始菜单反查实测约 1.5 秒），而健康检查每 30 秒就会查一次状态。
// 这里做短时缓存；force=true 用于用户显式操作（打开设置、点击「验证安装」），保证拿到最新结果。
const INSTALL_CHECK_TTL_MS = 5 * 60 * 1000;
let installedCache: { value: boolean; at: number } | null = null;

export async function checkHerdsmanInstalled(force = false): Promise<boolean> {
  if (!force && installedCache && Date.now() - installedCache.at < INSTALL_CHECK_TTL_MS) {
    return installedCache.value;
  }
  let installed = false;
  try {
    for (const p of getHerdsmanExePaths()) {
      if (fs.existsSync(p)) {
        installed = true;
        break;
      }
    }
    if (!installed && (await findHerdsmanFromStartMenu())) {
      installed = true;
    }
    if (!installed) {
      const output = await runPowerShellAsync(
        '(Get-Command herdsman -ErrorAction SilentlyContinue).Source',
        5000
      );
      installed = output.trim().length > 0;
    }
  } catch {
    installed = false;
  }
  installedCache = { value: installed, at: Date.now() };
  return installed;
}

export async function getHerdsmanStatus(url: string = HERDSMAN_DEFAULT_URL, force = false): Promise<OllamaStatus> {
  try {
    const running = await checkOllamaRunning(url);
    if (running) {
      const models: OllamaModel[] = await listModels(url);
      return { state: 'running', models };
    }
    const installed = await checkHerdsmanInstalled(force);
    return { state: installed ? 'not_running' : 'not_installed' };
  } catch (err: any) {
    log.error('[Herdsman] 状态检查失败:', err.message);
    return { state: 'not_installed', error: err.message };
  }
}

export async function startHerdsman(url: string = HERDSMAN_DEFAULT_URL): Promise<{ success: boolean; message: string }> {
  if (startInProgress) {
    return { success: false, message: 'Herdsman 正在启动中，请稍候' };
  }
  startInProgress = true;
  try {
    const validation = validateLocalUrl(url);
    if (!validation.valid) {
      return { success: false, message: validation.error || 'URL 验证失败' };
    }
    const running = await checkOllamaRunning(url);
    if (running) {
      return { success: true, message: 'Herdsman 已在运行' };
    }
    let exe = getHerdsmanExePath();
    if (!fs.existsSync(exe)) {
      exe = await findHerdsmanFromStartMenu();
    }
    if (!exe || !fs.existsSync(exe)) {
      return { success: false, message: '未找到 Herdsman 安装位置，请手动启动 Herdsman' };
    }
    herdsmanProcess = spawn(exe, [], {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    });
    herdsmanProcess.on('error', (err) => {
      log.error('[Herdsman] 进程错误:', err.message);
      herdsmanProcess = null;
    });
    // 必须监听 exit：否则进程退出后引用一直挂着，
    // 后续 isHerdsmanProcessRunning() 之类的判断会基于失效句柄给出错误结论
    herdsmanProcess.on('exit', (code, signal) => {
      log.info(`[Herdsman] 进程已退出 (code=${code}, signal=${signal})`);
      herdsmanProcess = null;
    });
    // Herdsman 为 GUI 应用，启动后等待网关就绪（最长 15 秒）
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await checkOllamaRunning(url)) {
        return { success: true, message: 'Herdsman 启动成功' };
      }
    }
    return { success: false, message: 'Herdsman 启动超时，请检查 Herdsman 网关是否开启' };
  } catch (err: any) {
    log.error('[Herdsman] 启动失败:', err.message);
    return { success: false, message: err.message };
  } finally {
    startInProgress = false;
  }
}

/**
 * 停止由本应用启动的 Herdsman 进程。
 *
 * 只杀 **本应用 spawn 出来** 的进程（herdsmanProcess 句柄），
 * 用户自行启动的 Herdsman 不在管辖范围，不会被误杀。
 * 应在应用退出前调用，否则 Herdsman 是 GUI 程序，会留下孤儿窗口常驻后台。
 */
export function stopHerdsman(): void {
  const proc = herdsmanProcess;
  if (!proc) return;
  herdsmanProcess = null;
  try {
    if (process.platform === 'win32' && proc.pid) {
      // GUI 应用常派生子进程，/T 连带结束进程树，避免残留窗口
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).on('error', () => { /* taskkill 不可用时忽略 */ });
    } else {
      proc.kill();
    }
    log.info('[Herdsman] 已请求停止本地引擎进程');
  } catch (err: any) {
    log.warn('[Herdsman] 停止进程失败:', err?.message || err);
  }
}

export async function testHerdsmanConnection(url: string = HERDSMAN_DEFAULT_URL): Promise<{ success: boolean; message: string }> {
  try {
    const validation = validateLocalUrl(url);
    if (!validation.valid) {
      return { success: false, message: validation.error || 'URL 验证失败' };
    }
    const running = await checkOllamaRunning(url);
    if (running) {
      return { success: true, message: 'Herdsman 连接正常' };
    }
    return { success: false, message: '无法连接到 Herdsman 服务' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export function getInstallGuide(): OllamaInstallGuide {
  return {
    downloadUrl: HERDSMAN_OFFICIAL_SITE,
    installPath: path.dirname(getHerdsmanExePath()),
    docsUrl: HERDSMAN_OFFICIAL_SITE,
    windows: [
      `访问 ${HERDSMAN_OFFICIAL_SITE} 下载 Herdsman(牧马人) 安装包`,
      '运行安装包完成安装，首次启动按引导完成账号登录',
      '确认「网关」已开启，监听端口默认 8080（设置中可查看端口提示）',
      '在 Herdsman 模型库中下载所需的文本生成模型（如 Qwen、DeepSeek、GLM 系列）',
      '回到本软件 AI 设置，将服务地址指向 Herdsman 网关地址即可',
    ],
    mac: [
      `访问 ${HERDSMAN_OFFICIAL_SITE} 下载 macOS 版本`,
      '安装后启动 Herdsman，完成登录并下载模型',
      '确认网关监听已开启（默认 8080 端口）',
    ],
    linux: [
      'Herdsman 以 Windows/macOS 桌面端为主，Linux 环境请参考官网说明',
    ],
  };
}

export interface HerdsmanRecommendedModel {
  name: string;
  label: string;
  description: string;
  size: string;
  minMemory: number;
  supportsVision: boolean;
}

/**
 * Herdsman 引擎不支持通过 API 下载模型（实测 /api/pull 返回 404），
 * 模型需在 Herdsman 客户端模型库中下载，故不提供"一键下载"推荐列表，
 * 返回空数组，前端展示引导文案。
 */
export const RECOMMENDED_MODELS: HerdsmanRecommendedModel[] = [];