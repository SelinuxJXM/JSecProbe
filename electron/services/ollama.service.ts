import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const MIN_DISK_SPACE_GB = 5;

let ollamaProcess: ReturnType<typeof spawn> | null = null;
let startInProgress = false;
const OLLAMA_API_TAGS = '/api/tags';
const OLLAMA_API_SHOW = '/api/show';
const OLLAMA_API_PULL = '/api/pull';
const OLLAMA_API_DELETE = '/api/delete';

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  details?: {
    parameterSize?: string;
    quantization?: string;
    family?: string;
  };
}

export interface OllamaStatus {
  state: 'running' | 'not_running' | 'not_installed';
  models?: OllamaModel[];
  error?: string;
}

export interface OllamaInstallGuide {
  downloadUrl: string;
  installPath: string;
  docsUrl: string;
  windows: string[];
  mac: string[];
  linux: string[];
}

interface OllamaTagResponse {
  models?: Array<{
    name: string;
    size: number;
    digest: string;
    modified_at: string;
  }>;
}

interface OllamaShowResponse {
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

function validateOllamaUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      return { valid: false, error: `不支持的协议: ${parsed.protocol}，仅支持 HTTP/HTTPS` };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.includes('..') || hostname.includes('/') || hostname.includes('\\')) {
      return { valid: false, error: 'URL 格式无效' };
    }
    // 禁止用户名/密码嵌入 URL（避免凭据泄露到日志）
    if (parsed.username || parsed.password) {
      return { valid: false, error: 'URL 中不允许包含用户名密码' };
    }
    if (parsed.port) {
      const port = parseInt(parsed.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return { valid: false, error: '端口号无效' };
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'URL 格式无效' };
  }
}

async function fetchOllama(url: string, endpoint: string, options?: RequestInit): Promise<any> {
  const validation = validateOllamaUrl(url);
  if (!validation.valid) {
    throw new Error(validation.error || 'URL 验证失败');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${url}${endpoint}`, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getOllamaExePaths(): string[] {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
  return [
    path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    path.join(programFiles, 'Ollama', 'ollama.exe'),
    path.join(programFilesX86, 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe',
    'C:\\Program Files (x86)\\Ollama\\ollama.exe',
  ];
}

function getOllamaExePath(): string {
  const paths = getOllamaExePaths();
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return paths[0];
}

async function checkDiskSpace(targetPath: string): Promise<{ free: number; total: number }> {
  try {
    const stats = fs.statfsSync(targetPath);
    return {
      free: stats.bavail * stats.bsize,
      total: stats.blocks * stats.bsize,
    };
  } catch (err: any) {
    log.warn('[磁盘空间检查] 失败:', err.message);
    return { free: 0, total: 0 };
  }
}

export async function checkOllamaInstalled(): Promise<boolean> {
  try {
    const paths = getOllamaExePaths();
    for (const p of paths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }
    const output = execSync(
      'powershell -NoProfile -Command "(Get-Command ollama -ErrorAction SilentlyContinue).Source"',
      { stdio: 'pipe', timeout: 5000 }
    ).toString();
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export async function checkOllamaRunning(url: string = OLLAMA_DEFAULT_URL): Promise<boolean> {
  try {
    await fetchOllama(url, OLLAMA_API_TAGS);
    return true;
  } catch {
    return false;
  }
}

export async function getOllamaStatus(url: string = OLLAMA_DEFAULT_URL): Promise<OllamaStatus> {
  try {
    const running = await checkOllamaRunning(url);
    if (running) {
      const models = await listModels(url);
      return { state: 'running', models };
    }
    const installed = await checkOllamaInstalled();
    return { state: installed ? 'not_running' : 'not_installed' };
  } catch (err: any) {
    log.error('[Ollama] 状态检查失败:', err.message);
    return { state: 'not_installed', error: err.message };
  }
}

export async function listModels(url: string = OLLAMA_DEFAULT_URL): Promise<OllamaModel[]> {
  const data: OllamaTagResponse = await fetchOllama(url, OLLAMA_API_TAGS);
  if (!data.models || !Array.isArray(data.models)) {
    return [];
  }
  return data.models.map((m) => ({
    name: m.name,
    size: m.size,
    digest: m.digest,
    modifiedAt: m.modified_at,
  }));
}

export async function getModelInfo(modelName: string, url: string = OLLAMA_DEFAULT_URL): Promise<OllamaModel | null> {
  try {
    const data: OllamaShowResponse = await fetchOllama(url, OLLAMA_API_SHOW, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });
    return {
      name: modelName,
      size: 0,
      digest: '',
      modifiedAt: '',
      details: {
        parameterSize: data.details?.parameter_size,
        quantization: data.details?.quantization_level,
        family: data.details?.family,
      },
    };
  } catch {
    return null;
  }
}

export async function pullModel(
  modelName: string,
  onProgress?: (progress: { status: string; completed?: number; total?: number }) => void,
  url: string = OLLAMA_DEFAULT_URL,
): Promise<boolean> {
  try {
    const validation = validateOllamaUrl(url);
    if (!validation.valid) {
      onProgress?.({ status: 'error', completed: 0, total: 0 });
      throw new Error(validation.error || 'URL 验证失败');
    }
    const ollamaPath = getOllamaExePath();
    const diskSpace = await checkDiskSpace(ollamaPath);
    const minFreeBytes = MIN_DISK_SPACE_GB * 1024 * 1024 * 1024;
    if (diskSpace.free > 0 && diskSpace.free < minFreeBytes) {
      const freeGB = (diskSpace.free / (1024 * 1024 * 1024)).toFixed(2);
      log.warn(`[Ollama] 磁盘空间不足: 剩余 ${freeGB} GB，需要至少 ${MIN_DISK_SPACE_GB} GB`);
      onProgress?.({ status: 'error', completed: 0, total: 0 });
      throw new Error(`磁盘空间不足，剩余 ${freeGB} GB，需要至少 ${MIN_DISK_SPACE_GB} GB 可用空间`);
    }
    onProgress?.({ status: 'pulling', completed: 0, total: 0 });
    log.info(`[Ollama] 开始下载模型: ${modelName}`);
    const controller = new AbortController();
    // 总超时 30 分钟
    const totalTimeout = setTimeout(() => controller.abort(new Error('下载总超时(30分钟)')), 30 * 60 * 1000);
    // chunk 间超时：每次读取重置 60 秒计时器
    let chunkTimeout: NodeJS.Timeout | null = null;
    const resetChunkTimeout = () => {
      if (chunkTimeout) clearTimeout(chunkTimeout);
      chunkTimeout = setTimeout(() => controller.abort(new Error('数据流停滞超时(60秒)')), 60000);
    };
    try {
      const response = await fetch(`${url}${OLLAMA_API_PULL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.body) {
        // 无响应体：视为异常，不再误报成功
        throw new Error('Ollama 返回空响应体，可能是服务异常');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastProgress = { status: 'downloading', completed: 0, total: 0 };
      let totalBytes = 0;
      let chunkCount = 0;
      resetChunkTimeout();
      while (true) {
        const { done, value } = await reader.read();
        if (chunkTimeout) clearTimeout(chunkTimeout);
        if (done) break;
        chunkCount++;
        totalBytes += value.length;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            lastProgress = {
              status: data.status || 'downloading',
              completed: data.completed,
              total: data.total,
            };
            onProgress?.(lastProgress);
          } catch {
            // ignore parse errors
          }
        }
        resetChunkTimeout();
      }
      log.info(`[Ollama] 模型下载完成: ${modelName}, 共接收 ${chunkCount} 个数据块, 总大小: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
      onProgress?.({ status: 'success', completed: 100, total: 100 });
      return true;
    } finally {
      clearTimeout(totalTimeout);
      if (chunkTimeout) clearTimeout(chunkTimeout);
    }
  } catch (err: any) {
    log.error('[Ollama] 拉取模型失败:', err.message);
    onProgress?.({ status: 'error', completed: 0, total: 0 });
    return false;
  }
}

export async function deleteModel(modelName: string, url: string = OLLAMA_DEFAULT_URL): Promise<{ success: boolean; message: string }> {
  try {
    const validation = validateOllamaUrl(url);
    if (!validation.valid) {
      return { success: false, message: validation.error || 'URL 验证失败' };
    }

    // 先检查模型是否存在
    const models = await listModels(url);
    const modelExists = models.some(m => m.name === modelName);
    if (!modelExists) {
      return { success: false, message: `模型 ${modelName} 不存在，可能已被删除` };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${url}${OLLAMA_API_DELETE}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      log.warn(`[Ollama] 删除模型返回非200状态: ${response.status}, 错误: ${errorText}`);
      return { success: false, message: `删除失败(HTTP ${response.status}): ${errorText || '未知错误'}` };
    }

    // 验证删除是否成功
    await new Promise(resolve => setTimeout(resolve, 500));
    const updatedModels = await listModels(url);
    const stillExists = updatedModels.some(m => m.name === modelName);
    if (stillExists) {
      return { success: false, message: '模型删除请求已发送，但模型仍然存在，请稍后重试' };
    }

    log.info(`[Ollama] 模型已删除: ${modelName}`);
    return { success: true, message: '模型已删除' };
  } catch (err: any) {
    log.error('[Ollama] 删除模型失败:', err.message);
    if (err.name === 'AbortError') {
      return { success: false, message: '删除请求超时，请检查Ollama服务状态' };
    }
    return { success: false, message: err.message || '删除失败' };
  }
}

export async function startOllama(url: string = OLLAMA_DEFAULT_URL): Promise<{ success: boolean; message: string }> {
  // 已有进程：检查是否仍健康
  if (ollamaProcess) {
    const running = await checkOllamaRunning(url);
    return running
      ? { success: true, message: 'Ollama 已在运行' }
      : { success: false, message: 'Ollama 进程异常，请先停止再启动' };
  }
  // 防止并发 spawn
  if (startInProgress) {
    return { success: false, message: 'Ollama 正在启动中，请稍候' };
  }
  startInProgress = true;
  try {
    const validation = validateOllamaUrl(url);
    if (!validation.valid) {
      return { success: false, message: validation.error || 'URL 验证失败' };
    }
    const ollamaExe = getOllamaExePath();
    if (!fs.existsSync(ollamaExe)) {
      return { success: false, message: 'Ollama 未安装，请先下载并安装 Ollama' };
    }
    const running = await checkOllamaRunning(url);
    if (running) {
      return { success: true, message: 'Ollama 已在运行' };
    }
    ollamaProcess = spawn(ollamaExe, ['serve'], {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    });
    ollamaProcess.on('exit', (code) => {
      log.info(`[Ollama] 进程退出，退出码: ${code}`);
      ollamaProcess = null;
    });
    ollamaProcess.on('error', (err) => {
      log.error('[Ollama] 进程错误:', err.message);
      ollamaProcess = null;
    });
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const isRunning = await checkOllamaRunning(url);
      if (isRunning) {
        return { success: true, message: 'Ollama 启动成功' };
      }
    }
    return { success: false, message: 'Ollama 启动超时，请手动启动' };
  } catch (err: any) {
    log.error('[Ollama] 启动失败:', err.message);
    return { success: false, message: err.message };
  } finally {
    startInProgress = false;
  }
}

export async function stopOllama(): Promise<{ success: boolean; message: string }> {
  if (!ollamaProcess) {
    return { success: true, message: 'Ollama 未在运行' };
  }
  const proc = ollamaProcess;
  ollamaProcess = null; // 立即清空引用，避免并发问题

  return new Promise((resolve) => {
    let resolved = false;
    const forceTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          proc.kill('SIGKILL');
          log.warn('[Ollama] 进程未响应 SIGTERM，已强制终止');
        } catch {
          // 进程可能已退出，忽略
        }
        resolve({ success: true, message: 'Ollama 已强制停止' });
      }
    }, 3000);

    proc.once('exit', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(forceTimeout);
        log.info('[Ollama] 进程已退出');
        resolve({ success: true, message: 'Ollama 已停止' });
      }
    });

    try {
      proc.kill('SIGTERM');
      log.info('[Ollama] 进程终止信号已发送');
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(forceTimeout);
        log.warn('[Ollama] 终止进程失败:', err);
        resolve({ success: false, message: '终止进程失败' });
      }
    }
  });
}

export async function testOllamaConnection(url: string = OLLAMA_DEFAULT_URL): Promise<{ success: boolean; message: string }> {
  try {
    const validation = validateOllamaUrl(url);
    if (!validation.valid) {
      return { success: false, message: validation.error || 'URL 验证失败' };
    }
    const running = await checkOllamaRunning(url);
    if (running) {
      return { success: true, message: 'Ollama 连接正常' };
    }
    return { success: false, message: '无法连接到 Ollama 服务' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export function getInstallGuide(): OllamaInstallGuide {
  return {
    downloadUrl: 'https://ollama.com/download',
    installPath: path.dirname(getOllamaExePath()),
    docsUrl: 'https://github.com/ollama/ollama',
    windows: [
      '访问 https://ollama.com/download 下载 Windows 安装包',
      '运行下载的 OllamaSetup.exe 完成安装',
      '安装完成后 Ollama 会自动启动，或手动从开始菜单启动',
      '打开命令提示符，运行 ollama pull qwen3-vl:8b 下载推荐模型',
    ],
    mac: [
      '访问 https://ollama.com/download 下载 macOS 安装包',
      '打开下载的 .zip 文件，将 Ollama 拖入 Applications 文件夹',
      '从启动台或 Applications 文件夹启动 Ollama',
      '打开终端，运行 ollama pull qwen3-vl:8b 下载推荐模型',
    ],
    linux: [
      '打开终端，运行 curl -fsSL https://ollama.com/install.sh | sh 安装',
      '安装完成后运行 ollama serve 启动服务',
      '运行 ollama pull qwen3-vl:8b 下载推荐模型',
    ],
  };
}

export const RECOMMENDED_MODELS = [
  {
    name: 'qwen3-vl:8b',
    label: 'Qwen3-VL 8B（推荐）',
    description: '阿里最新多模态模型，中文支持优秀，OCR能力强，适合等保测评截图分析',
    size: '~8GB',
    minMemory: 12,
    supportsVision: true,
  },
  {
    name: 'gemma4:e4b',
    label: 'Gemma 4 E4B',
    description: 'Google最新开源模型，基于Gemini技术，多语言支持好，16GB内存流畅运行',
    size: '~9.6GB',
    minMemory: 12,
    supportsVision: true,
  },
  {
    name: 'qwen2.5vl:7b',
    label: 'Qwen2.5-VL 7B',
    description: '通义千问多模态模型，中文支持好，资源占用低，适合简单图片分析',
    size: '~4.5GB',
    minMemory: 8,
    supportsVision: true,
  },
  {
    name: 'aiden_lu/minicpm-v2.6:Q4_K_M',
    label: 'MiniCPM-V 2.6（轻量）',
    description: '轻量级多模态模型，资源占用极低，适合低配置设备',
    size: '~2.5GB',
    minMemory: 6,
    supportsVision: true,
  },
];
