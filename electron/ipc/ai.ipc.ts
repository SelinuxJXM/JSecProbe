import { ipcMain, safeStorage } from 'electron';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { readFile, stat } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import sharp from 'sharp';
import { writeOperationLog } from '../utils/operation-log';
import { resolvePath, validateDataPath } from '../utils/path-resolver';
import { requireSession } from '../utils/auth-guard';
import { wrap as globalWrap } from '../utils/ipc-wrapper';
import { getDbPath } from '../main/paths';
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
  getHerdsmanStatus,
  startHerdsman,
  testHerdsmanConnection,
  getInstallGuide as getHerdsmanInstallGuide,
  RECOMMENDED_MODELS as HERDSMAN_RECOMMENDED_MODELS,
  HERDSMAN_DEFAULT_URL,
} from '../services/herdsman.service';
import {
  extractTextFromImage,
  extractTextFromMultipleImages,
  isOCREnabled,
  getSharedWorker,
} from '../services/ocr.service';
import { extractTextFromFile } from '../utils/text-extract';
import { aiFetch, isValidProxyMode, parseProxyUrl, syncAiProxyFromDb } from '../services/ai-net.service';
import {
  BUILTIN_PROMPTS,
  MAX_PROMPT_LENGTH,
  getPromptTemplate,
  isValidPromptKey,
  renderTemplate as renderPromptTemplate,
  validateTemplate,
} from '../services/ai-prompt.service';
import { ASSET_CATEGORIES } from '../../shared/asset-categories';
import { computeComplianceStats } from '../services/compliance-stats';

// ====== 工作台确定性预警规则（纯常量，模块顶层，便于单测与复用）======
// 5 条规则：后端判定预警本体，AI 仅对命中项补充处置建议，不得新增/删除预警
interface AlertRule {
  key: string;
  severity: string;
  title: string;
  detail: (s: {
    overdueCount: number; highOverdue: number; medOverdue: number; lowOverdue: number;
    highRiskOpenCount: number; stalledCount: number; draftCount: number;
    recentProjectsCount: number;
  }) => string;
}
const ALERT_RULES: AlertRule[] = [
  { key: 'overdue_rectification', severity: 'high', title: '整改逾期预警', detail: (s) => `尚有 ${s.overdueCount} 条问题已逾整改期限仍未关闭（高风险 ${s.highOverdue} / 中风险 ${s.medOverdue} / 低风险 ${s.lowOverdue}）` },
  { key: 'high_risk_open', severity: 'high', title: '高风险未处理预警', detail: (s) => `尚有 ${s.highRiskOpenCount} 条高风险问题处于未处理或整改中状态` },
  { key: 'stalled_projects', severity: 'medium', title: '项目长期停滞预警', detail: (s) => `${s.stalledCount} 个进行中项目近 30 天无任何数据更新` },
  { key: 'draft_backlog', severity: 'medium', title: '草稿项目积压预警', detail: (s) => `${s.draftCount} 个项目仍为草稿状态（未启动测评）` },
  { key: 'trend_cold', severity: 'low', title: '项目活跃度预警', detail: () => `近 6 个月未新建任何项目` },
];

const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// 互斥锁：防止同一 AI 分析通道并发触发（如连续点击）造成重复请求/结果覆盖
type AiLockKey = 'dashboardInsight' | 'explainStandardDiff' | 'standardComplianceGap';
const aiLocks = new Map<AiLockKey, boolean>();

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

// 从 AI 自由文本中稳健地提取顶层 JSON 对象（去代码块包裹 + 按大括号配平 + 兜底截取）
// 避免「首个 { 到末个 }」在内容含数组/嵌套大括号时多截取导致的解析失败
function extractAiJson(text: string, label: string): Record<string, any> {
  let s = String(text ?? '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const firstOpen = s.indexOf('{');
  if (firstOpen === -1) throw new Error(`${label} 返回格式异常：未找到 JSON 对象`);
  const start = firstOpen;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = false; }
    } else {
      if (c === '"') { inStr = true; }
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
  }
  if (end === -1) end = s.lastIndexOf('}');
  if (end <= start) throw new Error(`${label} 返回格式异常：JSON 不完整`);
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (e: any) {
    throw new Error(`${label} 返回格式异常：JSON 解析失败（${e?.message || ''}）`);
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

// 获取当前操作者身份（用于操作日志溯源）
// 单用户桌面应用：主进程把活动会话持久化到 session.json（与 AuthService 同一数据源），
// 文件内已含 userId 与 username，直接读取即可，无需再查 users 表二次解析。
function getCurrentOperator(): { username?: string; userId?: string } | null {
  try {
    const sessionFile = path.join(path.dirname(getDbPath()), 'session.json');
    if (!fs.existsSync(sessionFile)) return null;
    const raw = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    if (!raw?.username) return null;
    return { userId: raw.userId, username: raw.username };
  } catch {
    return null;
  }
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

    const worker = await getSharedWorker('chi_sim+eng');
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

const MAX_CHAT_DOC_TEXT_LENGTH = 200 * 1024;

async function buildChatMessageContent(msg: { role: string; content: string; attachments?: Array<{ name: string; path: string; type: 'image' | 'document' }> }): Promise<any> {
  const attachments = msg.attachments || [];
  if (msg.role !== 'user' || attachments.length === 0) {
    return msg.content;
  }

  const userContent: any[] = [];
  const docBlocks: string[] = [];
  const failedDocs: string[] = [];

  for (const att of attachments) {
    try {
      const absPath = await resolvePath(att.path);
      if (att.type === 'image') {
        const base64 = await encodeImageToBase64(absPath);
        if (base64) {
          userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } });
        } else {
          failedDocs.push(`${att.name}（图片读取失败）`);
        }
      } else {
        let text = await extractTextFromFile(absPath);
        if (text.length > MAX_CHAT_DOC_TEXT_LENGTH) {
          text = text.slice(0, MAX_CHAT_DOC_TEXT_LENGTH) + '\n...(内容过长已截断)';
        }
        docBlocks.push(`--- 附件: ${att.name} ---\n${text}\n--- 附件结束 ---`);
      }
    } catch (err: any) {
      log.error('[ai:chat] 附件处理失败:', att.name, err.message);
      failedDocs.push(`${att.name}（读取失败: ${err.message}）`);
    }
  }

  let textContent = msg.content || '';
  if (docBlocks.length > 0) {
    textContent = `${textContent}\n\n${docBlocks.join('\n\n')}`.trim();
  }
  if (failedDocs.length > 0) {
    textContent = `${textContent}\n\n[以下附件读取失败，未包含在上下文中: ${failedDocs.join('; ')}]`.trim();
  }

  if (userContent.length === 0) {
    return textContent || msg.content;
  }

  userContent.push({ type: 'text', text: textContent || '请分析以上附件内容' });
  return userContent;
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
  // 匹配任意版本段（/v1、/v4 等），如 /openai/v4 → /openai/v4/chat/completions
  if (/\/v\d+(\/|$)/.test(base)) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function getApiKeyForMode(config: any): string {
  if (config.mode === 'local') {
    // 本地模式固定使用 'ollama' 作为 API key：
    // - Ollama 服务端校验该值
    // - Herdsman 网关默认不强制鉴权（实测任意值均可访问），后续若启用 Token Router 需在此补充
    return 'ollama';
  }
  return config.apiKey || '';
}

/** 本地引擎解析：ollama=Ollama / herdsman=Herdsman(牧马人) */
function resolveLocalEngine(config: any): 'ollama' | 'herdsman' {
  return config.localEngine === 'herdsman' ? 'herdsman' : 'ollama';
}

function getLocalEngineUrl(config: any): string {
  return resolveLocalEngine(config) === 'herdsman'
    ? (config.herdsmanUrl || HERDSMAN_DEFAULT_URL)
    : (config.ollamaUrl || 'http://localhost:11434');
}

function getLocalEngineModel(config: any): string {
  return resolveLocalEngine(config) === 'herdsman'
    ? (config.herdsmanModel || config.model || '')
    : (config.ollamaModel || config.model || '');
}

function getEffectiveApiBase(config: any, mode?: string): string {
  const effectiveMode = mode || config.mode || 'cloud';
  if (effectiveMode === 'local') {
    return `${getLocalEngineUrl(config).replace(/\/+$/, '')}/v1`;
  }
  return config.apiBase || '';
}

function shouldValidateApiKey(config: any): boolean {
  return config.mode !== 'local';
}

function getEffectiveModel(params: any, config: any): string {
  if (config.mode === 'local') {
    return getLocalEngineModel(config) || params.model || config.model || '';
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

function wrap<T>(event: any, fn: () => T | Promise<T>): Promise<any> {
  // 统一走全局 wrap：默认 requireAuth: true（受信来源校验），与全应用 IPC 鉴权契约一致，
  // 拦截非受信来源（如被注入的恶意网页）调用 AI 通道；同时保留响应体脱敏（sanitize）。
  const handler = globalWrap(async () => fn() as any, { moduleName: 'ai', requireAuth: true });
  return handler(event).then(sanitize);
}

/**
 * API Key 加解密：使用 safeStorage（Windows DPAPI）落库加密。
 * - 加密值带 'enc:v1:' 前缀，未带前缀的视为旧版明文（兼容，下次保存时自动转加密）
 * - safeStorage 不可用时降级为明文保存
 */
const API_KEY_ENC_PREFIX = 'enc:v1:';

function encryptApiKey(plain: string): string {
  if (!plain || plain.startsWith(API_KEY_ENC_PREFIX)) return plain;
  try {
    if (!safeStorage.isEncryptionAvailable()) return plain;
    return API_KEY_ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch (e) {
    log.warn('[AI] 加密 API Key 失败，将以明文保存:', e);
    return plain;
  }
}

function decryptApiKey(stored: string): string {
  if (!stored || !stored.startsWith(API_KEY_ENC_PREFIX)) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(API_KEY_ENC_PREFIX.length), 'base64'));
  } catch (e) {
    log.error('[AI] 解密 API Key 失败（密文可能损坏或系统凭据变更），请重新填写 API Key:', e);
    return '';
  }
}

function maskApiKey(key: string): string {
  return key.length > 12 ? key.substring(0, 4) + '****' + key.substring(key.length - 4) : '****';
}

/**
 * 规范化从数据库读取的 aiConfigs 配置：
 * - mode 强制为 'cloud' | 'local'
 * - 数值字段强制为 number
 * - 字符串字段兜底空串
 * - privacyMode/ocrPreprocess 强制为 0/1
 * - apiKey 解密（兼容旧明文）
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
    apiKey: decryptApiKey(toStr(raw.apiKey)),
    apiBase: toStr(raw.apiBase),
    model: toStr(raw.model, 'gpt-4o-mini'),
    provider: toStr(raw.provider, 'openai'),
    ollamaUrl: toStr(raw.ollamaUrl, 'http://localhost:11434'),
    ollamaModel: raw.ollamaModel || null,
    localEngine: raw.localEngine === 'herdsman' ? 'herdsman' : 'ollama',
    herdsmanUrl: toStr(raw.herdsmanUrl, HERDSMAN_DEFAULT_URL),
    herdsmanModel: raw.herdsmanModel || null,
    temperature: toNum(raw.temperature, 0.3),
    privacyMode: toInt(raw.privacyMode),
    ocrPreprocess: toInt(raw.ocrPreprocess),
    sensitiveWords: toStr(raw.sensitiveWords),
  };
}



export function registerAIHandlers(): void {
  /**
   * 云端模型故障转移：按 priority 顺序依次尝试，全部失败才抛错。
   * 返回 { success, modelId, modelName, content, error }
   */
  async function callWithFailover(params: {
    messages: any[];
    temperature?: number;
    mode?: string;
    config?: any;
  }): Promise<{ success: boolean; modelId?: string; modelName?: string; content: string; error?: string }> {
    const { messages, temperature = 0.3, mode = 'cloud', config } = params;
    const db = getDb();

    // 优先使用云端模型列表（mode === 'cloud'）
    if (mode === 'cloud') {
      const activeModelId = config?.activeModelId || null;
      const cloudModels = await db.select().from(schema.aiCloudModels)
        .where(eq(schema.aiCloudModels.configId, 'default'))
        .orderBy(schema.aiCloudModels.priority)
        .all();

      if (cloudModels.length > 0) {
        // 构建尝试队列：先 activeModelId（如果有效），然后按 priority 排序的所有启用模型
        const enabledModels = cloudModels.filter(m => m.enabled === 1);
        const attemptOrder = [...enabledModels];
        // 确保 activeModelId 排在最前面（如果存在且启用）
        if (activeModelId) {
          const activeIdx = attemptOrder.findIndex(m => m.id === activeModelId);
          if (activeIdx >= 0) {
            const [active] = attemptOrder.splice(activeIdx, 1);
            attemptOrder.unshift(active);
          }
        }

        let lastError = '';
        for (const model of attemptOrder) {
          const apiKey = model.apiKey ? decryptApiKey(model.apiKey) : '';
          if (!apiKey) {
            log.warn(`[AI故障转移] 模型 ${model.name} 缺少 API Key，跳过`);
            lastError = `模型 ${model.name} 缺少 API Key`;
            continue;
          }
          const apiUrl = ensureApiUrl(model.apiBase, mode);
          if (!apiUrl) {
            log.warn(`[AI故障转移] 模型 ${model.name} API 地址无效，跳过`);
            lastError = `模型 ${model.name} API 地址无效`;
            continue;
          }

          try {
            const requestBody = JSON.stringify({
              model: model.model,
              messages,
              temperature,
            });
            const bodySizeKB = Buffer.byteLength(requestBody, 'utf8') / 1024;
            log.info(`[AI故障转移] 尝试模型: ${model.name} (${model.model}), URL: ${apiUrl}, 请求体: ${bodySizeKB.toFixed(1)}KB`);

            const response = await aiFetch(apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: requestBody,
            });

            if (!response.ok) {
              const errorBody = await response.text().catch(() => '');
              throw new Error(`API请求失败(${response.status}): ${errorBody}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            log.info(`[AI故障转移] 模型 ${model.name} 调用成功, 返回内容长度: ${content.length}字符`);
            return { success: true, modelId: model.id, modelName: model.name, content };
          } catch (error: any) {
            log.warn(`[AI故障转移] 模型 ${model.name} 失败: ${error.message}`);
            lastError = error.message || String(error);
            continue; // 尝试下一个
          }
        }

        // 所有云端模型都失败
        throw new Error(`云端模型全部失败（共 ${attemptOrder.length} 个）。最近错误：${lastError}`);
      }
    }

    // 本地模式或没有云端模型时，回退到原有逻辑
    if (mode === 'local' && config) {
      const model = getLocalEngineModel(config);
      const apiUrl = `${getLocalEngineUrl(config).replace(/\/+$/, '')}/v1`;
      const apiKey = 'ollama';

      try {
        const requestBody = JSON.stringify({
          model,
          messages,
          temperature,
        });
        const response = await aiFetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: requestBody,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(`本地引擎请求失败(${response.status}): ${errorBody}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        return { success: true, modelName: model, content };
      } catch (error: any) {
        throw error;
      }
    }

    // 兜底：使用 config 中的单一模型配置（向后兼容）
    if (config) {
      const model = mode === 'local' ? getLocalEngineModel(config) : (config.model || '');
      const apiUrl = ensureApiUrl(getEffectiveApiBase(config, mode), mode);
      const apiKey = getApiKeyForMode(config);

      const requestBody = JSON.stringify({
        model,
        messages,
        temperature,
      });
      const response = await aiFetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: requestBody,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API请求失败(${response.status}): ${errorBody}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return { success: true, modelName: model, content };
    }

    throw new Error('未配置任何可用的 AI 模型');
  }

  /**
   * 解析云端可用的模型端点列表（供除 ai:chat 外的其它 AI 功能做故障转移）。
   * 规则与 callWithFailover 保持一致：过滤禁用 → 激活模型优先 → 其余按 priority 升序。
   * 本地模式或云端无可用模型时返回空数组（调用方走单端点兜底逻辑）。
   */
  async function resolveCloudEndpoints(config: any): Promise<Array<{ id: string; name: string; model: string; apiBase: string; apiKey: string }>> {
    const db = getDb();
    const activeModelId = config?.activeModelId || null;
    const cloudModels = await db.select().from(schema.aiCloudModels)
      .where(eq(schema.aiCloudModels.configId, 'default'))
      .orderBy(schema.aiCloudModels.priority)
      .all();
    const enabled = cloudModels.filter(m => m.enabled === 1);
    if (enabled.length === 0) return [];

    const order = [...enabled];
    if (activeModelId) {
      const idx = order.findIndex(m => m.id === activeModelId);
      if (idx >= 0) {
        const [active] = order.splice(idx, 1);
        order.unshift(active);
      }
    }

    return order
      .map(m => {
        const apiKey = m.apiKey ? decryptApiKey(m.apiKey) : '';
        const apiBase = m.apiBase || '';
        return apiKey && apiBase
          ? { id: m.id, name: m.name || m.model, model: m.model, apiBase, apiKey }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  /**
   * 通用故障转移执行器：对候选端点逐个尝试，失败自动切换到下一个。
   * - 本地模式：使用 config 中的 Ollama 单端点（不参与故障转移）
   * - 云端模式：遍历 resolveCloudEndpoints 的模型列表
   * - 云端但未配置模型：明确报错，引导用户在「云端模型列表」中添加
   * build 回调接收每个端点的 model/apiBase/apiKey，返回请求体。
   */
  async function runWithFailover(
    config: any,
    mode: string,
    options: {
      build: (ep: { model: string; apiBase: string; apiKey: string; name: string }) => {
        body: string;
        timeoutMs: number;
      };
    },
  ): Promise<{ content: string; modelName?: string }> {
    const { build } = options;

    async function attempt(ep: { model: string; apiBase: string; apiKey: string; name: string }): Promise<{ content: string; modelName?: string }> {
      const { body, timeoutMs } = build(ep);
      const apiUrl = ensureApiUrl(ep.apiBase, 'cloud');
      if (!apiUrl) throw new Error(`模型 ${ep.name} API 地址无效`);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error('请求超时')), timeoutMs || 30000);
      try {
        const response = await aiFetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ep.apiKey}` },
          body,
          signal: ac.signal,
        });
        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(`API请求失败(${response.status}): ${errorBody}`);
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (!content) throw new Error('模型返回内容为空');
        return { content, modelName: ep.name };
      } finally {
        clearTimeout(timer);
      }
    }

    // 本地模式：单端点（按所选本地引擎：Ollama / Herdsman）
    if (mode === 'local') {
      const ep = {
        model: getLocalEngineModel(config),
        apiBase: `${getLocalEngineUrl(config).replace(/\/+$/, '')}/v1`,
        apiKey: 'ollama',
        name: getLocalEngineModel(config) || '本地模型',
      };
      return attempt(ep);
    }

    // 云端模式：遍历模型列表做故障转移
    const endpoints = await resolveCloudEndpoints(config);
    if (endpoints.length === 0) {
      throw new Error('尚未配置云端模型，请在 AI 设置的「云端模型列表」中添加模型');
    }
    let lastErr: any = null;
    for (const ep of endpoints) {
      try {
        return await attempt(ep);
      } catch (e: any) {
        lastErr = e;
        log.warn(`[AI故障转移] 模型 ${ep.name} 失败: ${e.message}`);
      }
    }
    throw new Error(`云端模型全部失败（共 ${endpoints.length} 个）。最近错误：${lastErr?.message || ''}`);
  }

  ipcMain.handle('ai:getConfig', async (event) =>
    wrap(event, async () => {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      const config: any = configs[0] ? { ...configs[0] } : {};
      // 返回前对 apiKey 解密并脱敏，防止明文泄露到渲染层
      // testConnection 等需要完整 apiKey 的场景通过 params.apiKey 单独传参
      if (config.apiKey) {
        const key = decryptApiKey(String(config.apiKey));
        config.apiKey = key ? maskApiKey(key) : '';
      }
      return config;
    })
  );

  ipcMain.handle('ai:saveConfig', async (event, config: any) =>
    wrap(event, async () => {
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
      if (/\/v\d+(\/|$)/.test(apiBase)) {
        apiBase = apiBase.replace(/\/v\d+\/?$/, '');
      }

      const ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
      const ollamaModel = config.ollamaModel || null;
      const localEngine = config.localEngine === 'herdsman' ? 'herdsman' : 'ollama';
      const herdsmanUrl = config.herdsmanUrl || HERDSMAN_DEFAULT_URL;
      const herdsmanModel = config.herdsmanModel || null;

      let saveData: any = {
        mode,
        privacyMode: config.privacyMode ?? 0,
        sensitiveWords: config.sensitiveWords || '',
        temperature: config.temperature ?? 0.3,
        // OCR预处理默认：云端模式关闭，本地模式开启
        ocrPreprocess: config.ocrPreprocess !== undefined ? (config.ocrPreprocess ? 1 : 0) : (mode === 'local' ? 1 : 0),
        updatedAt: now,
      };

      // 代理配置：system=跟随系统代理 / manual=手动代理 / none=直连
      if (config.proxyMode !== undefined) {
        const proxyMode = isValidProxyMode(config.proxyMode) ? config.proxyMode : 'system';
        saveData.proxyMode = proxyMode;
        if (proxyMode === 'manual') {
          const proxyRaw = typeof config.proxyUrl === 'string' ? config.proxyUrl.trim() : '';
          const parsed = parseProxyUrl(proxyRaw);
          if (proxyRaw && !parsed) {
            throw new Error('代理地址格式无效，示例：127.0.0.1:7890 或 socks5://127.0.0.1:7890');
          }
          saveData.proxyUrl = parsed ? `${parsed.scheme}://${parsed.rules}` : proxyRaw;
        } else {
          saveData.proxyUrl = null;
        }
      }

      if (mode === 'local') {
        // 本地模式：仅保存本地引擎相关字段，不覆盖云端的 apiKey/apiBase/model
        // 这确保云端配置在切换模式时不会被丢失
        saveData.localEngine = localEngine;
        saveData.ollamaUrl = ollamaUrl;
        saveData.ollamaModel = ollamaModel;
        saveData.herdsmanUrl = herdsmanUrl;
        saveData.herdsmanModel = herdsmanModel;
        saveData.provider = localEngine === 'herdsman' ? 'herdsman' : 'ollama';
        // 关键：不修改 apiKey、apiBase、model、provider（云端字段保持不变）
      } else {
        // 云端模式：保存云端配置，同时保留本地 Ollama 配置
        saveData.apiBase = apiBase;
        // apiKey 三态处理：
        // - 非空且非掩码 → 用户输入了新 key，加密后保存
        // - 空串或含 '****'（前端掩码不回填所致）→ 视为未修改，保留 DB 原值，避免清空真实 key
        const incomingKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
        saveData.apiKey = (incomingKey && !incomingKey.includes('****'))
          ? encryptApiKey(incomingKey)
          : (existing?.apiKey || '');
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

      // 代理设置有变化时立即应用，无需等待下次请求的节流同步
      await syncAiProxyFromDb(true);
    })
  );

  ipcMain.handle('ollama:getStatus', async (event, url?: string, engine?: string) =>
    wrap(event, async () => {
      if (engine === 'herdsman') {
        return await getHerdsmanStatus(url);
      }
      return await getOllamaStatus(url);
    })
  );

  ipcMain.handle('ollama:listModels', async (event, url?: string) =>
    wrap(event, async () => {
      return await listModels(url);
    })
  );

  ipcMain.handle('ollama:pullModel', async (_event, modelName: string, url?: string, engine?: string) => {
    if (engine === 'herdsman') {
      return sanitize({ success: false, error: { code: 'PULL_MODEL_NOT_SUPPORTED', message: 'Herdsman 不支持通过 API 下载模型，请在 Herdsman 模型库中下载' } });
    }
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

  ipcMain.handle('ollama:deleteModel', async (_event, modelName: string, url?: string, engine?: string) => {
    if (engine === 'herdsman') {
      return sanitize({ success: false, error: { code: 'DELETE_MODEL_NOT_SUPPORTED', message: 'Herdsman 不支持通过 API 删除模型，请在 Herdsman 中管理模型' } });
    }
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

  ipcMain.handle('ollama:start', async (_event, url?: string, engine?: string) => {
    requireSession(_event);
    try {
      const result = engine === 'herdsman' ? await startHerdsman(url) : await startOllama(url);
      return sanitize({ success: result.success, data: result });
    } catch (err: any) {
      return sanitize({ success: false, error: { code: 'START_OLLAMA_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ollama:getInstallGuide', async (event, engine?: string) =>
    wrap(event, async () => {
      return engine === 'herdsman' ? getHerdsmanInstallGuide() : getInstallGuide();
    })
  );

  ipcMain.handle('ollama:testConnection', async (_event, url?: string, engine?: string) => {
    requireSession(_event);
    try {
      const result = engine === 'herdsman' ? await testHerdsmanConnection(url) : await testOllamaConnection(url);
      if (result.success) {
        return sanitize({ success: true, data: result });
      } else {
        return sanitize({ success: false, error: { code: 'TEST_CONNECTION_ERROR', message: result.message } });
      }
    } catch (err: any) {
      return sanitize({ success: false, error: { code: 'TEST_CONNECTION_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ollama:getRecommendedModels', async (event, engine?: string) =>
    wrap(event, async () => {
      return engine === 'herdsman' ? HERDSMAN_RECOMMENDED_MODELS : RECOMMENDED_MODELS;
    })
  );

  // ===== 用户自定义提示词管理 =====
  ipcMain.handle('ai:prompts:list', async (event) =>
    wrap(event, async () => {
      const db = getDb();
      const rows = await db.select().from(schema.aiPrompts).all();
      const customMap = new Map(rows.map(r => [r.promptKey, r.template]));
      return BUILTIN_PROMPTS.map(def => {
        const custom = customMap.get(def.key);
        return {
          key: def.key,
          name: def.name,
          description: def.description,
          variables: def.variables,
          template: custom ?? def.builtinTemplate,
          builtinTemplate: def.builtinTemplate,
          customized: !!custom,
          warnings: validateTemplate(def.key, custom ?? def.builtinTemplate).missing,
        };
      });
    })
  );

  ipcMain.handle('ai:prompts:save', async (event, payload: { key?: string; template?: string }) =>
    wrap(event, async () => {
      if (!payload || !isValidPromptKey(payload.key)) {
        throw new Error('无效的提示词功能键');
      }
      const key = payload.key;
      const template = typeof payload.template === 'string' ? payload.template : '';
      if (!template.trim()) {
        throw new Error('提示词内容不能为空');
      }
      if (template.length > MAX_PROMPT_LENGTH) {
        throw new Error(`提示词内容过长（${template.length} 字符），上限 ${MAX_PROMPT_LENGTH} 字符`);
      }
      const { missing } = validateTemplate(key, template);
      if (missing.length > 0) {
        throw new Error(`模板缺少必需变量：${missing.join('、')}，请在模板中保留这些占位符`);
      }
      const db = getDb();
      const now = new Date().toISOString();
      const existing = await db.select({ promptKey: schema.aiPrompts.promptKey })
        .from(schema.aiPrompts)
        .where(eq(schema.aiPrompts.promptKey, key))
        .limit(1);
      if (existing.length > 0) {
        await db.update(schema.aiPrompts)
          .set({ template, updatedAt: now })
          .where(eq(schema.aiPrompts.promptKey, key));
      } else {
        await db.insert(schema.aiPrompts).values({ promptKey: key, template, updatedAt: now });
      }
      log.info(`[AI提示词] 已保存自定义模板: ${key}（${template.length} 字符）`);
      return { success: true };
    })
  );

  ipcMain.handle('ai:prompts:reset', async (event, payload: { key?: string }) =>
    wrap(event, async () => {
      if (!payload || !isValidPromptKey(payload.key)) {
        throw new Error('无效的提示词功能键');
      }
      const db = getDb();
      await db.delete(schema.aiPrompts).where(eq(schema.aiPrompts.promptKey, payload.key));
      log.info(`[AI提示词] 已重置为内置默认模板: ${payload.key}`);
      return { success: true };
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

  ipcMain.handle('ai:testConnection', async (_event, params?: { apiBase?: string; apiKey?: string; model?: string; mode?: string; ollamaUrl?: string; herdsmanUrl?: string; localEngine?: string }) => {
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) return sanitize({ success: false, error: { code: 'NOT_CONFIGURED', message: 'AI未配置' } });

      const config = normalizeConfig(sanitize(configs[0]));
      const mode = params?.mode || config.mode || 'cloud';
      // 合并 params 到 config，使 getEffectiveApiBase 能根据 mode 选择正确的 API 地址
      const mergedConfig = { ...config, ...params };
      const apiBase = getEffectiveApiBase(mergedConfig, mode);
      // params.apiKey 为掩码回传（含 '****'）时不可用于请求，回退到已解密的 config.apiKey
      const paramKey = typeof params?.apiKey === 'string' ? params.apiKey.trim() : '';
      const effectiveKey = (paramKey && !paramKey.includes('****')) ? paramKey : config.apiKey;
      const apiKey = getApiKeyForMode({ ...config, mode, apiKey: effectiveKey });
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
        response = await aiFetch(apiUrl, {
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
          error: { code: 'TEST_CONNECTION_ERROR', message: errMsg, apiUrl, cause: fetchErr?.cause?.code || fetchErr?.cause?.message || undefined }
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
    messages: { role: string; content: string; attachments?: Array<{ name: string; path: string; type: 'image' | 'document' }> }[];
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

      if (shouldValidateApiKey(config) && !config.apiKey && !config.activeModelId) {
        // 自动（按优先级）模式下，任一启用的云端模型配置了 API Key 即视为已配置
        const cloudRows = await db.select({ enabled: schema.aiCloudModels.enabled, apiKey: schema.aiCloudModels.apiKey })
          .from(schema.aiCloudModels)
          .where(eq(schema.aiCloudModels.configId, 'default'))
          .all();
        const hasUsableKey = cloudRows.some(m => m.enabled === 1 && !!m.apiKey);
        if (!hasUsableKey) {
          throw new Error('API Key未配置');
        }
      }

      const temperature = params.temperature ?? config.temperature ?? 0.3;
      const messages: any[] = [];
      if (params.context) {
        messages.push({ role: 'system', content: params.context });
      }
      for (const msg of params.messages) {
        messages.push({ role: msg.role, content: await buildChatMessageContent(msg) });
      }

      // 使用故障转移机制
      const result = await callWithFailover({ messages, temperature, mode, config });

      try {
        writeOperationLog({
          action: 'ai_chat',
          module: 'ai',
          description: `AI对话: 模式=${mode}, 模型=${result.modelName || params.model || '未知'}, 消息数=${params.messages.length}, 上下文=${params.context ? '是' : '否'}, 故障转移=${result.modelName !== (config.model || params.model) ? '是' : '否'}`,
        });
      } catch (logErr: any) {
        log.error('[操作日志] 写入AI对话日志失败:', logErr.message);
      }

      return sanitize({
        success: true,
        data: {
          content: result.content,
          modelName: result.modelName,
          switched: result.modelName !== config.model,
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

      const temperature = config.temperature ?? 0.3;

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

      const recordTemplate = await getPromptTemplate('analyze_record');
      const systemPrompt = renderPromptTemplate(recordTemplate, {
        '安全控制点': controlPoint,
        '测评项': requirement,
      });

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

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

      // 使用云端模型列表做故障转移（失败自动切换下一模型）
      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({ model: ep.model, messages, temperature }),
          timeoutMs: dynamicTimeout,
        }),
      });
      const content = runResult.content;

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

      const temperature = config.temperature ?? 0.3;

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

      log.info(`批量AI分析 图片数: ${hasImages ? params.screenshots.length : 0}, 隐私模式: ${privacyMode}（模型由云端模型列表提供）`);

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

      const batchMatchTemplate = await getPromptTemplate('batch_match');
      const promptText = renderPromptTemplate(batchMatchTemplate, {
        '证据描述': evidenceDesc,
        '测评项列表': itemsJson,
      });

      userContent.push({ type: 'text', text: promptText });

      const messages = [
        { role: 'system', content: '你是一名专业的等级保护测评师。请严格按照要求的JSON格式返回详细的分析结果。' },
        { role: 'user', content: userContent },
      ];

      sendProgress({ stage: 'sending', message: '正在提交给AI分析...', percent: 60 });

      startHeartbeat(61, 90);

      // 使用云端模型列表做故障转移（失败自动切换下一模型）
      let runResult: any;
      try {
        runResult = await runWithFailover(config, mode, {
          build: (ep) => ({
            body: JSON.stringify({ model: ep.model, messages, temperature }),
            timeoutMs: dynamicTimeout,
          }),
        });
      } finally {
        stopHeartbeat();
      }
      const content = runResult.content;

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

      const temperature = config.temperature ?? 0.3;

      log.info('[ai:analyzeIssue] AI配置:', JSON.stringify({
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

      const rectifyTemplate = await getPromptTemplate('rectify_suggestion');
      const systemPrompt = renderPromptTemplate(rectifyTemplate, {
        '问题标题': issueTitle,
        '安全域': securityDomain,
        '控制点': controlPoint,
        '控制项': controlName,
        '问题描述': issueDescription,
      });

      // 使用云端模型列表做故障转移（失败自动切换下一模型）
      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名专业的等级保护测评师，擅长撰写连贯的安全整改建议描述。请以纯文本段落形式返回整改建议，不需要JSON格式。' },
              { role: 'user', content: systemPrompt },
            ],
            temperature,
          }),
          timeoutMs: 60000,
        }),
      });
      let content = runResult.content;
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

      const temperature = config.temperature ?? 0.3;

      log.info('[ai:analyzeIssueDescription] AI配置:', JSON.stringify({
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

      const issueDescTemplate = await getPromptTemplate('issue_desc');
      const systemPrompt = renderPromptTemplate(issueDescTemplate, {
        '问题标题': issueTitle,
        '安全域': securityDomain,
        '控制点': controlPoint,
        '控制项': controlName,
        '问题描述': issueDescription,
      });

      // 使用云端模型列表做故障转移（失败自动切换下一模型）
      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名专业的等级保护测评师，擅长从问题信息中提炼核心安全问题和风险描述。' },
              { role: 'user', content: systemPrompt },
            ],
            temperature,
          }),
          timeoutMs: 60000,
        }),
      });
      let content = runResult.content;
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

      const temperature = config.temperature ?? 0.3;

      log.info('[ai:batchAnalyzeIssues] AI配置:', JSON.stringify({
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

          const batchRectifyTemplate = await getPromptTemplate('rectify_suggestion');
          const systemPrompt = renderPromptTemplate(batchRectifyTemplate, {
            '问题标题': issueTitle,
            '安全域': securityDomain,
            '控制点': controlPoint,
            '控制项': controlName,
            '问题描述': issueDescription,
          });

          // 使用云端模型列表做故障转移（失败自动切换下一模型）
          const runResult = await runWithFailover(config, mode, {
            build: (ep) => ({
              body: JSON.stringify({
                model: ep.model,
                messages: [
                  { role: 'system', content: '你是一名专业的等级保护测评师，擅长撰写连贯的安全整改建议描述。请以纯文本段落形式返回整改建议，不需要JSON格式。' },
                  { role: 'user', content: systemPrompt },
                ],
                temperature,
              }),
              timeoutMs: 60000,
            }),
          });
          // 移除所有前导换行符和回车符
          const content = runResult.content.replace(/^[\r\n]+/, '').trim();
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
    requireSession(_event);
    try {
      const safePath = await validateDataPath(imagePath);
      const result = await extractTextFromImage(safePath, options);
      return sanitize({ success: true, data: result });
    } catch (err: any) {
      log.error('[OCR] 提取文本失败:', err.message);
      return sanitize({ success: false, error: { code: 'OCR_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ocr:extractTextFromMultiple', async (_event, imagePaths: string[], options?: any) => {
    requireSession(_event);
    try {
      const safePaths = await Promise.all(imagePaths.map((p: string) => validateDataPath(p)));
      const results = await extractTextFromMultipleImages(safePaths, options);
      return sanitize({ success: true, data: results });
    } catch (err: any) {
      log.error('[OCR] 批量提取文本失败:', err.message);
      return sanitize({ success: false, error: { code: 'OCR_ERROR', message: err.message } });
    }
  });

  ipcMain.handle('ocr:isEnabled', async (_event) => {
    requireSession(_event);
    return sanitize({ success: true, data: isOCREnabled() });
  });

  // 获取云端模型列表
  ipcMain.handle('ai:getModels', async (event) =>
    wrap(event, async () => {
      const db = getDb();
      const models = await db.select().from(schema.aiCloudModels).orderBy(schema.aiCloudModels.priority).all();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      const activeModelId = configs[0]?.activeModelId || null;
      // 与 getConfig 保持一致：交互平铺数据，外层 envelope 由 wrap 统一处理
      return {
        models: models.map(m => ({
          id: m.id,
          name: m.name,
          apiBase: m.apiBase,
          model: m.model,
          apiFormat: m.apiFormat,
          enabled: m.enabled === 1,
          priority: m.priority,
        })),
        activeModelId,
      };
    })
  );

  // 创建云端模型
  ipcMain.handle('ai:createModel', async (_event, data: any) =>
    wrap(_event, async () => {
      const db = getDb();
      const now = new Date().toISOString();
      const id = `model-${Date.now()}`;
      await db.insert(schema.aiCloudModels).values({
        id,
        configId: 'default',
        name: data.name,
        apiBase: data.apiBase || '',
        apiKey: data.apiKey ? encryptApiKey(data.apiKey) : '',
        model: data.model || '',
        apiFormat: data.apiFormat || 'openai',
        enabled: data.enabled !== false ? 1 : 0,
        priority: data.priority || 99,
        createdAt: now,
        updatedAt: now,
      });
      return sanitize({ success: true, data: { id } });
    })
  );

  // 更新云端模型
  ipcMain.handle('ai:updateModel', async (_event, modelId: string, data: any) =>
    wrap(_event, async () => {
      const db = getDb();
      const now = new Date().toISOString();
      const updateData: any = {
        name: data.name,
        apiBase: data.apiBase,
        model: data.model,
        apiFormat: data.apiFormat,
        enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : undefined,
        priority: data.priority !== undefined ? data.priority : undefined,
        updatedAt: now,
      };
      if (data.apiKey && !data.apiKey.includes('****')) {
        updateData.apiKey = encryptApiKey(data.apiKey);
      }
      await db.update(schema.aiCloudModels).set(updateData).where(eq(schema.aiCloudModels.id, modelId));
      return sanitize({ success: true });
    })
  );

  // 删除云端模型
  ipcMain.handle('ai:deleteModel', async (_event, modelId: string) =>
    wrap(_event, async () => {
      const db = getDb();
      await db.delete(schema.aiCloudModels).where(eq(schema.aiCloudModels.id, modelId));
      // 如果删除的是当前激活的模型，重置 activeModelId
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs[0]?.activeModelId === modelId) {
        await db.update(schema.aiConfigs).set({ activeModelId: null }).where(eq(schema.aiConfigs.id, 'default'));
      }
      return sanitize({ success: true });
    })
  );

  // 设置当前激活的模型
  ipcMain.handle('ai:setActiveModel', async (_event, modelId: string | null) =>
    wrap(_event, async () => {
      const db = getDb();
      await db.update(schema.aiConfigs).set({ activeModelId: modelId }).where(eq(schema.aiConfigs.id, 'default'));
      return sanitize({ success: true });
    })
  );

  // 测试单个模型的连接
  ipcMain.handle('ai:testModelConnection', async (_event, modelId: string) =>
    wrap(_event, async () => {
      const db = getDb();
      const model = await db.select().from(schema.aiCloudModels).where(eq(schema.aiCloudModels.id, modelId)).limit(1);
      if (model.length === 0) throw new Error('模型不存在');
      const m = model[0];
      const apiKey = m.apiKey ? decryptApiKey(m.apiKey) : '';
      const apiUrl = ensureApiUrl(m.apiBase, 'cloud');
      if (!apiUrl) throw new Error('API 地址未配置');
      if (!apiKey) throw new Error('API Key 未配置');

      const requestBody = JSON.stringify({
        model: m.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      });

      const response = await aiFetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: requestBody,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API 请求失败 (${response.status}): ${errorBody}`);
      }

      const data = await response.json();
      return sanitize({ success: true, data: { model: m.model, response: data.choices?.[0]?.message?.content || '' } });
    })
  );

  /**
   * 知识库智能问答：基于知识库文档内容回答用户问题
   * 检索策略：关键词打分排序取 Top5 文档，每篇正文截断，控制上下文长度
   */
  ipcMain.handle('ai:searchKnowledge', async (_event, rawParams: { question: string }) => {
    try {
      const params = sanitize(rawParams);
      const question = String(params.question || '').trim();
      if (!question) throw new Error('问题不能为空');

      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      // 检索知识库：全量加载文档后按关键词命中打分（文档量小，内存打分足够）
      const docs = await db.select({
        id: schema.knowledgeDocuments.id,
        title: schema.knowledgeDocuments.title,
        content: schema.knowledgeDocuments.content,
        description: schema.knowledgeDocuments.description,
        tags: schema.knowledgeDocuments.tags,
      }).from(schema.knowledgeDocuments);

      // 分词：按非中文字符/标点/空白切分，保留长度>=2的片段；中文整句作为整体短语参与匹配
      const tokens = question
        .split(/[\s,，。.;；:：!！?？、()（）\[\]【】"'”“]+/)
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length >= 2);

      const scored = docs.map(doc => {
        const title = (doc.title || '').toLowerCase();
        const desc = (doc.description || '').toLowerCase();
        const content = (doc.content || '').toLowerCase();
        const tags = (doc.tags || '').toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (title.includes(t)) score += 10;
          if (tags.includes(t)) score += 6;
          if (desc.includes(t)) score += 4;
          if (content.includes(t)) score += 2;
        }
        return { doc, score };
      });

      const topDocs = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(s => s.doc);

      // 全部文档均未命中时，取前 3 篇作为兜底上下文（AI 会提示未找到相关内容）
      const contextDocs = topDocs.length > 0
        ? topDocs
        : docs.slice(0, 3).map(d => ({ ...d, _fallback: true }));

      const DOC_SNIPPET_LIMIT = 4000;
      const knowledgeContent = contextDocs
        .map((d: any) => {
          const content = (d.content || d.description || '').slice(0, DOC_SNIPPET_LIMIT);
          const truncated = (d.content || '').length > DOC_SNIPPET_LIMIT ? '（内容过长，已截断）' : '';
          return `【文档：${d.title}】\n${content}${truncated}`;
        })
        .join('\n\n---\n\n');

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const safeQuestion = privacyMode ? desensitizeText(question, extraWords) : question;
      const safeKnowledge = privacyMode ? desensitizeText(knowledgeContent, extraWords) : knowledgeContent;

      const qaTemplate = await getPromptTemplate('knowledge_qa');
      const userPrompt = renderPromptTemplate(qaTemplate, {
        '用户问题': safeQuestion,
        '知识库内容': safeKnowledge,
      });

      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名专业的网络安全等级保护测评顾问，基于提供的知识库内容准确回答问题。' },
              { role: 'user', content: userPrompt },
            ],
            temperature: config.temperature ?? 0.3,
          }),
          timeoutMs: 90000,
        }),
      });

      writeOperationLog({
        action: 'ai_knowledge_qa',
        module: 'ai',
        targetName: question.slice(0, 50),
        description: `知识库AI问答: ${question.slice(0, 80)}`,
      });

      return sanitize({
        success: true,
        data: {
          content: runResult.content,
          modelName: runResult.modelName || '',
          referencedDocs: contextDocs.map((d: any) => ({ id: d.id, title: d.title })),
        },
      });
    } catch (error: any) {
      log.error('[ai:searchKnowledge] 错误:', error.message);
      return sanitize({
        success: false,
        error: { code: 'AI_KNOWLEDGE_QA_ERROR', message: error.message || '知识库AI问答失败' },
      });
    }
  });

  /**
   * 核查命令智能推荐：根据测评项 + 资产信息，从命令库中推荐最相关的核查命令
   * 返回完整命令对象 + 每条推荐理由，命令 ID 均经候选列表校验
   */
  ipcMain.handle('ai:recommendCommands', async (_event, rawParams: {
    controlPoint?: string;
    controlName?: string;
    requirement?: string;
    assetLabel?: string;
    brand?: string;
    os?: string;
    deviceType?: string;
  }) => {
    try {
      const params = sanitize(rawParams);
      if (!params.requirement && !params.controlPoint) {
        throw new Error('缺少测评项信息，请先选择测评行');
      }

      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      // 候选命令：全量加载，若提供资产信息则按匹配度排序截取，控制上下文规模
      const allCommands = await db.select().from(schema.knowledgeCommands);
      const assetInfo = {
        brand: String(params.brand || '').toLowerCase(),
        os: String(params.os || '').toLowerCase(),
        deviceType: String(params.deviceType || '').toLowerCase(),
        label: String(params.assetLabel || '').toLowerCase(),
      };
      const hasAssetHint = !!(assetInfo.brand || assetInfo.os || assetInfo.deviceType || assetInfo.label);

      const descLimit = 120;
      const candidates = allCommands.map(cmd => {
        const haystack = `${cmd.brand || ''} ${cmd.os || ''} ${cmd.deviceType || ''} ${cmd.target || ''}`.toLowerCase();
        let score = 0;
        if (hasAssetHint) {
          for (const v of [assetInfo.brand, assetInfo.os, assetInfo.deviceType, assetInfo.label]) {
            if (v && v.length >= 2 && haystack.includes(v)) score += 1;
          }
        }
        return {
          id: cmd.id,
          name: cmd.name,
          command: cmd.command,
          description: (cmd.description || '').slice(0, descLimit),
          target: cmd.target,
          os: cmd.os,
          brand: cmd.brand,
          deviceType: cmd.deviceType,
          category: cmd.category,
          subCategory: cmd.subCategory,
          _score: score,
        };
      });

      // 有资产提示时优先相关命令（含 0 分兜底）；上限 100 条
      candidates.sort((a, b) => b._score - a._score);
      const limited = candidates.slice(0, 100).map(({ _score, ...rest }) => rest);

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const d = (t: string) => (privacyMode ? desensitizeText(String(t || ''), extraWords) : String(t || ''));

      const candidatesJson = JSON.stringify(limited, null, 0);
      const recommendTemplate = await getPromptTemplate('command_recommend');
      const userPrompt = renderPromptTemplate(recommendTemplate, {
        '控制点': d(params.controlPoint),
        '控制项': d(params.controlName),
        '测评项内容': d(params.requirement),
        '资产信息': d([params.assetLabel, params.brand, params.os, params.deviceType].filter(Boolean).join(' / ') || '未指定'),
        '候选命令列表': candidatesJson,
      });

      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名专业的等级保护测评师，擅长为测评项匹配合适的核查命令。请严格按照要求的JSON格式返回。' },
              { role: 'user', content: userPrompt },
            ],
            temperature: config.temperature ?? 0.3,
          }),
          timeoutMs: 90000,
        }),
      });

      // 解析 AI 返回的 JSON（容错：剥离 ```json 包裹、截取首个 { 到末个 }）
      let raw = runResult.content.trim();
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) throw new Error('AI 返回格式异常：未找到 JSON');
      const parsed = JSON.parse(raw.slice(start, end + 1));

      const idSet = new Set(limited.map(c => c.id));
      const recommendedIds: string[] = Array.isArray(parsed.recommendedIds)
        ? parsed.recommendedIds.filter((id: any) => typeof id === 'string' && idSet.has(id)).slice(0, 5)
        : [];
      const reasons: Record<string, string> = parsed.reasons && typeof parsed.reasons === 'object' ? parsed.reasons : {};

      const commands = recommendedIds
        .map(id => limited.find(c => c.id === id))
        .filter((c): c is (typeof limited)[number] => !!c)
        .map(c => ({ ...c, reason: reasons[c.id] || '' }));

      writeOperationLog({
        action: 'ai_recommend_commands',
        module: 'ai',
        targetName: String(params.controlPoint || '').slice(0, 50),
        description: `AI推荐核查命令: 控制点=${params.controlPoint || ''}, 推荐${commands.length}条`,
      });

      return sanitize({ success: true, data: { commands } });
    } catch (error: any) {
      log.error('[ai:recommendCommands] 错误:', error.message);
      return sanitize({
        success: false,
        error: { code: 'AI_RECOMMEND_COMMANDS_ERROR', message: error.message || '命令智能推荐失败' },
      });
    }
  });

  // AI 资产识别：根据系统描述文本识别资产清单，前端勾选预览后走 asset:create 导入
  ipcMain.handle('ai:identifyAssets', async (_e, rawParams: {
    projectId?: string;
    systemName?: string;
    description?: string;
    imagePaths?: string[];
    documents?: string[];
    ocrPreprocess?: boolean;
  }) => {
    try {
      const params = sanitize(rawParams);
      const description = String(params.description || '').trim();
      const imagePathsInput: string[] = Array.isArray(params.imagePaths)
        ? params.imagePaths.map((p: any) => String(p || '').trim()).filter(Boolean)
        : [];
      const documentPathsInput: string[] = Array.isArray(params.documents)
        ? params.documents.map((p: any) => String(p || '').trim()).filter(Boolean)
        : [];
      const hasAttachment = imagePathsInput.length > 0 || documentPathsInput.length > 0;
      if (!description && !hasAttachment) throw new Error('请先粘贴系统描述信息或添加附件');
      if (description.length > 20000) throw new Error('系统描述过长，请控制在 20000 字以内');
      if (imagePathsInput.length > 20) throw new Error('图片附件过多，请控制在 20 张以内');
      if (documentPathsInput.length > 10) throw new Error('文档附件过多，请控制在 10 份以内');

      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      // 项目上下文（系统名称/定级/被测单位），失败不阻断识别
      let systemContext = String(params.systemName || '');
      if (params.projectId) {
        try {
          const projects = await db.select().from(schema.projects).where(eq(schema.projects.id, String(params.projectId))).limit(1);
          if (projects.length > 0) {
            const p = sanitize(projects[0]);
            systemContext = [p.systemName || p.name, p.levelCombo || '', p.assessedUnit || ''].filter(Boolean).join(' / ');
          }
        } catch (e: any) {
          log.warn('[ai:identifyAssets] 项目信息获取失败:', e.message);
        }
      }

      // 现有资产清单（供 AI 去重），上限 100 条控制上下文规模
      let existingAssetsText = '无';
      if (params.projectId) {
        try {
          const catNames = new Map(ASSET_CATEGORIES.map(c => [c.id, c.name] as [string, string]));
          const existing = await db.select().from(schema.assets).where(eq(schema.assets.projectId, String(params.projectId)));
          existingAssetsText = existing.length === 0
            ? '无'
            : existing.slice(0, 100).map(a => `[${catNames.get(String(a.category)) || a.category}] ${a.name}`).join('；');
        } catch (e: any) {
          log.warn('[ai:identifyAssets] 现有资产查询失败:', e.message);
        }
      }

      const categoryListText = ASSET_CATEGORIES.map(c => `${c.id}=${c.name}`).join('、');

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const d = (t: string) => (privacyMode ? desensitizeText(String(t || ''), extraWords) : String(t || ''));

      const identifyTemplate = await getPromptTemplate('asset_identify');
      const userPrompt = renderPromptTemplate(identifyTemplate, {
        '系统信息': d(systemContext || '未指定'),
        '系统描述': d(description || '（未填写文字描述，请依据下方附件内容识别）'),
        '资产分类说明': categoryListText,
        '现有资产清单': d(existingAssetsText),
      });

      // 构建多模态用户内容：图片（多模态/OCR）+ 文档（提取文本）+ 文字描述
      const userContent: any[] = [];
      const docBlocks: string[] = [];
      const ocrBlocks: string[] = [];
      const failedFiles: string[] = [];
      const ocrPreprocess = params.ocrPreprocess === true;

      // 图片附件：校验路径 → 隐私模式脱敏 / OCR 提取文字 / 编码为 base64
      let validatedImages: string[] = [];
      if (imagePathsInput.length > 0) {
        try {
          validatedImages = await validateScreenshotPaths(imagePathsInput);
        } catch (e: any) {
          failedFiles.push(`图片附件（路径无效: ${e.message}）`);
          validatedImages = [];
        }
      }
      for (const imgPath of validatedImages) {
        try {
          const fileName = path.basename(imgPath);
          if (ocrPreprocess) {
            const ocrResults = await extractTextFromMultipleImages([imgPath], { preprocess: true });
            for (const { result } of ocrResults) {
              if (result.text && result.text.trim().length > 0) {
                ocrBlocks.push(`--- 图片 OCR: ${fileName} ---\n${result.text}\n--- OCR 结束 ---`);
              }
            }
          }
          if (privacyMode) {
            const base64 = await desensitizeImage(imgPath);
            if (base64) userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } });
          } else {
            const base64 = await encodeImageToBase64(imgPath);
            if (base64) userContent.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } });
          }
        } catch (err: any) {
          failedFiles.push(`${path.basename(imgPath)}（图片处理失败: ${err.message}）`);
        }
      }

      // 文档附件：校验路径 → 提取文本拼接
      if (documentPathsInput.length > 0) {
        for (const docPath of documentPathsInput) {
          try {
            const absPath = await resolvePath(docPath);
            const text = await extractTextFromFile(absPath);
            const truncated = text.length > MAX_CHAT_DOC_TEXT_LENGTH
              ? text.slice(0, MAX_CHAT_DOC_TEXT_LENGTH) + '\n...(内容过长已截断)'
              : text;
            docBlocks.push(`--- 附件: ${path.basename(docPath)} ---\n${truncated}\n--- 附件结束 ---`);
          } catch (err: any) {
            failedFiles.push(`${path.basename(docPath)}（文档读取失败: ${err.message}）`);
          }
        }
      }

      // 合并文字与附件文本块
      let textContent = userPrompt;
      if (docBlocks.length > 0) textContent += `\n\n${docBlocks.join('\n\n')}`;
      if (ocrBlocks.length > 0) textContent += `\n\n[图片 OCR 识别文字]\n${ocrBlocks.join('\n\n')}`;
      if (failedFiles.length > 0) textContent += `\n\n[以下附件读取失败，未包含在上下文中: ${[...new Set(failedFiles)].join('; ')}]`;
      userContent.push({ type: 'text', text: textContent });

      // 动态超时：基于图片数量、文档数量与图片总体积
      let totalImageSizeKB = 0;
      for (const imgPath of validatedImages) {
        try {
          const st = await stat(imgPath);
          totalImageSizeKB += st.size / 1024;
        } catch { /* ignore */ }
      }
      const dynamicTimeout = calculateTimeout(1, validatedImages.length, totalImageSizeKB, privacyMode);

      const messages = [
        { role: 'system', content: '你是一名专业的等级保护测评师，擅长梳理信息系统的资产构成。请严格按照要求的JSON格式返回。' },
        { role: 'user', content: userContent },
      ];

      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages,
            temperature: config.temperature ?? 0.3,
          }),
          timeoutMs: dynamicTimeout,
        }),
      });

      // 解析 AI 返回的 JSON（容错：剥离 ```json 包裹、截取首个 { 到末个 }）
      let raw = runResult.content.trim();
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) throw new Error('AI 返回格式异常：未找到 JSON');
      const parsed = JSON.parse(raw.slice(start, end + 1));

      const categoryIds = new Set(ASSET_CATEGORIES.map(c => c.id));
      const importanceSet = new Set(['high', 'medium', 'low']);
      const assets: Array<Record<string, any>> = [];
      if (Array.isArray(parsed.assets)) {
        for (const item of parsed.assets) {
          if (!item || typeof item !== 'object') continue;
          const name = String(item.name || '').trim();
          if (!name) continue;
          const quantityNum = Number(item.quantity);
          assets.push({
            category: categoryIds.has(String(item.category)) ? String(item.category) : 'other_asset',
            name: name.slice(0, 100),
            os: String(item.os || '').slice(0, 100),
            version: String(item.version || '').slice(0, 100),
            ip: String(item.ip || '').slice(0, 100),
            quantity: Number.isFinite(quantityNum) && quantityNum >= 1 ? Math.floor(quantityNum) : 1,
            importance: importanceSet.has(String(item.importance)) ? String(item.importance) : 'medium',
            deviceUsage: String(item.deviceUsage || '').slice(0, 200),
            description: String(item.description || '').slice(0, 500),
          });
          if (assets.length >= 30) break;
        }
      }

      writeOperationLog({
        action: 'ai_identify_assets',
        module: 'ai',
        targetName: (systemContext || '系统资产识别').slice(0, 50),
        description: `AI资产识别: 识别出${assets.length}个资产, 图片附件${validatedImages.length}张, 文档附件${documentPathsInput.length}份`,
      });

      return sanitize({ success: true, data: { assets } });
    } catch (error: any) {
      log.error('[ai:identifyAssets] 错误:', error.message);
      return sanitize({
        success: false,
        error: { code: 'AI_IDENTIFY_ASSETS_ERROR', message: error.message || 'AI资产识别失败' },
      });
    }
  });

  // 缺失资产智能提醒：按 13 类统计已录入资产分布，由 AI 结合等保各层面要求分析缺失项
  ipcMain.handle('ai:checkMissingAssets', async (_e, rawParams: {
    projectId?: string;
    systemName?: string;
  }) => {
    try {
      const params = sanitize(rawParams);
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      let systemContext = String(params.systemName || '');
      if (params.projectId) {
        try {
          const projects = await db.select().from(schema.projects).where(eq(schema.projects.id, String(params.projectId))).limit(1);
          if (projects.length > 0) {
            const p = sanitize(projects[0]);
            systemContext = [p.systemName || p.name, p.levelCombo || '', p.assessedUnit || ''].filter(Boolean).join(' / ');
          }
        } catch (e: any) {
          log.warn('[ai:checkMissingAssets] 项目信息获取失败:', e.message);
        }
      }

      // 已录入资产按分类分组统计，每类名称最多展示 15 个
      let distributionText = '无（尚未录入任何资产）';
      if (params.projectId) {
        try {
          const catNames = new Map(ASSET_CATEGORIES.map(c => [c.id, c.name] as [string, string]));
          const rows = await db.select().from(schema.assets).where(eq(schema.assets.projectId, String(params.projectId)));
          if (rows.length > 0) {
            const grouped = new Map<string, string[]>();
            for (const a of rows) {
              const key = String(a.category || 'other_asset');
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key)!.push(String(a.name || '').slice(0, 40));
            }
            distributionText = [...grouped.entries()]
              .map(([cat, names]) => `${catNames.get(cat) || cat}（${names.length}个）：${names.slice(0, 15).join('、')}${names.length > 15 ? ' 等' : ''}`)
              .join('\n');
          }
        } catch (e: any) {
          log.warn('[ai:checkMissingAssets] 资产统计失败:', e.message);
        }
      }

      const categoryListText = ASSET_CATEGORIES.map(c => `${c.id}=${c.name}`).join('、');

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const d = (t: string) => (privacyMode ? desensitizeText(String(t || ''), extraWords) : String(t || ''));

      const missingTemplate = await getPromptTemplate('asset_missing');
      const userPrompt = renderPromptTemplate(missingTemplate, {
        '系统信息': d(systemContext || '未指定'),
        '资产分类清单': categoryListText,
        '已录入资产分布': d(distributionText),
      });

      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名专业的等级保护测评师，熟悉等级保护2.0各安全层面的资产构成要求。请严格按照要求的JSON格式返回。' },
              { role: 'user', content: userPrompt },
            ],
            temperature: config.temperature ?? 0.3,
          }),
          timeoutMs: 90000,
        }),
      });

      let raw = runResult.content.trim();
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) throw new Error('AI 返回格式异常：未找到 JSON');
      const parsed = JSON.parse(raw.slice(start, end + 1));

      const categoryIds = new Set(ASSET_CATEGORIES.map(c => c.id));
      const missing: Array<{ category: string; risk: string; suggestion: string }> = [];
      if (Array.isArray(parsed.missing)) {
        for (const item of parsed.missing) {
          if (!item || typeof item !== 'object') continue;
          const category = String(item.category || '');
          if (!categoryIds.has(category)) continue;
          missing.push({
            category,
            risk: String(item.risk || '').slice(0, 500),
            suggestion: String(item.suggestion || '').slice(0, 500),
          });
        }
      }

      writeOperationLog({
        action: 'ai_check_missing_assets',
        module: 'ai',
        targetName: (systemContext || '缺失资产提醒').slice(0, 50),
        description: `缺失资产提醒: 发现${missing.length}项缺失类别`,
      });

      return sanitize({ success: true, data: { missing } });
    } catch (error: any) {
      log.error('[ai:checkMissingAssets] 错误:', error.message);
      return sanitize({
        success: false,
        error: { code: 'AI_CHECK_MISSING_ASSETS_ERROR', message: error.message || '缺失资产提醒失败' },
      });
    }
  });

  // ====== 工作台数据洞察 + 异常预警（ai:dashboardInsight） ======
  // 设计：后端 5 条确定性规则（ALERT_RULES，模块顶层）计算预警本体，AI 仅对命中项补充处置建议，不得新增/删除预警

  // 计算预警统计量（接收调用方已查好的全表数据，避免重复全表扫描）
  function computeAlertStats(allProjects: any[], issuesRows: any[]) {
    const now = Date.now();
    const date30DaysAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
    const date6MonthsAgo = new Date(now - 6 * 30 * 24 * 3600 * 1000).toISOString();
    const dateToday = new Date(now).toISOString().slice(0, 10);

    // 逾期整改：status 非 resolved/closed 且 rectificationDeadline < 今天
    let overdueCount = 0, highOverdue = 0, medOverdue = 0, lowOverdue = 0;
    let highRiskOpenCount = 0;
    for (const issue of issuesRows) {
      const status = String(issue.status || 'pending');
      const isClosed = status === 'resolved' || status === 'closed';
      const risk = String(issue.riskLevel || 'medium');
      if (!isClosed && risk === 'high') highRiskOpenCount++;
      if (isClosed) continue;
      const deadline = String(issue.rectificationDeadline || '').slice(0, 10);
      if (deadline && deadline < dateToday) {
        overdueCount++;
        if (risk === 'high') highOverdue++;
        else if (risk === 'medium') medOverdue++;
        else lowOverdue++;
      }
    }

    // 长期停滞：进行中且 30 天内无更新
    let stalledCount = 0;
    for (const p of allProjects) {
      if (String(p.status || 'draft') !== 'in_progress') continue;
      const updated = String(p.updatedAt || p.createdAt || '');
      if (updated && updated < date30DaysAgo) stalledCount++;
    }

    // 草稿积压
    let draftCount = 0;
    for (const p of allProjects) {
      if (String(p.status || 'draft') === 'draft') draftCount++;
    }

    // 活跃度：近 6 个月内新建项目（复用已查好的全表数据，与项目创建趋势图口径一致）
    // 同时返回 recentProjects（供调用方算月度趋势分布）与 recentProjectsCount（供预警判定），消除重复过滤
    const recentProjects = allProjects.filter((p: any) => {
      const created = String(p.createdAt || '');
      return created && created >= date6MonthsAgo;
    });

    return {
      overdueCount, highOverdue, medOverdue, lowOverdue,
      highRiskOpenCount, stalledCount, draftCount,
      recentProjectsCount: recentProjects.length,
      recentProjects,
    };
  }

  ipcMain.handle('ai:dashboardInsight', async (_e, _rawParams: any) => {
    // 并发防护：同通道串行，避免连续触发造成重复请求/结果覆盖
    if (aiLocks.get('dashboardInsight')) {
      return sanitize({ success: false, error: { code: 'AI_BUSY', message: '上一次 AI 分析仍在执行中，请稍候（请勿重复点击），完成后可重新触发' } });
    }
    aiLocks.set('dashboardInsight', true);
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      const [allProjects, issuesRows, assetRows] = await Promise.all([
        db.select().from(schema.projects),
        db.select().from(schema.issues),
        db.select().from(schema.assets),
      ]);

      // 状态分布
      const statusMap: Record<string, number> = { draft: 0, in_progress: 0, completed: 0, archived: 0 };
      for (const p of allProjects) {
        const st = String(p.status || 'draft');
        statusMap[st] = (statusMap[st] || 0) + 1;
      }
      // 等级分布
      const levelMap: Record<number, number> = {};
      for (const p of allProjects) {
        const lv = Number(p.level) || 0;
        levelMap[lv] = (levelMap[lv] || 0) + 1;
      }
      // 问题风险分布
      const riskMap: Record<string, number> = { high: 0, medium: 0, low: 0 };
      const statusIssueMap: Record<string, number> = { pending: 0, rectifying: 0, resolved: 0, closed: 0 };
      for (const issue of issuesRows) {
        const rl = String(issue.riskLevel || 'medium');
        riskMap[rl] = (riskMap[rl] || 0) + 1;
        const st = String(issue.status || 'pending');
        statusIssueMap[st] = (statusIssueMap[st] || 0) + 1;
      }

      const alertStats = computeAlertStats(allProjects, issuesRows);

      // 触发预警
      const triggeredAlerts = ALERT_RULES.filter(rule => {
        switch (rule.key) {
          case 'overdue_rectification': return alertStats.overdueCount > 0;
          case 'high_risk_open': return alertStats.highRiskOpenCount > 0;
          case 'stalled_projects': return alertStats.stalledCount > 0;
          case 'draft_backlog': return alertStats.draftCount > 0;
          case 'trend_cold': return alertStats.recentProjectsCount === 0;
          default: return false;
        }
      }).map(rule => ({
        key: rule.key,
        severity: rule.severity,
        title: rule.title,
        detail: rule.detail(alertStats),
      }));

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const d = (t: string) => (privacyMode ? desensitizeText(String(t || ''), extraWords) : String(t || ''));

      const template = await getPromptTemplate('dashboard_insight');

      // 项目创建趋势（近 6 个月）：复用 computeAlertStats 已过滤好的 recentProjects，消除重复过滤
      const trendByMonth: Record<string, number> = {};
      for (const p of alertStats.recentProjects) {
        const m = String(p.createdAt || '').slice(0, 7);
        if (m) trendByMonth[m] = (trendByMonth[m] || 0) + 1;
      }
      const trendText = Object.entries(trendByMonth)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([m, c]) => `${m}: ${c} 个`)
        .join('；') || '近 6 个月未新建项目';

      const statsText = d(JSON.stringify({
        projectCount: allProjects.length,
        status: statusMap,
        level: levelMap,
        assetCount: assetRows.length,
      }));

      const issueStatsText = d(JSON.stringify({
        total: issuesRows.length,
        riskLevel: riskMap,
        status: statusIssueMap,
      }));

      const alertsText = triggeredAlerts.length === 0
        ? '无命中预警'
        : triggeredAlerts.map((a: any) => `[${a.severity}] ${a.title}：${a.detail}`).join('\n');

      const userPrompt = renderPromptTemplate(template, {
        '工作台统计': statsText,
        '项目创建趋势': d(trendText),
        '问题统计': issueStatsText,
        '预警规则命中': alertsText,
      });

      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名专业的等级保护测评项目管理专家，擅长基于项目数据做风险态势分析与预警解读。请严格按照要求的 JSON 格式返回。' },
              { role: 'user', content: userPrompt },
            ],
            temperature: config.temperature ?? 0.3,
          }),
          timeoutMs: 120000,
        }),
      });

      // 解析 JSON（容错：代码块包裹 + 大括号配平）
      const parsed = extractAiJson(runResult.content, 'AI 工作台洞察');

      const insight = String(parsed.insight || '').slice(0, 2000);
      const alertKeySet = new Set(triggeredAlerts.map((a: any) => a.key));
      const alertAdvices: Array<{ key: string; advice: string }> = [];
      if (Array.isArray(parsed.alertAdvices)) {
        for (const item of parsed.alertAdvices) {
          if (!item || typeof item !== 'object') continue;
          const key = String(item.key || '').trim();
          if (!alertKeySet.has(key)) continue;
          const advice = String(item.advice || '').trim().slice(0, 300);
          if (advice) alertAdvices.push({ key, advice });
        }
      }

      const operator = getCurrentOperator();
      writeOperationLog({
        action: 'ai_dashboard_insight',
        module: 'ai',
        targetName: '工作台洞察',
        description: `AI 工作台洞察: 命中预警 ${triggeredAlerts.length} 条，生成建议 ${alertAdvices.length} 条`,
        ...(operator?.userId ? { userId: operator.userId, username: operator.username } : {}),
      });

      return sanitize({
        success: true,
        data: {
          insight,
          alerts: triggeredAlerts,
          alertAdvices,
        },
      });
    } catch (error: any) {
      log.error('[ai:dashboardInsight] 错误:', String(error?.message ?? error));
      return sanitize({
        success: false,
        error: { code: 'AI_DASHBOARD_INSIGHT_ERROR', message: error.message || 'AI 工作台洞察失败' },
      });
    } finally {
      aiLocks.delete('dashboardInsight');
    }
  });

  // ====== 标准差异智能解读（ai:explainStandardDiff） ======
  // 入参：前端 standard:compare 返回的对照结果（含 stats/rows），字段白名单 + 截断，上限 200 行
  ipcMain.handle('ai:explainStandardDiff', async (_e, rawParams: any) => {
    // 并发防护：同通道串行，避免连续触发造成重复请求/结果覆盖
    if (aiLocks.get('explainStandardDiff')) {
      return sanitize({ success: false, error: { code: 'AI_BUSY', message: '上一次 AI 分析仍在执行中，请稍候（请勿重复点击），完成后可重新触发' } });
    }
    aiLocks.set('explainStandardDiff', true);
    try {
      const params = sanitize(rawParams);
      const baseStandard = String(params.baseStandard || '').trim();
      const targetStandard = String(params.targetStandard || '').trim();
      const stats = params.stats || {};
      const rows: Array<any> = Array.isArray(params.rows) ? params.rows : [];
      if (!baseStandard || !targetStandard) throw new Error('缺少基准标准或对照标准信息');
      if (rows.length === 0) throw new Error('无差异明细可解读');

      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const d = (t: string) => (privacyMode ? desensitizeText(String(t || ''), extraWords) : String(t || ''));

      // 截取字段白名单，最多 200 行
      const MAX_ROWS = 200;
      const MAX_REQ_LEN = 150;
      const diffDetails = rows.slice(0, MAX_ROWS).map((r: any) => {
        const tag = String(r.tag || '').trim();
        const domain = String(r.domain || r.domainA || r.domainB || '').trim();
        const controlPoint = String(r.controlPoint || '').trim();
        // 兼容嵌套 left.requirement / 扁平 leftRequirement
        const leftText = String(r.left?.requirement ?? r.left?.summary ?? r.leftRequirement ?? '').slice(0, MAX_REQ_LEN);
        const rightText = String(r.right?.requirement ?? r.right?.summary ?? r.rightRequirement ?? '').slice(0, MAX_REQ_LEN);
        return {
          tag,
          domain: d(domain),
          controlPoint: d(controlPoint),
          left: leftText ? d(leftText) : '',
          right: rightText ? d(rightText) : '',
        };
      }).filter((r: any) => r.tag || r.controlPoint || r.left || r.right);

      const template = await getPromptTemplate('standard_diff_explain');
      const userPrompt = renderPromptTemplate(template, {
        '基准标准': d(baseStandard),
        '对照标准': d(targetStandard),
        '对照统计': d(JSON.stringify({
          totalControlPoints: stats.totalControlPoints || rows.length,
          levelDiffCount: stats.levelDiffCount || 0,
          requirementDiffCount: stats.requirementDiffCount || 0,
          extensionCount: stats.extensionCount ?? stats.extensionOnlyCount ?? 0,
        })),
        '差异明细': d(JSON.stringify(diffDetails)),
      });

      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名精通网络安全等级保护标准体系的测评专家，擅长标准差异解读与合规影响分析。请严格按照要求的 JSON 格式返回。' },
              { role: 'user', content: userPrompt },
            ],
            temperature: config.temperature ?? 0.3,
          }),
          timeoutMs: 120000,
        }),
      });

      // 解析 JSON（容错：代码块包裹 + 大括号配平）
      const parsed = extractAiJson(runResult.content, 'AI 标准差异解读');

      const keyDiffs: Array<{ domain: string; point: string; impact: string }> = [];
      if (Array.isArray(parsed.keyDiffs)) {
        for (const item of parsed.keyDiffs.slice(0, 12)) {
          if (!item || typeof item !== 'object') continue;
          keyDiffs.push({
            domain: String(item.domain || '').trim().slice(0, 100),
            point: String(item.point || '').trim().slice(0, 300),
            impact: String(item.impact || '').trim().slice(0, 300),
          });
        }
      }

      const operator = getCurrentOperator();
      writeOperationLog({
        action: 'ai_explain_standard_diff',
        module: 'ai',
        targetName: `${baseStandard} → ${targetStandard}`,
        description: `AI 差异解读: 分析了 ${diffDetails.length} 条差异明细，提炼 ${keyDiffs.length} 条关键差异`,
        ...(operator?.userId ? { userId: operator.userId, username: operator.username } : {}),
      });

      return sanitize({
        success: true,
        data: {
          summary: String(parsed.summary || '').slice(0, 1500),
          keyDiffs,
          advice: String(parsed.advice || '').slice(0, 1500),
        },
      });
    } catch (error: any) {
      log.error('[ai:explainStandardDiff] 错误:', String(error?.message ?? error));
      return sanitize({
        success: false,
        error: { code: 'AI_EXPLAIN_STANDARD_DIFF_ERROR', message: error.message || 'AI 标准差异解读失败' },
      });
    } finally {
      aiLocks.delete('explainStandardDiff');
    }
  });

  // ====== 合规差距智能分析（ai:standardComplianceGap） ======
  // 入参：projectId + standardId（可附 precomputed 统计以跳过二次全量查库），再调 AI 分析差距
  ipcMain.handle('ai:standardComplianceGap', async (_e, rawParams: any) => {
    // 并发防护：同通道串行，避免连续触发造成重复请求/结果覆盖
    if (aiLocks.get('standardComplianceGap')) {
      return sanitize({ success: false, error: { code: 'AI_BUSY', message: '上一次 AI 分析仍在执行中，请稍候（请勿重复点击），完成后可重新触发' } });
    }
    aiLocks.set('standardComplianceGap', true);
    try {
      const params = sanitize(rawParams);
      const projectId = String(params.projectId || '').trim();
      const standardId = String(params.standardId || '').trim();
      if (!projectId) throw new Error('缺少项目 ID');
      if (!standardId) throw new Error('缺少标准 ID');

      const db = getDb();

      // 查项目与标准（供 AI 提示词使用）
      const projRows = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      if (projRows.length === 0) throw new Error('项目不存在');
      const stdRows = await db.select().from(schema.standards).where(eq(schema.standards.id, standardId)).limit(1);
      if (stdRows.length === 0) throw new Error('标准不存在');
      const proj = projRows[0];
      const std = stdRows[0];

      // 优先复用前端已算好的统计（跳过二次全量查库）；缺失或校验失败则回退到公共统计
      const pre = sanitize(params.precomputed || {});
      const preSummary = pre.summary;
      const preDomains = Array.isArray(pre.domains) ? pre.domains : null;
      const preSamples = Array.isArray(pre.nonCompliantSamples) ? pre.nonCompliantSamples : null;
      const preValid =
        preSummary &&
        typeof preSummary === 'object' &&
        Number.isFinite(preSummary.totalItems) &&
        Number.isFinite(preSummary.nonCompliant) &&
        !!preDomains &&
        !!preSamples;
      let domains: Array<Record<string, any>>;
      let summary: Record<string, any>;
      let nonCompliantSamples: Array<Record<string, any>>;
      if (preValid) {
        domains = preDomains as Array<Record<string, any>>;
        summary = preSummary as Record<string, any>;
        nonCompliantSamples = preSamples as Array<Record<string, any>>;
      } else {
        const computed = await computeComplianceStats(projectId, standardId);
        domains = computed.domains;
        summary = computed.summary as unknown as Record<string, any>;
        nonCompliantSamples = computed.nonCompliantSamples;
      }
      const sNonCompliant = Number(summary.nonCompliant || 0);

      // 查 AI 配置
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = normalizeConfig(sanitize(configs[0]));
      const mode = config.mode || 'cloud';

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const d = (t: string) => (privacyMode ? desensitizeText(String(t || ''), extraWords) : String(t || ''));

      const template = await getPromptTemplate('standard_compliance_gap');
      const userPrompt = renderPromptTemplate(template, {
        '项目信息': d(JSON.stringify({
          projectName: proj.name,
          assessedUnit: proj.assessedUnit || '',
          level: proj.level,
          standardCode: std.code,
          standardName: std.name,
        })),
        '各域合规统计': d(JSON.stringify(domains)),
        '不符合条目样例': d(JSON.stringify(nonCompliantSamples)),
      });

      const runResult = await runWithFailover(config, mode, {
        build: (ep) => ({
          body: JSON.stringify({
            model: ep.model,
            messages: [
              { role: 'system', content: '你是一名专业的等级保护测评师，擅长合规差距分析与整改优先级评估。请严格按照要求的 JSON 格式返回。' },
              { role: 'user', content: userPrompt },
            ],
            temperature: config.temperature ?? 0.3,
          }),
          timeoutMs: 120000,
        }),
      });

      // 解析 JSON（容错：代码块包裹 + 大括号配平）
      const parsed = extractAiJson(runResult.content, 'AI 合规差距分析');

      const gaps: Array<{ domain: string; gap: string; risk: string; priority: string; suggestion: string }> = [];
      if (Array.isArray(parsed.gaps)) {
        for (const item of parsed.gaps.slice(0, 10)) {
          if (!item || typeof item !== 'object') continue;
          gaps.push({
            domain: String(item.domain || '').trim().slice(0, 100),
            gap: String(item.gap || '').trim().slice(0, 300),
            risk: String(item.risk || '').trim().slice(0, 300),
            priority: String(item.priority || 'medium').trim().slice(0, 10),
            suggestion: String(item.suggestion || '').trim().slice(0, 300),
          });
        }
      }

      const operator = getCurrentOperator();
      writeOperationLog({
        action: 'ai_standard_compliance_gap',
        module: 'ai',
        targetName: `${proj.name} × ${std.code}`,
        description: `AI 合规差距分析: 共 ${summary.totalItems} 条适用条目，${sNonCompliant} 条不符合，提炼 ${gaps.length} 条差距`,
        ...(operator?.userId ? { userId: operator.userId, username: operator.username } : {}),
      });

      return sanitize({
        success: true,
        data: {
          summary: String(parsed.summary || '').slice(0, 1500),
          gaps,
          domains,
          nonCompliantSamples,
          stats: summary,
        },
      });
    } catch (error: any) {
      log.error('[ai:standardComplianceGap] 错误:', String(error?.message ?? error));
      return sanitize({
        success: false,
        error: { code: 'AI_STANDARD_COMPLIANCE_GAP_ERROR', message: error.message || 'AI 合规差距分析失败' },
      });
    } finally {
      aiLocks.delete('standardComplianceGap');
    }
  });
}