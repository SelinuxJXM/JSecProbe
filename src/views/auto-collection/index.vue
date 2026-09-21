<template>
  <div class="auto-collection-page">
    <div class="ac-header">
      <div class="ac-header-left">
        <div class="ac-title">
          <el-icon class="ac-title-icon"><Cpu /></el-icon>
          <span>自动采集</span>
        </div>
        <div class="ac-subtitle">连接目标设备，自动执行等保合规核查命令，并生成 Markdown 报告文档</div>
      </div>
      <div class="ac-project-picker">
        <span class="ac-project-label">所属项目</span>
        <el-select
          v-model="selectedProjectId"
          placeholder="选择测评项目"
          filterable
          clearable
          style="width: 280px"
        >
          <el-option
            v-for="p in projects"
            :key="p.id"
            :value="p.id"
            :label="p.name"
          />
        </el-select>
      </div>
    </div>

    <div class="ac-body">
      <!-- 左栏：连接配置 -->
      <div class="ac-left">
        <div class="ac-panel ac-profile-panel">
          <div class="ac-panel-header">
            <span>连接配置</span>
            <el-button type="primary" link size="small" @click="switchProfileMode">
              {{ profileMode === 'select' ? '新建连接' : '选择已有' }}
            </el-button>
          </div>

          <div class="ac-panel-body">
            <template v-if="profileMode === 'select'">
              <el-empty v-if="profiles.length === 0" description="暂无连接配置，请新建" :image-size="60" />
              <template v-else>
                <div class="ac-profile-toolbar">
                  <el-checkbox
                    v-model="selectAllChecked"
                    :indeterminate="selectAllIndeterminate"
                    @change="handleSelectAllProfiles"
                  >
                    全选
                  </el-checkbox>
                  <el-button
                    v-if="selectedProfileIds.length > 0"
                    type="danger"
                    link
                    size="small"
                    @click="handleBatchDelete"
                  >
                    删除选中（{{ selectedProfileIds.length }}）
                  </el-button>
                </div>
                <div class="ac-profile-list">
                  <div
                    v-for="p in profiles"
                    :key="p.id"
                    class="ac-profile-item"
                    :class="{ 'is-selected': selectedProfileIds.includes(p.id), 'is-active-task': getProfileTaskCount(p.id) > 0 }"
                  >
                    <el-checkbox
                      :model-value="selectedProfileIds.includes(p.id)"
                      @change="toggleProfileSelection(p.id)"
                    />
                    <div class="ac-profile-item-body" @click="toggleProfileSelection(p.id)">
                      <div class="ac-profile-item-main">
                        <span class="ac-profile-name">{{ p.name }}</span>
                        <el-tag
                          v-if="getProfileTaskCount(p.id) > 0"
                          :type="getProfileRunningCount(p.id) > 0 ? 'warning' : 'info'"
                          size="small"
                          class="ac-profile-task-badge"
                        >
                          {{ getProfileRunningCount(p.id) > 0 ? '执行中' : '排队' }} {{ getProfileTaskCount(p.id) }}
                        </el-tag>
                      </div>
                      <div class="ac-profile-item-sub">
                        <span class="ac-profile-conn-type">{{ connTypeLabel(p.connType) }}</span>
                        <span class="ac-profile-host">{{ p.host }}:{{ p.port || defaultPort(p.connType) }}</span>
                      </div>
                      <div v-if="p.username" class="ac-profile-item-user">
                        用户：{{ p.username }}
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </template>

            <el-form v-else label-position="top" class="ac-profile-form">
              <el-form-item label="连接类型">
                <el-select v-model="form.connType" style="width: 100%" @change="handleConnTypeChange">
                  <el-option v-for="t in CONN_TYPE_OPTIONS" :key="t.value" :value="t.value" :label="t.label" />
                </el-select>
              </el-form-item>
              <el-form-item label="连接名称">
                <el-input v-model="form.name" :placeholder="`如：${connTypeLabel(form.connType)} 连接`" />
              </el-form-item>
              <el-form-item label="主机地址">
                <el-input v-model="form.host" placeholder="IP 或域名" />
              </el-form-item>
              <el-form-item label="端口">
                <el-input-number v-model="form.port" :min="1" :max="65535" style="width: 100%" />
              </el-form-item>
              <el-form-item v-if="form.connType !== 'redis'" label="用户名">
                <el-input v-model="form.username" :placeholder="form.connType === 'ssh' ? '如 root / administrator' : '数据库登录用户' " />
              </el-form-item>
              <el-form-item v-if="form.connType === 'ssh'" label="认证方式">
                <el-radio-group v-model="form.authMethod">
                  <el-radio-button value="password">密码</el-radio-button>
                  <el-radio-button value="privateKey">私钥</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item v-if="form.connType === 'ssh' && form.authMethod === 'password'" label="密码">
                <el-input v-model="form.password" type="password" show-password />
              </el-form-item>
              <el-form-item v-else-if="form.connType === 'ssh'" label="私钥路径">
                <el-input v-model="form.privateKeyPath" placeholder="私钥文件绝对路径" />
              </el-form-item>
              <el-form-item v-else label="密码">
                <el-input
                  v-model="form.password"
                  type="password"
                  show-password
                  :placeholder="form.connType === 'redis' ? '无密码可留空' : '数据库登录密码'"
                />
              </el-form-item>
              <el-form-item v-if="showDatabaseField" label="数据库名">
                <el-input v-model="form.database" :placeholder="databasePlaceholder" />
              </el-form-item>
              <el-form-item v-if="form.connType === 'sqlserver'" label="实例名">
                <el-input v-model="form.instance" placeholder="可选，如 SQLEXPRESS" />
              </el-form-item>
              <el-form-item v-if="form.connType === 'redis'" label="数据库编号">
                <el-input-number v-model="form.dbIndex" :min="0" :max="15" style="width: 100%" />
              </el-form-item>
              <template v-if="form.connType === 'winrm' || form.connType === 'http'">
                <el-form-item label="HTTPS 加密">
                  <el-switch v-model="form.useHttps" />
                </el-form-item>
              </template>
              <template v-if="form.connType === 'winrm'">
                <el-form-item label="认证方式">
                  <el-select v-model="form.winrmAuth" style="width: 100%">
                    <el-option value="auto" label="自动（本地用户 Basic，域用户 NTLM）" />
                    <el-option value="basic" label="Basic" />
                    <el-option value="ntlm" label="NTLM" />
                  </el-select>
                </el-form-item>
                <el-form-item label="PowerShell 模式">
                  <el-switch v-model="form.usePowershell" />
                  <span class="ac-form-tip">开启后用 PowerShell 执行核查命令</span>
                </el-form-item>
              </template>
              <el-form-item v-if="form.connType === 'http'" label="控制台账号（可选）">
                <el-input v-model="form.username" placeholder="WebLogic 控制台用户，无需认证可留空" />
              </el-form-item>
              <el-form-item label="关联资产">
                <el-select v-model="form.assetId" placeholder="可选：关联系统构成中的资产" clearable filterable style="width: 100%">
                  <el-option
                    v-for="a in assets"
                    :key="a.id"
                    :value="a.id"
                    :label="`${a.name}（${a.ip || '无IP'} / ${a.os || '未知系统'}）`"
                  />
                </el-select>
              </el-form-item>
            </el-form>
          </div>

          <div class="ac-panel-footer">
            <span v-if="profileMode === 'select' && selectedProfileIds.length > 0" class="ac-selected-count">
              已选 {{ selectedProfileIds.length }} 个连接
            </span>
            <el-button :loading="testing" @click="handleTestConnection">测试连接</el-button>
            <el-button v-if="profileMode === 'create'" type="primary" @click="handleSaveProfile">保存连接</el-button>
            <el-button v-if="profileMode === 'select' && currentProfileId" type="danger" link @click="handleDeleteProfile">删除当前</el-button>
          </div>
        </div>
      </div>

      <!-- 右栏 -->
      <div class="ac-right">
        <!-- 采集设置 -->
        <div class="ac-panel ac-setup-panel">
          <div class="ac-panel-header"><span>采集设置</span></div>
          <div class="ac-row ac-cmd-filter">
            <el-input v-model="commandKeyword" placeholder="搜索命令名称 / 内容 / 分类..." clearable style="width: 200px" />
            <el-select v-model="commandOsFilter" style="width: 170px">
              <el-option label="OS：自动（按资产）" value="__auto__" />
              <el-option label="OS：全部" value="" />
              <el-option v-for="os in osOptions" :key="os" :value="os" :label="`OS：${os}`" />
            </el-select>
            <span class="ac-cmd-count">已选 {{ selectedCommandIds.length }} / {{ filteredCommands.length }}</span>
            <el-button link type="primary" @click="toggleSelectAll">全选/清空</el-button>
          </div>
          <div class="ac-cmd-scroll">
            <el-scrollbar height="100%" class="ac-cmd-list">
              <el-checkbox-group v-model="selectedCommandIds" class="ac-cmd-group">
                <div
                  v-for="cmd in filteredCommands"
                  :key="cmd.id"
                  class="ac-cmd-item"
                  :class="{ selected: selectedCommandIds.includes(cmd.id) }"
                  @click="toggleCommandSelection(cmd, $event)"
                >
                  <el-checkbox :value="cmd.id">
                    <span class="ac-cmd-name">{{ cmd.name }}</span>
                    <span class="ac-cmd-target">{{ cmd.target }}</span>
                  </el-checkbox>
                  <div class="ac-cmd-command">{{ cmd.command }}</div>
                </div>
              </el-checkbox-group>
              <el-empty v-if="filteredCommands.length === 0" description="暂无匹配的核查命令" :image-size="60" />
            </el-scrollbar>
          </div>

          <div class="ac-panel-footer">
            <div class="ac-start-hint">
              <el-icon v-if="canStartReason"><InfoFilled /></el-icon>
              <span v-if="canStartReason">{{ canStartReason }}</span>
              <span v-else class="ac-concurrent-tip">
                已选 {{ selectedProfileIds.length }} 个连接，{{ selectedCommandIds.length }} 条命令，并发执行（上限 3）
              </span>
            </div>
            <el-button type="primary" :disabled="!canStart" :loading="starting" @click="handleStartTask">
              开始采集（{{ selectedProfileIds.length }} × {{ selectedCommandIds.length }}）
            </el-button>
            <el-button class="ac-local-collect-btn" type="warning" plain :disabled="selectedCommandIds.length === 0" @click="openLocalCollectDialog">
              本地采集
            </el-button>
          </div>
        </div>

        <!-- 底部：进度 / 结果 / 文档历史 -->
        <div class="ac-panel ac-bottom-panel">
          <el-tabs v-model="activeTab" class="ac-tabs">
            <el-tab-pane label="执行进度" name="progress">
              <el-empty
                v-if="tasks.length === 0"
                description="暂无执行记录，配置连接并勾选命令后点击「开始采集」"
                :image-size="70"
              />
              <div v-else class="ac-task-list">
                <el-scrollbar height="100%">
                  <div v-for="t in tasks" :key="t.id" class="ac-task-card" :class="{ 'is-active': t.id === activeTaskId, 'is-failed': t.status === 'failed' || t.status === 'error' }" :data-task-id="t.id">
                    <div class="ac-task-header">
                      <span class="ac-task-title">{{ t.profileName }}</span>
                      <el-tag :type="taskStatusType(t.status)" size="small">{{ taskStatusText(t.status) }}</el-tag>
                    </div>
                    <el-progress :percentage="t.percent || 0" :status="t.status === 'failed' ? 'exception' : undefined" />
                    <div class="ac-progress-msg">{{ t.message || '' }}</div>
                    <div class="ac-progress-msg sub">
                      已完成 {{ t.completedCommands || 0 }} / {{ t.totalCommands || 0 }} 条命令
                      <template v-if="t.summary.total > 0">
                        ｜成功 {{ t.summary.success }} / 失败 {{ t.summary.failed }} / 超时 {{ t.summary.timeout }}
                      </template>
                    </div>
                    <div v-if="t.expanded" class="ac-cmd-states">
                      <el-scrollbar height="100%">
                        <div v-for="s in t.commandStates" :key="s.commandId" class="ac-cmd-state-row">
                          <span class="ac-cmd-state-name" :title="s.command">{{ s.command || s.commandId }}</span>
                          <span class="ac-cmd-state-duration">{{ s.durationMs != null ? `${s.durationMs} ms` : '' }}</span>
                          <el-tag :type="stateTagType(s.status)" size="small">{{ stateText(s.status) }}</el-tag>
                        </div>
                        <!-- 无命令明细时给出明确提示：否则「命令明细」按钮点了看不到任何变化，像是失效 -->
                        <div v-if="t.commandStates.length === 0" class="ac-cmd-empty">暂无命令明细</div>
                      </el-scrollbar>
                    </div>
                    <div class="ac-task-actions">
                      <el-button
                        size="small"
                        type="danger"
                        plain
                        :disabled="!isTaskRunning(t.status)"
                        :loading="canceling"
                        @click="handleCancelTask(t)"
                      >取消任务</el-button>
                      <el-button
                        v-if="!isTaskRunning(t.status)"
                        link
                        size="small"
                        type="danger"
                        @click="handleDeleteTask(t)"
                      >删除</el-button>
                      <el-button link size="small" @click="toggleTaskExpand(t)">命令明细</el-button>
                      <el-button v-if="!isTaskRunning(t.status)" link size="small" @click="viewTaskResults(t.id)">查看结果</el-button>
                      <el-button
                        v-if="!isTaskRunning(t.status) && t.commandStates.length > 0"
                        type="success"
                        size="small"
                        :loading="saving"
                        @click="handleSaveDocument(t.id)"
                      >
                        保存文档
                      </el-button>
                    </div>
                  </div>
                </el-scrollbar>
              </div>
            </el-tab-pane>

            <el-tab-pane v-if="results.length > 0" :label="`采集结果（${results.length}）`" name="results">
              <el-table :data="results" size="small" max-height="200">
                <el-table-column type="expand">
                  <template #default="{ row }">
                    <div class="ac-result-detail">
                      <div class="ac-result-label">命令</div>
                      <pre class="ac-mono">{{ row.command }}</pre>
                      <div class="ac-result-label">输出（stdout）</div>
                      <pre class="ac-mono">{{ row.stdout || '(空)' }}</pre>
                      <template v-if="row.parsedData">
                        <div class="ac-result-label">解析结果</div>
                        <pre class="ac-mono">{{ formatParsed(row.parsedData) }}</pre>
                      </template>
                      <template v-if="row.stderr">
                        <div class="ac-result-label stderr">错误（stderr）</div>
                        <pre class="ac-mono stderr">{{ row.stderr }}</pre>
                      </template>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="command" label="命令" min-width="260" show-overflow-tooltip />
                <el-table-column prop="status" label="状态" width="80">
                  <template #default="{ row }">
                    <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
                      {{ statusText(row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane :label="`文档历史（${documents.length}）`" name="documents">
              <el-empty v-if="documents.length === 0" description="暂无采集文档，完成任务后可保存 Markdown 报告" :image-size="70" />
              <el-table v-else :data="documents" size="small" max-height="200">
                <el-table-column prop="title" label="文档名称" min-width="220" show-overflow-tooltip />
                <el-table-column prop="assetName" label="资产" width="110" show-overflow-tooltip />
                <el-table-column prop="host" label="主机" width="120" />
                <el-table-column prop="createdAt" label="生成时间" width="150">
                  <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="110">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" @click="handleOpenDocumentDir(row)">打开</el-button>
                    <el-button link type="danger" size="small" @click="handleDeleteDocument(row.id)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </div>
      </div>
    </div>

  <!-- 本地采集助手：目标机仅开远程桌面(3389)无法用连接器远程执行时的兜底方案 -->
  <el-dialog
    v-model="localDialogVisible"
    title="本地采集助手"
    width="560px"
    append-to-body
  >
    <div class="ac-local-dialog-body">
      <p class="ac-local-dialog-tip">
        已选 <b>{{ selectedCommandIds.length }}</b> 条核查命令。将生成一个 PowerShell 脚本，拷到目标
        Windows 主机以管理员身份运行一次，本地逐条执行命令并生成 results.json，再导回本工具入库。
      </p>
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="目标主机">
          <el-input v-model="localHost" placeholder="可选，将写入脚本头部便于溯源" clearable />
        </el-form-item>
      </el-form>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="无需目标机开启 WinRM/SSH，仅需能放置脚本并本地运行一次（经 RDP/拷贝投递）。"
      />
    </div>
    <template #footer>
      <el-button :loading="exporting" type="primary" @click="handleExportLocalScript">导出本地脚本</el-button>
      <el-button :loading="importing" type="success" @click="handleImportLocalResults">导入结果文件</el-button>
    </template>
  </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Cpu, InfoFilled } from '@element-plus/icons-vue';
import type { ConnectionProfileInput } from '../../../shared/types';

// ============ 所属项目 ============
const projects = ref<any[]>([]);
const selectedProjectId = ref<string>(localStorage.getItem('currentProjectId') || '');

async function loadProjects() {
  const res = await window.api.project.list({ page: 1, pageSize: 200 });
  if (res.success) {
    projects.value = res.data?.list || [];
    // 默认项目已被删除时清空，避免残留无效 ID
    if (selectedProjectId.value && !projects.value.some((p) => p.id === selectedProjectId.value)) {
      selectedProjectId.value = '';
    }
  }
}

// ============ 连接配置 ============
const CONN_TYPE_OPTIONS = [
  { value: 'ssh', label: 'SSH' },
  { value: 'winrm', label: 'WinRM（Windows）' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlserver', label: 'SQL Server' },
  { value: 'redis', label: 'Redis' },
  { value: 'http', label: 'HTTP（WebLogic 控制台）' },
] as const;

const profiles = ref<any[]>([]);
const profileMode = ref<'select' | 'create'>('select');
const currentProfileId = ref('');
const selectedProfileIds = ref<string[]>([]);
const testing = ref(false);

// 全选状态
const selectAllChecked = computed({
  get: () => selectedProfileIds.value.length === profiles.value.length && profiles.value.length > 0,
  set: (val: boolean) => {
    if (val) {
      selectedProfileIds.value = profiles.value.map((p) => p.id);
    } else {
      selectedProfileIds.value = [];
    }
  },
});
const selectAllIndeterminate = computed(
  () => selectedProfileIds.value.length > 0 && selectedProfileIds.value.length < profiles.value.length
);

/**
 * 判断异常是否只是「用户在确认框点了取消/关闭」（4.2 静默吞错）。
 *
 * Element Plus 的 ElMessageBox 在用户取消时抛出 'cancel'（或 message 为 'cancel' 的 Error）。
 * 此前所有 `await ElMessageBox.confirm(...)` 的 catch 都直接 `return`，
 * 真实异常（渲染失败、组件异常）也被当成"用户取消"静默吞掉，排障时没有任何线索。
 * 现在只有用户取消才静默返回，其余一律留痕。
 */
function isUserCancel(e: unknown): boolean {
  return e === 'cancel' || e === 'close' || (e as { message?: string } | null)?.message === 'cancel';
}

// 每个连接的任务统计
function getProfileTaskCount(profileId: string): number {
  return tasks.value.filter((t) => t.profileId === profileId && isTaskRunning(t.status)).length;
}
function getProfileRunningCount(profileId: string): number {
  return tasks.value.filter((t) => t.profileId === profileId && t.status === 'running').length;
}

function toggleProfileSelection(profileId: string) {
  const idx = selectedProfileIds.value.indexOf(profileId);
  if (idx >= 0) {
    selectedProfileIds.value.splice(idx, 1);
  } else {
    selectedProfileIds.value.push(profileId);
  }
  // 同步 currentProfileId（保持单选兼容性）
  if (selectedProfileIds.value.length === 1) {
    currentProfileId.value = selectedProfileIds.value[0];
  } else {
    currentProfileId.value = '';
  }
}

function handleSelectAllProfiles(val: boolean) {
  if (val) {
    selectedProfileIds.value = profiles.value.map((p) => p.id);
  } else {
    selectedProfileIds.value = [];
  }
  currentProfileId.value = '';
}

async function handleBatchDelete() {
  if (selectedProfileIds.value.length === 0) return;
  const runningTasks = tasks.value.filter(
    (t) => isTaskRunning(t.status) && selectedProfileIds.value.includes(t.profileId)
  );
  if (runningTasks.length > 0) {
    try {
      await ElMessageBox.confirm(
        `选中的连接中有 ${runningTasks.length} 个正在执行采集任务，删除后将中断这些任务并清除相关进度，是否继续？`,
        '警告',
        { type: 'warning', confirmButtonText: '强制删除', cancelButtonText: '取消' }
      );
    } catch (e) {
      if (!isUserCancel(e)) console.warn('[auto-collection] 强制删除确认失败:', e);
      return;
    }
  } else {
    try {
      await ElMessageBox.confirm(
        `确定删除选中的 ${selectedProfileIds.value.length} 个连接配置吗？此操作不可恢复。`,
        '批量删除',
        { type: 'warning' }
      );
    } catch (e) {
      if (!isUserCancel(e)) console.warn('[auto-collection] 批量删除确认失败:', e);
      return;
    }
  }
  const ids = [...selectedProfileIds.value];
  const res = await window.api.collection.batchDeleteProfiles(ids);
  if (res.success) {
    ElMessage.success(`已删除 ${res.data?.deleted || ids.length} 个连接配置`);
    selectedProfileIds.value = [];
    currentProfileId.value = '';
    tasks.value = tasks.value.filter((t) => !ids.includes(t.profileId));
    await loadProfiles();
  } else {
    ElMessage.error(res.error?.message || '批量删除失败');
  }
}

const form = ref<ConnectionProfileInput & { database?: string; instance?: string; dbIndex?: number; winrmAuth?: string; useHttps?: boolean; usePowershell?: boolean }>({
  connType: 'ssh',
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  privateKeyPath: '',
  timeoutMs: 10000,
  database: '',
  instance: '',
  dbIndex: 0,
  winrmAuth: 'auto',
  useHttps: false,
  usePowershell: false,
});

function defaultPort(connType: string): number {
  switch (connType) {
    case 'winrm': return 5985;
    case 'mysql': return 3306;
    case 'oracle': return 1521;
    case 'postgresql': return 5432;
    case 'sqlserver': return 1433;
    case 'redis': return 6379;
    case 'http': return 7001;
    default: return 22;
  }
}

function connTypeLabel(connType: string): string {
  return CONN_TYPE_OPTIONS.find((t) => t.value === connType)?.label || connType;
}

const showDatabaseField = computed(() =>
  form.value.connType === 'mysql' ||
  form.value.connType === 'oracle' ||
  form.value.connType === 'postgresql' ||
  form.value.connType === 'sqlserver'
);

const databasePlaceholder = computed(() => {
  switch (form.value.connType) {
    case 'mysql': return '可选，默认不指定库';
    case 'oracle': return '可选，默认 ORCL（服务名）';
    case 'postgresql': return '可选，默认 postgres';
    case 'sqlserver': return '可选，默认 master';
    default: return '';
  }
});

function handleConnTypeChange() {
  form.value.authMethod = 'password';
  form.value.privateKeyPath = '';
  form.value.port = defaultPort(form.value.connType);
}

function buildExtraConfig(): string | null {
  const cfg: Record<string, unknown> = {};
  if (form.value.database) cfg.database = form.value.database;
  if (form.value.instance) cfg.instance = form.value.instance;
  if (form.value.connType === 'redis' && form.value.dbIndex) cfg.database = String(form.value.dbIndex);
  if (form.value.connType === 'winrm' || form.value.connType === 'http') {
    if (form.value.connType === 'winrm' && form.value.winrmAuth && form.value.winrmAuth !== 'auto') {
      cfg.authMethod = form.value.winrmAuth;
    }
    if (form.value.useHttps) cfg.useHttps = true;
    if (form.value.connType === 'winrm' && form.value.usePowershell) cfg.usePowershell = true;
  }
  const keys = Object.keys(cfg);
  return keys.length ? JSON.stringify(cfg) : null;
}

const currentProfile = computed(() => profiles.value.find((p) => p.id === currentProfileId.value) || null);

async function loadProfiles() {
  const res = await window.api.collection.listProfiles();
  if (res.success) {
    profiles.value = res.data || [];
    // 清理已不存在的 selection
    const validIds = new Set(profiles.value.map((p) => p.id));
    selectedProfileIds.value = selectedProfileIds.value.filter((id) => validIds.has(id));
    if (currentProfileId.value && !validIds.has(currentProfileId.value)) {
      currentProfileId.value = '';
    }
  }
}

function switchProfileMode() {
  profileMode.value = profileMode.value === 'select' ? 'create' : 'select';
}

async function saveProfileInner(): Promise<string> {
  const payload: ConnectionProfileInput = {
    name: form.value.name,
    connType: form.value.connType,
    host: form.value.host,
    port: form.value.port,
    username: form.value.username,
    authMethod: form.value.authMethod,
    password: form.value.password,
    privateKeyPath: form.value.privateKeyPath,
    timeoutMs: form.value.timeoutMs,
    extraConfig: buildExtraConfig(),
    assetId: form.value.assetId,
  };
  const res = await window.api.collection.saveProfile(payload);
  if (!res.success || !res.data) {
    ElMessage.error(res.error?.message || '保存连接配置失败');
    return '';
  }
  ElMessage.success('连接配置已保存');
  await loadProfiles();
  currentProfileId.value = res.data.id;
  selectedProfileIds.value = [res.data.id];
  return res.data.id;
}

async function handleSaveProfile() {
  await saveProfileInner();
}

async function handleTestConnection() {
  testing.value = true;
  try {
    if (profileMode.value === 'create') {
      const payload: ConnectionProfileInput = {
        name: form.value.name,
        connType: form.value.connType,
        host: form.value.host,
        port: form.value.port,
        username: form.value.username,
        authMethod: form.value.authMethod,
        password: form.value.password,
        privateKeyPath: form.value.privateKeyPath,
        timeoutMs: form.value.timeoutMs,
        extraConfig: buildExtraConfig(),
        assetId: form.value.assetId,
      };
      const res = await window.api.collection.testConnectionWithProfile(payload);
      if (res.success && res.data?.ok) {
        ElMessage.success('连接成功');
      } else {
        ElMessage.error(res.data?.message || res.error?.message || '连接失败');
      }
    } else {
      const profileId = currentProfileId.value;
      if (!profileId) return;
      const res = await window.api.collection.testConnection(profileId);
      if (res.success && res.data?.ok) {
        ElMessage.success('连接成功');
      } else {
        ElMessage.error(res.data?.message || res.error?.message || '连接失败');
      }
    }
  } finally {
    testing.value = false;
  }
}

async function handleDeleteProfile() {
  try {
    await ElMessageBox.confirm('确定删除该连接配置吗？', '确认删除', { type: 'warning' });
  } catch {
    return;
  }
  const res = await window.api.collection.deleteProfile(currentProfileId.value);
  if (res.success) {
    ElMessage.success('已删除');
    currentProfileId.value = '';
    await loadProfiles();
  } else {
    ElMessage.error(res.error?.message || '删除失败');
  }
}

// ============ 资产关联（连接配置可关联资产） ============
const assets = ref<any[]>([]);

const currentAsset = computed(() => {
  const assetId = currentProfile.value?.assetId;
  if (!assetId) return null;
  return assets.value.find((a) => a.id === assetId) || null;
});

const currentOs = computed(() => currentAsset.value?.os || '');

async function loadAssets() {
  if (!selectedProjectId.value) {
    assets.value = [];
    return;
  }
  const res = await window.api.asset.list({ projectId: selectedProjectId.value, pageSize: 999 });
  if (res.success) assets.value = res.data?.list || [];
}

function guessCommandOs(assetOs: string): string {
  const os = (assetOs || '').toLowerCase();
  if (os.includes('linux')) return 'Linux';
  if (os.includes('windows')) return 'Windows';
  if (os.includes('mysql')) return 'MySQL';
  if (os.includes('oracle')) return 'Oracle';
  if (os.includes('redis')) return 'Redis';
  if (os.includes('postgres')) return 'PostgreSQL';
  if (os.includes('sqlserver') || os.includes('sql server')) return 'SQL Server';
  return '';
}

// ============ 命令选择 ============
const allCommands = ref<any[]>([]);
const commandKeyword = ref('');
const selectedCommandIds = ref<string[]>([]);
// OS 筛选：__auto__ = 按连接关联资产的 OS 自动过滤；'' = 全部；其他 = 精确匹配
const commandOsFilter = ref<string>('__auto__');

async function loadCommands() {
  // 分页循环拉取全量命令：后端 pageSize 硬上限为 500，单次请求可能取不全，需翻页直至取完
  const pageSize = 500;
  const all: any[] = [];
  let page = 1;
  for (;;) {
    const res = await window.api.knowledge.listCommands({ page, pageSize });
    if (!res.success) break;
    const list = res.data?.list || [];
    all.push(...list);
    if (list.length < pageSize) break;
    page++;
  }
  allCommands.value = all;
}

const osOptions = computed(() => {
  const set = new Set<string>();
  for (const c of allCommands.value) {
    if (c.os) set.add(c.os);
  }
  return Array.from(set).sort();
});

const filteredCommands = computed(() => {
  let list = allCommands.value;
  if (commandOsFilter.value === '__auto__') {
    const os = guessCommandOs(currentOs.value);
    if (os) list = list.filter((c) => c.os === os);
  } else if (commandOsFilter.value) {
    list = list.filter((c) => c.os === commandOsFilter.value);
  }
  const kw = commandKeyword.value.trim().toLowerCase();
  if (!kw) return list;
  return list.filter((c) =>
    (c.name || '').toLowerCase().includes(kw) ||
    (c.command || '').toLowerCase().includes(kw) ||
    (c.category || '').toLowerCase().includes(kw) ||
    (c.subCategory || '').toLowerCase().includes(kw)
  );
});

function toggleSelectAll() {
  if (selectedCommandIds.value.length === filteredCommands.value.length) {
    selectedCommandIds.value = [];
  } else {
    selectedCommandIds.value = filteredCommands.value.map((c) => c.id);
  }
}

/**
 * 点击卡片任意位置切换勾选（点在勾选框自身上则交给原生逻辑，避免双触发）。
 * 用整体替换数组而非 splice：el-checkbox-group 的子项按 modelValue 引用计算选中态。
 */
function toggleCommandSelection(cmd: any, e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('.el-checkbox')) return;
  const id = cmd.id;
  selectedCommandIds.value = selectedCommandIds.value.includes(id)
    ? selectedCommandIds.value.filter((x: any) => x !== id)
    : [...selectedCommandIds.value, id];
}

const canStartReason = computed(() => {
  if (!selectedProjectId.value) return '请先在右上角选择所属项目';
  if (selectedProfileIds.value.length === 0) return '请先在左侧勾选至少一个连接配置';
  if (selectedCommandIds.value.length === 0) return '请至少勾选一条核查命令';
  return '';
});

const canStart = computed(() => !canStartReason.value);

// ============ 任务执行（多资产并发） ============
const starting = ref(false);
const canceling = ref(false);
const tasks = ref<any[]>([]);
const activeTaskId = ref('');
const results = ref<any[]>([]);
const activeTab = ref('progress');

// ============ 本地采集助手（手动投放兜底方案） ============
const localDialogVisible = ref(false);
const localHost = ref('');
const exporting = ref(false);
const importing = ref(false);
let localTargetProfileId = '';

let progressOff: (() => void) | null = null;

async function handleStartTask() {
  if (selectedCommandIds.value.length === 0) {
    ElMessage.warning('请先勾选核查命令');
    return;
  }
  starting.value = true;
  try {
    // 注意：selectedCommandIds 是 Vue ref，.value 为 reactive Proxy，直接传给 ipcRenderer 可能触发
    // "An object could not be cloned"（Proxy 无法结构化克隆）。用 map() 取出纯数组副本再传出。
    const plainCommandIds = selectedCommandIds.value.map((id) => String(id));

    let targetProfileIds: string[] = [];
    if (profileMode.value === 'create') {
      // 新建模式：先保存，再以其为唯一目标
      const newId = await saveProfileInner();
      if (!newId) return;
      targetProfileIds = [newId];
    } else {
      // 选择模式：使用勾选的所有连接
      targetProfileIds = [...selectedProfileIds.value];
    }

    if (targetProfileIds.length === 0) {
      ElMessage.warning('请先选择连接配置');
      return;
    }

    let successCount = 0;
    let firstNewTaskId = '';
    for (const profileId of targetProfileIds) {
      const profile = profiles.value.find((p) => p.id === profileId);
      const res = await window.api.collection.createTask({
        projectId: String(selectedProjectId.value),
        assetId: profile?.assetId ? String(profile.assetId) : '',
        connectionId: String(profileId),
        commandIds: plainCommandIds,
      });
      if (!res.success || !res.data) {
        ElMessage.error(res.error?.message || `创建任务失败：${profile?.name || profileId}`);
        continue;
      }
      const t = res.data;
      tasks.value.push({
        id: t.id,
        profileId: profileId,
        status: t.status || 'pending',
        message: '任务已创建，排队等待调度…',
        percent: 0,
        completedCommands: 0,
        totalCommands: t.totalCommands || plainCommandIds.length,
        commandStates: [],
        summary: { total: 0, success: 0, failed: 0, timeout: 0, error: 0, running: 0, pending: 0 },
        expanded: false,
        profileName: profile?.name || `${profile?.host || ''} 采集任务`,
      });
      if (!firstNewTaskId) firstNewTaskId = t.id;
      successCount++;
    }
    if (successCount > 0) {
      ElMessage.success(`已为 ${successCount} 个连接创建采集任务`);
      activeTab.value = 'progress';
      if (firstNewTaskId) {
        await nextTick();
        const el = document.querySelector(`[data-task-id="${firstNewTaskId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  } finally {
    starting.value = false;
  }
}

// ============ 本地采集助手（手动投放兜底方案） ============
async function openLocalCollectDialog() {
  if (selectedCommandIds.value.length === 0) {
    ElMessage.warning('请先勾选核查命令');
    return;
  }
  localTargetProfileId = '';
  if (profileMode.value === 'select' && selectedProfileIds.value.length > 0) {
    localTargetProfileId = selectedProfileIds.value[0];
  }
  localDialogVisible.value = true;
}

async function handleExportLocalScript() {
  if (selectedCommandIds.value.length === 0) {
    ElMessage.warning('请先勾选核查命令');
    return;
  }
  exporting.value = true;
  try {
    const res = await window.api.collection.exportLocalScript({
      host: localHost.value,
      commandIds: selectedCommandIds.value.map((id) => String(id)),
    });
    if (!res.success || !res.data) {
      ElMessage.error(res.error?.message || '生成本地采集脚本失败');
      return;
    }
    const saveRes = await window.api.dialog.showSaveDialog({
      title: '保存本地采集脚本',
      defaultPath: 'local-collect.ps1',
      filters: [{ name: 'PowerShell 脚本', extensions: ['ps1'] }],
    });
    if (!saveRes.success || !saveRes.data?.filePath) return;
    const writeRes = await window.api.fs.writeTextFile(saveRes.data.filePath, res.data.content);
    if (!writeRes.success) {
      ElMessage.error(writeRes.error?.message || '写入脚本文件失败');
      return;
    }
    ElMessage.success(`脚本已导出（共 ${res.data.commandCount} 条命令），请拷贝到目标主机以管理员身份运行`);
  } finally {
    exporting.value = false;
  }
}

async function handleImportLocalResults() {
  // 本地采集为手动投放兜底模式，不建立远程连接，因此不强求关联连接配置。
  // connectionId 可空（后端 NOT NULL 列允许空串），任务对象自带兜底展示名「本地采集」。
  importing.value = true;
  try {
    const openRes = await window.api.dialog.showOpenDialog({
      title: '选择本地采集结果文件',
      filters: [{ name: 'JSON 结果文件', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!openRes.success || !openRes.data?.filePaths?.length) return;
    const filePath = openRes.data.filePaths[0];
    const readRes = await window.api.fs.readFile(filePath);
    if (!readRes.success) {
      ElMessage.error(readRes.error?.message || '读取结果文件失败');
      return;
    }
    if (!readRes.data || !readRes.data.trim()) {
      ElMessage.warning('结果文件内容为空，请检查 results.json 是否正确生成');
      return;
    }
    const profile = profiles.value.find((p) => p.id === localTargetProfileId);
    const impRes = await window.api.collection.importLocalResults({
      projectId: String(selectedProjectId.value),
      assetId: profile?.assetId ? String(profile.assetId) : '',
      connectionId: String(localTargetProfileId),
      jsonContent: readRes.data ?? '',
    });
    if (!impRes.success || !impRes.data) {
      ElMessage.error(impRes.error?.message || '导入结果失败');
      return;
    }
    ElMessage.success(`成功导入 ${impRes.data.imported} 条采集结果`);
    tasks.value.push({
      id: impRes.data.taskId,
      profileId: localTargetProfileId,
      status: 'success',
      message: '本地采集结果已导入',
      percent: 100,
      completedCommands: impRes.data.imported,
      totalCommands: impRes.data.imported,
      commandStates: [],
      summary: { total: impRes.data.imported, success: impRes.data.imported, failed: 0, timeout: 0, error: 0, running: 0, pending: 0 },
      expanded: false,
      profileName: profile?.name || `${profile?.host || ''} 本地采集`,
    });
    activeTab.value = 'progress';
  } finally {
    importing.value = false;
  }
}

function handleProgress(data: any) {
  if (!data || !data.taskId) return;
  const t = tasks.value.find((x) => x.id === data.taskId);
  if (!t) return;
  t.status = data.status || t.status;
  t.message = data.message || '';
  t.percent = data.percent || 0;
  t.completedCommands = data.completedCommands || 0;
  if (data.totalCommands != null) t.totalCommands = data.totalCommands;
  if (Array.isArray(data.commandStates)) {
    t.commandStates = data.commandStates;
    t.summary = calcSummary(data.commandStates);
  }
  if (data.status && data.status !== 'running' && data.status !== 'pending') {
    void loadResults(data.taskId);
  }
}

function calcSummary(states: any[]): Record<string, number> {
  const s: Record<string, number> = { total: states.length, success: 0, failed: 0, timeout: 0, error: 0, running: 0, pending: 0 };
  for (const st of states) {
    const key = String(st.status);
    if (s[key] != null) s[key]++;
  }
  return s;
}

async function loadResults(taskId: string) {
  const res = await window.api.collection.listResults(taskId);
  if (res.success) {
    activeTaskId.value = taskId;
    results.value = res.data || [];
  }
}

async function viewTaskResults(taskId: string) {
  // 必须先等结果加载完成再切页签：结果页签是 v-if="results.length > 0"，
  // 若先切过去而此时 results 仍为空，页签不存在，就会出现「跳转后什么内容也没显示」
  await loadResults(taskId);
  if (results.value.length === 0) {
    ElMessage.warning('该任务暂无采集结果');
    return;
  }
  activeTab.value = 'results';
}

function toggleTaskExpand(t: any) {
  t.expanded = !t.expanded;
}

async function handleCancelTask(t: any) {
  const taskId = t?.id;
  if (!taskId) return;
  // 立即给用户反馈：先乐观置为「取消中」，后台循环将在当前命令结束后中断并推送最终状态
  if (t.status !== 'canceled') {
    t.status = 'canceling';
    t.message = '正在取消，等待当前命令结束…';
  }
  canceling.value = true;
  try {
    await window.api.collection.cancelTask(taskId);
  } finally {
    canceling.value = false;
  }
}

async function handleDeleteTask(t: any) {
  if (!t?.id) return;
  const name = t.profileName || '该任务';
  try {
    await ElMessageBox.confirm(
      `确定删除任务「${name}」吗？将同时清除其采集结果与已生成的文档记录。`,
      '删除任务',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
  } catch (e) {
    if (!isUserCancel(e)) console.warn('[auto-collection] 删除任务确认失败:', e);
    return;
  }
  const res = await window.api.collection.deleteTask(t.id);
  if (res.success) {
    ElMessage.success('已删除任务');
    tasks.value = tasks.value.filter((x) => x.id !== t.id);
    if (activeTaskId.value === t.id) {
      activeTaskId.value = '';
      results.value = [];
    }
    await loadDocuments();
  } else {
    ElMessage.error(res.error?.message || '删除任务失败');
  }
}

function isTaskRunning(status: string): boolean {
  return status === 'running' || status === 'pending' || status === 'canceling';
}

function taskStatusText(s: string): string {
  return { pending: '排队中', running: '执行中', success: '成功', failed: '失败', partial: '部分完成', canceled: '已取消', canceling: '取消中', error: '错误' }[s] || s;
}

function taskStatusType(s: string): 'info' | 'warning' | 'success' | 'danger' {
  switch (s) {
    case 'running':
    case 'canceling':
      return 'warning';
    case 'success':
    case 'partial':
      return 'success';
    case 'failed':
    case 'error':
      return 'danger';
    case 'canceled':
      return 'info';
    default:
      return 'info';
  }
}

function statusText(s: string): string {
  return { success: '成功', failed: '失败', timeout: '超时', error: '错误' }[s] || s;
}

function stateText(s: string): string {
  return { pending: '等待', running: '执行中', success: '成功', failed: '失败', timeout: '超时', error: '错误' }[s] || s;
}

function stateTagType(s: string): 'info' | 'warning' | 'success' | 'danger' {
  switch (s) {
    case 'success': return 'success';
    case 'failed':
    case 'error':
      return 'danger';
    case 'running':
    case 'timeout':
      return 'warning';
    default:
      return 'info';
  }
}

function formatParsed(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch (e) {
    // 4.2：解析失败时回退原文是对的，但不应完全无声 —— 用户会以为看到的是格式化后的规范 JSON
    console.warn('[auto-collection] 结果内容不是合法 JSON，已按原文展示:', e);
    return data;
  }
}

// ============ 文档保存与历史 ============
const documents = ref<any[]>([]);
const saving = ref(false);

async function handleSaveDocument(taskId?: string) {
  const id = taskId || activeTaskId.value;
  if (!id) return;
  saving.value = true;
  try {
    const res = await window.api.dialog.showOpenDialog({
      title: '选择采集文档保存目录',
      properties: ['openDirectory'],
    });
    if (!res.success || res.data?.canceled || !res.data?.filePaths?.[0]) return;
    const dirPath = res.data.filePaths[0];
    const saveRes = await window.api.collection.saveDocument({ taskId: id, dirPath });
    if (saveRes.success && saveRes.data) {
      ElMessage.success(`文档已保存：${saveRes.data.filePath}`);
      await loadDocuments();
      activeTab.value = 'documents';
    } else {
      ElMessage.error(saveRes.error?.message || '保存文档失败');
    }
  } finally {
    saving.value = false;
  }
}

async function loadDocuments() {
  if (!selectedProjectId.value) {
    documents.value = [];
    return;
  }
  const res = await window.api.collection.listDocuments(selectedProjectId.value);
  if (res.success) documents.value = res.data || [];
}

function handleOpenDocumentDir(row: any) {
  window.api.collection.openDocumentDir(row.filePath);
}

async function handleDeleteDocument(id: string) {
  try {
    await ElMessageBox.confirm('确定删除该采集文档记录吗？（文件本身不会被删除）', '确认删除', { type: 'warning' });
  } catch {
    return;
  }
  const res = await window.api.collection.deleteDocument(id);
  if (res.success) {
    ElMessage.success('已删除');
    await loadDocuments();
  } else {
    ElMessage.error(res.error?.message || '删除失败');
  }
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============ 生命周期 ============
watch(selectedProjectId, () => {
  // 切换项目后刷新资产与文档历史（命令为全量加载，OS 自动过滤由 computed 响应式完成）
  loadAssets();
  loadDocuments();
});

onMounted(() => {
  progressOff = window.api.collection.onProgress(handleProgress);
  loadProjects();
  loadProfiles();
  loadAssets();
  loadDocuments();
  loadCommands();
});

onUnmounted(() => {
  if (progressOff) progressOff();
});
</script>

<style scoped>
.auto-collection-page {
  height: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  box-sizing: border-box;
}

.ac-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
}

.ac-header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ac-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.ac-title-icon {
  color: var(--color-primary);
  font-size: 20px;
}

.ac-subtitle {
  font-size: 13px;
  color: var(--color-text-tertiary);
}

.ac-project-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ac-project-label {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.ac-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
  align-items: stretch;
}

.ac-left {
  width: 340px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
}

.ac-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
}

.ac-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: 14px 16px;
}

.ac-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
  margin-bottom: 12px;
}

/* 左栏连接配置：占满全高，内容区滚动 */
.ac-profile-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ac-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.ac-profile-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0 10px;
  border-bottom: 1px solid var(--color-border-light);
  margin-bottom: 8px;
}

.ac-profile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ac-profile-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-bg-container);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ac-profile-item:hover {
  border-color: var(--color-primary);
  background: var(--color-bg-hover);
}

.ac-profile-item.is-selected {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.ac-profile-item.is-active-task {
  border-left: 3px solid var(--color-warning);
}

.ac-profile-item-body {
  flex: 1;
  min-width: 0;
}

.ac-profile-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.ac-profile-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-profile-task-badge {
  flex-shrink: 0;
}

.ac-profile-item-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.ac-profile-conn-type {
  background: var(--color-bg-hover);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  color: var(--color-primary);
}

.ac-profile-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-profile-item-user {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.ac-selected-count {
  font-size: 12px;
  color: var(--color-primary);
  font-weight: 500;
}

.ac-profile-form :deep(.el-form-item) {
  margin-bottom: 10px;
}

.ac-panel-footer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  align-items: center;
}

/* 采集设置：弹性撑满剩余高度，命令列表自适应 */
.ac-setup-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ac-row {
  margin-bottom: 10px;
}

.ac-cmd-filter {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.ac-cmd-count {
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.ac-cmd-scroll {
  flex: 1;
  min-height: 120px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.ac-cmd-list {
  box-sizing: border-box;
}

/* 命令卡片：圆角描边容器替代原先的"分隔线 + 通栏灰条"组合 */
.ac-cmd-item {
  margin: 6px 8px;
  padding: 7px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.ac-cmd-item:hover {
  border-color: var(--color-primary);
  background: var(--color-bg-hover);
}

.ac-cmd-item.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-lighter);
}

.ac-cmd-name {
  font-weight: 500;
  color: var(--color-text-primary);
}

.ac-cmd-target {
  margin-left: 8px;
  font-size: 11px;
  color: var(--color-primary);
  background: var(--color-primary-light);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

/* 命令文本：随内容收缩的内联代码片，不再撑满整行 */
.ac-cmd-command {
  display: inline-block;
  max-width: 100%;
  margin-top: 4px;
  margin-left: 24px;
  padding: 2px 8px;
  font-family: var(--font-family-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-sm);
  word-break: break-all;
  cursor: default;
}

.ac-setup-panel .ac-panel-footer {
  justify-content: space-between;
  flex-shrink: 0;
}

.ac-start-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-warning);
  min-height: 20px;
}

/* 底部 Tabs：固定高度，集中展示进度/结果/文档 */
.ac-bottom-panel {
  flex-shrink: 0;
  height: 300px;
  display: flex;
  flex-direction: column;
}

.ac-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ac-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.ac-tabs :deep(.el-tab-pane) {
  padding-top: 4px;
}

.ac-progress-msg {
  margin-top: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  word-break: break-all;
}

.ac-progress-msg.sub {
  color: var(--color-text-tertiary);
  font-size: 12px;
  margin-bottom: 8px;
}

.ac-cmd-states {
  height: 130px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  overflow: hidden;
  padding: 0 8px;
  margin-bottom: 8px;
}

.ac-cmd-empty {
  padding: 46px 0;
  text-align: center;
  font-size: 12px;
  color: #909399;
}

.ac-cmd-state-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--color-border-light);
  font-size: 12px;
}

.ac-cmd-state-row:last-child {
  border-bottom: none;
}

.ac-cmd-state-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.ac-cmd-state-duration {
  color: var(--color-text-tertiary);
  font-size: 12px;
  flex-shrink: 0;
}

.ac-form-tip {
  margin-left: 8px;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.ac-concurrent-tip {
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.ac-task-list {
  height: 250px;
  overflow: hidden;
}

.ac-task-card {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--color-bg-container);
}

.ac-task-card.is-active {
  border-color: var(--color-primary);
}

.ac-task-card.is-failed {
  border-color: var(--color-danger);
  border-left: 3px solid var(--color-danger);
  background: var(--color-danger-light, #fef0f0);
}

.ac-task-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.ac-task-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-task-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.ac-result-detail {
  padding: 8px 16px;
}

.ac-result-label {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin: 8px 0 4px;
}

.ac-result-label.stderr {
  color: var(--color-danger);
}

.ac-mono {
  margin: 0;
  padding: 8px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-base);
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text-primary);
}

.ac-mono.stderr {
  color: var(--color-danger);
  background: var(--color-danger-light);
}
</style>
