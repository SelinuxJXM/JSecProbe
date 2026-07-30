import { createWorker, Worker } from 'tesseract.js';
import log from 'electron-log';
import sharp from 'sharp';
import { readFile, stat } from 'fs/promises';

const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

let sharedWorker: Worker | null = null;
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

export async function getSharedWorker(language: string = 'eng'): Promise<Worker | null> {
  if (sharedWorker) return sharedWorker;
  if (sharedWorkerInitializing) return sharedWorkerInitializing;

  sharedWorkerInitializing = (async () => {
    try {
      const worker = await createWorker(language);
      sharedWorker = worker;
      log.info('[OCR] Worker 初始化成功');
      return worker;
    } catch (error) {
      sharedWorkerInitializing = null;
      log.error('[OCR] 初始化 worker 失败:', error);
      return null;
    }
  })();

  return sharedWorkerInitializing;
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
  const { language = 'eng', preprocess = true } = options;

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

  for (const imagePath of imagePaths) {
    const result = await extractTextFromImage(imagePath, options);
    results.push({ path: imagePath, result });
  }

  return results;
}

export async function terminateOCRWorker(): Promise<void> {
  if (sharedWorker) {
    try {
      await sharedWorker.terminate();
      sharedWorker = null;
      sharedWorkerInitializing = null;
      log.info('[OCR] Worker 已终止');
    } catch (err) {
      log.warn('[OCR] 终止 Worker 失败:', err);
    }
  }
}

export function isOCREnabled(): boolean {
  return sharedWorker !== null;
}
