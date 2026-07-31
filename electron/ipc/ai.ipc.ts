import { ipcMain } from 'electron';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { readFile, stat } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import sharp from 'sharp';
import { writeOperationLog } from '../utils/operation-log';
import { resolvePath } from '../utils/path-resolver';
import {
  getOllamaStatus,
  listModels,
  pullModel,
  deleteModel,
  startOllama,
  getInstallGuide,
  testOllamaConnection,
  RECOMMENDED_MODELS,
} from '../services/ollama.service';
import {
  extractTextFromImage,
  extractTextFromMultipleImages,
  isOCREnabled,
  getSharedWorker,
} from '../services/ocr.service';

const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// 进度存储（用于轮询 fallback）
// 注意：单任务进度，并发批量任务会互相覆盖（已知限制，UI 层应禁止并发批量）
let currentProgress: { stage: string; message: string; percent: number; timestamp: number } | null = null;
const PROGRESS_EXPIRE_MS = 5 * 60 * 1000; // 5 分钟过期

function sanitize<T>(obj: T): any {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    log.error('IPC返回值序列化失败:', e);
    return { success: false, error: { code: 'SERIALIZE_ERROR', message: '数据序列化失败' } };
  }
}

// 计算动态超时时间（基于图片数量和大小）
function calculateTimeout(itemCount: number, imageCount: number, totalImageSizeKB: number, privacyMode: boolean): number {
  const baseTimeout = 60000;
  const perItemTimeout = 3000;
  const perImageTimeout = 5000;
  const privacyModeExtra = privacyMode ? 60000 : 0;
  const sizeTimeout = Math.ceil(totalImageSizeKB / 1024) * 5000;
  return baseTimeout + (itemCount * perItemTimeout) + (imageCount * perImageTimeout) + privacyModeExtra + sizeTimeout;
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff'].includes(ext);
}

async function validateScreenshotPath(inputPath: string): Promise<string> {
  const resolved = await resolvePath(inputPath);
  const normalized = path.resolve(resolved);
  if (normalized.includes('..')) {
    throw new Error(`路径访问被拒绝: 非法的路径格式`);
  }

  // 容错：如果精确路径不存在，尝试按文件名（去时间戳）模糊匹配
  if (!fs.existsSync(normalized)) {
    const dir = path.dirname(normalized);
    const baseName = path.basename(normalized);
    const ext = path.extname(baseName);
    const nameWithoutExt = path.basename(baseName, ext);
    const match = nameWithoutExt.match(/^(.+?)_(\d{10,13})$/);
    if (match && fs.existsSync(dir)) {
      const basePrefix = match[1];
      const candidates = fs.readdirSync(dir)
        .filter(f => f.startsWith(basePrefix + '_') && f.endsWith(ext))
        .map(f => ({
          fullPath: path.join(dir, f),
          mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);
      if (candidates.length > 0) {
        log.info(`[AI截图] 路径已更新: ${normalized} -> ${candidates[0].fullPath}`);
        return candidates[0].fullPath;
      }
    }
  }

  return normalized;
}

async function validateScreenshotPaths(inputPaths: string[] | undefined): Promise<string[]> {
  if (!inputPaths || inputPaths.length === 0) return [];
  const validated: string[] = [];
  for (const p of inputPaths) {
    validated.push(await validateScreenshotPath(p));
  }
  return validated;
}

async function encodeImageToBase64(imagePath: string, maxSizeKB: number = 120): Promise<string> {
  try {
    if (!isImageFile(imagePath)) {
      log.warn(`[图片编码] 跳过非图片文件: ${imagePath}`);
      return '';
    }

    const fileStats = await stat(imagePath);
    const originalSizeMB = fileStats.size / (1024 * 1024);
    if (fileStats.size > MAX_IMAGE_SIZE_BYTES) {
      log.warn(`[图片编码] 图片过大，跳过: ${imagePath}, 大小: ${originalSizeMB.toFixed(1)} MB (最大限制: ${MAX_IMAGE_SIZE_MB} MB)`);
      return '';
    }
    log.info(`[图片编码] 路径: ${imagePath}, 原始大小: ${originalSizeMB.toFixed(1)} MB`);

    const imageBuffer = await readFile(imagePath);
    const originalSizeKB = imageBuffer.length / 1024;

    if (originalSizeKB <= maxSizeKB) {
      return imageBuffer.toString('base64');
    }

    const compressed = await sharp(imageBuffer)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
    const compressedSizeKB = compressed.length / 1024;
    log.info(`[图片压缩] ${imagePath}: ${originalSizeKB.toFixed(1)} KB → ${compressedSizeKB.toFixed(1)} KB`);
    return compressed.toString('base64');
  } catch (err: any) {
    log.error(`[图片编码失败] ${imagePath}: ${err.message}`);
    return '';
  }
}

async function desensitizeImage(imagePath: string): Promise<string> {
  try {
    if (!isImageFile(imagePath)) {
      return '';
    }
    const fileStats = await stat(imagePath);
    const originalSizeMB = fileStats.size / (1024 * 1024);
    if (fileStats.size > MAX_IMAGE_SIZE_BYTES) {
      log.warn(`[图片脱敏] 图片过大，跳过脱敏: ${imagePath}, 大小: ${originalSizeMB.toFixed(1)} MB (最大限制: ${MAX_IMAGE_SIZE_MB} MB)`);
      return '';
    }
    const imageBuffer = await readFile(imagePath);
    log.info(`[图片脱敏] 路径: ${imagePath}, 原始大小: ${originalSizeMB.toFixed(1)} MB`);

    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;

    const worker = await getSharedWorker('eng');
    if (!worker) {
      log.warn(`[图片脱敏] OCR worker 不可用，发送原图`);
      return imageBuffer.toString('base64');
    }

    // 取顶部40%区域，提升清晰度后OCR识别IP地址
    const cropHeight = Math.max(1, Math.round(height * 0.4));
    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left: 0, top: 0, width, height: cropHeight })
      .normalise()
      .sharpen()
      .toBuffer();

    const { data } = await worker.recognize(croppedBuffer);

    const ipPattern = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
    const maskRects: { x: number; y: number; w: number; h: number }[] = [];

    for (const word of data.words || []) {
      if (word.text && ipPattern.test(word.text.trim())) {
        const pad = 2;
        maskRects.push({
          x: Math.max(0, word.bbox.x0 - pad),
          y: Math.max(0, word.bbox.y0 - pad),
          w: word.bbox.x1 - word.bbox.x0 + pad * 2,
          h: word.bbox.y1 - word.bbox.y0 + pad * 2,
        });
      }
    }

    if (maskRects.length === 0) {
      log.info(`[图片脱敏] ${imagePath}: 未检测到敏感文本，发送原图`);
      return imageBuffer.toString('base64');
    }

    let svgRects = '';
    for (const r of maskRects) {
      svgRects += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="black"/>`;
    }
    const svg = `<svg width="${width}" height="${height}">${svgRects}</svg>`;

    const processed = await sharp(imageBuffer)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();

    const processedSizeMB = processed.length / (1024 * 1024);
    log.info(`[图片脱敏] ${imagePath}: 共遮盖 ${maskRects.length} 处敏感文本, ${originalSizeMB.toFixed(1)} MB → ${processedSizeMB.toFixed(1)} MB`);
    return processed.toString('base64');
  } catch (err: any) {
    log.error(`[图片脱敏失败] ${imagePath}: ${err.message}`);
    return '';
  }
}

function isBlockedIp(hostname: string): boolean {
  // 云元数据端点
  if (hostname === '169.254.169.254' || hostname === '169.254.170.2') return true;
  // 链路本地 169.254.0.0/16
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // 0.0.0.0
  if (hostname === '0.0.0.0') return true;
  return false;
}

function ensureApiUrl(baseUrl: string | null | undefined, mode?: string): string {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';

  // 协议校验：仅允许 http/https，阻止 file://、ftp:// 等
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error('API地址必须以 http:// 或 https:// 开头');
  }

  // 云端模式下校验 IP 黑名单，阻止 SSRF 探测云元数据/链路本地地址
  // 本地模式（Ollama）不校验，因为用户可能在任意内网地址部署 Ollama
  if (mode !== 'local') {
    let hostname = '';
    try {
      hostname = new URL(raw).hostname;
    } catch {
      throw new Error('API地址格式无效');
    }
    if (isBlockedIp(hostname)) {
      throw new Error(`API地址被禁止访问: ${hostname}`);
    }
  }

  const queryIndex = raw.indexOf('?');
  const base = queryIndex >= 0 ? raw.substring(0, queryIndex) : raw;

  if (base.endsWith('/chat/completions')) {
    return raw;
  }
  if (/\/v1(\/|$)/.test(base)) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function getApiKeyForMode(config: any): string {
  if (config.mode === 'local') {
    // 本地Ollama模式固定使用 'ollama' 作为API key，不使用云端保存的key
    return 'ollama';
  }
  return config.apiKey || '';
}

function getEffectiveApiBase(config: any, mode?: string): string {
  const effectiveMode = mode || config.mode || 'cloud';
  if (effectiveMode === 'local') {
    return `${(config.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '')}/v1`;
  }
  return config.apiBase || '';
}

function shouldValidateApiKey(config: any): boolean {
  return config.mode !== 'local';
}

function getEffectiveModel(params: any, config: any): string {
  if (config.mode === 'local') {
    return params.model || config.ollamaModel || config.model || '';
  }
  return params.model || config.model || '';
}

function desensitizeText(text: string, extraWords?: string[]): string {
  if (!text) return text;
  let result = text;

  result = result.replace(/\b(\d{1,3}\.\d{1,3}\.)\d{1,3}(\.\d{1,3})\b/g, '$1***$2');
  result = result.replace(/\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '**:**:**:**:**:**');
  result = result.replace(/\b[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+\.(com|cn|org|net|gov|edu|io|ai|dev|info|mil|int|biz|pro|name|coop|mobi)\b/g, (m) => {
    const parts = m.split('.');
    return `***.${parts.slice(-2).join('.')}`;
  });
  result = result.replace(/\/(home|Users|data|export|app|var|etc|tmp|opt|usr)\/[a-zA-Z0-9_\/\-]+/g, (m) => {
    const parts = m.split('/');
    if (parts.length > 2) {
      return '/' + parts[1] + '/***';
    }
    return m;
  });
  result = result.replace(/(password|passwd|pwd|secret|token)\s*[=:]\s*['"]?[^\s;,:]+['"]?/gi, '$1=***');

  result = result.replace(/\b1[3-9]\d{9}\b/g, '1**********');

  const phoneLike = /\b\d{3,4}-?\d{7,8}\b/g;
  result = result.replace(phoneLike, (m) => {
    if (/^\d{4,5}$/.test(m) || /^\d{7,8}$/.test(m)) return m;
    return '***-*******';
  });

  result = result.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '***@***.***');
  result = result.replace(/\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, '******************');
  result = result.replace(/\b[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}\b/g, '*******************');

  result = result.replace(/([\u4e00-\u9fa5]{2,12})(有限公司|有限责任公司|股份有限公司|集团有限公司|集团公司|厂|局|研究院|设计院|设计研究院|分行|支行|信用社|联社|集团|分公司|子公司|办事处|联络处|指挥部|委员会)/g, '***$2');

  if (extraWords && extraWords.length > 0) {
    for (const word of extraWords) {
      if (!word || word.trim().length === 0) continue;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), '***');
    }
  }

  return result;
}

function wrap<T>(fn: () => T | Promise<T>): Promise<any> {
  return Promise.resolve()
    .then(fn)
    .then((data) => sanitize({ success: true, data }))
    .catch((error) => {
      log.error('AI IPC Error:', error);
      return sanitize({
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || '操作失败',
        },
      });
    });
}

/**
 * 规范化从数据库读取的 aiConfigs 配置：
 * - mode 强制为 'cloud' | 'local'
 * - 数值字段强制为 number
 * - 字符串字段兜底空串
 * - privacyMode/ocrPreprocess 强制为 0/1
 */
function normalizeConfig(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  const mode = raw.mode === 'local' ? 'local' : 'cloud';
  const toInt = (v: any): number => (v === 1 || v === true ? 1 : 0);
  const toStr = (v: any, def = ''): string => (typeof v === 'string' ? v : def);
  const toNum = (v: any, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  return {
    ...raw,
    mode,
    apiKey: toStr(raw.apiKey),
    apiBase: toStr(raw.apiBase),
    model: toStr(raw.model, 'gpt-4o-mini'),
    provider: toStr(raw.provider, 'openai'),
    ollamaUrl: toStr(raw.ollamaUrl, 'http://localhost:11434'),
    ollamaModel: raw.ollamaModel || null,
    temperature: toNum(raw.temperature, 0.3),
    privacyMode: toInt(raw.privacyMode),
    ocrPreprocess: toInt(raw.ocrPreprocess),
    sensitiveWords: toStr(raw.sensitiveWords),
  };
}



export function registerAIHandlers(): void {
  ipcMain.handle('ai:getConfig', async () =>
    wrap(async () => {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      const config: any = configs[0] ? { ...configs[0] } : {};
      // 返回前对 apiKey 脱敏，防止明文泄露到渲染层
      // testConnection 等需要完整 apiKey 的场景通过 params.apiKey 单独传参
      if (config.apiKey) {
        const key = config.apiKey;
        if (key.length > 12) {
          config.apiKey = key.substring(0, 4) + '****' + key.substring(key.length - 4);
        } else {
          config.apiKey = '****';
        }
      }
      return config;
    })
  );

  ipcMain.handle('ai:saveConfig', async (_event, config: any) =>
    wrap(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      const mode = config.mode || 'cloud';

      // 先读取现有配置，保留另一模式的设置
      const existingConfigs = await db.select().from(schema.aiConfigs).limit(1);
      const existing = existingConfigs.length > 0 ? existingConfigs[0] : null;

      let apiBase = (config.apiBase || '').trim().replace(/\/+$/, '');
      if (apiBase.endsWith('/v1/chat/completions')) {
        apiBase = apiBase.replace(/\/v1\/chat\/completions\/?$/, '');
      } else if (apiBase.endsWith('/chat/completions')) {
        apiBase = apiBase.replace(/\/chat\/completions\/?$/, '');
      }
      if (apiBase.endsWith('/v1')) {
        apiBase = apiBase.replace(/\/v1\/?$/, '');
      }

      const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
      const ollamaModel = config.ollamaModel || null;

      let saveData: any = {
        mode,
        privacyMode: config.privacyMode ?? 0,
        sensitiveWords: config.sensitiveWords || '',
        temperature: config.temperature ?? 0.3,
        // OCR预处理默认：云端模式关闭，本地模式开启
        ocrPreprocess: config.ocrPreprocess !== undefined ? (config.ocrPreprocess ? 1 : 0) : (mode === 'local' ? 1 : 0),
        updatedAt: now,
      };

      if (mode === 'local') {
        // 本地模式：仅保存 Ollama 相关字段，不覆盖云端的 apiKey/apiBase/model
        // 这确保云端配置在切换模式时不会被丢失
        saveData.ollamaUrl = ollamaUrl;
        saveData.ollamaModel = ollamaModel;
        saveData.provider = 'ollama';
        // 关键：不修改 apiKey、apiBase、model、provider（云端字段保持不变）
      } else {
        // 云端模式：保存云端配置，同时保留本地 Ollama 配置
        saveData.apiBase = apiBase;
        saveData.apiKey = config.apiKey;
        saveData.model = config.model;
        saveData.provider = config.provider || 'openai';
        // 保留本地 Ollama 配置
        if (existing) {
          saveData.ollamaUrl = existing.ollamaUrl || ollamaUrl;
          saveData.ollamaModel = existing.ollamaModel || null;
        } else {
          saveData.ollamaUrl = ollamaUrl;
          saveData.ollamaModel = null;
        }
      }

      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length > 0) {
        await db.update(schema.aiConfigs)
          .set(saveData)
          .where(eq(schema.aiConfigs.id, configs[0].id));
      } else {
        await db.insert(schema.aiConfigs).values({
          id: 'default',
          ...saveData,
          createdAt: now,
        });
      }

      log.info(`[保存AI配置] 模式: ${mode}, API地址: ${mode === 'cloud' ? (saveData.apiBase || '未设置') : '使用Ollama'}, 模型: ${mode === 'cloud' ? (saveData.model || '未设置') : saveData.ollamaModel || '未设置'}`);
    })
  );

  ipcMain.handle('ollama:getStatus', async (_event, url?: string) =>
    wrap(async () => {
      return await getOllamaStatus(url);
    })
  );

  ipcMain.handle('ollama:listModels', async (_event, url?: string) =>
    wrap(async () => {
      return await listModels(url);
    })
  );

  ipcMain.handle('ollama:pullModel', async (_event, modelName: string, url?: string) => {
    try {
      const result = await pullModel(
        modelName,
        (progress) => {
          try {
            _event.sender.send('ollama:pullProgress', { modelName, ...progress });
          } catch {
            // ignore send errors
          }
        },
        url,
      );
      if (!result) {
        return sanitize({ success: false, error: { code: 'PULL_MODEL_ERROR', message: '模型下载失败，请检查Ollama服务状态和网络连接' } });
      }
      return sanitize({ success: true, data: { result } });
    } catch (err: any) {
      return sanitize({ success: false, error: { code: 'PULL_MODEL_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ollama:deleteModel', async (_event, modelName: string, url?: string) => {
    try {
      const result = await deleteModel(modelName, url);
      if (!result.success) {
        return sanitize({ success: false, error: { code: 'DELETE_MODEL_ERROR', message: result.message } });
      }
      return sanitize({ success: true, data: true });
    } catch (err: any) {
      return sanitize({ success: false, error: { code: 'DELETE_MODEL_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ollama:start', async (_event, url?: string) => {
    try {
      const result = await startOllama(url);
      return sanitize({ success: result.success, data: result });
    } catch (err: any) {
      return sanitize({ success: false, error: { code: 'START_OLLAMA_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ollama:getInstallGuide', async () =>
    wrap(async () => {
      return getInstallGuide();
    })
  );

  ipcMain.handle('ollama:testConnection', async (_event, url?: string) => {
    try {
      const result = await testOllamaConnection(url);
      if (result.success) {
        return sanitize({ success: true, data: result });
      } else {
        return sanitize({ success: false, error: { code: 'TEST_CONNECTION_ERROR', message: result.message } });
      }
    } catch (err: any) {
      return sanitize({ success: false, error: { code: 'TEST_CONNECTION_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ollama:getRecommendedModels', async () =>
    wrap(async () => {
      return RECOMMENDED_MODELS;
    })
  );

  // 进度轮询（fallback 机制）
  ipcMain.handle('ai:getProgress', async () => {
    // 过期进度返回 null，避免读到陈旧数据
    if (currentProgress && Date.now() - currentProgress.timestamp > PROGRESS_EXPIRE_MS) {
      currentProgress = null;
    }
    return sanitize({ success: true, data: currentProgress });
  });

  ipcMain.handle('ai:testConnection', async (_event, params?: { apiBase?: string; apiKey?: string; model?: string; mode?: string; ollamaUrl?: string }) => {
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) return sanitize({ success: false, error: { code: 'NOT_CONFIGURED', message: 'AI未配置' } });

      const config = normalizeConfig(sanitize(configs[0]));
      const mode = params?.mode || config.mode || 'cloud';
      // 合并 params 到 config，使 getEffectiveApiBase 能根据 mode 选择正确的 API 地址
      const mergedConfig = { ...config, ...params };
      const apiBase = getEffectiveApiBase(mergedConfig, mode);
      const apiKey = getApiKeyForMode({ ...config, mode, apiKey: params?.apiKey || config.apiKey });
      const model = getEffectiveModel(params, { ...config, mode });

      if (shouldValidateApiKey({ ...config, mode }) && !apiKey) {
        return sanitize({ success: false, error: { code: 'NO_API_KEY', message: 'API Key未配置' } });
      }
      if (!apiBase) return sanitize({ success: false, error: { code: 'NO_API_BASE', message: 'API地址未配置' } });

      const apiUrl = ensureApiUrl(apiBase, mode);
      // 日志中不打印完整 URL（可能含 query 参数中的 token）
      log.info(`[测试连接] 模式: ${mode}, 模型: ${model}`);

      const requestBody = {
        model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
        temperature: 0.1,
      };

      // 测试连接超时控制（15秒）
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        const errMsg = fetchErr.name === 'AbortError' ? `连接超时(15秒): ${apiUrl}` : `网络错误: ${fetchErr.message}`;
        return sanitize({
          success: false,
          error: { code: 'TEST_CONNECTION_ERROR', message: errMsg, apiUrl }
        });
      }
      clearTimeout(timeout);

      const responseText = await response.text();
      log.info(`[测试连接] 状态: ${response.status}, 响应: ${responseText.substring(0, 500)}`);

      if (!response.ok) {
        return sanitize({
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: `请求失败(${response.status}): ${apiUrl}`,
            details: responseText.substring(0, 500),
            apiUrl,
          }
        });
      }

      const data = JSON.parse(responseText);
      return sanitize({
        success: true,
        data: {
          url: apiUrl,
          model,
          reply: data.choices?.[0]?.message?.content || '无回复',
          mode,
        }
      });
    } catch (error: any) {
      log.error('[测试连接] 错误:', error);
      return sanitize({ success: false, error: { code: 'TEST_ERROR', message: error.message } });
    }
  });

  ipcMain.handle('ai:chat', async (_event, params: {
    messages: { role: string; content: string }[];
    model?: string;
    temperature?: number;
    context?: string;
  }) => {
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      if (shouldValidateApiKey(config) && !config.apiKey) {
        throw new Error('API Key未配置');
      }

      const model = getEffectiveModel(params, config);
      const temperature = params.temperature ?? config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(getEffectiveApiBase(config, mode), mode);
      const apiKey = getApiKeyForMode(config);

      if (!apiUrl) throw new Error('API地址未配置');

      const messages: any[] = [];
      if (params.context) {
        messages.push({ role: 'system', content: params.context });
      }
      messages.push(...params.messages);

      const requestBody = JSON.stringify({
        model,
        messages,
        temperature,
      });
      const bodySizeKB = Buffer.byteLength(requestBody, 'utf8') / 1024;
      log.info(`[AI对话] 模式: ${mode}, URL: ${apiUrl}, 模型: ${model}, 消息数: ${messages.length}, 请求体: ${bodySizeKB.toFixed(1)}KB`);

      // 添加超时机制
      const dynamicTimeout = calculateTimeout(1, 0, bodySizeKB, false);
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        log.warn(`[AI对话] 请求超时(${dynamicTimeout}ms)，终止请求`);
        abortController.abort(new Error('请求超时'));
      }, dynamicTimeout);

      let response;
      try {
        const fetchStartTime = Date.now();
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: requestBody,
          signal: abortController.signal,
        });
        const elapsed = Date.now() - fetchStartTime;
        log.info(`[AI对话] fetch收到响应，耗时: ${elapsed}ms, 状态: ${response.status}`);
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError' || fetchError.message.includes('请求超时')) {
          throw new Error('AI对话超时，请检查网络连接或稍后重试');
        }
        throw fetchError;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API请求失败(${response.status}): ${apiUrl} - ${errorBody}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      log.info(`[AI对话] 响应内容长度: ${content.length}字符`);

      try {
        writeOperationLog({
          action: 'ai_chat',
          module: 'ai',
          description: `AI对话: 模式=${mode}, 模型=${model}, 消息数=${params.messages.length}, 上下文=${params.context ? '是' : '否'}`,
        });
      } catch (logErr: any) {
        log.error('[操作日志] 写入AI对话日志失败:', logErr.message);
      }

      return sanitize({
        success: true,
        data: {
          content,
          suggestions: [
            '是否需要进一步详细分析？',
            '将结果保存到核查记录',
            '生成整改建议',
          ],
        },
      });
    } catch (error: any) {
      log.error('AI Chat Error:', error);
      return sanitize({
        success: false,
        error: {
          code: 'AI_CHAT_ERROR',
          message: error.message || 'AI调用失败',
        },
      });
    }
  });

  ipcMain.handle('ai:analyzeAssessment', async (_event, rawParams: any) => {
    const params = sanitize(rawParams) as {
      controlPoint: string;
      requirement: string;
      command: string;
      result: string;
      screenshots?: string[];
      ocrPreprocess?: boolean;
    };
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      if (shouldValidateApiKey(config) && !config.apiKey) {
        throw new Error('API Key未配置');
      }

      const model = mode === 'local' ? (config.ollamaModel || config.model || '') : (config.model || '');
      const temperature = config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(getEffectiveApiBase(config, mode), mode);
      const apiKey = getApiKeyForMode(config);

      if (!apiUrl) throw new Error('API地址未配置');

      const privacyMode = config.privacyMode === 1;
      const ocrPreprocess = params.ocrPreprocess === true;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      params.screenshots = await validateScreenshotPaths(params.screenshots);
      let hasScreenshots = params.screenshots && params.screenshots.length > 0;

      const userContent: any[] = [];

      // OCR 预处理：提取截图中的文字
      let ocrText = '';
      if (hasScreenshots && ocrPreprocess) {
        log.info(`[OCR预处理] 开始提取截图文字，数量: ${params.screenshots!.length}`);
        const ocrResults = await extractTextFromMultipleImages(params.screenshots!, { preprocess: true });
        for (const { path: imgPath, result: ocrResult } of ocrResults) {
          const fileName = imgPath.split('\\').pop()?.split('/').pop() || 'unknown';
          if (ocrResult.text && ocrResult.text.trim().length > 0) {
            ocrText += `\n=== 截图 ${fileName} (OCR识别) ===\n${ocrResult.text}\n`;
          }
        }
        log.info(`[OCR预处理] 提取完成，总文字长度: ${ocrText.length}`);
      }

      if (hasScreenshots && privacyMode) {
        for (const screenshotPath of params.screenshots!) {
          const base64 = await desensitizeImage(screenshotPath);
          if (base64) {
            userContent.push({
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64}`,
              },
            });
          }
        }
        log.info(`[隐私模式] 截图已脱敏发送（OCR遮盖IP），数量: ${params.screenshots!.length}`);
      } else if (hasScreenshots && !ocrPreprocess) {
        for (const screenshotPath of params.screenshots!) {
          const base64 = await encodeImageToBase64(screenshotPath);
          if (base64) {
            userContent.push({
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64}`,
              },
            });
          }
        }
      }

      const screenshotCount = hasScreenshots ? params.screenshots!.length : 0;

      const evidenceText = privacyMode
        ? desensitizeText(params.result || '无文本内容', extraWords)
        : params.result || '无文本内容，请分析图片中的证据信息';

      // 构建用户内容，包含OCR提取的文字
      let contentText = `关键证据点内容：${evidenceText}`;
      if (ocrText && ocrText.trim().length > 0) {
        contentText += `\n\n[OCR预处理提取的截图文字]${ocrText}`;
      }
      if (!hasScreenshots && !ocrText) {
        contentText += '\n\n无截图，请根据文本内容进行分析';
      }

      userContent.push({
        type: 'text',
        text: contentText,
      });

      const controlPoint = privacyMode ? desensitizeText(params.controlPoint, extraWords) : params.controlPoint;
      const requirement = privacyMode ? desensitizeText(params.requirement, extraWords) : params.requirement;

      const systemPrompt = `你是一名专业的等级保护测评师。请根据以下信息撰写现场测评记录：

安全控制点：${controlPoint}
测评项（标准条款）：${requirement}

用户已在"关键证据点"中提供了核查证据（命令输出、配置信息、文件内容、截图等）。

请严格基于证据，撰写一段详实的测评记录。参考以下示例格式：

示例1：经核查，执行命令返回系统用户列表。root用户UID为0，存在多个系统账户。已确认/etc/shadow文件中所有用户均设置了口令，口令字段非空。身份鉴别信息具有唯一性。

示例2：经核查，/etc/login.defs中配置了FAIL_MAX_ENTRIES=5，FAIL_INTERVAL=300，表示连续登录失败5次后锁定账户300秒。

要求：
- 以"经核查，"或"经访谈，"开头（根据证据来源自动选择）
- 描述具体做了什么核查（执行了什么命令、查看了什么文件、检查了什么配置）
- 引用具体的配置参数、数值、版本、文件名
- 语句连贯、事实清晰，形成一段完整描述
- 必须根据实际证据情况，对测评项给出明确的符合性判定：符合/部分符合/不符合/不适用，绝不允许输出"证据不足"等模糊判定
- 严禁编造不存在的内容，所有结论必须有实际证据支撑
- 结论末尾不要写"均满足二级要求"、"综合判定：符合"、"符合等保二级要求"等总结性套话

请按照以下格式返回JSON结果（不要有其他说明文字）：
{
  "actualOutput": "从关键证据点中提取的核心内容摘要（如无相关内容则写'无相关证据'）",
  "keyEvidencePoints": [
    "具体描述1（仅列出与测评项相关的证据，不要用序号前缀，如: /etc/login.defs中配置了FAIL_MAX_ENTRIES=5）"
  ],
  "compliance": "符合/部分符合/不符合/不适用",
  "conclusion": "经核查，执行命令返回系统用户列表。root用户UID为0，存在多个系统账户。已确认/etc/shadow文件中所有用户均设置了口令，口令字段非空。身份鉴别信息具有唯一性。"
}`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

      const requestBody = JSON.stringify({
          model,
          messages,
          temperature,
        });
      const bodySizeKB = Buffer.byteLength(requestBody, 'utf8') / 1024;
      log.info(`[单条AI分析] 请求体大小: ${bodySizeKB.toFixed(1)} KB, 截图数: ${screenshotCount}`);

      // 计算动态超时
      let totalImageSizeKB = 0;
      if (hasScreenshots && params.screenshots) {
        for (const screenshotPath of params.screenshots) {
          try {
            const stats = await readFile(screenshotPath);
            totalImageSizeKB += stats.length / 1024;
          } catch (e) { /* ignore */ }
        }
      }
      const dynamicTimeout = calculateTimeout(1, screenshotCount, totalImageSizeKB, privacyMode);

      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        log.warn(`[单条AI分析] 请求超时(${dynamicTimeout}ms)，终止请求`);
        abortController.abort(new Error('请求超时'));
      }, dynamicTimeout);

      let response;
      try {
        const fetchStartTime = Date.now();
        response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: requestBody,
        signal: abortController.signal,
      });
        const elapsed = Date.now() - fetchStartTime;
        log.info(`[单条AI分析] fetch收到响应，耗时: ${elapsed}ms, 状态: ${response.status}`);
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError' || fetchError.message.includes('请求超时')) {
          throw new Error('AI分析超时，请检查网络连接或稍后重试');
        }
        throw fetchError;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API请求失败(${response.status}): ${apiUrl} - ${errorBody}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      try {
        writeOperationLog({
          action: 'ai_analyze',
          module: 'ai',
          targetName: params.controlPoint,
          description: `AI单条分析: 控制点=${params.controlPoint}, 截图数=${screenshotCount}, 隐私模式=${privacyMode ? '是' : '否'}`,
        });
      } catch (logErr: any) {
        log.error('[操作日志] 写入AI分析日志失败:', logErr.message);
      }

      return sanitize({ success: true, data: { content } });
    } catch (error: any) {
      log.error('AI分析错误:', error);
      return sanitize({
        success: false,
        error: {
          code: 'AI_ANALYZE_ERROR',
          message: error.message || 'AI分析失败',
        },
      });
    }
  });

  ipcMain.handle('ai:batchAnalyzeScreenshots', async (_event, rawParams: any) => {
    const params = sanitize(rawParams) as {
      items: { id: string; controlPoint: string; requirement: string }[];
      screenshots: string[];
      documents?: { name: string; content: string }[];
      ocrPreprocess?: boolean;
    };
    const ocrPreprocess = params.ocrPreprocess === true;

    const sendProgress = (data: { stage: string; message: string; percent: number }) => {
      currentProgress = { ...data, timestamp: Date.now() };
      try { _event.sender.send('ai:progress', data); } catch (innerErr: any) {
        log.warn('[批量分析] 发送进度失败:', innerErr.message);
      }
    };

    let heartbeatTimer: NodeJS.Timeout | null = null;
    const startHeartbeat = (startPercent: number, endPercent: number) => {
      let current = startPercent;
      heartbeatTimer = setInterval(() => {
        if (current < endPercent) {
          current += 1;
          sendProgress({ stage: 'sending', message: `正在提交给AI分析... (${current}%)`, percent: current });
        }
      }, 2000);
    };
    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    try {
      sendProgress({ stage: 'init', message: '正在读取配置...', percent: 5 });
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      if (shouldValidateApiKey(config) && !config.apiKey) {
        throw new Error('API Key未配置');
      }

      const model = mode === 'local' ? (config.ollamaModel || config.model || '') : (config.model || '');
      const temperature = config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(getEffectiveApiBase(config, mode), mode);
      const apiKey = getApiKeyForMode(config);

      if (!apiUrl) throw new Error('API地址未配置');

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      params.screenshots = await validateScreenshotPaths(params.screenshots);
      const hasImages = params.screenshots && params.screenshots.length > 0;

      // 计算图片总大小（用于动态超时）
      let totalImageSizeKB = 0;
      if (hasImages) {
        for (const screenshotPath of params.screenshots) {
          try {
            const stats = await readFile(screenshotPath);
            totalImageSizeKB += stats.length / 1024;
          } catch (e) {
            log.warn(`[批量分析] 无法读取图片大小: ${screenshotPath}`);
          }
        }
      }
      const dynamicTimeout = calculateTimeout(params.items.length, params.screenshots.length, totalImageSizeKB, privacyMode);
      log.info(`[批量AI分析] 动态超时: ${dynamicTimeout}ms (图片总大小: ${totalImageSizeKB.toFixed(1)}KB, 隐私模式: ${privacyMode})`);

      sendProgress({ stage: 'encoding', message: `正在编码文件...`, percent: 15 });
      if (privacyMode && params.screenshots && params.screenshots.length > 0) {
        log.info('[隐私模式] 批量分析截图将脱敏处理（OCR遮盖IP）后发送');
      }

      log.info(`批量AI分析 请求URL: ${apiUrl}, 模型: ${model}, 图片数: ${hasImages ? params.screenshots.length : 0}, 隐私模式: ${privacyMode}`);

      const userContent: any[] = [];
      const imageFileNames: string[] = [];
      const docFileNames: string[] = [];
      let encoded = 0;

      // OCR 预处理：提取截图中的文字
      let ocrText = '';
      if (hasImages && ocrPreprocess) {
        sendProgress({ stage: 'ocr', message: `正在OCR识别截图文字...`, percent: 10 });
        log.info(`[OCR预处理] 开始提取截图文字，数量: ${params.screenshots.length}`);
        const ocrResults = await extractTextFromMultipleImages(params.screenshots, { preprocess: true });
        for (const { path: imgPath, result: ocrResult } of ocrResults) {
          const fileName = imgPath.split('\\').pop()?.split('/').pop() || 'unknown';
          if (ocrResult.text && ocrResult.text.trim().length > 0) {
            ocrText += `\n=== 截图 ${fileName} (OCR识别) ===\n${ocrResult.text}\n`;
          }
        }
        log.info(`[OCR预处理] 提取完成，总文字长度: ${ocrText.length}`);
      }

      if (hasImages && !ocrPreprocess) {
        const concurrency = 3;
        const imagePaths = params.screenshots;
        const batches: string[][] = [];
        for (let i = 0; i < imagePaths.length; i += concurrency) {
          batches.push(imagePaths.slice(i, i + concurrency));
        }

        for (let b = 0; b < batches.length; b++) {
          const batch = batches[b];
          const results = await Promise.all(
            batch.map(async (screenshotPath) => {
              const fileName = screenshotPath.split('\\').pop()?.split('/').pop() || 'unknown';
              imageFileNames.push(fileName);

              const base64 = privacyMode
                ? await desensitizeImage(screenshotPath)
                : await encodeImageToBase64(screenshotPath);
              const base64Preview = base64 ? base64.substring(0, 50) + '...' : 'EMPTY';
              log.info(`[图片编码结果] ${screenshotPath}: ${base64Preview}`);
              return { screenshotPath, base64 };
            })
          );

          for (const { base64 } of results) {
            if (base64) {
              userContent.push({
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64}`,
                },
              });
            }
          }

          encoded += batch.length;
          const encodePercent = 15 + Math.round((encoded / params.screenshots.length) * 35);
          sendProgress({ stage: 'encoding', message: `正在编码文件 (${encoded}/${params.screenshots.length})...`, percent: encodePercent });
        }
      }

      const itemsJson = JSON.stringify(params.items.map(item => ({
        id: item.id,
        controlPoint: privacyMode ? desensitizeText(item.controlPoint, extraWords) : item.controlPoint,
        requirement: privacyMode ? desensitizeText(item.requirement, extraWords) : item.requirement,
      })));

      let docContent = '';
      if (params.documents && params.documents.length > 0) {
        for (const doc of params.documents) {
          const fileName = doc.name.split('\\').pop()?.split('/').pop() || doc.name;
          docFileNames.push(fileName);
          const content = privacyMode ? desensitizeText(doc.content, extraWords) : doc.content;
          docContent += `\n=== 文档：${doc.name} ===\n${content}\n`;
        }
      }

      let evidenceDesc = '';
      const allFileNames: string[] = [];
      if (hasImages && !ocrPreprocess) {
        allFileNames.push(...imageFileNames.map(f => `截图：${f}`));
      } else if (hasImages && ocrPreprocess) {
        allFileNames.push(...params.screenshots.map(f => `截图：${f.split('\\').pop()?.split('/').pop() || 'unknown'}`));
      }
      if (docFileNames.length > 0) {
        allFileNames.push(...docFileNames.map(f => `文档：${f}`));
      }
      if (allFileNames.length > 0) {
        const modeText = privacyMode ? '（已脱敏处理：OCR遮盖IP地址）' : '';
        const ocrTextNote = ocrPreprocess ? '（已通过OCR提取文字）' : '';
        evidenceDesc = `已提供 ${params.screenshots.length} 张截图${modeText}${ocrTextNote}。`;
        evidenceDesc += `\n\n文件列表（请根据分析结果，将相关的文件填入每个测评项的attachedFiles数组中）：\n${allFileNames.join('\n')}`;
      }
      if (docContent) {
        evidenceDesc += `\n\n文档文本内容：\n${docContent}`;
      }
      if (ocrText && ocrText.trim().length > 0) {
        evidenceDesc += `\n\n[OCR预处理提取的截图文字]\n${ocrText}`;
      }

      let promptText = `你是一名专业的等级保护测评师。请根据以下截图、文档内容，智能匹配到对应的测评项，并为每个匹配到的测评项撰写现场测评记录。

${evidenceDesc}

测评项列表：
${itemsJson}

请逐一仔细分析每张截图和文档的具体内容（界面文字、配置项、状态信息、数据等），智能判断内容与哪些测评项相关，然后为每个匹配到的测评项撰写一段详实的测评记录。

要求：
- 以"经核查，"或"经访谈，"开头（根据证据来源自动选择）
- 描述具体做了什么核查（执行了什么命令、查看了什么文件、检查了什么配置）
- 引用具体的配置参数、数值、版本、文件名
- 语句连贯、事实清晰，形成一段完整描述
- 智能匹配：匹配时必须仔细，且当只有内容与测评项相关时才返回该测评项的分析结果
- 如果截图/文档内容与某个测评项无关，不要返回该测评项的结果
- 一个截图/文档可能匹配多个测评项，某个测评项也可能匹配多个截图/文档
- 对于匹配到的测评项，必须根据实际证据情况给出明确的符合性判定：符合/部分符合/不符合
- 严禁编造不存在的内容，所有结论必须有实际证据支撑
- 结论末尾不要写"均满足二级要求"、"综合判定：符合"、"符合等保二级要求"等总结性套话
- 对于每个匹配到的测评项，必须从文件列表中选出与该测评项相关的截图或文档文件名，填入attachedFiles数组
- 如果某个文件与多个测评项相关，可以在多个测评项的attachedFiles中都列出该文件名

请严格按照以下JSON格式返回结果（不要有其他说明文字）：
{
  "results": [
    {
      "itemId": "匹配到的测评项ID",
      "keyEvidencePoints": [
        "具体描述1（仅列出与测评项相关的证据，如: FAIL_LOGIN_ENABLED=yes）"
      ],
      "attachedFiles": [
        "截图：截图文件名1.png",
        "文档：审计日志.docx"
      ],
      "compliance": "符合/部分符合/不符合",
      "conclusion": "经核查，/etc/login.defs中配置了FAIL_MAX_ENTRIES=5，FAIL_INTERVAL=300，表示连续登录失败5次后锁定账户300秒。"
    }
  ]
}`;

      userContent.push({ type: 'text', text: promptText });

      const messages = [
        { role: 'system', content: '你是一名专业的等级保护测评师。请严格按照要求的JSON格式返回详细的分析结果。' },
        { role: 'user', content: userContent },
      ];

      const batchRequestBody = JSON.stringify({
          model,
          messages,
          temperature,
        });

      const bodySizeKB = Buffer.byteLength(batchRequestBody, 'utf8') / 1024;
      const hasApiKey = !!getApiKeyForMode(config);
      log.info(`[批量AI分析] 请求体大小: ${bodySizeKB.toFixed(1)} KB, 用户内容项数: ${userContent.length}, 动态超时: ${dynamicTimeout}ms, API Key: ${hasApiKey ? '已配置' : '未配置'}`);

      sendProgress({ stage: 'sending', message: '正在提交给AI分析...', percent: 60 });

      log.info(`[批量AI分析] 开始发送fetch请求... URL: ${apiUrl}`);
      const fetchStartTime = Date.now();

      startHeartbeat(61, 90);

      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        log.warn(`[批量AI分析] 请求超时(${dynamicTimeout}ms)，终止请求`);
        abortController.abort(new Error('请求超时'));
      }, dynamicTimeout);

      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: batchRequestBody,
          signal: abortController.signal,
        });
        const elapsed = Date.now() - fetchStartTime;
        log.info(`[批量AI分析] fetch收到响应，耗时: ${elapsed}ms, 状态: ${response.status}`);
      } catch (fetchError: any) {
        const elapsed = Date.now() - fetchStartTime;
        log.error(`[批量AI分析] fetch请求失败，耗时: ${elapsed}ms, 错误: ${fetchError.name}: ${fetchError.message}`);
        stopHeartbeat();
        throw fetchError;
      } finally {
        clearTimeout(timeout);
      }

      stopHeartbeat();
      sendProgress({ stage: 'receiving', message: 'AI正在分析中...', percent: 90 });
      log.info(`[批量AI分析] 开始读取响应体...`);
      const responseText = await response.text();
      log.info(`[批量AI分析] 响应体大小: ${Buffer.byteLength(responseText, 'utf8') / 1024} KB`);
      
      sendProgress({ stage: 'parsing', message: '正在解析AI结果...', percent: 95 });

      if (!response.ok) {
        log.error(`[批量AI分析] API返回错误状态: ${response.status}, 响应: ${responseText.substring(0, 500)}`);
        throw new Error(`API请求失败(${response.status}): ${apiUrl} - ${responseText}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError: any) {
        log.error(`[批量AI分析] JSON解析失败: ${parseError?.message || parseError}, 响应: ${responseText.substring(0, 500)}`);
        throw new Error('AI返回数据格式错误');
      }
      sendProgress({ stage: 'parsing', message: '正在解析AI结果...', percent: 95 });

      const content = data.choices?.[0]?.message?.content || '';

      sendProgress({ stage: 'done', message: '分析完成', percent: 100 });

      try {
        writeOperationLog({
          action: 'ai_batch_analyze',
          module: 'ai',
          description: `AI批量分析: 测评项数=${params.items.length}, 截图数=${params.screenshots.length}, 文档数=${params.documents?.length || 0}, 隐私模式=${privacyMode ? '是' : '否'}`,
        });
      } catch (logErr: any) {
        log.error('[操作日志] 写入批量分析日志失败:', logErr.message);
      }

      return sanitize({ success: true, data: { content } });
    } catch (error: any) {
      sendProgress({ stage: 'error', message: error.message || '分析失败', percent: 0 });
      log.error('批量AI分析错误:', error);
      return sanitize({
        success: false,
        error: {
          code: 'AI_BATCH_ERROR',
          message: error.message || 'AI分析失败',
        },
      });
    }
  });

  ipcMain.handle('ai:analyzeIssue', async (_event, rawParams: {
    issueId: string;
    issueTitle: string;
    issueDescription: string;
    securityDomain: string;
    controlPoint: string;
    controlName: string;
  }) => {
    try {
      const params = sanitize(rawParams);
      log.info('[ai:analyzeIssue] 调用参数:', JSON.stringify({
        issueId: params.issueId,
        securityDomain: params.securityDomain,
        controlPoint: params.controlPoint,
        controlName: params.controlName,
      }));
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      if (shouldValidateApiKey(config) && !config.apiKey) {
        throw new Error('API Key未配置');
      }

      const model = config.mode === 'local' ? (config.ollamaModel || config.model || '') : (config.model || '');
      const temperature = config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(getEffectiveApiBase(config), mode);
      const apiKey = getApiKeyForMode(config);
      if (!apiUrl) throw new Error('API地址未配置');

      log.info('[ai:analyzeIssue] AI配置:', JSON.stringify({
        model,
        temperature,
        mode,
        privacyMode: config.privacyMode === 1,
      }));

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];

      const issueTitle = privacyMode ? desensitizeText(params.issueTitle, extraWords) : params.issueTitle;
      const issueDescription = privacyMode ? desensitizeText(params.issueDescription, extraWords) : params.issueDescription;
      const securityDomain = privacyMode ? desensitizeText(params.securityDomain, extraWords) : params.securityDomain;
      const controlPoint = privacyMode ? desensitizeText(params.controlPoint, extraWords) : params.controlPoint;
      const controlName = privacyMode ? desensitizeText(params.controlName, extraWords) : params.controlName;

      const systemPrompt = `你是一名专业的等级保护测评师。请根据以下问题信息，撰写一段连贯的整改建议：

问题标题：${issueTitle}
安全域：${securityDomain}
控制点：${controlPoint}
控制项：${controlName}
问题描述：${issueDescription}

要求：
- 以"整改措施："开头
- 描述具体的整改措施（需要执行什么操作、修改什么配置、部署什么安全机制等）
- 引用具体的技术手段、配置命令、安全产品或防护措施
- 包含整改优先级和注意事项
- 语句连贯、逻辑清晰，形成一段完整的整改建议描述
- 严禁编造不存在的内容，所有建议必须基于问题描述中的实际情况
- 不要分点列举，保持段落形式

请以纯文本形式返回整改建议（不需要JSON格式）。`;

      const requestBody = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一名专业的等级保护测评师，擅长撰写连贯的安全整改建议描述。请以纯文本段落形式返回整改建议，不需要JSON格式。' },
          { role: 'user', content: systemPrompt },
        ],
        temperature,
      });

      log.info('[ai:analyzeIssue] 发送API请求, 请求体大小:', Buffer.byteLength(requestBody, 'utf8'), 'bytes');

      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        log.warn('[ai:analyzeIssue] 请求超时(60s)，终止请求');
        abortController.abort(new Error('请求超时'));
      }, 60000);

      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: requestBody,
          signal: abortController.signal,
        });
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') throw new Error('AI分析超时');
        throw fetchError;
      } finally {
        clearTimeout(timeout);
      }

      log.info('[ai:analyzeIssue] API响应状态:', response.status);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API请求失败(${response.status}): ${errorBody}`);
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content || '';
      // 移除所有前导换行符和回车符
      content = content.replace(/^[\r\n]+/, '').trim();

      log.info('[ai:analyzeIssue] AI返回内容长度:', content.length);

      try {
        writeOperationLog({
          action: 'ai_analyze_issue',
          module: 'ai',
          targetName: params.issueTitle,
          description: `AI分析问题整改建议: ${params.issueTitle}`,
        });
      } catch (logErr: any) {
        log.error('[操作日志] 写入AI分析问题日志失败:', logErr.message);
      }

      return sanitize({ success: true, data: { content } });
    } catch (error: any) {
      log.error('[ai:analyzeIssue] 错误:', error.message);
      log.error('AI分析问题错误:', error);
      return sanitize({
        success: false,
        error: { code: 'AI_ANALYZE_ISSUE_ERROR', message: error.message || 'AI分析失败' },
      });
    }
  });

  ipcMain.handle('ai:analyzeIssueDescription', async (_event, rawParams: {
    issueId: string;
    issueTitle: string;
    issueDescription: string;
    securityDomain: string;
    controlPoint: string;
    controlName: string;
  }) => {
    try {
      const params = sanitize(rawParams);
      log.info('[ai:analyzeIssueDescription] 调用参数:', JSON.stringify({
        issueId: params.issueId,
        securityDomain: params.securityDomain,
        controlPoint: params.controlPoint,
        controlName: params.controlName,
      }));
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      if (shouldValidateApiKey(config) && !config.apiKey) {
        throw new Error('API Key未配置');
      }

      const model = config.mode === 'local' ? (config.ollamaModel || config.model || '') : (config.model || '');
      const temperature = config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(getEffectiveApiBase(config), mode);
      const apiKey = getApiKeyForMode(config);
      if (!apiUrl) throw new Error('API地址未配置');

      log.info('[ai:analyzeIssueDescription] AI配置:', JSON.stringify({
        model,
        temperature,
        mode,
        privacyMode: config.privacyMode === 1,
      }));

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];

      const issueTitle = privacyMode ? desensitizeText(params.issueTitle, extraWords) : params.issueTitle;
      const issueDescription = privacyMode ? desensitizeText(params.issueDescription, extraWords) : params.issueDescription;
      const securityDomain = privacyMode ? desensitizeText(params.securityDomain, extraWords) : params.securityDomain;
      const controlPoint = privacyMode ? desensitizeText(params.controlPoint, extraWords) : params.controlPoint;
      const controlName = privacyMode ? desensitizeText(params.controlName, extraWords) : params.controlName;

      const systemPrompt = `你是一名专业的等级保护测评师。请根据以下问题信息，提取出一句话的核心问题描述。

问题标题：${issueTitle}
安全域：${securityDomain}
控制点：${controlPoint}
控制项：${controlName}
当前问题描述：${issueDescription}

要求：
- 用一句话（不超过50字）概括问题的本质
- 直接指出安全风险或合规缺失，不要描述核查过程
- 不要包含"经核查"、"经访谈"等前缀
- 不要包含具体命令、路径等细节信息
- 聚焦于"存在什么风险"或"缺少什么防护"

示例：
- "SSH登录失败锁定策略未配置，存在暴力破解风险"
- "系统密码复杂度策略未启用，易受字典攻击"
- "日志审计功能未开启，无法追溯安全事件"

请直接返回问题描述文本，不要JSON格式，不要解释。`;

      const requestBody = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一名专业的等级保护测评师，擅长从问题信息中提炼核心安全问题和风险描述。' },
          { role: 'user', content: systemPrompt },
        ],
        temperature,
      });

      log.info('[ai:analyzeIssueDescription] 发送API请求, 请求体大小:', Buffer.byteLength(requestBody, 'utf8'), 'bytes');

      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        log.warn('[ai:analyzeIssueDescription] 请求超时(60s)，终止请求');
        abortController.abort(new Error('请求超时'));
      }, 60000);

      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: requestBody,
          signal: abortController.signal,
        });
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') throw new Error('AI分析超时');
        throw fetchError;
      } finally {
        clearTimeout(timeout);
      }

      log.info('[ai:analyzeIssueDescription] API响应状态:', response.status);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API请求失败(${response.status}): ${errorBody}`);
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content || '';
      // 移除所有前导换行符和回车符
      content = content.replace(/^[\r\n]+/, '').trim().replace(/^["'"']|["'"']$/g, '');

      log.info('[ai:analyzeIssueDescription] AI返回内容长度:', content.length);

      try {
        writeOperationLog({
          action: 'ai_analyze_issue_description',
          module: 'ai',
          targetName: params.issueTitle,
          description: `AI分析问题描述: ${params.issueTitle}`,
        });
      } catch (logErr: any) {
        log.error('[操作日志] 写入AI分析问题描述日志失败:', logErr.message);
      }

      return sanitize({ success: true, data: { content } });
    } catch (error: any) {
      log.error('[ai:analyzeIssueDescription] 错误:', error.message);
      log.error('AI分析问题描述错误:', error);
      return sanitize({
        success: false,
        error: { code: 'AI_ANALYZE_ISSUE_DESC_ERROR', message: error.message || 'AI分析失败' },
      });
    }
  });

  ipcMain.handle('ai:batchAnalyzeIssues', async (_event, rawParams: {
    issues: Array<{
      issueId: string;
      issueTitle: string;
      issueDescription: string;
      securityDomain: string;
      controlPoint: string;
      controlName: string;
    }>;
  }) => {
    const sendProgress = (data: { stage: string; message: string; percent: number; current: number; total: number }) => {
      currentProgress = { ...data, timestamp: Date.now() };
      try { _event.sender.send('ai:batchIssueProgress', data); } catch (innerErr: any) {
        log.warn('[批量问题分析] 发送进度失败:', innerErr.message);
      }
    };

    try {
      const params = sanitize(rawParams);
      const total = params.issues.length;
      const results: Array<{ issueId: string; suggestion: string; success: boolean; error?: string }> = [];

      log.info('[ai:batchAnalyzeIssues] 开始批量分析, 问题总数:', total);

      sendProgress({ stage: 'init', message: '正在读取配置...', percent: 0, current: 0, total });

      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      if (shouldValidateApiKey(config) && !config.apiKey) {
        throw new Error('API Key未配置');
      }

      const model = config.mode === 'local' ? (config.ollamaModel || config.model || '') : (config.model || '');
      const temperature = config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(getEffectiveApiBase(config), mode);
      const apiKey = getApiKeyForMode(config);
      if (!apiUrl) throw new Error('API地址未配置');

      log.info('[ai:batchAnalyzeIssues] AI配置:', JSON.stringify({
        model,
        temperature,
        mode,
        privacyMode: config.privacyMode === 1,
      }));

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < params.issues.length; i++) {
        const issue = params.issues[i];
        sendProgress({
          stage: 'analyzing',
          message: `正在分析: ${issue.issueTitle}`,
          percent: Math.round((i / total) * 100),
          current: i + 1,
          total,
        });

        try {
          log.info(`[ai:batchAnalyzeIssues] [${i + 1}/${total}] 开始分析`);

          const issueTitle = privacyMode ? desensitizeText(issue.issueTitle, extraWords) : issue.issueTitle;
          const issueDescription = privacyMode ? desensitizeText(issue.issueDescription, extraWords) : issue.issueDescription;
          const securityDomain = privacyMode ? desensitizeText(issue.securityDomain, extraWords) : issue.securityDomain;
          const controlPoint = privacyMode ? desensitizeText(issue.controlPoint, extraWords) : issue.controlPoint;
          const controlName = privacyMode ? desensitizeText(issue.controlName, extraWords) : issue.controlName;

          const systemPrompt = `你是一名专业的等级保护测评师。请根据以下问题信息，撰写一段连贯的整改建议：

问题标题：${issueTitle}
安全域：${securityDomain}
控制点：${controlPoint}
控制项：${controlName}
问题描述：${issueDescription}

要求：
- 以"整改措施："开头
- 描述具体的整改措施（需要执行什么操作、修改什么配置、部署什么安全机制等）
- 引用具体的技术手段、配置命令、安全产品或防护措施
- 包含整改优先级和注意事项
- 语句连贯、逻辑清晰，形成一段完整的整改建议描述
- 严禁编造不存在的内容，所有建议必须基于问题描述中的实际情况
- 不要分点列举，保持段落形式

请以纯文本形式返回整改建议（不需要JSON格式）。`;

          const requestBody = JSON.stringify({
            model,
            messages: [
              { role: 'system', content: '你是一名专业的等级保护测评师，擅长撰写连贯的安全整改建议描述。请以纯文本段落形式返回整改建议，不需要JSON格式。' },
              { role: 'user', content: systemPrompt },
            ],
            temperature,
          });

          const abortController = new AbortController();
          const timeout = setTimeout(() => abortController.abort(new Error('请求超时')), 60000);

          let response;
          try {
            response = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: requestBody,
              signal: abortController.signal,
            });
          } catch (fetchError: any) {
            if (fetchError.name === 'AbortError') throw new Error('AI分析超时');
            throw fetchError;
          } finally {
            clearTimeout(timeout);
          }

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(`API请求失败(${response.status}): ${errorBody}`);
          }

          const data = await response.json();
          // 移除所有前导换行符和回车符
          const content = (data.choices?.[0]?.message?.content || '').replace(/^[\r\n]+/, '').trim();
          results.push({ issueId: issue.issueId, suggestion: content, success: true });
          successCount++;
          log.info(`[ai:batchAnalyzeIssues] [${i + 1}/${total}] 分析成功, 返回内容长度: ${content.length}`);
        } catch (error: any) {
          results.push({ issueId: issue.issueId, suggestion: '', success: false, error: error.message });
          failCount++;
          log.error(`[ai:batchAnalyzeIssues] [${i + 1}/${total}] 分析失败: ${error.message}`);
        }
      }

      sendProgress({ stage: 'done', message: '分析完成', percent: 100, current: total, total });

      log.info(`[ai:batchAnalyzeIssues] 批量分析完成, 成功: ${successCount}, 失败: ${failCount}`);

      try {
        writeOperationLog({
          action: 'ai_batch_analyze_issues',
          module: 'ai',
          description: `AI批量分析问题: 总数=${total}, 成功=${results.filter(r => r.success).length}`,
        });
      } catch (logErr: any) {
        log.error('[操作日志] 写入批量问题分析日志失败:', logErr.message);
      }

      return sanitize({ success: true, data: { results } });
    } catch (error: any) {
      sendProgress({ stage: 'error', message: error.message || '分析失败', percent: 0, current: 0, total: rawParams.issues?.length || 0 });
      log.error('[ai:batchAnalyzeIssues] 错误:', error.message);
      log.error('AI批量分析问题错误:', error);
      return sanitize({
        success: false,
        error: { code: 'AI_BATCH_ISSUE_ERROR', message: error.message || 'AI批量分析失败' },
      });
    }
  });

  // OCR 相关 IPC 处理器
  ipcMain.handle('ocr:extractText', async (_event, imagePath: string, options?: any) => {
    try {
      const result = await extractTextFromImage(imagePath, options);
      return sanitize({ success: true, data: result });
    } catch (err: any) {
      log.error('[OCR] 提取文本失败:', err.message);
      return sanitize({ success: false, error: { code: 'OCR_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ocr:extractTextFromMultiple', async (_event, imagePaths: string[], options?: any) => {
    try {
      const results = await extractTextFromMultipleImages(imagePaths, options);
      return sanitize({ success: true, data: results });
    } catch (err: any) {
      log.error('[OCR] 批量提取文本失败:', err.message);
      return sanitize({ success: false, error: { code: 'OCR_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ocr:isEnabled', async () => {
    return sanitize({ success: true, data: isOCREnabled() });
  });
}