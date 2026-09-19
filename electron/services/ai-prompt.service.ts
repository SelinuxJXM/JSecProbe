import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import log from 'electron-log';

// 提示词功能键白名单
export const PROMPT_KEYS = ['analyze_record', 'batch_match', 'rectify_suggestion', 'issue_desc', 'report_overview', 'report_rectification', 'knowledge_qa', 'command_recommend', 'asset_identify', 'asset_missing', 'dashboard_insight', 'standard_diff_explain', 'standard_compliance_gap'] as const;
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
  {
    key: 'report_overview',
    name: '报告总体分析评价',
    description: '根据测评数据生成报告「总体分析评价」章节内容',
    variables: [
      { name: '项目名称', description: '测评项目名称' },
      { name: '系统名称', description: '被测系统名称' },
      { name: '测评标准', description: '测评依据标准（代号+名称）' },
      { name: '问题总数', description: '发现的安全问题总数' },
      { name: '高风险数', description: '高风险问题数量' },
      { name: '中风险数', description: '中风险问题数量' },
      { name: '低风险数', description: '低风险问题数量' },
      { name: '各域问题分布', description: '各安全域问题分布（JSON）' },
      { name: '合规率', description: '测评合规率（百分比）' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据以下测评数据，撰写报告「五、总体分析评价」章节的正文内容。

项目名称：{{项目名称}}
系统名称：{{系统名称}}
测评标准：{{测评标准}}
问题总数：{{问题总数}}
高风险问题：{{高风险数}}个
中风险问题：{{中风险数}}个
低风险问题：{{低风险数}}个
各域问题分布：{{各域问题分布}}
测评合规率：{{合规率}}

要求：
- 以"经过全面测评，该系统..."开头，直接给出总体判断
- 第一段：概述测评总体情况，包含测评项数量、符合/部分符合/不符合/不适用统计
- 第二段（如有高风险）：说明高风险问题的主要分布领域和潜在影响
- 第三段（如有中风险）：说明中风险问题的分布和影响
- 第四段（如有低风险）：简要说明低风险问题
- 第五段：综合评价，给出整改优先级建议
- 语言正式、客观，符合等级保护测评报告文风
- 每段不超过200字
- 严禁编造不存在的内容

请直接返回各段文本，用空行分隔，不要JSON格式，不要标题行。`,
  },
  {
    key: 'report_rectification',
    name: '报告整改建议及规划',
    description: '根据问题列表生成报告「整改建议及规划」章节内容',
    variables: [
      { name: '项目名称', description: '测评项目名称' },
      { name: '系统名称', description: '被测系统名称' },
      { name: '问题总数', description: '发现的安全问题总数' },
      { name: '高风险数', description: '高风险问题数量' },
      { name: '中风险数', description: '中风险问题数量' },
      { name: '低风险数', description: '低风险问题数量' },
      { name: '问题列表JSON', description: '问题列表（含标题/描述/整改建议，JSON格式）' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据以下问题信息，撰写报告「七、整改建议及规划」章节的正文内容。

项目名称：{{项目名称}}
系统名称：{{系统名称}}
问题总数：{{问题总数}}
高风险问题：{{高风险数}}个
中风险问题：{{中风险数}}个
低风险问题：{{低风险数}}个

问题列表：
{{问题列表JSON}}

要求：
- 按风险等级分段撰写：高风险整改建议、中风险整改建议、低风险整改建议、整改规划
- 每段开头说明该等级问题数量和占比
- 整改建议要具体、可操作，引用问题列表中的实际问题
- 整改规划按"立即整改(0-30天)、中期整改(30-90天)、持续改进(90-180天)"三个阶段
- 每个阶段列出具体工作内容和目标
- 语言正式、专业，符合等级保护测评报告文风
- 严禁编造不存在的内容，所有建议必须基于实际问题

请直接返回正文文本，用空行分隔各段，不要JSON格式，不要标题行。`,
  },
  {
    key: 'knowledge_qa',
    name: '知识库智能问答',
    description: '基于知识库文档内容回答用户的自然语言问题',
    variables: [
      { name: '用户问题', description: '用户输入的自然语言问题' },
      { name: '知识库内容', description: '从知识库中检索到的文档内容（标题+正文片段）' },
    ],
    builtinTemplate: `你是一名专业的网络安全等级保护测评顾问。请基于以下知识库内容，回答用户的问题。

用户问题：{{用户问题}}

知识库检索内容：
{{知识库内容}}

要求：
- 优先基于知识库内容作答，回答需与检索内容中的具体条文、命令、配置一致
- 回答末尾用「参考文档：」列出所引用的文档标题（多个用顿号分隔），若未引用任何文档则省略此行
- 若知识库内容不足以回答问题，明确说明知识库中未找到相关内容，并基于通用专业知识给出简要建议
- 语言简洁专业，直接回答问题，不要复述问题
- 不要编造知识库中不存在的内容

请直接返回回答文本，不要JSON格式。`,
  },
  {
    key: 'command_recommend',
    name: '核查方法与命令智能推荐',
    description: '根据测评项和资产信息推荐库内核查命令；库内不足时补充AI生成核查方法与命令（返回JSON）',
    variables: [
      { name: '控制点', description: '测评项所属安全控制点' },
      { name: '控制项', description: '测评项所属控制项名称' },
      { name: '测评项内容', description: '标准条款内容' },
      { name: '资产信息', description: '当前资产信息（品牌/系统/设备类型）' },
      { name: '候选命令列表', description: '命令库候选命令列表（JSON格式）' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据以下测评项信息和资产信息，从候选命令列表中推荐最相关的核查命令；库内命令不足以覆盖测评项时，补充可执行的核查方法。

安全控制点：{{控制点}}
控制项：{{控制项}}
测评项内容：{{测评项内容}}
资产信息：{{资产信息}}

候选命令列表：
{{候选命令列表}}

选择原则（按优先级）：
- 首先理解"测评项内容要核查什么合规要求"，只选能够直接验证该要求的命令；资产信息仅用于决定命令方言（同一核查意图应选哪个品牌/操作系统版本的命令），不是入选理由
- 严禁因为品牌/操作系统与资产匹配就成批推荐无关命令；每条被推荐的命令都必须能说明它验证了测评项的哪一点
- 只能从候选命令列表的 id 字段中选择，不得编造 id，不得把列表外的命令写进 recommendedIds
- 最多推荐 5 条，按与测评项的相关度从高到低排序，宁缺毋滥；库内没有合适命令时 recommendedIds 返回空数组

核查方法补充（aiMethods）：
- 当库内候选命令无法覆盖测评项的核查需要（如该测评项要求访谈管理员、查阅文档、检查机制配置或做功能验证），或除命令外还需要其他核查手段时，输出 aiMethods 给出具体可执行的核查方法
- type 取值：check（检查配置/策略/日志/文档等取证）、interview（访谈询问管理员或运维人员）、test（功能性测试或穿透验证）
- steps 必须写成可执行的具体步骤（看哪个配置项/日志/菜单、问谁、问什么、用什么验证），禁止空泛表述
- commands 可给出该品牌/操作系统的主流真实命令（注明适用范围），供现场参考；这些命令属于 AI 生成、不在命令库中，禁止编造不存在的参数或回显字段
- aiMethods 必须与测评项直接相关，最多 4 条；没有合适方法时返回空数组；命令与方法都不合适时两个字段均返回空数组

请严格按照以下JSON格式返回（不要有其他说明文字）：
{
  "recommendedIds": ["命令ID1", "命令ID2"],
  "reasons": {
    "命令ID1": "一句话说明该命令验证了测评项的什么内容",
    "命令ID2": "一句话说明该命令验证了测评项的什么内容"
  },
  "aiMethods": [
    {
      "type": "check",
      "title": "方法名称（简短）",
      "steps": ["具体步骤1", "具体步骤2"],
      "commands": [
        { "name": "命令用途", "command": "具体命令", "os": "适用系统如 Oracle Linux 7", "brand": "适用厂商如 Oracle" }
      ],
      "reason": "为什么需要该方法、与测评项的关联"
    }
  ]
}`,
  },
  {
    key: 'asset_identify',
    name: 'AI资产识别',
    description: '根据粘贴的系统描述信息识别资产清单，辅助快速录入系统构成（返回JSON）',
    variables: [
      { name: '系统信息', description: '项目名称/被测单位/定级信息等上下文' },
      { name: '系统描述', description: '用户粘贴的系统描述文本' },
      { name: '资产分类说明', description: '支持的资产分类ID与名称对照' },
      { name: '现有资产清单', description: '项目中已录入的资产列表（用于去重）' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据用户提供的系统描述信息，识别并整理出该信息系统应纳入测评范围的资产清单。

系统信息：{{系统信息}}
系统描述：{{系统描述}}
资产分类说明：{{资产分类说明}}
现有资产清单：{{现有资产清单}}

要求：
- 只提取系统描述或附件中有明确文字依据（出现具体设备、角色、数量、软件名称等线索）的资产；"系统信息"仅作为命名和分级的背景参考，不得作为资产依据
- 严禁结合等保通用经验补充描述中未出现的"常见必备资产"（如服务器、数据库、防火墙、终端等）；若系统描述不含实质内容（如随机字符、无意义数字、测试文字）或识别不出任何资产，必须返回 {"assets": []}
- 每个资产的 evidence 字段必须摘录描述或附件中支撑该资产的原文片段；给不出依据的资产一律不得输出
- category 必须从资产分类说明列出的分类ID中选择，每个资产只归入一个最匹配的分类
- 现有资产清单中已存在的资产不要重复输出
- name 简洁明确（如"核心交换机"、"Oracle 11g 数据库"）
- importance 取值只能是 high（关键）/medium（重要）/low（一般）
- quantity 为数量，默认 1
- ip、os、version、deviceUsage、description 无信息时填空字符串
- isVirtual 表示是否为虚拟化设备（VMware 虚机、云主机、容器、超融合虚拟机等填 true，物理设备填 false，不确定时填 false）
- dbSystem 仅在资产为数据库系统（分类 server_storage 且用途为数据库，或业务应用依赖的数据库实例）时填写具体数据库名称及版本（如 "Oracle 11g"、"MySQL 8.0"），其余填空字符串
- middleware 仅在资产明确使用或承载中间件时填写具体中间件名称及版本（如 "Tomcat 9.0"、"Nginx 1.24"），其余填空字符串
- 最多识别 30 个资产

请严格按照以下JSON格式返回（不要有其他说明文字）：
{
  "assets": [
    {
      "category": "分类ID",
      "name": "资产名称",
      "os": "",
      "version": "",
      "ip": "",
      "quantity": 1,
      "importance": "medium",
      "isVirtual": false,
      "dbSystem": "",
      "middleware": "",
      "deviceUsage": "用途一句话",
      "description": "",
      "evidence": "支撑该资产的描述原文片段"
    }
  ]
}`,
  },
  {
    key: 'asset_missing',
    name: '缺失资产智能提醒',
    description: '根据已录入资产分布分析缺失的资产类别及其对测评的影响（返回JSON）',
    variables: [
      { name: '系统信息', description: '项目名称/被测单位/定级信息等上下文' },
      { name: '资产分类清单', description: '支持的资产分类ID与名称对照' },
      { name: '已录入资产分布', description: '当前项目已录入资产的分类分布' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请根据已录入的资产分布情况，分析该信息系统在资产构成上可能存在的缺失项，并评估其对等级保护测评的影响。

系统信息：{{系统信息}}
资产分类清单：{{资产分类清单}}
已录入资产分布：{{已录入资产分布}}

要求：
- 结合等级保护2.0各安全层面（物理和环境安全、安全通信网络、安全区域边界、安全计算环境、安全管理中心）的常见资产构成要求进行分析
- 仅列出明显缺失或明显不足的分类，已有充足资产的分类不要列出
- 若资产构成已较完整，返回空数组
- risk 说明该类资产缺失会导致哪些安全层面/控制点无法有效核查
- suggestion 给出具体、可操作的补充建议

请严格按照以下JSON格式返回（不要有其他说明文字）：
{
  "missing": [
    {
      "category": "分类ID",
      "risk": "缺失风险说明（涉及的安全层面与控制点）",
      "suggestion": "补充建议"
    }
  ]
}`,
  },
  {
    key: 'dashboard_insight',
    name: '工作台数据洞察与异常预警',
    description: '基于工作台统计数据与规则预警命中结果，生成总体态势洞察和每条预警的处置建议（返回JSON）',
    variables: [
      { name: '工作台统计', description: '项目总数/状态分布/等级分布/资产总数等汇总数据' },
      { name: '项目创建趋势', description: '近6个月每月新建项目数与累计数' },
      { name: '问题统计', description: '安全问题按状态与风险等级的分布' },
      { name: '预警规则命中', description: '系统规则检测出的异常预警清单（key/级别/标题/详情）' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评项目管理专家。请基于工作台统计数据和系统规则检测出的预警清单，生成工作台数据洞察。

工作台统计：{{工作台统计}}
项目创建趋势：{{项目创建趋势}}
问题统计：{{问题统计}}
预警规则命中：{{预警规则命中}}

要求：
- insight 面向测评机构负责人：概括项目整体态势、等级结构特点、进度状况、问题整改压力与趋势变化，并给出1-3条聚焦的行动建议
- insight 使用简明的中文叙述，可用分号分层，不要使用一级标题，控制在300-600字
- 预警由系统规则检出，你不得新增或删除预警，只能针对每条命中的预警（key 一一对应）给出具体、可操作的处置建议
- 每条建议控制在80-150字，说明应优先做什么、如何核实、可能的影响
- 所有结论必须严格基于给定数据，不得编造数字或推断数据中不存在的事实；若数据不足则如实说明

请严格按照以下JSON格式返回（不要有其他说明文字）：
{
  "insight": "总体态势洞察文本",
  "alertAdvices": [
    { "key": "预警key（与预警规则命中中的key一致）", "advice": "处置建议" }
  ]
}`,
  },
  {
    key: 'standard_diff_explain',
    name: '标准差异智能解读',
    description: '对两个标准的对照结果进行专家解读：总体结论、关键差异点及其对测评业务的影响、落地建议（返回JSON）',
    variables: [
      { name: '基准标准', description: '基准标准的名称与代号' },
      { name: '对照标准', description: '对照标准的名称与代号' },
      { name: '对照统计', description: '控制点总数/等级差异数/要求文差异数/行业扩展数' },
      { name: '差异明细', description: '差异条目清单（差异类型/域/控制点/等级/要求摘要）' },
    ],
    builtinTemplate: `你是一名精通网络安全等级保护标准体系的测评专家。请对以下两个标准的对照结果进行专业解读。

基准标准：{{基准标准}}
对照标准：{{对照标准}}
对照统计：{{对照统计}}
差异明细：{{差异明细}}

要求：
- summary 概括两个标准的总体关系与差异规模，指出差异主要集中在哪些安全层面，控制在200-400字
- keyDiffs 挑选最重要的差异要点（最多12条，按重要性排序）：point 简述差异内容，impact 说明该差异对测评实施（测评项数量、测评方法、证据要求、工作量）的具体影响
- advice 给出面向测评机构的落地建议：如何基于对照结果调整测评模板、证据收集与工作量估算，使用简明条目式文字
- 只基于差异明细中实际存在的内容解读，不得编造不存在的条款；若差异很少则如实说明

请严格按照以下JSON格式返回（不要有其他说明文字）：
{
  "summary": "总体解读",
  "keyDiffs": [
    { "domain": "安全层面/域", "point": "差异要点", "impact": "对测评业务的影响" }
  ],
  "advice": "落地建议"
}`,
  },
  {
    key: 'standard_compliance_gap',
    name: '合规差距智能分析',
    description: '基于项目在选定标准下各安全域的测评覆盖与符合情况，分析合规差距、风险与优先级（返回JSON）',
    variables: [
      { name: '项目信息', description: '项目名称/被测单位/保护等级/所用标准' },
      { name: '各域合规统计', description: '各安全域的适用条目数/已测评/符合/部分符合/不符合/不适用/未测评及覆盖率' },
      { name: '不符合条目样例', description: '部分不符合条目的控制点与要求摘要' },
    ],
    builtinTemplate: `你是一名专业的等级保护测评师。请基于项目在选定标准下各安全域的测评覆盖与符合情况，分析当前的合规差距。

项目信息：{{项目信息}}
各域合规统计：{{各域合规统计}}
不符合条目样例：{{不符合条目样例}}

要求：
- summary 总体评价项目的测评覆盖程度与合规水平，指出最薄弱的安全层面，控制在150-300字
- gaps 逐域分析存在明显差距的层面（最多10条，按优先级排序）：gap 描述差距（覆盖缺口或符合缺口），risk 说明该差距可能带来的测评结论风险，priority 取 high/medium/low，suggestion 给出补充测评或整改的具体建议
- 覆盖率高且符合率高的域不要列入 gaps；若整体已较完善，返回空数组并在 summary 中说明
- 所有结论必须严格基于给定统计数据，不得编造数字

请严格按照以下JSON格式返回（不要有其他说明文字）：
{
  "summary": "总体评价",
  "gaps": [
    { "domain": "安全层面/域", "gap": "差距描述", "risk": "风险说明", "priority": "high或medium或low", "suggestion": "建议" }
  ]
}`,
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
  // 单遍替换（E11）。
  //
  // 原实现按变量表顺序反复 `split(...).join(...)`：若某个**变量的值**里含有
  // `{{另一个变量}}`，它会在后续迭代中被二次展开。而变量值来自用户填写的证据文本、
  // 资产名称等不可信输入 —— 用户只要在证据里写 `{{xxx}}` 就能注入模板指令，
  // 视模板定义不同可改写 AI 的系统约束（二阶模板注入）。
  //
  // `String.replace` 只扫描原串一次，替换进去的内容不再参与匹配，从根本上消除该面；
  // 同时也与 `extractVariables` 用同一套正则，支持 `{{ name }}` 这类带空格写法。
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawName: string) => {
    const name = rawName.trim();
    if (!(name in vars)) return match; // 未提供：原样保留，便于发现拼写问题
    const value = vars[name];
    return value ?? '';
  });
}
