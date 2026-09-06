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
          <div class="ai-sidebar-title">附件上传</div>
          <div class="ai-upload-area" @click="triggerAttachmentUpload" @dragover.prevent @drop.prevent="handleDrop">
            <el-icon :size="32" class="upload-icon"><Paperclip /></el-icon>
            <div class="upload-text">点击或拖拽上传附件</div>
            <div class="upload-hint">支持图片、PDF、Word、Excel、文本等格式</div>
            <input
              ref="fileInput"
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.bmp,.webp,.pdf,.doc,.docx,.xls,.xlsx,.md,.txt,.csv,.log,.json,.xml,.html,.css,.js,.ts"
              multiple
              hidden
              @change="handleFileSelect"
            />
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
              <template v-if="aiSettings.mode === 'cloud'">
                <el-select
                  v-if="isConfigured && cloudModels.length > 0"
                  v-model="activeModelSelectValue"
                  size="small"
                  style="width: 200px;"
                >
                  <el-option
                    label="自动（按优先级）"
                    value="auto"
                  />
                  <el-option
                    v-for="m in cloudModels.filter(m => m.enabled)"
                    :key="m.id"
                    :label="`${m.name || m.model} (优先级${m.priority})`"
                    :value="m.id"
                  />
                  <template #footer>
                    <div style="padding: 4px 12px; color: #909399; font-size: 12px;">
                      当前使用：{{ (cloudModels.find(m => m.id === activeModelId)?.name || cloudModels.find(m => m.id === activeModelId)?.model) || '自动' }}
                      <el-button size="small" text @click="showModelManager = true; showSettings = true">管理模型</el-button>
                    </div>
                  </template>
                </el-select>
                <span v-else-if="isConfigured">云端服务已配置 · {{ cloudModels.length }} 个模型</span>
                <span v-else>请先在设置中添加云端模型</span>
              </template>
              <template v-else>
                {{ isConfigured ? `本地Ollama · ${aiSettings.ollamaModel}` : '请先在设置中选择本地模型' }}
              </template>
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
            v-for="msg in messages"
            :key="msg.id"
            class="ai-message"
            :class="msg.role"
          >
            <div class="msg-avatar">
              <el-icon v-if="msg.role === 'user'"><User /></el-icon>
              <el-icon v-else><MagicStick /></el-icon>
            </div>
            <div class="msg-content">
              <div class="msg-role">{{ msg.role === 'user' ? '我' : 'AI助手' }}</div>
              <div v-if="msg.attachments && msg.attachments.length > 0" class="msg-attachments">
                <div v-for="(att, i) in msg.attachments" :key="i" class="msg-attachment-item">
                  <el-icon :size="14"><component :is="att.type === 'image' ? Picture : Document" /></el-icon>
                  <span class="msg-attachment-name">{{ att.name }}</span>
                  <span class="msg-attachment-size">{{ formatAttachmentSize(att.size) }}</span>
                </div>
              </div>
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
          <div v-if="pendingAttachments.length > 0" class="pending-attachments">
            <div v-for="(att, i) in pendingAttachments" :key="att.path" class="pending-attachment-chip">
              <el-icon :size="14"><component :is="att.type === 'image' ? Picture : Document" /></el-icon>
              <span class="chip-name" :title="att.name">{{ att.name }}</span>
              <span class="chip-size">{{ formatAttachmentSize(att.size) }}</span>
              <el-icon class="chip-remove" :size="14" @click="removeAttachment(i)"><CircleClose /></el-icon>
            </div>
          </div>
          <div class="ai-input-wrapper">
            <el-input
              v-model="inputMessage"
              type="textarea"
              :rows="2"
              placeholder="输入您的问题... 可直接粘贴图片或文件"
              resize="none"
              @keydown.enter.exact.prevent="sendMessage()"
              @paste="handlePaste"
            />
            <div class="ai-input-actions">
              <el-button :icon="Paperclip" circle title="添加附件" @click="triggerAttachmentUpload" />
              <el-button
                type="primary"
                :icon="Promotion"
                :disabled="(!inputMessage.trim() && pendingAttachments.length === 0) || loading"
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

    <el-dialog v-model="showSettings" title="AI设置" width="640px" destroy-on-close @opened="handleDialogOpened">
      <div class="ai-settings">
        <!-- 合规声明 -->
        <div class="compliance-notice">
          <div class="compliance-notice-title">⚠️ 数据合规声明</div>
          <div class="compliance-notice-body">
            <p>AI分析功能会将测评数据（包括核查记录、截图、文档等）发送到您配置的第三方AI服务进行处理。在启用AI功能前，请确保：</p>
            <ul>
              <li>已获得被测评单位的数据处理授权</li>
              <li>您配置的AI服务符合数据安全与隐私保护要求</li>
              <li>对于等保三级及以上项目，建议使用本地部署的LLM（如Ollama、vLLM等）</li>
            </ul>
            <p class="compliance-notice-footer">如涉及敏感数据，建议开启下方的「隐私模式」（截图自动遮盖IP地址，文本自动脱敏处理）。</p>
          </div>
        </div>

        <!-- 接入模式选择 -->
        <div class="setting-item">
          <label class="setting-label"><span class="required">*</span>接入模式</label>
          <el-radio-group v-model="aiSettings.mode" size="default">
            <el-radio-button value="cloud">云端服务</el-radio-button>
            <el-radio-button value="local">本地 Ollama</el-radio-button>
          </el-radio-group>
          <div class="setting-hint" style="margin-top: 8px;">
            <span v-if="aiSettings.mode === 'cloud'">使用云端AI服务（如OpenAI、Claude等），需要API Key和网络连接</span>
            <span v-else>使用本地部署的Ollama运行大模型，数据不出本地，保护隐私安全</span>
          </div>
        </div>

        <!-- 云端模式配置 -->
        <template v-if="aiSettings.mode === 'cloud'">
          <div class="setting-hint" style="margin: 4px 0 8px;">
            云端 AI 支持配置多个大模型，请在下方「云端模型列表」中添加模型并设置 API 信息。
            当主用模型不可用时，系统会自动按优先级切换到下一个可用模型。
          </div>
        </template>

        <!-- 云端多模型管理 -->
        <template v-if="aiSettings.mode === 'cloud'">
          <div class="setting-item">
            <div class="setting-label-row">
              <label class="setting-label">云端模型列表</label>
              <div style="display: flex; gap: 8px;">
                <el-button size="small" @click="showModelManager = !showModelManager">
                  {{ showModelManager ? '收起' : '管理' }}
                </el-button>
                <el-button size="small" type="primary" @click="openAddModelForm">+ 添加模型</el-button>
              </div>
            </div>
            <div class="setting-hint" style="margin-top: 4px;">
              配置多个云端模型，当主模型不可用时自动切换。当前使用：{{ activeModelId ? (cloudModels.find(m => m.id === activeModelId)?.name || '未知') : '自动（按优先级）' }}
            </div>

            <!-- 模型列表 -->
            <div v-if="showModelManager" class="model-list">
              <div v-if="cloudModels.length === 0" class="model-empty">
                暂无云端模型配置，点击「添加模型」开始配置
              </div>
              <div v-for="m in cloudModels" :key="m.id" class="model-card" :class="{ 'model-active': activeModelId === m.id }">
                <div class="model-card-header">
                  <span class="model-card-name">{{ m.name || m.model }}</span>
                  <span class="model-card-priority">优先级 {{ m.priority }}</span>
                  <el-switch v-model="m.enabled" size="small" @change="saveModel()" />
                </div>
                <div class="model-card-info">
                  <span>{{ m.model }}</span>
                  <span class="model-card-base">{{ m.apiBase }}</span>
                </div>
                <div class="model-card-actions">
                  <el-button size="small" text @click="editModel(m)">编辑</el-button>
                  <el-button size="small" text @click="setActiveModel(m.id)">设为当前</el-button>
                  <el-button size="small" text :loading="modelTestLoading === m.id" @click="testModelConnection(m.id)">测试</el-button>
                  <el-button size="small" text type="danger" @click="deleteModel(m.id)">删除</el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- 添加/编辑模型表单 -->
          <el-dialog v-model="showModelForm" :title="editingModel?.id ? '编辑模型' : '添加模型'" width="500px" destroy-on-close>
            <el-form v-if="editingModel" label-width="100px">
              <el-form-item label="显示名称">
                <el-input v-model="editingModel!.name" placeholder="如：OpenAI-GPT-4o" />
              </el-form-item>
              <el-form-item label="模型ID">
                <el-input v-model="editingModel!.model" placeholder="如：gpt-4o" />
              </el-form-item>
              <el-form-item label="API格式">
                <el-select v-model="editingModel!.apiFormat" style="width: 100%">
                  <el-option label="OpenAI" value="openai" />
                  <el-option label="Claude" value="claude" />
                  <el-option label="Gemini" value="gemini" />
                </el-select>
              </el-form-item>
              <el-form-item label="API地址">
                <el-input v-model="editingModel!.apiBase" placeholder="https://api.openai.com" />
                <div class="setting-hint" style="margin-top: 4px; line-height: 1.5;">
                  系统会自动补全路径：地址含 <code>/v1</code> 时补 <code>/chat/completions</code>；否则补 <code>/v1/chat/completions</code>；若地址已以 <code>/chat/completions</code> 结尾则原样使用。
                </div>
              </el-form-item>
              <el-form-item label="API密钥">
                <el-input v-model="editingModel!.apiKey" type="password" show-password placeholder="输入 API 密钥（留空则保留原值）" />
              </el-form-item>
              <el-form-item label="优先级">
                <el-input-number v-model="editingModel!.priority" :min="1" :max="99" />
                <span class="setting-hint" style="margin-left: 8px;">数字越小优先级越高</span>
              </el-form-item>
              <el-form-item label="启用">
                <el-switch v-model="editingModel!.enabled" />
              </el-form-item>
            </el-form>
            <template #footer>
              <el-button @click="showModelForm = false">取消</el-button>
              <el-button type="primary" @click="saveModel">保存</el-button>
            </template>
          </el-dialog>
        </template>

        <!-- 本地Ollama模式配置 -->
        <template v-else>
          <!-- Ollama服务地址 -->
          <div class="setting-item">
            <label class="setting-label"><span class="required">*</span>Ollama 服务地址</label>
            <el-input
              v-model="aiSettings.ollamaUrl"
              placeholder="http://localhost:11434"
            />
            <div class="setting-hint" style="margin-top: 4px;">
              Ollama 默认运行在 http://localhost:11434，如已修改请填写实际地址
            </div>
          </div>

          <!-- Ollama状态面板 -->
          <div class="ollama-status-panel">
            <div class="ollama-status-header">
              <span class="ollama-status-title">Ollama 服务状态</span>
              <el-button 
                type="primary" 
                plain 
                size="small" 
                :loading="ollamaLoading"
                @click="checkOllamaStatus"
              >
                刷新状态
              </el-button>
            </div>

            <!-- 未安装 -->
            <div v-if="ollamaStatus?.state === 'not_installed'" class="ollama-status-content">
              <div class="ollama-status-icon not-installed">📦</div>
              <div class="ollama-status-text">
                <div class="ollama-status-label">Ollama 未安装</div>
                <div class="ollama-status-desc">请下载并安装 Ollama 以使用本地大模型功能</div>
              </div>
              <el-button type="primary" size="small" @click="showInstallGuide = true">
                查看安装指南
              </el-button>
            </div>

            <!-- 已安装未运行 -->
            <div v-else-if="ollamaStatus?.state === 'not_running'" class="ollama-status-content">
              <div class="ollama-status-icon not-running">⏸️</div>
              <div class="ollama-status-text">
                <div class="ollama-status-label">Ollama 未运行</div>
                <div class="ollama-status-desc">Ollama 已安装但未启动，请点击下方按钮启动</div>
              </div>
              <el-button 
                type="success" 
                size="small" 
                :loading="ollamaLoading"
                @click="handleStartOllama"
              >
                启动 Ollama
              </el-button>
            </div>

            <!-- 运行中 -->
            <div v-else-if="ollamaStatus?.state === 'running'" class="ollama-status-content">
              <div class="ollama-status-icon running">✅</div>
              <div class="ollama-status-text">
                <div class="ollama-status-label">Ollama 运行中</div>
                <div class="ollama-status-desc">
                  已加载 {{ ollamaStatus?.models?.length || 0 }} 个模型
                </div>
              </div>
            </div>

            <!-- 加载中 -->
            <div v-else class="ollama-status-content">
              <div class="ollama-status-icon">⏳</div>
              <div class="ollama-status-text">
                <div class="ollama-status-label">正在检测状态...</div>
              </div>
            </div>
          </div>

          <!-- 已安装模型列表 -->
          <div v-if="ollamaStatus?.state === 'running' && ollamaStatus?.models?.length" class="setting-item">
            <label class="setting-label">已安装的模型</label>
            <div class="model-list">
              <div 
                v-for="model in ollamaStatus?.models" 
                :key="model.name"
                class="model-item"
                :class="{ selected: aiSettings.ollamaModel === model.name }"
                @click="aiSettings.ollamaModel = model.name"
              >
                <div class="model-info">
                  <div class="model-name">{{ model.name }}</div>
                  <div class="model-size">{{ formatModelSize(model.size) }}</div>
                </div>
                <el-button 
                  type="danger" 
                  plain 
                  size="small"
                  @click.stop="handleDeleteModel(model.name)"
                >
                  删除
                </el-button>
              </div>
            </div>
          </div>

          <!-- 使用建议 -->
          <div class="setting-item">
            <label class="setting-label">使用建议</label>
            <div class="setting-hint" style="margin-bottom: 12px;">
              请根据本地电脑配置选用模型或前往ollama模型仓库自行挑选合适模型
            </div>
            <div class="model-list">
              <div 
                v-for="model in recommendedModels" 
                :key="model.name"
                class="model-item recommended"
              >
                <div class="model-info">
                  <div class="model-name">{{ model.label }}</div>
                  <div class="model-desc">{{ model.description }}</div>
                  <div class="model-meta">
                    <el-tag size="small" type="info">{{ model.size }}</el-tag>
                    <el-tag v-if="model.supportsVision" size="small" type="success">支持图片</el-tag>
                    <el-tag size="small">需 {{ model.minMemory }}GB 内存</el-tag>
                  </div>
                  <!-- 下载进度条 -->
                  <div v-if="downloadProgress?.modelName === model.name" class="download-progress">
                    <div class="progress-header">
                      <span class="progress-status">{{ formatDownloadStatus(downloadProgress.status) }}</span>
                      <span class="progress-percent">{{ downloadPercent }}%</span>
                    </div>
                    <el-progress 
                      :percentage="downloadPercent" 
                      :stroke-width="8" 
                      :show-text="false"
                      :status="downloadProgress.status === 'completed' ? 'success' : ''"
                    />
                    <div v-if="downloadProgress.completed && downloadProgress.total" class="progress-size">
                      {{ formatBytes(downloadProgress.completed) }} / {{ formatBytes(downloadProgress.total) }}
                    </div>
                  </div>
                </div>
                <el-button 
                  type="primary" 
                  plain 
                  size="small"
                  :loading="pullingModel === model.name"
                  :disabled="pullingModel !== '' && pullingModel !== model.name || isModelInstalled(model.name)"
                  @click="handlePullModel(model.name)"
                >
                  {{ pullingModel === model.name ? '下载中...' : (isModelInstalled(model.name) ? '已安装' : '下载') }}
                </el-button>
              </div>
            </div>
          </div>

          <!-- 测试连接 -->
          <div class="setting-item">
            <el-button 
              type="success" 
              plain 
              :loading="localTestLoading" 
              @click="handleTestOllamaConnection"
              style="width: 100%"
            >
              {{ localTestLoading ? '测试中...' : '🔌 测试 Ollama 连接' }}
            </el-button>
            <div v-if="localTestResult" class="test-result" :class="localTestResult.success ? 'test-success' : 'test-error'">
              <div v-if="localTestResult.success">✅ 连接正常！Ollama 服务运行良好</div>
              <div v-else>
                ❌ 失败 [{{ localTestResult.error?.code || 'ERROR' }}]：{{ localTestResult.error?.message || '未知错误' }}
              </div>
            </div>
          </div>
        </template>

        <!-- 隐私模式 -->
        <div class="setting-item">
          <div class="setting-label-row">
            <label class="setting-label">隐私模式</label>
            <el-switch v-model="aiSettings.privacyMode" size="small" :active-value="true" :inactive-value="false" />
          </div>
          <div class="setting-hint" style="margin-top: 4px;">
            开启后，截图中的IP地址将被OCR识别并局部遮盖，其余内容保持清晰；文本内容中的涉密信息将自动脱敏后发送给AI分析。
          </div>
          <div v-if="aiSettings.privacyMode" class="desensitize-rules">
            <div class="desensitize-rules-title">自动脱敏规则</div>
            <div class="desensitize-rule-item">
              <span class="rule-type">图片</span>
              <span>IP地址 → OCR识别后黑色方块遮盖</span>
            </div>
            <div class="desensitize-rules-subtitle">文本内置规则</div>
            <div class="desensitize-rule-item">
              <span class="rule-type">IP</span>
              <span><code>192.168.1.100</code> → <code>192.168.***.100</code>（仅第3段）</span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">手机</span>
              <span><code>13812345678</code> → <code>1**********</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">固话</span>
              <span><code>0355-1234567</code> → <code>***-*******</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">邮箱</span>
              <span><code>admin@xxx.com</code> → <code>***@***.***</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">域名</span>
              <span><code>mail.xxx.com</code> → <code>***.xxx.com</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">身份证</span>
              <span>18位 → 全部替换为 <code>***</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">信用代码</span>
              <span>18位统一信用代码 → 全部替换</span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">密码</span>
              <span><code>password=123456</code> → <code>password=***</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">MAC</span>
              <span><code>00:1A:2B:3C:4D:5E</code> → <code>**:**:**:**:**:**</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">路径</span>
              <span><code>/home/admin</code> → <code>/home/***</code></span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">单位</span>
              <span>公司名（如XX有限责任公司）→ 隐藏名称</span>
            </div>
            <div class="desensitize-rule-item">
              <span class="rule-type">自定义</span>
              <span>下方配置的敏感词 → 全文替换为 <code>***</code></span>
            </div>
          </div>
        </div>

        <!-- 敏感词过滤 -->
        <div class="setting-item">
          <div class="setting-label-row">
            <label class="setting-label">敏感词过滤列表</label>
          </div>
          <el-input
            v-model="aiSettings.sensitiveWords"
            type="textarea"
            :rows="4"
            placeholder="每行一个敏感词，例如：&#10;内网核心系统&#10;生产数据库节点&#10;SVR-DB-01"
          />
          <div class="setting-hint" style="margin-top: 4px;">
            隐私模式下，文本中的公司名、单位名等自定义敏感词将被替换为「***」。每行一个关键词。
          </div>
        </div>

        <!-- OCR预处理 -->
        <div class="setting-item">
          <div class="setting-label-row">
            <label class="setting-label">OCR预处理</label>
            <el-switch v-model="aiSettings.ocrPreprocess" size="small" :active-value="true" :inactive-value="false" />
          </div>
          <div class="setting-hint" style="margin-top: 4px;">
            开启后，截图分析时会先用OCR提取截图中的文字，再发送给AI分析。对本地小模型效果提升明显。
          </div>
        </div>

        </div>

      <template #footer>
        <el-button @click="showSettings = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showInstallGuide" title="Ollama 安装指南" width="700px" destroy-on-close @opened="installStep = 0">
      <div class="install-guide">
        <!-- 步骤条 -->
        <el-steps :active="installStep" finish-status="success" align-center class="install-steps">
          <el-step title="选择平台" description="选择您的操作系统" />
          <el-step title="下载安装" description="下载并安装 Ollama" />
          <el-step title="验证安装" description="检测安装结果" />
        </el-steps>

        <!-- 步骤1: 选择平台 -->
        <div v-show="installStep === 0" class="install-step-content">
          <div class="install-guide-intro">
            <el-icon :size="48" class="guide-icon"><Monitor /></el-icon>
            <h3>欢迎使用本地 AI 助手</h3>
            <p>Ollama 是一个本地大模型运行工具，支持在您的电脑上运行 Qwen、Llama 等大模型。</p>
            <p>安装后，所有 AI 分析将在本地完成，数据不会离开您的电脑，确保数据安全。</p>
          </div>

          <div class="platform-selection">
            <div class="platform-selection-title">请选择您的操作系统：</div>
            <div class="platform-cards">
              <div 
                class="platform-card" 
                :class="{ active: selectedPlatform === 'windows' }"
                @click="selectedPlatform = 'windows'"
              >
                <el-icon :size="32"><Monitor /></el-icon>
                <span>Windows</span>
              </div>
              <div 
                class="platform-card" 
                :class="{ active: selectedPlatform === 'mac' }"
                @click="selectedPlatform = 'mac'"
              >
                <el-icon :size="32"><Iphone /></el-icon>
                <span>macOS</span>
              </div>
              <div 
                class="platform-card" 
                :class="{ active: selectedPlatform === 'linux' }"
                @click="selectedPlatform = 'linux'"
              >
                <el-icon :size="32"><Monitor /></el-icon>
                <span>Linux</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 步骤2: 下载安装 -->
        <div v-show="installStep === 1" class="install-step-content">
          <div class="download-section">
            <el-button type="primary" size="large" @click="openDownloadPage">
              <el-icon><Download /></el-icon>
              前往 Ollama 官网下载
            </el-button>
            <p class="download-hint">点击上方按钮将在浏览器中打开 Ollama 官方下载页面</p>
          </div>

          <div class="install-instructions">
            <div class="instructions-title">
              {{ selectedPlatform === 'windows' ? 'Windows' : selectedPlatform === 'mac' ? 'macOS' : 'Linux' }} 安装步骤：
            </div>
            <ol class="step-list">
              <li v-for="(step, idx) in currentPlatformSteps" :key="idx" class="step-item-detail">
                <span class="step-number">{{ idx + 1 }}</span>
                <span class="step-text">{{ step }}</span>
              </li>
            </ol>
          </div>
        </div>

        <!-- 步骤3: 验证安装 -->
        <div v-show="installStep === 2" class="install-step-content">
          <div class="verify-section">
            <el-icon :size="48" class="guide-icon"><CircleCheck /></el-icon>
            <h3>安装完成？</h3>
            <p>安装完成后，点击下方按钮检测 Ollama 是否正常运行</p>
            <el-button type="success" size="large" :loading="ollamaLoading" @click="verifyInstallation">
              <el-icon><Refresh /></el-icon>
              检测 Ollama 状态
            </el-button>
          </div>

          <div v-if="ollamaStatus?.state === 'running'" class="verify-success">
            <el-alert type="success" :closable="false" show-icon>
              <template #title>
                ✅ Ollama 安装成功！已检测到 {{ ollamaStatus?.models?.length || 0 }} 个模型
              </template>
            </el-alert>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button v-if="installStep > 0" @click="installStep--">上一步</el-button>
        <el-button v-if="installStep < 2" type="primary" @click="installStep++">下一步</el-button>
        <el-button v-else @click="showInstallGuide = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, onDeactivated, onActivated, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
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
  Paperclip,
  CircleClose,
  Monitor,
  Download,
  Refresh,
  CircleCheck,
  Iphone,
} from '@element-plus/icons-vue';

const showSettings = ref(false);
const loading = ref(false);
const messages = ref<{ id: number; role: string; content: string; suggestions?: string[]; attachments?: PendingAttachment[] }[]>([]);
const inputMessage = ref('');
const pendingAttachments = ref<PendingAttachment[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const messagesContainer = ref<HTMLElement | null>(null);
const selectedProjectId = ref<string>('');
const projectList = ref<any[]>([]);
const projectsLoading = ref(false);

interface PendingAttachment {
  name: string;
  path: string;
  type: 'image' | 'document';
  size: number;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
const TEXT_EXTENSIONS = ['.md', '.txt', '.csv', '.log', '.json', '.xml', '.html', '.css', '.js', '.ts'];
const DOC_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const TEXT_MAX_SIZE = 1024 * 1024;
const DOC_MAX_SIZE = 20 * 1024 * 1024;

function getFileExtension(name: string): string {
  return name.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
}

function getAttachmentKind(file: File): 'image' | 'text' | 'document' | null {
  const ext = getFileExtension(file.name);
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (DOC_EXTENSIONS.includes(ext)) return 'document';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

function getAttachmentSizeLimit(kind: 'image' | 'text' | 'document'): number {
  if (kind === 'image') return IMAGE_MAX_SIZE;
  if (kind === 'text') return TEXT_MAX_SIZE;
  return DOC_MAX_SIZE;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const aiSettings = reactive({
  apiFormat: 'openai',
  fullUrl: false,
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  temperature: 0.3,
  provider: 'openai',
  privacyMode: false,
  sensitiveWords: '',
  mode: 'cloud' as 'cloud' | 'local',
  ollamaModel: '',
  ollamaUrl: 'http://localhost:11434',
  // OCR预处理默认：云端模式关闭，本地模式开启
  ocrPreprocess: false,
});

// 云端多模型管理
interface CloudModel {
  id: string;
  name: string;
  apiBase: string;
  model: string;
  apiFormat: string;
  enabled: boolean;
  priority: number;
}
const cloudModels = ref<CloudModel[]>([]);
const activeModelId = ref<string | null>(null);
const showModelManager = ref(false);
const editingModel = ref<{ id?: string; name: string; apiBase: string; apiKey?: string; model: string; apiFormat: string; enabled: boolean; priority: number } | null>(null);
const showModelForm = ref(false);
const modelTestLoading = ref<string | null>(null);

const isConfigured = computed(() => {
  if (aiSettings.mode === 'cloud') {
    return cloudModels.value.some(m => m.enabled === true);
  }
  return aiSettings.ollamaModel.length > 0;
});

const activeModelSelectValue = computed<string>({
  get: () => activeModelId.value ?? 'auto',
  set: (val) => {
    setActiveModel(val === 'auto' ? null : val);
  },
});

const localTestLoading = ref(false);
const localTestResult = ref<any>(null);
const settingsLoaded = ref(false);

const ollamaStatus = ref<{ state: string; models?: any[]; error?: string } | null>(null);
const ollamaLoading = ref(false);
const recommendedModels = ref<Array<{ name: string; label: string; description: string; size: string; minMemory: number; supportsVision: boolean }>>([]);
const installGuide = ref<{ windows: string[]; mac: string[]; linux: string[]; downloadUrl: string } | null>(null);
const showInstallGuide = ref(false);
const installStep = ref(0);
const selectedPlatform = ref<'windows' | 'mac' | 'linux'>('windows');
const pullingModel = ref('');
const downloadProgress = ref<{ modelName: string; status: string; completed?: number; total?: number } | null>(null);
let pullProgressCleanup: (() => void) | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
const HEALTH_CHECK_INTERVAL = 30000; // 30秒轮询一次

const downloadPercent = computed(() => {
  if (!downloadProgress.value) return 0;
  const { completed, total } = downloadProgress.value;
  if (!completed || !total) return 0;
  return Math.min(Math.round((completed / total) * 100), 100);
});

// 已安装模型名称集合
const installedModelNames = computed(() => {
  if (!ollamaStatus.value?.models) return new Set<string>();
  return new Set(ollamaStatus.value.models.map(m => m.name));
});

// 剥离模型名的 Tag（最后一个冒号及其后的内容）
function stripModelTag(name: string): string {
  const lastColon = name.lastIndexOf(':');
  // 只剥离 Windows 盘符以外的冒号（避免 C:\path 这种被误剥）
  if (lastColon > 1) return name.substring(0, lastColon);
  return name;
}

// 检查模型是否已安装（Tag 无关 + 大小写无关 + 兼容 :latest 自动追加）
const isModelInstalled = (modelName: string) => {
  if (!modelName) return false;
  const inputBase = stripModelTag(modelName).toLowerCase();
  if (!inputBase) return false;
  for (const installed of installedModelNames.value) {
    if (!installed) continue;
    // 精确匹配（大小写敏感）
    if (installed === modelName) return true;
    // 精确匹配 + :latest
    if (installed === modelName + ':latest') return true;
    // Tag 无关 + 大小写无关（兜底，覆盖 Ollama 改名/大小写差异）
    const installedBase = stripModelTag(installed).toLowerCase();
    if (installedBase === inputBase) return true;
  }
  return false;
};

const currentPlatformSteps = computed(() => {
  if (!installGuide.value) return [];
  const platformMap = {
    windows: installGuide.value.windows,
    mac: installGuide.value.mac,
    linux: installGuide.value.linux,
  };
  return platformMap[selectedPlatform.value] || [];
});

async function verifyInstallation() {
  installStep.value = 2;
  await checkOllamaStatus();
}

function formatDownloadStatus(status: string): string {
  const statusMap: Record<string, string> = {
    starting: '正在准备...',
    pulling: '正在下载...',
    downloading: '正在下载...',
    extracting: '正在解压...',
    verifying: '正在校验...',
    'writing manifest': '正在写入...',
    'removing any unused layers': '正在清理...',
    success: '下载完成',
  };
  return statusMap[status] || status;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

async function checkOllamaStatus() {
  if (!window.api) return;
  ollamaLoading.value = true;
  try {
    const res = await window.api.ollama.getStatus(aiSettings.ollamaUrl);
    if (res.success && res.data) {
      ollamaStatus.value = res.data;
    } else {
      ollamaStatus.value = { state: 'not_installed', error: res.error?.message };
    }
  } catch (err: any) {
    ollamaStatus.value = { state: 'not_installed', error: err.message };
  } finally {
    ollamaLoading.value = false;
  }
}

async function loadRecommendedModels() {
  if (!window.api) return;
  try {
    const res = await window.api.ollama.getRecommendedModels();
    if (res.success && res.data) {
      recommendedModels.value = res.data;
    }
  } catch (err) {
    console.error('加载推荐模型失败:', err);
  }
}

async function loadInstallGuide() {
  if (!window.api) return;
  try {
    const res = await window.api.ollama.getInstallGuide();
    if (res.success && res.data) {
      installGuide.value = res.data;
    }
  } catch (err) {
    console.error('加载安装指南失败:', err);
  }
}

async function handleStartOllama() {
  if (!window.api) return;
  ollamaLoading.value = true;
  try {
    const res = await window.api.ollama.start(aiSettings.ollamaUrl);
    if (res.success) {
      ElMessage.success('Ollama 启动成功');
      await checkOllamaStatus();
    } else {
      ElMessage.error('启动失败：' + (res.error?.message || '未知错误'));
    }
  } catch (err: any) {
    ElMessage.error('启动失败：' + err.message);
  } finally {
    ollamaLoading.value = false;
  }
}

async function handlePullModel(modelName: string) {
  if (!window.api) return;
  pullingModel.value = modelName;
  downloadProgress.value = { modelName, status: 'starting' };

  // 注册进度事件监听器
  if (window.api.ollama.onPullProgress) {
    pullProgressCleanup = window.api.ollama.onPullProgress((data) => {
      // 抗竞态：只有当前正在拉取的模型、且 downloadProgress 未被置空时才更新
      // 双重保险：
      // 1) pullingModel.value 已清空时：说明 finally 已执行，不再接受事件
      // 2) downloadProgress.value 已置 null 时：说明 success/error 分支已清空进度，不再接受覆盖
      if (data.modelName === modelName
          && pullingModel.value === modelName
          && downloadProgress.value !== null) {
        downloadProgress.value = data;
      }
    });
  }

  try {
    ElMessage.info(`正在下载模型 ${modelName}，请稍候...`);
    const res = await window.api.ollama.pullModel(modelName, aiSettings.ollamaUrl);
    if (res.success) {
      ElMessage.success('模型下载成功');
      // 清空进度展示（必须在轮询检查之前，防止轮询间隔被事件覆盖）
      downloadProgress.value = null;
      // 轮询检查（最多 10 秒）：Ollama 落盘/写入 Tags 需要时间，固定 1 秒延迟不可靠
      // 只要 isModelInstalled 返回 true 就立即停止，避免用户等待
      let retries = 0;
      const maxRetries = 20; // 20 × 500ms = 10 秒
      while (retries < maxRetries) {
        await checkOllamaStatus();
        if (isModelInstalled(modelName)) break;
        retries++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      const errorMsg = res.error?.message || '未知错误';
      // 提供更友好的错误提示
      if (errorMsg.includes('磁盘空间不足')) {
        ElMessage.error(`磁盘空间不足，请清理磁盘后重试。${errorMsg}`);
      } else if (errorMsg.includes('HTTP 404') || errorMsg.includes('not found')) {
        ElMessage.error(`模型 ${modelName} 不存在，请检查模型名称是否正确`);
      } else if (errorMsg.includes('HTTP 500') || errorMsg.includes('internal server error')) {
        ElMessage.error('Ollama服务内部错误，请重启Ollama后重试');
      } else if (errorMsg.includes('超时') || errorMsg.includes('timeout')) {
        ElMessage.error('下载超时，请检查网络连接后重试');
      } else if (errorMsg.includes('connection refused') || errorMsg.includes('ECONNREFUSED')) {
        ElMessage.error('无法连接到Ollama服务，请确认Ollama已启动');
      } else {
        ElMessage.error('下载失败：' + errorMsg);
      }
      downloadProgress.value = null;
    }
  } catch (err: any) {
    ElMessage.error('下载失败：' + err.message);
    downloadProgress.value = null;
  } finally {
    pullingModel.value = '';
    // 清理事件监听器
    if (pullProgressCleanup) {
      pullProgressCleanup();
      pullProgressCleanup = null;
    }
  }
}

async function handleDeleteModel(modelName: string) {
  if (!window.api) return;
  try {
    await ElMessageBox.confirm(
      `确定要删除模型 ${modelName} 吗？删除后不可恢复。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
    const res = await window.api.ollama.deleteModel(modelName, aiSettings.ollamaUrl);
    if (res.success) {
      ElMessage.success('模型已删除');
      // 如果删除的是当前选中的模型，清空选择
      if (aiSettings.ollamaModel === modelName) {
        aiSettings.ollamaModel = '';
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      await checkOllamaStatus();
    } else {
      // 检查模型是否实际存在
      await checkOllamaStatus();
      const stillExists = ollamaStatus.value?.models?.some(m => m.name === modelName);
      if (!stillExists) {
        ElMessage.success('模型已删除');
        if (aiSettings.ollamaModel === modelName) {
          aiSettings.ollamaModel = '';
        }
      } else {
        ElMessage.error('删除失败：' + (res.error?.message || '未知错误'));
      }
    }
  } catch (err: any) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败：' + err.message);
    }
  }
}

async function handleTestOllamaConnection() {
  if (!window.api) return;
  localTestLoading.value = true;
  localTestResult.value = null;
  try {
    const res = await window.api.ollama.testConnection(aiSettings.ollamaUrl);
    localTestResult.value = res;
  } catch (err: any) {
    localTestResult.value = { success: false, error: { code: 'CLIENT_ERROR', message: err.message } };
  } finally {
    localTestLoading.value = false;
  }
}

function openDownloadPage() {
  if (installGuide.value?.downloadUrl && window.api) {
    window.api.shell.openExternal(installGuide.value.downloadUrl);
  }
}

async function handleDialogOpened() {
  await loadRecommendedModels();
  await loadInstallGuide();
  if (aiSettings.mode === 'local') {
    await checkOllamaStatus();
    startHealthCheck();
  }
}

watch(showSettings, (visible) => {
  if (visible && aiSettings.mode === 'local') {
    startHealthCheck();
  } else {
    stopHealthCheck();
  }
});

watch(() => aiSettings.mode, (mode) => {
  if (mode === 'local' && showSettings.value) {
    // 立即检测一次状态，再启动定时轮询
    checkOllamaStatus();
    startHealthCheck();
  } else {
    stopHealthCheck();
  }
  // 恢复对应模式的配置
  restoreModeSettings(mode);
});

// 首次使用提示：检测到Ollama未安装时自动弹出引导
const hasShownInstallPrompt = ref(false);
watch(
  () => ollamaStatus.value?.state,
  (state) => {
    if (
      state === 'not_installed' &&
      aiSettings.mode === 'local' &&
      showSettings.value &&
      !hasShownInstallPrompt.value
    ) {
      hasShownInstallPrompt.value = true;
      setTimeout(() => {
        showInstallGuide.value = true;
      }, 500);
    }
  }
);

function formatModelSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '未知';
  if (bytes >= 1073741824) {
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }
  if (bytes >= 1048576) {
    return (bytes / 1048576).toFixed(0) + ' MB';
  }
  return (bytes / 1024).toFixed(0) + ' KB';
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
      const data = res.data;
      // 保存通用配置
      aiSettings.mode = data.mode || 'cloud';
      aiSettings.privacyMode = (data.privacyMode ?? 0) === 1;
      aiSettings.sensitiveWords = data.sensitiveWords || '';
      aiSettings.temperature = data.temperature ?? 0.3;
      // 本地配置
      aiSettings.ollamaModel = data.ollamaModel || '';
      aiSettings.ollamaUrl = data.ollamaUrl || 'http://localhost:11434';
      // 云端配置
      // 仅在 apiKey 不是脱敏掩码（含 ****）时才填充输入框，避免覆盖为无意义值
      if (data.apiKey && !data.apiKey.includes('****')) {
        aiSettings.apiKey = data.apiKey;
      }
      aiSettings.baseUrl = data.apiBase || 'https://api.openai.com/v1';
      aiSettings.model = data.model || 'gpt-4o';
      aiSettings.fullUrl = aiSettings.baseUrl.includes('/v1');
      aiSettings.apiFormat = data.apiFormat || 'openai';
      // OCR预处理配置：云端模式默认关闭，本地模式默认开启
      aiSettings.ocrPreprocess = data.ocrPreprocess !== undefined ? Boolean(data.ocrPreprocess) : (data.mode === 'local');

      // 加载云端模型列表
      await loadCloudModels();
    }
  } catch (e) {
    console.error('Failed to load AI settings', e);
  } finally {
    settingsLoaded.value = true;
  }
}

// 加载云端模型列表
async function loadCloudModels() {
  if (!window.api) return;
  try {
    const res = await window.api.ai.getModels();
    if (res.success && res.data) {
      cloudModels.value = res.data.models || [];
      activeModelId.value = res.data.activeModelId || null;
    }
  } catch (e) {
    console.error('加载云端模型列表失败:', e);
  }
}

// 打开添加模型表单
function openAddModelForm() {
  editingModel.value = {
    name: '',
    apiBase: aiSettings.baseUrl,
    model: aiSettings.model,
    apiFormat: aiSettings.apiFormat,
    enabled: true,
    priority: cloudModels.value.length + 1,
  };
  showModelForm.value = true;
}

// 编辑模型
function editModel(model: CloudModel) {
  editingModel.value = { ...model };
  showModelForm.value = true;
}

// 保存模型
async function saveModel() {
  if (!editingModel.value || !window.api) return;
  // 展开为普通对象，避免 Vue 响应式 Proxy 无法被 Electron IPC structured-clone
  const model = { ...editingModel.value };
  try {
    let res;
    if (model.id) {
      res = await window.api.ai.updateModel(model.id, model);
    } else {
      res = await window.api.ai.createModel(model);
    }
    if (res.success) {
      ElMessage.success(model.id ? '模型已更新' : '模型已添加');
      showModelForm.value = false;
      editingModel.value = null;
      await loadCloudModels();
    } else {
      ElMessage.error('保存失败：' + (res.error?.message || '未知错误'));
    }
  } catch (error: any) {
    ElMessage.error('保存失败：' + error.message);
  }
}

// 删除模型
async function deleteModel(modelId: string) {
  if (!window.api) return;
  try {
    const res = await window.api.ai.deleteModel(modelId);
    if (res.success) {
      ElMessage.success('模型已删除');
      await loadCloudModels();
    }
  } catch (error: any) {
    ElMessage.error('删除失败：' + error.message);
  }
}

// 设为当前使用
async function setActiveModel(modelId: string | null) {
  if (!window.api) return;
  try {
    const res = await window.api.ai.setActiveModel(modelId);
    if (res.success) {
      activeModelId.value = modelId;
      ElMessage.success(modelId ? '已切换到指定模型' : '已恢复自动切换');
      await loadCloudModels();
    }
  } catch (error: any) {
    ElMessage.error('操作失败：' + error.message);
  }
}

// 测试模型连接
async function testModelConnection(modelId: string) {
  if (!window.api) return;
  modelTestLoading.value = modelId;
  try {
    const res = await window.api.ai.testModelConnection(modelId);
    if (res.success) {
      ElMessage.success('连接测试成功');
    } else {
      ElMessage.error('连接失败：' + (res.error?.message || '未知错误'));
    }
  } catch (error: any) {
    ElMessage.error('连接失败：' + error.message);
  } finally {
    modelTestLoading.value = null;
  }
}

// 切换模式时恢复对应配置
function restoreModeSettings(mode: 'cloud' | 'local') {
  if (mode === 'cloud') {
    // 切换到云端模式时，恢复云端配置
    // 配置已经从数据库加载，无需额外操作
  } else {
    // 切换到本地模式时，恢复本地配置
    // 配置已经从数据库加载，无需额外操作
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
      privacyMode: aiSettings.privacyMode ? 1 : 0,
      sensitiveWords: aiSettings.sensitiveWords,
      mode: aiSettings.mode,
      ollamaModel: aiSettings.ollamaModel,
      ollamaUrl: aiSettings.ollamaUrl,
      ocrPreprocess: aiSettings.ocrPreprocess,
    });
    if (res.success) {
      ElMessage.success('设置已保存');
      showSettings.value = false;
    } else {
      ElMessage.error('保存失败：' + (res.error?.message || '未知错误'));
    }
  } catch (error: any) {
    ElMessage.error('保存失败：' + error.message);
  }
}

async function sendMessage(customMessage?: string, context?: string) {
  if (!window.api) {
    ElMessage.warning('应用未初始化，请在 Electron 环境中运行');
    return;
  }

  const content = customMessage || inputMessage.value.trim();
  if ((!content && pendingAttachments.value.length === 0) || loading.value) return;
  if (customMessage && pendingAttachments.value.length > 0) {
    ElMessage.warning('快捷指令暂不支持携带附件');
    return;
  }

  // 等待设置加载完成
  if (!settingsLoaded.value) {
    loading.value = true;
    let waitCount = 0;
    while (!settingsLoaded.value && waitCount < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitCount++;
    }
    loading.value = false;
  }

  // 重新检查配置
  if (!isConfigured.value) {
    messages.value.push({
      id: Date.now() + Math.random(),
      role: 'user',
      content: content || '请分析附件内容',
      attachments: pendingAttachments.value.length > 0 ? [...pendingAttachments.value] : undefined,
    });
    messages.value.push({
      id: Date.now() + Math.random(),
      role: 'assistant',
      content: 'AI 未配置，无法进行分析。请点击右上角的「AI设置」按钮配置 API Key。',
      suggestions: ['配置AI API Key', '查看使用帮助'],
    });
    pendingAttachments.value = [];
    nextTick(() => scrollToBottom());
    return;
  }

  const messageAttachments = pendingAttachments.value.length > 0 ? [...pendingAttachments.value] : undefined;
  messages.value.push({
    id: Date.now() + Math.random(),
    role: 'user',
    content: content || '请分析附件内容',
    attachments: messageAttachments,
  });

  inputMessage.value = '';
  pendingAttachments.value = [];
  loading.value = true;

  await nextTick();
  scrollToBottom();

  // 如果已配置AI，优先使用AI
  if (isConfigured.value) {
    try {
      const res = await window.api.ai.chat({
        messages: messages.value.map(m => ({ role: m.role, content: m.content, attachments: m.attachments })),
        model: aiSettings.mode === 'local' ? aiSettings.ollamaModel : aiSettings.model,
        temperature: aiSettings.temperature,
        context: context || undefined,
      });
      if (res.success && res.data) {
        messages.value.push({
          id: Date.now() + Math.random(),
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
        id: Date.now() + Math.random(),
        role: 'assistant',
        content: `AI调用失败：${error.message || '未知错误'}`,
        suggestions: ['检查AI配置', '查看控制台日志'],
      });
      loading.value = false;
      nextTick(() => scrollToBottom());
      return;
    }
  }

  // 未配置AI，提示用户配置
  messages.value.push({
    id: Date.now() + Math.random(),
    role: 'assistant',
    content: 'AI 未配置，无法进行分析。请点击右上角的「AI设置」按钮配置 API Key。',
    suggestions: ['配置AI API Key', '查看使用帮助'],
  });
  loading.value = false;
  nextTick(() => scrollToBottom());
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
  pendingAttachments.value = [];
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function triggerAttachmentUpload() {
  fileInput.value?.click();
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files ? Array.from(target.files) : [];
  files.forEach(file => addAttachmentFile(file));
  target.value = '';
}

function handleDrop(e: DragEvent) {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  Array.from(files).forEach(file => addAttachmentFile(file));
}

function removeAttachment(index: number) {
  pendingAttachments.value.splice(index, 1);
}

function isDuplicateAttachment(name: string, size: number): boolean {
  return pendingAttachments.value.some(a => a.name === name && a.size === size);
}

async function addAttachmentFile(file: File) {
  if (isDuplicateAttachment(file.name, file.size)) {
    ElMessage.warning(`附件「${file.name}」已存在`);
    return;
  }
  const kind = getAttachmentKind(file);
  if (!kind) {
    ElMessage.warning(`不支持的文件类型：${file.name}`);
    return;
  }
  const limit = getAttachmentSizeLimit(kind);
  if (file.size > limit) {
    const limitLabel = kind === 'image' ? '10MB' : kind === 'text' ? '1MB' : '20MB';
    ElMessage.warning(`「${file.name}」超过大小限制（${limitLabel}）`);
    return;
  }
  if (!window.api) {
    ElMessage.warning('应用未初始化，请在 Electron 环境中运行');
    return;
  }

  try {
    const base64Data = await readAttachmentAsBase64(file);
    const res = await window.api.attachment.save({ name: file.name, base64Data });
    if (res.success && res.data) {
      pendingAttachments.value.push({
        name: res.data.name,
        path: res.data.path,
        type: res.data.type,
        size: res.data.size,
      });
    } else {
      ElMessage.error(`附件保存失败：${res.error?.message || '未知错误'}`);
    }
  } catch (error: any) {
    ElMessage.error(`附件「${file.name}」处理失败：${error.message || '未知错误'}`);
  }
}

function readAttachmentAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      if (!base64) {
        reject(new Error('文件内容读取失败'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items || items.length === 0) return;

  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length > 0) {
    e.preventDefault();
    files.forEach(file => addAttachmentFile(file));
  }
}

function startHealthCheck() {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(() => {
    if (aiSettings.mode === 'local' && showSettings.value) {
      checkOllamaStatus();
    }
  }, HEALTH_CHECK_INTERVAL);
}

function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

onMounted(async () => {
  await loadSettings();
  loadProjects();
});

onUnmounted(() => {
  stopHealthCheck();
  if (pullProgressCleanup) {
    pullProgressCleanup();
  }
});

onDeactivated(() => {
  stopHealthCheck();
});

onActivated(() => {
  if (aiSettings.mode === 'local' && showSettings.value) {
    startHealthCheck();
  }
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

.msg-attachments {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}

.msg-attachment-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--bg-hover);
  font-size: 12px;
  color: var(--text-primary);

  .msg-attachment-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .msg-attachment-size {
    color: var(--text-secondary);
    flex-shrink: 0;
  }
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

.pending-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.pending-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  padding: 4px 10px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-hover);
  font-size: 12px;
  color: var(--text-primary);

  .chip-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-size {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .chip-remove {
    cursor: pointer;
    color: var(--text-secondary);
    flex-shrink: 0;

    &:hover {
      color: var(--color-danger);
    }
  }
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

.desensitize-rules {
  margin-top: 10px;
  padding: 10px 12px;
  background: rgba(64, 158, 255, 0.06);
  border: 1px solid rgba(64, 158, 255, 0.15);
  border-radius: 6px;
}

.desensitize-rules-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.desensitize-rules-subtitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 8px 0 4px 0;
  padding-top: 6px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.desensitize-rule-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 2;
}

.rule-type {
  display: inline-block;
  min-width: 48px;
  font-size: 11px;
  font-weight: 500;
  color: #409eff;
  background: rgba(64, 158, 255, 0.1);
  border-radius: 3px;
  padding: 0 5px;
  text-align: center;
  flex-shrink: 0;
}

.desensitize-rule-item code {
  font-size: 11px;
  background: rgba(0, 0, 0, 0.06);
  padding: 0 4px;
  border-radius: 3px;
  font-family: 'Consolas', 'Courier New', monospace;
}

.compliance-notice {
  background: rgba(230, 162, 60, 0.08);
  border: 1px solid rgba(230, 162, 60, 0.25);
  border-radius: 6px;
  padding: 14px 16px;
}

.compliance-notice-title {
  font-size: 14px;
  font-weight: 600;
  color: #e6a23c;
  margin-bottom: 10px;
}

.compliance-notice-body {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.compliance-notice-body p {
  margin: 0 0 6px 0;
}

.compliance-notice-body ul {
  margin: 4px 0 8px 0;
  padding-left: 18px;
}

.compliance-notice-body li {
  margin-bottom: 3px;
}

.compliance-notice-footer {
  font-weight: 500;
  color: #e6a23c;
  margin-top: 4px;
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

.ollama-status-panel {
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 14px 16px;
}

.ollama-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ollama-status-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.ollama-status-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ollama-status-icon {
  font-size: 28px;
  flex-shrink: 0;
}

.ollama-status-icon.not-installed {
  opacity: 0.7;
}

.ollama-status-icon.not-running {
  opacity: 0.8;
}

.ollama-status-text {
  flex: 1;
}

.ollama-status-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.ollama-status-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--primary-color);
  }

  &.selected {
    border-color: var(--primary-color);
    background: rgba(64, 158, 255, 0.08);
  }

  &.recommended {
    cursor: default;

    &:hover {
      border-color: var(--border-color);
    }
  }
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
  word-break: break-all;
}

.model-size {
  font-size: 11px;
  color: var(--text-secondary);
}

.model-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  line-height: 1.5;
}

.model-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.download-progress {
  margin-top: 10px;
  padding: 8px 10px;
  background: rgba(64, 158, 255, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(64, 158, 255, 0.15);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.progress-status {
  font-size: 12px;
  color: var(--text-secondary);
}

.progress-percent {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color, #409eff);
}

.progress-size {
  font-size: 11px;
  color: var(--text-placeholder, #909399);
  margin-top: 4px;
  text-align: right;
}

.install-steps {
  margin-bottom: 30px;
  padding: 0 20px;
}

.install-step-content {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.guide-icon {
  color: var(--primary-color, #409eff);
  margin-bottom: 16px;
}

.platform-selection {
  margin-top: 24px;
}

.platform-selection-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.platform-cards {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.platform-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 32px;
  background: var(--bg-hover);
  border: 2px solid var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  color: var(--text-secondary);

  &:hover {
    border-color: var(--primary-color);
    background: rgba(64, 158, 255, 0.08);
  }

  &.active {
    border-color: var(--primary-color);
    background: rgba(64, 158, 255, 0.12);
    color: var(--primary-color);
  }
}

.download-section {
  text-align: center;
  padding: 30px 0;
}

.download-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 12px;
}

.install-instructions {
  margin-top: 24px;
  padding: 16px;
  background: var(--bg-hover);
  border-radius: 8px;
}

.instructions-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.step-list {
  list-style: none;
  padding: 0;
  margin: 0;
  counter-reset: step;
}

.step-item-detail {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);

  &:last-child {
    border-bottom: none;
  }
}

.step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--primary-color, #409eff);
  color: white;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.step-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.verify-section {
  text-align: center;
  padding: 30px 0;
}

.verify-section h3 {
  font-size: 18px;
  color: var(--text-primary);
  margin: 16px 0 8px;
}

.verify-section p {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.verify-success {
  margin-top: 20px;
}

.install-guide {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.install-guide-intro {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.install-guide-intro p {
  margin: 0 0 6px 0;
}

.install-guide-steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.install-guide-platform {
  background: var(--bg-hover);
  border-radius: 6px;
  padding: 12px 14px;
}

.platform-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.install-guide-platform ol {
  margin: 0;
  padding-left: 20px;
}

.install-guide-platform li {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
}

.install-guide-note {
  margin-top: 8px;
}

// 深色主题覆盖
:root.dark {
  .required {
    color: var(--color-danger);
  }

  .setting-hint {
    background: rgba(59, 130, 246, 0.1);
    color: var(--color-primary);
  }

  .test-result {
    &.test-success {
      background: rgba(24, 169, 87, 0.15);
      color: #34D399;
      border-color: rgba(24, 169, 87, 0.3);
    }

    &.test-error {
      background: rgba(229, 57, 53, 0.15);
      color: #F87171;
      border-color: rgba(229, 57, 53, 0.3);
    }

    .test-details {
      background: rgba(0, 0, 0, 0.3);
      color: var(--color-text-secondary);
    }
  }

  .markdown-body {
    blockquote {
      border-left-color: var(--color-primary);
      background: rgba(59, 130, 246, 0.08);
      color: var(--color-text-secondary);
    }

    code {
      background: rgba(255, 255, 255, 0.08);
      color: var(--color-text-primary);
    }

    pre {
      background: #0F172A;
      color: #E2E8F0;
    }

    th, td {
      border-color: var(--color-border-base);
    }

    a {
      color: var(--color-primary);
    }

    hr {
      border-top-color: var(--color-border-base);
    }
  }
}

// 云端多模型管理样式
.model-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-secondary);
  font-size: 13px;
  background: var(--bg-hover);
  border-radius: 6px;
}

.model-card {
  padding: 12px 14px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: all 0.2s;

  &.model-active {
    border-color: var(--primary-color);
    background: rgba(64, 158, 255, 0.08);
  }

  &:hover {
    border-color: var(--primary-color);
  }
}

.model-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.model-card-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
}

.model-card-priority {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 2px 8px;
  background: var(--bg-primary);
  border-radius: 4px;
}

.model-card-info {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;

  .model-card-base {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }
}

.model-card-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}
</style>
