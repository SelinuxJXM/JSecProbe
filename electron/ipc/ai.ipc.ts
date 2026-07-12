import { ipcMain } from 'electron';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import log from 'electron-log';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { writeOperationLog } from '../utils/operation-log';

function sanitize<T>(obj: T): any {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    log.error('IPC返回值序列化失败:', e);
    return { success: false, error: { code: 'SERIALIZE_ERROR', message: '数据序列化失败' } };
  }
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff'].includes(ext);
}

async function encodeImageToBase64(imagePath: string, maxSizeKB: number = 200): Promise<string> {
  try {
    if (!isImageFile(imagePath)) {
      log.warn(`[图片编码] 跳过非图片文件: ${imagePath}`);
      return '';
    }

    const imageBuffer = await readFile(imagePath);
    const originalSizeKB = imageBuffer.length / 1024;
    log.info(`[图片编码] 路径: ${imagePath}, 原始大小: ${originalSizeKB.toFixed(1)} KB`);

    if (originalSizeKB <= maxSizeKB) {
      return imageBuffer.toString('base64');
    }

    const compressed = await sharp(imageBuffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
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
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    if (!isImageFile(imagePath)) {
      return '';
    }
    const imageBuffer = await readFile(imagePath);
    const originalSizeKB = imageBuffer.length / 1024;
    log.info(`[图片脱敏] 路径: ${imagePath}, 原始大小: ${originalSizeKB.toFixed(1)} KB`);

    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;

    worker = await createWorker('eng');
    const { data } = await worker.recognize(imageBuffer);

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

    const processedSizeKB = processed.length / 1024;
    log.info(`[图片脱敏] ${imagePath}: 共遮盖 ${maskRects.length} 处敏感文本, ${originalSizeKB.toFixed(1)} KB → ${processedSizeKB.toFixed(1)} KB`);
    return processed.toString('base64');
  } catch (err: any) {
    log.error(`[图片脱敏失败] ${imagePath}: ${err.message}，将发送原图`);
    try {
      return (await readFile(imagePath)).toString('base64');
    } catch {
      return '';
    }
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch {}
    }
  }
}

function ensureApiUrl(baseUrl: string | null | undefined): string {
  const raw = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';

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

export function registerAIHandlers(): void {
  ipcMain.handle('ai:getConfig', async () =>
    wrap(async () => {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      return configs[0] || {};
    })
  );

  ipcMain.handle('ai:saveConfig', async (_event, config: any) =>
    wrap(async () => {
      const db = getDb();
      const now = new Date().toISOString();
      let apiBase = (config.apiBase || '').trim().replace(/\/+$/, '');
      if (apiBase.endsWith('/v1/chat/completions')) {
        apiBase = apiBase.replace(/\/v1\/chat\/completions\/?$/, '');
      } else if (apiBase.endsWith('/chat/completions')) {
        apiBase = apiBase.replace(/\/chat\/completions\/?$/, '');
      }
      if (apiBase.endsWith('/v1')) {
        apiBase = apiBase.replace(/\/v1\/?$/, '');
      }
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length > 0) {
        await db.update(schema.aiConfigs)
          .set({
            apiBase,
            apiKey: config.apiKey,
            model: config.model,
            temperature: config.temperature ?? 0.3,
            privacyMode: config.privacyMode ?? 0,
            sensitiveWords: config.sensitiveWords || '',
            updatedAt: now,
          })
          .where(eq(schema.aiConfigs.id, configs[0].id));
      } else {
        await db.insert(schema.aiConfigs).values({
          id: 'default',
          apiBase,
          apiKey: config.apiKey,
          model: config.model,
          temperature: config.temperature ?? 0.3,
          privacyMode: config.privacyMode ?? 0,
          sensitiveWords: config.sensitiveWords || '',
          updatedAt: now,
          createdAt: now,
        });
      }
    })
  );

  ipcMain.handle('ai:testConnection', async (_event, params?: { apiBase?: string; apiKey?: string; model?: string }) => {
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) return sanitize({ success: false, error: { code: 'NOT_CONFIGURED', message: 'AI未配置' } });

      const config = sanitize(configs[0]);
      const apiBase = params?.apiBase || config.apiBase || '';
      const apiKey = params?.apiKey || config.apiKey || '';
      const model = params?.model || config.model || '';

      if (!apiKey) return sanitize({ success: false, error: { code: 'NO_API_KEY', message: 'API Key未配置' } });
      if (!apiBase) return sanitize({ success: false, error: { code: 'NO_API_BASE', message: 'API地址未配置' } });

      const apiUrl = ensureApiUrl(apiBase);
      log.info(`[测试连接] URL: ${apiUrl}, 模型: ${model}, Key前4位: ${apiKey.substring(0, 4)}***`);

      const requestBody = {
        model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
        temperature: 0.1,
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

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
          reply: data.choices?.[0]?.message?.content || '无回复'
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
      const config = sanitize(configs[0]);
      if (!config.apiKey) throw new Error('API Key未配置');

      const model = params.model || config.model || '';
      const temperature = params.temperature ?? config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(config.apiBase);

      if (!apiUrl) throw new Error('API地址未配置');

      const messages: any[] = [];
      if (params.context) {
        messages.push({ role: 'system', content: params.context });
      }
      messages.push(...params.messages);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API请求失败(${response.status}): ${apiUrl} - ${errorBody}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      try {
        writeOperationLog({
          action: 'ai_chat',
          module: 'ai',
          description: `AI对话: 模型=${model}, 消息数=${params.messages.length}, 上下文=${params.context ? '是' : '否'}`,
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
    };
    try {
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = sanitize(configs[0]);
      if (!config.apiKey) throw new Error('API Key未配置');

      const model = config.model || '';
      const temperature = config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(config.apiBase);

      if (!apiUrl) throw new Error('API地址未配置');

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      let hasScreenshots = params.screenshots && params.screenshots.length > 0;

      const userContent: any[] = [];

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
      } else if (hasScreenshots) {
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

      userContent.push({
        type: 'text',
        text: `关键证据点内容：${evidenceText}`,
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

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
        }),
      });

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

  ipcMain.handle('ai:batchAnalyzeScreenshots', async (_event, params: {
    items: { id: string; controlPoint: string; requirement: string }[];
    screenshots: string[];
    documents?: { name: string; content: string }[];
  }) => {
    const sendProgress = (data: { stage: string; message: string; percent: number }) => {
      try { _event.sender.send('ai:analysisProgress', data); } catch (innerErr: any) {
        log.warn('[批量分析] 发送进度失败:', innerErr.message);
      }
    };

    try {
      sendProgress({ stage: 'init', message: '正在读取配置...', percent: 5 });
      const db = getDb();
      const configs = await db.select().from(schema.aiConfigs).limit(1);
      if (configs.length === 0) throw new Error('AI未配置');
      const config = sanitize(configs[0]);
      if (!config.apiKey) throw new Error('API Key未配置');

      const model = config.model || '';
      const temperature = config.temperature ?? 0.3;
      const apiUrl = ensureApiUrl(config.apiBase);

      if (!apiUrl) throw new Error('API地址未配置');

      const privacyMode = config.privacyMode === 1;
      const extraWords = config.sensitiveWords
        ? config.sensitiveWords.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const hasImages = params.screenshots && params.screenshots.length > 0;

      sendProgress({ stage: 'encoding', message: `正在编码文件...`, percent: 15 });
      if (privacyMode && params.screenshots && params.screenshots.length > 0) {
        log.info('[隐私模式] 批量分析截图将脱敏处理（OCR遮盖IP）后发送');
      }

      log.info(`批量AI分析 请求URL: ${apiUrl}, 模型: ${model}, 图片数: ${hasImages ? params.screenshots.length : 0}, 隐私模式: ${privacyMode}`);

      const userContent: any[] = [];
      const imageFileNames: string[] = [];

      if (hasImages) {
        let encoded = 0;
        for (const screenshotPath of params.screenshots) {
          const fileName = screenshotPath.split('\\').pop()?.split('/').pop() || 'unknown';
          imageFileNames.push(fileName);

          const base64 = privacyMode
            ? await desensitizeImage(screenshotPath)
            : await encodeImageToBase64(screenshotPath);
          const base64Preview = base64 ? base64.substring(0, 50) + '...' : 'EMPTY';
          log.info(`[图片编码结果] ${screenshotPath}: ${base64Preview}`);
          if (base64) {
            userContent.push({
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64}`,
              },
            });
          }
          encoded++;
          const encodePercent = 15 + Math.round((encoded / params.screenshots.length) * 35);
          sendProgress({ stage: 'encoding', message: `正在编码文件 (${encoded}/${params.screenshots.length})...`, percent: encodePercent });
        }

        const imageListDesc = imageFileNames.map((name, idx) => `  图片${idx + 1}: ${name}`).join('\n');
        userContent.unshift({
          type: 'text',
          text: `已提供 ${params.screenshots.length} 张截图（按以下顺序排列）：\n${imageListDesc}\n\n请分析这些截图内容。`,
        });
      }

      const itemsJson = JSON.stringify(params.items.map(item => ({
        id: item.id,
        controlPoint: privacyMode ? desensitizeText(item.controlPoint, extraWords) : item.controlPoint,
        requirement: privacyMode ? desensitizeText(item.requirement, extraWords) : item.requirement,
      })));

      let docContent = '';
      if (params.documents && params.documents.length > 0) {
        for (const doc of params.documents) {
          const content = privacyMode ? desensitizeText(doc.content, extraWords) : doc.content;
          docContent += `\n=== 文档：${doc.name} ===\n${content}\n`;
        }
      }

      let evidenceDesc = '';
      if (hasImages) {
        const modeText = privacyMode ? '（已脱敏处理：OCR遮盖IP地址）' : '';
        evidenceDesc = `已提供 ${params.screenshots.length} 张截图${modeText}，已附加在消息中（先文本后图片）。`;
      }
      if (docContent) {
        evidenceDesc += `\n\n文档文本内容：\n${docContent}`;
      }

      let promptText = `你是一名专业的等级保护测评师。请根据以下截图、文档内容，智能匹配到对应的测评项，并为每个匹配到的测评项撰写现场测评记录。

${evidenceDesc}

测评项列表：
${itemsJson}

请逐一仔细分析每张截图和文档的具体内容（界面文字、配置项、状态信息、数据等），智能判断内容与哪些测评项相关，然后为每个匹配到的测评项撰写一段详实的测评记录。参考以下示例格式：

示例：经核查，/etc/login.defs中配置了FAIL_MAX_ENTRIES=5，FAIL_INTERVAL=300，表示连续登录失败5次后锁定账户300秒。

要求：
- 以"经核查，"或"经访谈，"开头（根据证据来源自动选择）
- 描述具体核查了什么配置、看到了什么界面信息
- 引用具体的配置参数、数值、版本、文件名
- 语句连贯、事实清晰，形成一段完整描述
- 智能匹配：只有当内容与测评项确实相关时才返回该测评项的分析结果
- 如果截图/文档内容与某个测评项无关，不要返回该测评项的结果
- 一个截图/文档可能匹配多个测评项，某个测评项也可能匹配多个截图/文档
- 对于匹配到的测评项，必须根据实际证据情况给出明确的符合性判定：符合/部分符合/不符合
- 严禁编造不存在的内容，所有结论必须有实际证据支撑
- 结论末尾不要写"均满足二级要求"、"综合判定：符合"、"符合等保二级要求"等总结性套话

请严格按照以下JSON格式返回结果（不要有其他说明文字）：
{
  "results": [
    {
      "itemId": "匹配到的测评项ID",
      "keyEvidencePoints": [
        "具体描述1（仅列出与测评项相关的证据，如: FAIL_LOGIN_ENABLED=yes）"
      ],
      "compliance": "符合/部分符合/不符合",
      "conclusion": "经核查，/etc/login.defs中配置了FAIL_MAX_ENTRIES=5，FAIL_INTERVAL=300，表示连续登录失败5次后锁定账户300秒。",
      "screenshots": ["Snipaste_2026-06-17_12-24-22.jpg"]
    }
  ]
}

⚠️ 重要：screenshots字段必须返回截图的完整原始文件名（如 "Snipaste_2026-06-17_12-24-22.jpg"），不要使用"图片1"、"截图1"等占位名称！`;

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
      log.info(`[批量AI分析] 请求体大小: ${bodySizeKB.toFixed(1)} KB, 用户内容项数: ${userContent.length}`);

      sendProgress({ stage: 'sending', message: '正在提交给AI分析...', percent: 60 });

      log.info(`[批量AI分析] 开始发送fetch请求...`);
      const fetchStartTime = Date.now();

      const abortController = new AbortController();
      const timeoutMs = 90000;
      const timeout = setTimeout(() => {
        log.warn(`[批量AI分析] 请求超时(${timeoutMs}ms)，终止请求`);
        abortController.abort(new Error('请求超时'));
      }, timeoutMs);

      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: batchRequestBody,
          signal: abortController.signal,
        });
        const elapsed = Date.now() - fetchStartTime;
        log.info(`[批量AI分析] fetch收到响应，耗时: ${elapsed}ms, 状态: ${response.status}`);
      } catch (fetchError: any) {
        const elapsed = Date.now() - fetchStartTime;
        log.error(`[批量AI分析] fetch请求失败，耗时: ${elapsed}ms, 错误: ${fetchError.name}: ${fetchError.message}`);
        throw fetchError;
      } finally {
        clearTimeout(timeout);
      }

      sendProgress({ stage: 'receiving', message: 'AI正在分析中...', percent: 75 });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`API请求失败(${response.status}): ${apiUrl} - ${errorBody}`);
      }

      const data = await response.json();
      sendProgress({ stage: 'parsing', message: '正在解析AI结果...', percent: 90 });

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
}