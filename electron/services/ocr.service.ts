import { createWorker, Worker } from 'tesseract.js';
import { app } from 'electron';
import log from 'electron-log';
import sharp from 'sharp';
import { readFile, writeFile, stat, mkdir } from 'fs/promises';
import * as path from 'path';

const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

/**
 * 离线语言包目录。
 * 未显式指定 langPath 时，tesseract.js 会从 jsdelivr CDN 下载 traineddata ——
 * 现场测评多为内网/隔离环境，且根目录的 *.traineddata 既未被引用也未被打包，
 * 结果就是 OCR 在离线环境必然失败。这里显式指向随包发布的 resources/tessdata。
 */
function resolveTessDataDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tessdata');
  }
  return path.join(app.getAppPath(), 'resources', 'tessdata');
}

/**
 * 语言包缓存目录。默认值为 '.'（进程工作目录），打包后落在安装目录（通常不可写），
 * 会导致每次识别都回填缓存失败并反复落盘报错。改到 userData 下的可写目录。
 */
function resolveTessCacheDir(): string {
  return path.join(app.getPath('userData'), 'tesseract-cache');
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // 目录已存在或不可创建：tesseract.js 会自行降级，不阻断识别
  }
}

/**
 * 把随包语言包预置进 tesseract 的缓存目录（离线可用的关键一步）。
 *
 * 背景：tesseract.js 在加载语言包时先查缓存（`adapter.readCache`），缓存未命中才去
 * `langPath` 取。而在 Electron **主进程**里 `is-electron()` 为真，
 * `getEnvironment('type')` 返回 `'electron'` 而不是 `'node'`，
 * 于是 `worker-script/index.js:134` 的 `env !== 'node'` 分支成立 —— 它把本地路径当成 URL
 * 交给 node-fetch 去拉，node-fetch 只接受绝对 URL，直接抛
 * `TypeError: Only absolute URLs are supported`，OCR 彻底不可用（且该错误是 throw 出来的，
 * 不装 errorHandler 会顶穿主进程）。
 *
 * 缓存命中路径走的是 fs 读取，不经过 fetch，所以只要先把 `<lang>.traineddata`
 * 放进 cachePath，就能完全绕开这个判定 bug。
 */
async function primeTessCache(langPath: string, cachePath: string, language: string): Promise<void> {
  const langs = language.split('+').map(s => s.trim()).filter(Boolean);
  for (const lang of langs) {
    const dest = path.join(cachePath, `${lang}.traineddata`);
    try {
      await stat(dest);
      continue; // 缓存已有，直接用
    } catch {
      // 不存在，继续拷贝
    }
    try {
      const src = path.join(langPath, `${lang}.traineddata`);
      await stat(src);
      await writeFile(dest, await readFile(src));
      log.info(`[OCR] 已预置语言包到缓存: ${lang}`);
    } catch (err) {
      log.warn(`[OCR] 语言包 ${lang} 预置失败，将尝试在线获取:`, err);
    }
  }
}

let sharedWorker: Worker | null = null;
let sharedWorkerLanguage: string | null = null;
let sharedWorkerInitializing: Promise<Worker | null> | null = null;

export interface OCROptions {
  language?: string;
  preprocess?: boolean;
}

export interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff'].includes(ext);
}

export async function getSharedWorker(language: string = 'chi_sim+eng'): Promise<Worker | null> {
  return await (async () => {
    // 已有 Worker 且语言匹配，直接返回
    if (sharedWorker && sharedWorkerLanguage === language) {
      return sharedWorker;
    }

    // 语言不匹配：先终止旧 Worker
    if (sharedWorker) {
      const oldWorker = sharedWorker;
      sharedWorker = null;
      sharedWorkerLanguage = null;
      log.info(`[OCR] 语言切换: 终止旧 Worker (target=${language})`);
      try {
        await oldWorker.terminate();
      } catch (err) {
        log.warn('[OCR] 终止旧 Worker 失败:', err);
      }
    }

    // 正在初始化且语言匹配，复用当前初始化 Promise
    if (sharedWorkerInitializing && sharedWorkerLanguage === language) {
      return sharedWorkerInitializing;
    }

    // 创建新 Worker
    sharedWorkerLanguage = language;
    const initPromise = (async () => {
      try {
        const langPath = resolveTessDataDir();
        const cachePath = resolveTessCacheDir();
        await ensureDir(cachePath);
        // 必须放在 createWorker 之前：缓存命中可绕开 Electron 主进程下
        // tesseract 误用 node-fetch 拉本地语言包的判定错误（见 primeTessCache 说明）
        await primeTessCache(langPath, cachePath, language);
        // gzip:false —— 随包发布的是未压缩的 *.traineddata；
        // 若保持默认 gzip:true，tesseract.js 会去找 *.traineddata.gz 而必然找不到。
        const worker = await createWorker(language, undefined, {
          langPath,
          cachePath,
          gzip: false,
          logger: (m: any) => {
            if (m && typeof m.progress === 'number') {
              log.debug(`[OCR] ${m.status} ${(m.progress * 100).toFixed(0)}%`);
            }
          },
          // 必须提供 errorHandler：tesseract.js 在 worker 消息回调里遇到 reject 时，
          // 若未设置则直接 `throw Error(data)`（createWorker.js:247）。该 throw 发生在
          // worker 的 message 事件回调中，**不在 createWorker 的 promise 链上**，
          // try/catch 与 .catch() 都拦不到 —— 结果是主进程未捕获异常，Electron 弹出
          // 「A JavaScript error occurred in the main process」并阻断启动。
          // 装上 errorHandler 后，OCR 失败降级为一条日志，应用照常启动。
          errorHandler: (err: any) => {
            log.error('[OCR] Worker 运行时错误:', err);
          },
        } as any);
        sharedWorker = worker;
        sharedWorkerLanguage = language;
        log.info(`[OCR] Worker 初始化成功 (language=${language}, langPath=${langPath})`);
        return worker;
      } catch (error) {
        log.error('[OCR] 初始化 worker 失败:', error);
        sharedWorker = null;
        sharedWorkerLanguage = null;
        return null;
      } finally {
        sharedWorkerInitializing = null;
      }
    })();

    sharedWorkerInitializing = initPromise;
    return initPromise;
  })();
}

async function preprocessImage(imagePath: string): Promise<Buffer> {
  const imageBuffer = await readFile(imagePath);
  
  const processed = await sharp(imageBuffer)
    .grayscale()
    .normalize()
    .threshold(128)
    .toBuffer();
  
  return processed;
}

export async function extractTextFromImage(
  imagePath: string,
  options: OCROptions = {}
): Promise<OCRResult> {
  const { language = 'chi_sim+eng', preprocess = true } = options;

  try {
    if (!isImageFile(imagePath)) {
      log.warn(`[OCR] 跳过非图片文件: ${imagePath}`);
      return { text: '', confidence: 0, words: [] };
    }

    const fileStats = await stat(imagePath);
    if (fileStats.size > MAX_IMAGE_SIZE_BYTES) {
      const originalSizeMB = fileStats.size / (1024 * 1024);
      log.warn(`[OCR] 图片过大，跳过: ${imagePath}, 大小: ${originalSizeMB.toFixed(1)} MB`);
      return { text: '', confidence: 0, words: [] };
    }

    log.info(`[OCR] 开始识别: ${imagePath}`);

    const worker = await getSharedWorker(language);
    if (!worker) {
      log.warn('[OCR] Worker 不可用');
      return { text: '', confidence: 0, words: [] };
    }

    let imageBuffer: Buffer;
    if (preprocess) {
      imageBuffer = await preprocessImage(imagePath);
    } else {
      imageBuffer = await readFile(imagePath);
    }

    const { data } = await worker.recognize(imageBuffer);

    const result: OCRResult = {
      text: data.text || '',
      confidence: data.confidence || 0,
      words: (data.words || [])
        .filter((w: any) => w.text && w.text.trim().length > 0)
        .map((w: any) => ({
          text: w.text || '',
          confidence: w.confidence || 0,
          bbox: {
            x0: w.bbox?.x0 || 0,
            y0: w.bbox?.y0 || 0,
            x1: w.bbox?.x1 || 0,
            y1: w.bbox?.y1 || 0,
          },
        })),
    };

    log.info(`[OCR] 识别完成: ${imagePath}, 文本长度: ${result.text.length}, 置信度: ${result.confidence.toFixed(1)}%`);
    return result;
  } catch (err: any) {
    log.error(`[OCR] 识别失败: ${imagePath}: ${err.message}`);
    return { text: '', confidence: 0, words: [] };
  }
}

async function resetSharedWorker(): Promise<void> {
  if (sharedWorker) {
    const old = sharedWorker;
    sharedWorker = null;
    sharedWorkerLanguage = null;
    try {
      await old.terminate();
    } catch (err) {
      log.warn('[OCR] 超时后终止 Worker 失败:', err);
    }
    log.info('[OCR] 超时后已终止旧 Worker（下次识别将重新初始化）');
  }
}

export async function extractTextFromMultipleImages(
  imagePaths: string[],
  options: OCROptions = {}
): Promise<Array<{ path: string; result: OCRResult }>> {
  const results: Array<{ path: string; result: OCRResult }> = [];
  const SINGLE_TIMEOUT = 60 * 1000; // 单张超时 60 秒

  // 串行处理（OCR Worker 是共享单例，并行会冲突），但加单张超时
  for (const imagePath of imagePaths) {
    const recognizePromise = extractTextFromImage(imagePath, options);
    try {
      const result = await Promise.race([
        recognizePromise,
        new Promise<OCRResult>((_, reject) =>
          setTimeout(() => reject(new Error(`OCR 单张超时(${SINGLE_TIMEOUT / 1000}s): ${imagePath}`)), SINGLE_TIMEOUT)
        ),
      ]);
      results.push({ path: imagePath, result });
    } catch (err: any) {
      log.warn(`[OCR] 批量处理单张失败: ${err.message}`);
      // 超时：底层 recognize 仍挂在共享 Worker 上，单例会被卡住导致后续图片全部排队等待。
      // 直接终止旧 Worker，下次识别会自动重建，避免批量串行被一个挂死任务阻塞。
      if (err.message && err.message.includes('超时')) {
        await resetSharedWorker();
      }
      // 吸收 recognizePromise 可能的后续拒绝，避免未处理 Promise 拒绝打崩主进程
      recognizePromise.catch(() => {});
      results.push({
        path: imagePath,
        result: { text: '', confidence: 0, words: [] },
      });
    }
  }

  return results;
}

export async function terminateOCRWorker(): Promise<void> {
  // 若正在初始化，等待其完成再终止
  if (sharedWorkerInitializing) {
    try {
      await sharedWorkerInitializing;
    } catch {
      // 忽略初始化错误
    }
  }
  if (sharedWorker) {
    try {
      await sharedWorker.terminate();
      log.info('[OCR] Worker 已终止');
    } catch (err) {
      log.warn('[OCR] 终止 Worker 失败:', err);
    }
  }
  sharedWorker = null;
  sharedWorkerLanguage = null;
  sharedWorkerInitializing = null;
}

export function isOCREnabled(): boolean {
  return sharedWorker !== null || sharedWorkerInitializing !== null;
}
