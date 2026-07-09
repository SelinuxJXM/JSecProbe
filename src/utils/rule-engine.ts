interface RuleMatch {
  result: 'compliant' | 'partial' | 'non_compliant';
  confidence: number;
  evidence: string;
  findings: string;
}

interface Rule {
  keywords: string[];
  patterns: RegExp[];
  result: 'compliant' | 'partial' | 'non_compliant';
  confidence: number;
  evidenceTemplate: string;
  findingsTemplate: string;
}

const CONTROL_POINT_RULES: Record<string, Rule[]> = {
  '身份鉴别': [
    {
      keywords: ['已启用', '已配置', '已开启', '已使用', '密码', '口令', '双因素', '生物识别'],
      patterns: [/已(启用|配置|开启|使用)/i, /密码.{0,10}(复杂度|长度|有效期)/i, /双因素|MFA|2FA/i],
      result: 'compliant',
      confidence: 0.85,
      evidenceTemplate: '系统已启用{keyword}机制，符合身份鉴别要求',
      findingsTemplate: '身份鉴别措施已部署，配置符合安全要求',
    },
    {
      keywords: ['未启用', '未配置', '默认密码', '弱口令', '无密码'],
      patterns: [/未(启用|配置|修改)/i, /默认(密码|口令)/i, /弱口令|弱密码/i],
      result: 'non_compliant',
      confidence: 0.9,
      evidenceTemplate: '系统{keyword}，存在安全风险',
      findingsTemplate: '身份鉴别措施缺失，建议立即整改',
    },
    {
      keywords: ['部分启用', '部分配置', '部分用户', '部分系统'],
      patterns: [/部分(启用|配置|覆盖)/i],
      result: 'partial',
      confidence: 0.75,
      evidenceTemplate: '系统{keyword}，覆盖不完全',
      findingsTemplate: '身份鉴别措施未全量覆盖，建议完善',
    },
  ],
  '访问控制': [
    {
      keywords: ['已配置', '已设置', '已授权', '已分配', '权限分离', '最小权限', '三权分立'],
      patterns: [/已(配置|设置|授权|分配)/i, /权限(分离|划分|管理)/i, /最小(权限|特权)/i],
      result: 'compliant',
      confidence: 0.85,
      evidenceTemplate: '访问控制策略已{keyword}，权限管理符合要求',
      findingsTemplate: '访问控制措施已部署，权限分配合理',
    },
    {
      keywords: ['未配置', '未设置', '未授权', '权限过大', '权限混乱', '无控制'],
      patterns: [/未(配置|设置|授权)/i, /权限(过大|混乱|不明)/i, /无(访问|权限)控制/i],
      result: 'non_compliant',
      confidence: 0.9,
      evidenceTemplate: '访问控制{keyword}，存在越权风险',
      findingsTemplate: '访问控制缺失，建议建立权限管理体系',
    },
  ],
  '安全审计': [
    {
      keywords: ['已开启', '已启用', '已配置', '日志记录', '审计日志', 'syslog'],
      patterns: [/已(开启|启用|配置)/i, /日志(记录|审计|收集)/i, /syslog|审计日志/i],
      result: 'compliant',
      confidence: 0.85,
      evidenceTemplate: '安全审计功能已{keyword}，日志正常记录',
      findingsTemplate: '安全审计措施已部署，日志记录正常',
    },
    {
      keywords: ['未开启', '未启用', '无日志', '日志未记录', '审计关闭'],
      patterns: [/未(开启|启用|配置)/i, /无(日志|审计)/i, /审计(关闭|未开启)/i],
      result: 'non_compliant',
      confidence: 0.9,
      evidenceTemplate: '安全审计{keyword}，无法追溯安全事件',
      findingsTemplate: '安全审计缺失，建议开启日志功能',
    },
  ],
  '入侵防范': [
    {
      keywords: ['已安装', '已部署', '已更新', '已配置', 'IDS', 'IPS', '防火墙'],
      patterns: [/已(安装|部署|更新|配置)/i, /IDS|IPS|WAF/i, /(入侵|攻击)检测/i],
      result: 'compliant',
      confidence: 0.85,
      evidenceTemplate: '入侵防范措施已{keyword}，防护正常',
      findingsTemplate: '入侵防范措施已部署，规则库版本正常',
    },
    {
      keywords: ['未安装', '未部署', '未更新', '规则过期', '特征库过期'],
      patterns: [/未(安装|部署|更新|配置)/i, /(规则|特征)库(过期|未更新)/i],
      result: 'non_compliant',
      confidence: 0.9,
      evidenceTemplate: '入侵防范{keyword}，存在被攻击风险',
      findingsTemplate: '入侵防范措施缺失，建议部署并更新规则库',
    },
  ],
  '数据安全': [
    {
      keywords: ['已加密', '已脱敏', '已备份', '已分类分级', '数据加密', '传输加密'],
      patterns: [/已(加密|脱敏|备份|分类)/i, /(传输|存储)加密/i, /(数据|信息)安全(策略|措施)/i],
      result: 'compliant',
      confidence: 0.85,
      evidenceTemplate: '数据安全措施已{keyword}，数据保护符合要求',
      findingsTemplate: '数据安全措施已部署，加密和备份机制正常',
    },
    {
      keywords: ['未加密', '未脱敏', '未备份', '明文传输', '数据泄露'],
      patterns: [/未(加密|脱敏|备份)/i, /明文(传输|存储)/i, /数据(泄露|泄漏)/i],
      result: 'non_compliant',
      confidence: 0.9,
      evidenceTemplate: '数据安全{keyword}，存在数据泄露风险',
      findingsTemplate: '数据安全措施缺失，建议实施加密和备份',
    },
  ],
};

const DEFAULT_RULES: Rule[] = [
  {
    keywords: ['符合', '满足', '已配置', '已启用', '正常', '通过', '是'],
    patterns: [/已(配置|启用|实现|部署)/i, /符合(要求|规范|标准)/i, /正常(运行|工作)/i],
    result: 'compliant',
    confidence: 0.7,
    evidenceTemplate: '测评结果符合安全要求',
    findingsTemplate: '该控制点满足基本安全要求',
  },
  {
    keywords: ['不符合', '不满足', '未配置', '未启用', '异常', '错误', '否'],
    patterns: [/未(配置|启用|实现|部署)/i, /不(符合|满足)/i, /(异常|错误|失败)/i],
    result: 'non_compliant',
    confidence: 0.8,
    evidenceTemplate: '测评结果不符合安全要求',
    findingsTemplate: '该控制点不满足基本安全要求，需整改',
  },
  {
    keywords: ['部分', '不完全', '有待完善', '大部分', '基本'],
    patterns: [/部分(符合|满足|配置)/i, /有待(完善|改进|提升)/i, /基本(符合|满足)/i],
    result: 'partial',
    confidence: 0.65,
    evidenceTemplate: '测评结果部分符合安全要求',
    findingsTemplate: '该控制点仅部分满足安全要求，需补充完善',
  },
];

function matchKeywords(text: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

function matchPatterns(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[0];
  }
  return null;
}

function getControlPoint(requirement: string): string | null {
  const controlPoints = Object.keys(CONTROL_POINT_RULES);
  for (const cp of controlPoints) {
    if (requirement.includes(cp)) return cp;
  }
  return null;
}

export function evaluateByRules(
  requirement: string,
  commandOutput: string,
): RuleMatch | null {
  const matchedKeyword = matchKeywords(commandOutput, ['符合', '不符合', '已启用', '未启用', '是', '否']);
  if (matchedKeyword) {
    const controlPoint = getControlPoint(requirement);
    const rules = controlPoint ? CONTROL_POINT_RULES[controlPoint] : DEFAULT_RULES;

    for (const rule of rules) {
      const kw = matchKeywords(commandOutput, rule.keywords);
      if (kw) {
        return {
          result: rule.result,
          confidence: rule.confidence,
          evidence: rule.evidenceTemplate.replace('{keyword}', kw),
          findings: rule.findingsTemplate,
        };
      }

      const pattern = matchPatterns(commandOutput, rule.patterns);
      if (pattern) {
        return {
          result: rule.result,
          confidence: rule.confidence,
          evidence: rule.evidenceTemplate.replace('{keyword}', pattern),
          findings: rule.findingsTemplate,
        };
      }
    }
  }

  for (const rule of DEFAULT_RULES) {
    const kw = matchKeywords(commandOutput, rule.keywords);
    if (kw) {
      return {
        result: rule.result,
        confidence: rule.confidence,
        evidence: rule.evidenceTemplate.replace('{keyword}', kw),
        findings: rule.findingsTemplate,
      };
    }

    const pattern = matchPatterns(commandOutput, rule.patterns);
    if (pattern) {
      return {
        result: rule.result,
        confidence: rule.confidence,
        evidence: rule.evidenceTemplate.replace('{keyword}', pattern),
        findings: rule.findingsTemplate,
      };
    }
  }

  return {
    result: 'partial',
    confidence: 0.4,
    evidence: '无法通过规则引擎确定判定结果，请人工核查',
    findings: '建议补充更多信息或使用AI辅助分析',
  };
}

export function isAIConfigured(): boolean {
  const settings = localStorage.getItem('ai_settings');
  if (!settings) return false;
  try {
    const parsed = JSON.parse(settings);
    return !!(parsed.apiKey && parsed.apiKey.length > 0);
  } catch {
    return false;
  }
}

export function evaluateBatch(
  items: { requirement: string; commandOutput: string }[],
): (RuleMatch | null)[] {
  return items.map((item) => evaluateByRules(item.requirement, item.commandOutput));
}