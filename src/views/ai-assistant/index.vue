<template>
  <div class="page-container ai-container">
    <div class="page-header">
      <div>
        <div class="page-header-title">AI智能辅助</div>
        <div class="page-header-desc">AI辅助测评分析与结论生成</div>
      </div>
      <div class="page-header-actions">
        <el-select
          v-model="selectedProjectId"
          placeholder="选择项目"
          style="width: 200px; margin-right: 8px;"
          :loading="projectsLoading"
          clearable
        >
          <el-option
            v-for="proj in projectList"
            :key="proj.id"
            :label="proj.name"
            :value="proj.id"
          />
        </el-select>
        <el-button :icon="Setting" @click="showSettings = true">
          AI设置
        </el-button>
        <el-button type="danger" :icon="Delete" @click="clearChat" :disabled="messages.length === 0">
          清空对话
        </el-button>
      </div>
    </div>

    <!-- 5步进度指示 -->
    <div class="ai-progress-bar" v-if="workflowMode">
      <div
        v-for="(step, index) in workflowSteps"
        :key="step.key"
        class="step-item"
        :class="{
          'step-active': index === workflowStep,
          'step-completed': index < workflowStep,
        }"
        @click="workflowStep = index"
      >
        <span class="step-number">{{ index + 1 }}</span>
        <span class="step-label">{{ step.label }}</span>
      </div>
    </div>

    <div class="ai-layout">
      <div class="ai-sidebar">
        <div class="ai-sidebar-section">
          <div class="ai-sidebar-title">快捷功能</div>
          <div class="ai-quick-actions">
            <div class="ai-quick-action" @click="quickAction('analyze')">
              <el-icon :size="20"><DataAnalysis /></el-icon>
              <span>测评结果分析</span>
            </div>
            <div class="ai-quick-action" @click="quickAction('rectify')">
              <el-icon :size="20"><Tools /></el-icon>
              <span>整改建议生成</span>
            </div>
            <div class="ai-quick-action" @click="quickAction('conclusion')">
              <el-icon :size="20"><Document /></el-icon>
              <span>测评结论撰写</span>
            </div>
            <div class="ai-quick-action" @click="quickAction('risk')">
              <el-icon :size="20"><Warning /></el-icon>
              <span>风险等级评估</span>
            </div>
          </div>
        </div>

        <div class="ai-sidebar-section">
          <div class="ai-sidebar-title">截图分析</div>
          <div class="ai-upload-area" @click="triggerScreenshotUpload" @dragover.prevent @drop.prevent="handleDrop">
            <el-icon :size="32" class="upload-icon"><Picture /></el-icon>
            <div class="upload-text">点击或拖拽上传截图</div>
            <div class="upload-hint">支持 JPG、PNG 格式</div>
            <input ref="fileInput" type="file" accept="image/*" hidden @change="handleFileSelect" />
          </div>
          <div v-if="screenshotPreview" class="screenshot-preview">
            <img :src="screenshotPreview" alt="截图预览" />
            <el-button type="primary" size="small" :loading="analyzing" @click="analyzeScreenshot">
              {{ analyzing ? '分析中...' : '开始分析' }}
            </el-button>
          </div>
        </div>

        <div class="ai-sidebar-section">
          <div class="ai-sidebar-title">当前状态</div>
          <div class="ai-status">
            <div class="status-item">
              <span class="status-dot" :class="{ active: isConfigured }"></span>
              <span>{{ isConfigured ? 'AI已配置' : 'AI未配置' }}</span>
            </div>
            <div class="status-desc">
              {{ isConfigured ? `使用模型：${aiSettings.model}` : '请先在设置中配置API密钥' }}
            </div>
          </div>
        </div>
      </div>

      <div class="ai-chat-area">
        <div class="ai-messages" ref="messagesContainer">
          <div v-if="messages.length === 0" class="ai-empty">
            <el-icon :size="64" class="empty-icon"><ChatDotRound /></el-icon>
            <div class="empty-title">AI智能助手</div>
            <div class="empty-desc">有什么可以帮助您的？</div>
            <div class="empty-suggestions">
              <div class="suggestion-item" @click="quickAction('analyze')">
                帮我分析当前项目的测评结果
              </div>
              <div class="suggestion-item" @click="quickAction('rectify')">
                生成高风险问题的整改建议
              </div>
              <div class="suggestion-item" @click="quickAction('conclusion')">
                帮我撰写测评结论
              </div>
            </div>
          </div>

          <div
            v-for="(msg, index) in messages"
            :key="index"
            class="ai-message"
            :class="msg.role"
          >
            <div class="msg-avatar">
              <el-icon v-if="msg.role === 'user'"><User /></el-icon>
              <el-icon v-else><MagicStick /></el-icon>
            </div>
            <div class="msg-content">
              <div class="msg-role">{{ msg.role === 'user' ? '我' : 'AI助手' }}</div>
              <div class="msg-bubble markdown-body" v-html="renderMarkdown(msg.content)"></div>
              <div v-if="msg.role === 'assistant' && msg.suggestions" class="msg-suggestions">
                <el-tag
                  v-for="(sug, i) in msg.suggestions"
                  :key="i"
                  effect="plain"
                  class="suggestion-tag"
                  @click="sendMessage(sug)"
                >
                  {{ sug }}
                </el-tag>
              </div>
            </div>
          </div>

          <div v-if="loading" class="ai-message assistant">
            <div class="msg-avatar">
              <el-icon><MagicStick /></el-icon>
            </div>
            <div class="msg-content">
              <div class="msg-role">AI助手</div>
              <div class="msg-bubble typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>

        <div class="ai-input-area">
          <div class="ai-input-wrapper">
            <el-input
              v-model="inputMessage"
              type="textarea"
              :rows="2"
              placeholder="输入您的问题..."
              resize="none"
              @keydown.enter.exact.prevent="sendMessage()"
            />
            <div class="ai-input-actions">
              <el-button :icon="Picture" circle @click="triggerScreenshotUpload" />
              <el-button
                type="primary"
                :icon="Promotion"
                :disabled="!inputMessage.trim() || loading"
                :loading="loading"
                @click="sendMessage()"
              >
                发送
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="showSettings" title="AI设置" width="600px" destroy-on-close>
      <div class="ai-settings">
        <!-- API格式 -->
        <div class="setting-item">
          <label class="setting-label"><span class="required">*</span>API格式</label>
          <el-select v-model="aiSettings.apiFormat" style="width: 100%">
            <el-option label="OpenAI Chat Completions 格式" value="openai" />
            <el-option label="Claude Messages 格式" value="claude" />
            <el-option label="Gemini GenerateContent 格式" value="gemini" />
          </el-select>
        </div>

        <!-- 自定义请求地址 -->
        <div class="setting-item">
          <div class="setting-label-row">
            <label class="setting-label"><span class="required">*</span>自定义请求地址</label>
            <el-switch v-model="aiSettings.fullUrl" size="small" />
          </div>
          <el-input
            v-model="aiSettings.baseUrl"
            :placeholder="aiSettings.fullUrl ? 'e.g. https://api.openai.com/v1' : 'e.g. https://api.openai.com'"
            :disabled="false"
          />
        </div>

        <!-- 提示信息 -->
        <div class="setting-hint">
          系统会自动补充 /v1/chat/completions 路径。如需自定义完整路径，请开启「完整URL」开关。
        </div>

        <!-- 模型ID -->
        <div class="setting-item">
          <div class="setting-label-row">
            <label class="setting-label"><span class="required">*</span>模型ID</label>
            <el-switch v-model="aiSettings.multiModal" size="small">多模态</el-switch>
          </div>
          <el-input
            v-model="aiSettings.model"
            placeholder="输入模型ID，例如：gpt-4o"
          />
        </div>

        <!-- API密钥 -->
        <div class="setting-item">
          <label class="setting-label"><span class="required">*</span>API密钥</label>
          <el-input
            v-model="aiSettings.apiKey"
            type="password"
            show-password
            placeholder="输入 API 密钥"
          />
        </div>

        <!-- 测试连接 -->
        <div class="setting-item">
          <el-button 
            type="success" 
            plain 
            :loading="testLoading" 
            @click="handleTestConnection"
            style="width: 100%"
          >
            {{ testLoading ? '测试中...' : '🔌 测试连接' }}
          </el-button>
          <div v-if="testResult" class="test-result" :class="testResult.success ? 'test-success' : 'test-error'">
            <div v-if="testResult.success">✅ 连接成功！回复：{{ testResult.data.reply }}</div>
            <div v-else>
              ❌ 失败 [{{ testResult.error.code }}]：{{ testResult.error.message }}
              <div v-if="testResult.error.details" class="test-details">{{ testResult.error.details }}</div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showSettings = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { evaluateByRules } from '@/utils/rule-engine';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

function renderMarkdown(content: string): string {
  if (!content) return '';
  const html = marked.parse(content) as string;
  return DOMPurify.sanitize(html);
}
import {
  Setting,
  Delete,
  DataAnalysis,
  Tools,
  Document,
  Warning,
  Picture,
  ChatDotRound,
  User,
  MagicStick,
  Promotion,
} from '@element-plus/icons-vue';

const showSettings = ref(false);
const loading = ref(false);
const analyzing = ref(false);
const messages = ref<{ role: string; content: string; suggestions?: string[] }[]>([]);
const inputMessage = ref('');
const screenshotPreview = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const messagesContainer = ref<HTMLElement | null>(null);
const selectedProjectId = ref<string>('');
const projectList = ref<any[]>([]);
const projectsLoading = ref(false);

const aiSettings = reactive({
  apiFormat: 'openai',
  fullUrl: false,
  multiModal: true,
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  temperature: 0.3,
  provider: 'openai',
});

const isConfigured = computed(() => aiSettings.apiKey.length > 0);

const testLoading = ref(false);
const testResult = ref<any>(null);

async function handleTestConnection() {
  if (!window.api) return;
  testLoading.value = true;
  testResult.value = null;
  try {
    let baseUrl = aiSettings.baseUrl.trim().replace(/\/+$/, '');
    const res = await window.api.ai.testConnection({
      apiBase: baseUrl,
      apiKey: aiSettings.apiKey,
      model: aiSettings.model,
    });
    testResult.value = res;
  } catch (err: any) {
    testResult.value = { success: false, error: { code: 'CLIENT_ERROR', message: err.message } };
  } finally {
    testLoading.value = false;
  }
}

// 加载项目列表
async function loadProjects() {
  if (!window.api) return;
  projectsLoading.value = true;
  try {
    const res = await window.api.project.list({ page: 1, pageSize: 100 });
    if (res.success && res.data) {
      projectList.value = res.data.list || [];
      if (projectList.value.length > 0 && !selectedProjectId.value) {
        selectedProjectId.value = projectList.value[0].id;
      }
    }
  } catch (e) {
    console.error('加载项目列表失败:', e);
  } finally {
    projectsLoading.value = false;
  }
}

// 获取项目问题数据并格式化为上下文
async function getProjectContext(): Promise<string> {
  if (!selectedProjectId.value) {
    return '未选择项目，请先选择要分析的项目。';
  }
  try {
    const summaryRes = await window.api.issue.getSummary(selectedProjectId.value);
    const issuesRes = await window.api.issue.list({
      projectId: selectedProjectId.value,
      page: 1,
      pageSize: 1000,
    });

    const summary = summaryRes.success && summaryRes.data ? summaryRes.data : null;
    const issues = issuesRes.success && issuesRes.data ? issuesRes.data.list : [];

    if (!summary && issues.length === 0) {
      return '当前项目暂无测评问题数据。';
    }

    let context = `## 项目测评数据\n\n`;
    if (summary) {
      context += `**项目总数**: ${summary.total} 项\n`;
      context += `**高风险**: ${summary.highRisk || 0} 项\n`;
      context += `**中风险**: ${summary.mediumRisk || 0} 项\n`;
      context += `**低风险**: ${summary.lowRisk || 0} 项\n`;
      context += `**待整改**: ${summary.pending || 0} 项\n`;
      context += `**整改中**: ${summary.rectifying || 0} 项\n`;
      context += `**已整改**: ${summary.resolved || 0} 项\n`;
      context += `**已关闭**: ${summary.closed || 0} 项\n`;
      if (summary.complianceRate !== undefined) {
        context += `**符合率**: ${summary.complianceRate}%\n`;
      }
      context += `\n`;
    }
    if (issues.length > 0) {
      context += `**问题列表（前20条）**:\n`;
      issues.slice(0, 20).forEach((issue: any, idx: number) => {
        context += `${idx + 1}. [${issue.riskLevel === 'high' ? '高' : issue.riskLevel === 'medium' ? '中' : '低'}] ${issue.issueTitle} - ${issue.securityDomain || ''} (${issue.status === 'pending' ? '待整改' : issue.status === 'rectifying' ? '整改中' : issue.status === 'resolved' ? '已整改' : '已关闭'})\n`;
      });
      if (issues.length > 20) {
        context += `\n...共 ${issues.length} 条问题`;
      }
    }
    return context;
  } catch (e) {
    console.error('获取项目数据失败:', e);
    return '获取项目数据失败，请检查项目是否存在。';
  }
}
const workflowMode = ref(true);
const workflowStep = ref(0);
const workflowSteps = [
  { key: 'upload', label: '上传' },
  { key: 'ocr', label: 'OCR识别' },
  { key: 'analyze', label: 'AI分析' },
  { key: 'generate', label: '生成结果' },
  { key: 'confirm', label: '确认填入' },
];

// 加载设置
async function loadSettings() {
  if (!window.api) return;
  try {
    const res = await window.api.ai.getConfig();
    if (res.success && res.data && Object.keys(res.data).length > 0) {
      aiSettings.apiKey = res.data.apiKey || '';
      aiSettings.baseUrl = res.data.apiBase || 'https://api.openai.com/v1';
      aiSettings.model = res.data.model || 'gpt-4o';
      aiSettings.temperature = res.data.temperature ?? 0.3;
      aiSettings.multiModal = (res.data.multiModal ?? 0) === 1;
      aiSettings.fullUrl = aiSettings.baseUrl.includes('/v1');
      aiSettings.apiFormat = aiSettings.fullUrl ? 'openai' : 'openai';
    }
  } catch (e) {
    console.error('Failed to load AI settings', e);
  }
}

// 保存设置
async function saveSettings() {
  if (!window.api) {
    ElMessage.warning('请在 Electron 环境中运行');
    return;
  }
  try {
    let baseUrl = aiSettings.baseUrl.trim().replace(/\/+$/, '');
    const res = await window.api.ai.saveConfig({
      apiBase: baseUrl,
      apiKey: aiSettings.apiKey,
      model: aiSettings.model,
      temperature: aiSettings.temperature,
    });
    if (res.success) {
      ElMessage.success('设置已保存');
      showSettings.value = false;
      await loadSettings();
    } else {
      ElMessage.error('保存失败：' + (res.error?.message || '未知错误'));
    }
  } catch (error: any) {
    ElMessage.error('保存失败：' + error.message);
  }
}

function mockAIResponse(prompt: string): { content: string; suggestions: string[] } {
  if (prompt.includes('分析') || prompt.includes('测评结果')) {
    return {
      content: `<strong>测评结果分析</strong><br><br>根据当前项目的测评数据，我为您进行以下分析：<br><br><strong>1. 整体情况</strong><br>项目整体符合率约为 78.5%，处于中等偏上水平。主要问题集中在安全计算环境和安全运维管理两个方面。<br><br><strong>2. 高风险问题分布</strong><br>- 安全计算环境：5项<br>- 安全区域边界：3项<br>- 安全运维管理：2项<br><br><strong>3. 重点关注领域</strong><br>身份鉴别和访问控制是最常见的不符合项，建议优先整改。<br><br><strong>4. 建议</strong><br>建议优先整改高风险问题，然后逐步完善中低风险项。`,
      suggestions: ['生成整改优先级建议', '生成详细整改方案', '分析高风险问题原因'],
    };
  }
  
  if (prompt.includes('整改') || prompt.includes('建议')) {
    return {
      content: `<strong>整改建议生成</strong><br><br>针对当前发现的高风险问题，建议如下整改措施：<br><br><strong>1. 身份鉴别类问题</strong><br>- 启用强口令策略，要求长度≥8位，包含大小写字母、数字和特殊字符<br>- 配置登录失败锁定策略，建议5次失败锁定15分钟<br>- 启用会话超时自动退出，建议15分钟无操作自动登出<br><br><strong>2. 访问控制类问题</strong><br>- 清理冗余账户和过期账户<br>- 实施最小权限原则，按需分配权限<br>- 定期审计权限分配情况<br><br><strong>3. 安全审计类问题</strong><br>- 启用操作系统安全审计功能<br>- 配置集中日志收集系统<br>- 确保日志保存期限不少于6个月<br><br>以上建议仅供参考，具体整改方案请结合实际情况制定。`,
      suggestions: ['生成整改计划时间表', '生成责任分配表', '生成整改验收标准'],
    };
  }
  
  if (prompt.includes('结论') || prompt.includes('报告')) {
    return {
      content: `<strong>测评结论</strong><br><br>本次测评依据《GB/T 22239-2019 信息安全技术 网络安全等级保护基本要求》第三级要求，对被测系统进行了全面检测。<br><br><strong>测评结果：</strong><br>本次测评共检测 109 项控制要求，其中符合 85 项，部分符合 15 项，不符合 9 项，整体符合率为 78.5%。<br><br><strong>主要不符合项：</strong><br>1. 安全计算环境-身份鉴别：部分系统未配置强口令策略<br>2. 安全区域边界-访问控制：防火墙策略存在冗余规则<br>3. 安全运维管理-漏洞和风险管理：未建立定期漏洞扫描机制<br><br><strong>综合结论：</strong><br>被测系统基本符合第三级等级保护要求，但仍存在一些安全隐患。建议被测单位按照整改建议限期完成整改工作，并在整改完成后进行复测。<br><br><em>（注：此结论为AI生成，仅供参考，最终结论请以人工审核为准）</em>`,
      suggestions: ['优化结论表述', '生成整改报告模板', '生成风险评估报告'],
    };
  }
  
  if (prompt.includes('风险') || prompt.includes('评估')) {
    return {
      content: `<strong>风险等级评估</strong><br><br>基于当前发现的问题，进行风险评估如下：<br><br><strong>高风险问题（5项）：</strong><br>1. 默认账户未禁用 - 可能导致未授权访问<br>2. 弱口令策略 - 存在口令被暴力破解风险<br>3. 未启用审计日志 - 安全事件无法追溯<br>4. 防火墙any-to-any规则 - 网络边界防护失效<br>5. 未定期漏洞扫描 - 系统漏洞无法及时发现<br><br><strong>风险等级：中高风险</strong><br><br><strong>建议处置优先级：</strong><br>紧急（立即处理）：第1、4项<br>高（一周内）：第2、3、5项<br>中（一月内）：中风险问题<br>低（季度内）：低风险问题<br><br>建议制定详细的整改计划，明确责任人和完成时间。`,
      suggestions: ['生成风险矩阵图', '生成风险处置计划', '生成残余风险评估'],
    };
  }
  
  if (prompt.includes('截图') || prompt.includes('图片') || prompt.includes('分析')) {
    return {
      content: `<strong>截图分析结果</strong><br><br>根据您提供的截图，我分析到以下信息：<br><br><strong>界面类型识别：</strong>操作系统设置界面<br><br><strong>安全配置分析：</strong><br>1. 口令策略：已配置基本策略，但复杂度要求不足<br>2. 账户锁定：未配置登录失败锁定<br>3. 审计策略：部分审计项未启用<br><br><strong>存在的问题：</strong><br>- 口令最小长度为6位，建议增加到8位以上<br>- 未配置口令过期时间<br>- 未启用账户锁定策略<br><br><strong>建议：</strong><br>按照等保三级要求，完善口令策略和账户锁定配置。<br><br><em>（注：此分析为模拟结果，实际使用时将调用真实AI进行图像识别）</em>`,
      suggestions: ['生成整改建议', '与标准条款对比', '生成问题描述'],
    };
  }
  
  return {
    content: `您好！我是AI智能助手，可以为您提供以下帮助：<br><br>1. <strong>测评结果分析</strong> - 分析当前项目的测评数据<br>2. <strong>整改建议生成</strong> - 针对问题生成整改方案<br>3. <strong>测评结论撰写</strong> - 生成专业的测评结论<br>4. <strong>风险等级评估</strong> - 评估问题风险等级<br>5. <strong>截图分析</strong> - 上传截图进行AI识别<br><br>请问有什么可以帮助您的？`,
    suggestions: ['分析测评结果', '生成整改建议', '撰写测评结论'],
  };
}

async function sendMessage(customMessage?: string, context?: string) {
  if (!window.api) {
    ElMessage.warning('应用未初始化，请在 Electron 环境中运行');
    return;
  }

  const content = customMessage || inputMessage.value.trim();
  if (!content || loading.value) return;
  
  messages.value.push({
    role: 'user',
    content,
  });
  
  inputMessage.value = '';
  loading.value = true;
  
  await nextTick();
  scrollToBottom();
  
  // 如果已配置AI，优先使用AI
  if (isConfigured.value) {
    try {
      const res = await window.api.ai.chat({
        messages: messages.value.map(m => ({ role: m.role, content: m.content })),
        model: aiSettings.model,
        temperature: aiSettings.temperature,
        context: context || undefined,
      });
      if (res.success && res.data) {
        messages.value.push({
          role: 'assistant',
          content: res.data.content,
          suggestions: res.data.suggestions,
        });
        loading.value = false;
        nextTick(() => scrollToBottom());
        return;
      }
      throw new Error(res.error?.message || 'AI回复失败');
    } catch (error: any) {
      // AI调用失败，显示错误信息，不降级
      messages.value.push({
        role: 'assistant',
        content: `AI调用失败：${error.message || '未知错误'}`,
        suggestions: ['检查AI配置', '查看控制台日志'],
      });
      loading.value = false;
      nextTick(() => scrollToBottom());
      return;
    }
  }

  // 未配置AI，使用本地规则引擎
  setTimeout(() => {
    try {
      const requirement = content;
      const commandParts = content.split('\n').filter(l => l.trim());
      const lastLine = commandParts[commandParts.length - 1] || '';

      const ruleResult = evaluateByRules(requirement, lastLine);

      const result = ruleResult || {
        result: 'partial',
        confidence: 0.3,
        evidence: '无法确定测评结果',
        findings: '请补充更多信息',
      };

      const response = {
        content: `## 本地规则引擎判定结果

**判定结果**：${result.result === 'compliant' ? '✅ 符合' : result.result === 'partial' ? '⚠️ 部分符合' : '❌ 不符合'}
**置信度**：${Math.round(result.confidence * 100)}%
**证据描述**：${result.evidence}
**分析结论**：${result.findings}

> 🔔 当前使用本地规则引擎进行分析（AI ${
  isConfigured.value ? '连接异常，已降级' : '未配置，已降级'
}）。如需更精确的分析，请在AI设置中配置API Key。`,
        suggestions: [
          '补充更多命令输出结果',
          '上传相关截图证据',
          '配置AI API Key获取深度分析',
        ],
      };

      messages.value.push({
        role: 'assistant',
        content: response.content,
        suggestions: response.suggestions,
      });
    } catch (error) {
      console.error('规则引擎执行失败:', error);
      messages.value.push({
        role: 'assistant',
        content: '抱歉，分析过程中出现了错误，请稍后重试。',
      });
    } finally {
      loading.value = false;
      nextTick(() => scrollToBottom());
    }
  }, 500);
}

async function quickAction(action: string) {
  const actions: Record<string, string> = {
    analyze: '帮我分析当前项目的测评结果',
    rectify: '针对高风险问题生成整改建议',
    conclusion: '帮我撰写测评结论',
    risk: '评估当前问题的风险等级',
  };
  const prompt = actions[action] || action;
  const context = await getProjectContext();
  sendMessage(prompt, context);
}

function clearChat() {
  messages.value = [];
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function triggerScreenshotUpload() {
  fileInput.value?.click();
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    processImage(file);
  }
}

function handleDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    processImage(file);
  }
}

function processImage(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    screenshotPreview.value = e.target?.result as string;
  };
  reader.readAsDataURL(file);
}

async function analyzeScreenshot() {
  if (!screenshotPreview.value) return;
  analyzing.value = true;
  
  messages.value.push({
    role: 'user',
    content: '[图片] 请分析这张截图中的安全配置情况',
  });
  
  loading.value = true;
  
  setTimeout(() => {
    const response = mockAIResponse('截图分析');
    messages.value.push({
      role: 'assistant',
      content: response.content,
      suggestions: response.suggestions,
    });
    loading.value = false;
    analyzing.value = false;
    screenshotPreview.value = '';
    nextTick(() => scrollToBottom());
  }, 1500);
}

onMounted(() => {
  loadSettings();
  loadProjects();
});
</script>

<style scoped lang="scss">
.ai-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.ai-progress-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 12px 20px;
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--spacing-md);
}

.step-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border-radius: var(--radius-md, 6px) 0 0 var(--radius-md, 6px);
  background: var(--color-border-light, #F0F0F3);
  color: var(--color-text-secondary, #4B5563);
  font-size: var(--text-sm, 12px);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;

  &:not(:first-child) {
    border-radius: 0 var(--radius-md, 6px) var(--radius-md, 6px) 0;
  }

  &:not(:last-child) {
    margin-right: -1px;
  }

  .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-border-default, #E5E7EB);
    font-size: var(--text-xs, 11px);
    font-weight: 600;
    color: var(--color-text-secondary, #4B5563);
  }

  &.step-completed {
    background: var(--color-border-light, #F0F0F3);
    color: var(--color-text-secondary, #4B5563);

    .step-number {
      background: var(--color-border-default, #E5E7EB);
      color: var(--color-text-secondary, #4B5563);
    }
  }

  &.step-active {
    background: var(--color-primary, #1B5FD9);
    color: var(--color-text-inverse, #FFFFFF);

    .step-number {
      background: rgba(255, 255, 255, 0.25);
      color: var(--color-text-inverse, #FFFFFF);
    }
  }

  &:hover:not(.step-active) {
    background: var(--color-primary-light, #E8F0FE);
    color: var(--color-primary, #1B5FD9);
  }
}

.ai-layout {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

.ai-sidebar {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.ai-sidebar-section {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
}

.ai-sidebar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.ai-quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ai-quick-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 12px;
  
  &:hover {
    background: rgba(64, 158, 255, 0.1);
    color: var(--primary-color);
  }
}

.ai-upload-area {
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  padding: 24px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    border-color: var(--primary-color);
    background: rgba(64, 158, 255, 0.05);
  }
}

.upload-icon {
  color: var(--text-placeholder);
  margin-bottom: 8px;
}

.upload-text {
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.upload-hint {
  font-size: 12px;
  color: var(--text-placeholder);
}

.screenshot-preview {
  margin-top: 12px;
  
  img {
    width: 100%;
    border-radius: 6px;
    margin-bottom: 8px;
  }
  
  .el-button {
    width: 100%;
  }
}

.ai-status {
  .status-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text-primary);
  }
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #909399;
    
    &.active {
      background: #67c23a;
      box-shadow: 0 0 8px rgba(103, 194, 58, 0.5);
    }
  }
  
  .status-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 8px;
  }
}

.ai-chat-area {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.ai-empty {
  text-align: center;
  padding: 60px 20px;
  
  .empty-icon {
    color: var(--text-placeholder);
    margin-bottom: 16px;
  }
  
  .empty-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }
  
  .empty-desc {
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 24px;
  }
  
  .empty-suggestions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 400px;
    margin: 0 auto;
  }
  
  .suggestion-item {
    padding: 12px 20px;
    background: var(--bg-hover);
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    color: var(--text-secondary);
    transition: all 0.2s;
    
    &:hover {
      background: rgba(64, 158, 255, 0.1);
      color: var(--primary-color);
    }
  }
}

.ai-message {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  
  &.user {
    flex-direction: row-reverse;
    
    .msg-bubble {
      background: var(--primary-color);
      color: white;
    }
    
    .msg-role {
      text-align: right;
    }
  }
}

.msg-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
  
  background: rgba(64, 158, 255, 0.1);
  color: var(--primary-color);
  
  .user & {
    background: var(--primary-color);
    color: white;
  }
}

.msg-content {
  max-width: 70%;
}

.msg-role {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.msg-bubble {
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--bg-hover);
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  
  pre {
    background: rgba(0, 0, 0, 0.1);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
    
    code {
      background: transparent;
      padding: 0;
    }
  }
  
  code {
    background: rgba(0, 0, 0, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
  }
  
  &.typing {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 16px;
    
    span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-placeholder);
      animation: typing 1.4s infinite;
      
      &:nth-child(2) {
        animation-delay: 0.2s;
      }
      
      &:nth-child(3) {
        animation-delay: 0.4s;
      }
    }
  }
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.msg-suggestions {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggestion-tag {
  cursor: pointer;
  
  &:hover {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }
}

.ai-input-area {
  padding: 16px;
  border-top: 1px solid var(--border-color);
}

.ai-input-wrapper {
  position: relative;
}

.ai-input-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.ai-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.setting-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.required {
  color: #f56c6c;
  margin-right: 2px;
}

.setting-hint {
  padding: 10px 14px;
  background: rgba(41, 128, 185, 0.1);
  border-radius: 4px;
  font-size: 12px;
  color: #2980b9;
  line-height: 1.6;
}

.test-result {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  
  &.test-success {
    background: rgba(103, 194, 58, 0.1);
    color: #67c23a;
    border: 1px solid rgba(103, 194, 58, 0.3);
  }
  
  &.test-error {
    background: rgba(245, 108, 108, 0.1);
    color: #f56c6c;
    border: 1px solid rgba(245, 108, 108, 0.3);
  }
  
  .test-details {
    margin-top: 6px;
    padding: 6px;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 2px;
    font-size: 11px;
    color: #666;
    word-break: break-all;
    white-space: pre-wrap;
  }
}

/* Markdown body styles for AI assistant */
.markdown-body {
  line-height: 1.6;
  word-break: break-word;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 0.5em 0 0.3em;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body h1 { font-size: 1.4em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
.markdown-body h2 { font-size: 1.25em; }
.markdown-body h3 { font-size: 1.1em; }

.markdown-body p { margin: 0.3em 0; }

.markdown-body ul,
.markdown-body ol { margin: 0.3em 0; padding-left: 1.5em; }

.markdown-body li { margin: 0.2em 0; }

.markdown-body blockquote {
  margin: 0.4em 0;
  padding: 0.3em 0.8em;
  border-left: 3px solid #409eff;
  background: rgba(64, 158, 255, 0.05);
  color: #666;
  font-size: 0.9em;
}

.markdown-body code {
  background: rgba(0, 0, 0, 0.06);
  padding: 0.15em 0.4em;
  border-radius: 3px;
  font-size: 0.85em;
  font-family: Consolas, Monaco, monospace;
}

.markdown-body pre {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 0.8em;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0.4em 0;
}

.markdown-body pre code {
  background: none;
  padding: 0;
  color: inherit;
}

.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.4em 0;
  font-size: 0.9em;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid #ddd;
  padding: 0.4em 0.6em;
  text-align: left;
}

.markdown-body th { background: var(--color-bg-hover); font-weight: 600; }

.markdown-body a { color: #409eff; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }

.markdown-body img { max-width: 100%; border-radius: 4px; margin: 0.3em 0; }

.markdown-body strong { font-weight: 600; }

.markdown-body em { font-style: italic; }

.markdown-body hr {
  border: none;
  border-top: 1px solid #eee;
  margin: 1em 0;
}

</style>
