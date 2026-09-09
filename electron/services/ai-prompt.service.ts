import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import log from 'electron-log';

// 提示词功能键白名单
export const PROMPT_KEYS = ['analyze_record', 'batch_match', 'rectify_suggestion', 'issue_desc'] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const MAX_PROMPT_LENGTH = 20000;

export interface PromptVariable {
  name: string;
  description: string;
}

interface PromptDefinition {
  key: PromptKey;
  name: string;
  description: string;
  variables: PromptVariable[];
  builtinTemplate: string;
}

// 内置提示词注册中心：原文搬迁自 ai.ipc.ts，${} 占位符改为 {{}} 风格
export const BUILTIN_PROMPTS: PromptDefinition[] = [
  {
    key: 'analyze_record',
    name: '撰写现场测评记录',
    description: '单条截图/文档分析，为测评项生成测评记录（返回JSON）',
    variables: [
      { name: '安全控制点', description: '测评项所属的安全控制点名称' },
      { name: '测评项', description: '标准条款内容' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据以下信息撰写现场测评记录：

安全控制点：{{安全控制点}}
测评项（标准条款）：{{测评项}}

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
}`,
  },
  {
    key: 'batch_match',
    name: '批量智能匹配分析',
    description: '多截图/文档批量分析，自动匹配测评项并生成记录（返回JSON）',
    variables: [
      { name: '证据描述', description: '截图文件列表、文档文本与OCR提取文字的汇总描述' },
      { name: '测评项列表', description: '当前测评项清单（JSON格式）' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据以下截图、文档内容，智能匹配到对应的测评项，并为每个匹配到的测评项撰写现场测评记录。

{{证据描述}}

测评项列表：
{{测评项列表}}

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
}`,
  },
  {
    key: 'rectify_suggestion',
    name: '整改建议',
    description: '根据问题信息生成整改措施建议（单条与批量共用）',
    variables: [
      { name: '问题标题', description: '问题的标题' },
      { name: '安全域', description: '问题所属安全域' },
      { name: '控制点', description: '问题所属控制点' },
      { name: '控制项', description: '问题所属控制项名称' },
      { name: '问题描述', description: '问题的详细描述' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据以下问题信息，撰写一段连贯的整改建议：

问题标题：{{问题标题}}
安全域：{{安全域}}
控制点：{{控制点}}
控制项：{{控制项}}
问题描述：{{问题描述}}

要求：
- 以"整改措施："开头
- 描述具体的整改措施（需要执行什么操作、修改什么配置、部署什么安全机制等）
- 引用具体的技术手段、配置命令、安全产品或防护措施
- 包含整改优先级和注意事项
- 语句连贯、逻辑清晰，形成一段完整的整改建议描述
- 严禁编造不存在的内容，所有建议必须基于问题描述中的实际情况
- 不要分点列举，保持段落形式

请以纯文本形式返回整改建议（不需要JSON格式）。`,
  },
  {
    key: 'issue_desc',
    name: '一句话问题描述',
    description: '从问题信息中提炼一句话核心风险描述',
    variables: [
      { name: '问题标题', description: '问题的标题' },
      { name: '安全域', description: '问题所属安全域' },
      { name: '控制点', description: '问题所属控制点' },
      { name: '控制项', description: '问题所属控制项名称' },
      { name: '问题描述', description: '当前的详细问题描述' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据以下问题信息，提取出一句话的核心问题描述。

问题标题：{{问题标题}}
安全域：{{安全域}}
控制点：{{控制点}}
控制项：{{控制项}}
当前问题描述：{{问题描述}}

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

请直接返回问题描述文本，不要JSON格式，不要解释。`,
  },
];

export function isValidPromptKey(key: any): key is PromptKey {
  return typeof key === 'string' && (PROMPT_KEYS as readonly string[]).includes(key);
}

export function getPromptDefinition(key: PromptKey): PromptDefinition {
  return BUILTIN_PROMPTS.find(p => p.key === key)!;
}

// 查询当前生效模板：DB 有自定义 → 自定义；无记录或查库异常 → 内置默认
export async function getPromptTemplate(key: PromptKey): Promise<string> {
  const def = getPromptDefinition(key);
  try {
    const db = getDb();
    const rows = await db.select({ template: schema.aiPrompts.template })
      .from(schema.aiPrompts)
      .where(eq(schema.aiPrompts.promptKey, key))
      .limit(1);
    if (rows[0]?.template) {
      return rows[0].template;
    }
  } catch (e: any) {
    log.warn(`[AI提示词] 读取自定义模板失败(${key})，回退内置默认:`, e?.message || e);
  }
  return def.builtinTemplate;
}

// 提取模板中的 {{变量名}} 占位符
export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

// 校验：必需变量是否都在模板中
export function validateTemplate(key: PromptKey, template: string): { ok: boolean; missing: string[] } {
  const def = getPromptDefinition(key);
  const used = new Set(extractVariables(template));
  const missing = def.variables.filter(v => !used.has(v.name)).map(v => `{{${v.name}}}`);
  return { ok: missing.length === 0, missing };
}

// 渲染：按变量表替换；模板中出现但未提供的变量原样保留（便于用户发现拼写问题）
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [name, value] of Object.entries(vars)) {
    result = result.split(`{{${name}}}`).join(value ?? '');
    result = result.split(`{{ ${name} }}`).join(value ?? '');
  }
  return result;
}
