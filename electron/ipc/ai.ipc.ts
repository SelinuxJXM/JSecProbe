import { ipcMain } from 'electron';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import log from 'electron-log';
import sharp from 'sharp';

function sanitize<T>(obj: T): T {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    log.error('IPC返回值序列化失败:', e);
    return obj;
  }
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'svg'].includes(ext);
}

async function encodeImageToBase64(imagePath: string, maxSizeKB: number = 200): Promise<string> {
  try {
    if (!isImageFile(imagePath)) {
      log.warn(`[图片编码] 跳过非图片文件: ${imagePath}`);
      return '';
    }
    
    const imageBuffer = readFileSync(imagePath);
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

function ensureApiUrl(baseUrl: string | null | undefined): string {
  const url = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (url.endsWith('/chat/completions')) {
    return url;
  }
  if (url.includes('/v1')) {
    return `${url}/chat/completions`;
  }
  return `${url}/v1/chat/completions`;
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
          updatedAt: now,
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
      
      log.info(`[测试连接] 请求体: ${JSON.stringify(requestBody)}`);
      
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
    messages: { role: string; content: any }[];
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

      const hasScreenshots = params.screenshots && params.screenshots.length > 0;

      const userContent: any[] = [];

      if (hasScreenshots) {
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

      userContent.push({
        type: 'text',
        text: `关键证据点内容：${params.result || '无文本内容，请分析图片中的证据信息'}`,
      });

      const systemPrompt = `你是一名专业的等级保护测评师。请根据以下信息进行专业分析：

安全控制点：${params.controlPoint}
测评项（标准条款）：${params.requirement}

用户已在"关键证据点"中提供了相关的核查证据（可能包括命令输出、配置信息、访谈记录、截图等）。请严格基于这些证据进行分析。

⚠️ 重要原则：
1. 证据必须与当前测评项直接相关，否则不能作为判定依据
2. 如果提供的证据不足以支撑判定，请如实说明"证据不足"，不要编造结论
3. 如果证据与测评项无关，请如实说明"证据与本测评项无关"
4. 严禁编造不存在的内容，所有结论必须有实际证据支撑
5. 测评结论必须以"经核查，"或"经访谈，"开头，根据证据类型自动选择：
   - 经核查：适用于文档审查、配置检查、命令输出、截图分析等
   - 经访谈：适用于人员访谈、口头确认等
6. 结论中不要重复"核查了"等与开头重复的表述
7. 结论末尾不要写"均满足二级要求"、"综合判定：符合"、"符合等保二级要求"等总结性套话，直接陈述事实即可

请按照以下格式返回JSON结果（不要有其他说明文字）：
{
  "actualOutput": "从关键证据点中提取的核心内容摘要（如无相关内容则写'无相关证据'）",
  "keyEvidencePoints": [
    "关键证据点1：具体描述（仅列出与测评项相关的证据）"
  ],
  "compliance": "符合/部分符合/不符合/不适用/证据不足",
  "conclusion": "经核查，系统密码策略配置如下：PASS_MAX_DAYS=90天，PASS_MIN_DAYS=7天，PASS_WARN_AGE=14天。"
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
      try { _event.sender.send('ai:analysisProgress', data); } catch {}
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

      const hasImages = params.screenshots && params.screenshots.length > 0;

      sendProgress({ stage: 'encoding', message: `正在编码文件...`, percent: 15 });
      log.info(`批量AI分析 请求URL: ${apiUrl}, 模型: ${model}, 图片数: ${hasImages ? params.screenshots.length : 0}`);

      const userContent: any[] = [];
      const imageFileNames: string[] = [];

      if (hasImages) {
        let encoded = 0;
        for (const screenshotPath of params.screenshots) {
          const fileName = screenshotPath.split('\\').pop()?.split('/').pop() || 'unknown';
          imageFileNames.push(fileName);
          
          const base64 = await encodeImageToBase64(screenshotPath);
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
        controlPoint: item.controlPoint,
        requirement: item.requirement,
      })));

      let docContent = '';
      if (params.documents && params.documents.length > 0) {
        for (const doc of params.documents) {
          docContent += `\n=== 文档：${doc.name} ===\n${doc.content}\n`;
        }
      }

      let evidenceDesc = '';
      if (hasImages) {
        evidenceDesc = `已提供 ${params.screenshots.length} 张截图，已附加在消息中（先文本后图片）。`;
      }
      if (docContent) {
        evidenceDesc += `\n\n文档文本内容：\n${docContent}`;
      }

      let promptText = `你是一名专业的等级保护测评师。请根据以下截图、文档内容，智能匹配到对应的测评项，并为每个匹配到的测评项生成专业的测评结论。

${evidenceDesc}

测评项列表：
${itemsJson}

请逐一仔细分析每张截图和文档的具体内容（界面文字、配置项、状态信息、数据等），然后为每项生成详细结论。

⚠️ 重要原则：
1. 仔细分析每张截图和文档的具体内容
2. 将内容与每个测评项的控制点和要求逐项比对
3. 只有当内容与测评项确实相关时才匹配
4. 一个文件可能匹配多个测评项
5. 某个测评项可能匹配多个文件
6. 严禁编造不存在的内容，所有结论必须有实际证据支撑
7. 如果某个测评项没有匹配到相关证据，请标注"证据不足"，不要编造结论
8. 如果证据与测评项无关，请如实说明"证据与本测评项无关"
9. 测评结论必须以"经核查，"或"经访谈，"开头，根据证据类型自动选择：
   - 经核查：适用于文档审查、配置检查、命令输出、截图分析等
   - 经访谈：适用于人员访谈、口头确认等
10. 结论中不要重复"核查了"等与开头重复的表述
11. 结论末尾不要写"均满足二级要求"、"综合判定：符合"、"符合等保二级要求"等总结性套话，直接陈述事实即可

请严格按照以下JSON格式返回结果（不要有其他说明文字）：
{
  "results": [
    {
      "itemId": "匹配到的测评项ID",
      "keyEvidencePoints": [
        "关键证据点1：从截图/文档中提取的具体内容摘要",
        "关键证据点2：与标准要求对比后的发现"
      ],
      "compliance": "符合/部分符合/不符合/不适用/证据不足",
      "conclusion": "经核查，系统密码策略配置如下：PASS_MAX_DAYS=90天，PASS_MIN_DAYS=7天，PASS_WARN_AGE=14天。",
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
      log.info(`[批量AI分析] 请求体预览: ${batchRequestBody.substring(0, 1000)}`);

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