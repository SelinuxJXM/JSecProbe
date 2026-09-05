import { createWorker, Worker } from 'tesseract.js';
import log from 'electron-log';
import sharp from 'sharp';
import { readFile, stat } from 'fs/promises';

const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

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
        const worker = await createWorker(language);
        sharedWorker = worker;
        sharedWorkerLanguage = language;
        log.info(`[OCR] Worker 初始化成功 (language=${language})`);
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

export async function extractTextFromMultipleImages(
  imagePaths: string[],
  options: OCROptions = {}
): Promise<Array<{ path: string; result: OCRResult }>> {
  const results: Array<{ path: string; result: OCRResult }> = [];
  const SINGLE_TIMEOUT = 60 * 1000; // 单张超时 60 秒

  // 串行处理（OCR Worker 是共享单例，并行会冲突），但加单张超时
  for (const imagePath of imagePaths) {
    try {
      const result = await Promise.race([
        extractTextFromImage(imagePath, options),
        new Promise<OCRResult>((_, reject) =>
          setTimeout(() => reject(new Error(`OCR 单张超时(${SINGLE_TIMEOUT / 1000}s): ${imagePath}`)), SINGLE_TIMEOUT)
        ),
      ]);
      results.push({ path: imagePath, result });
    } catch (err: any) {
      log.warn(`[OCR] 批量处理单张失败: ${err.message}`);
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
