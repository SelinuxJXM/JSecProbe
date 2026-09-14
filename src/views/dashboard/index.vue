<template>
  <div class="page-container">
    <div class="page-header">
      <div class="page-header-title">工作台</div>
      <div class="page-header-desc">欢迎使用 JSecProbe</div>
    </div>
    
    <el-row :gutter="16" class="stats-row">
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon project">
            <el-icon><Folder /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stats.projectCount }}</div>
            <div class="stat-label">项目总数</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon inprogress">
            <el-icon><Loading /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stats.inProgressCount }}</div>
            <div class="stat-label">进行中</div>
          </div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-icon completed">
            <el-icon><CircleCheck /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stats.completedCount }}</div>
            <div class="stat-label">已完成</div>
          </div>
        </div>
      </el-col>
    </el-row>
    
    <el-row :gutter="16" class="content-row">
      <el-col :span="16">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">最近项目</span>
            <el-button type="primary" link @click="$router.push('/projects')">查看全部</el-button>
          </div>
          <el-table :data="recentProjects" style="width: 100%" v-loading="loading">
            <el-table-column prop="name" label="项目名称" />
            <el-table-column prop="systemName" label="系统名称" />
            <el-table-column prop="level" label="等级" width="80">
              <template #default="{ row }">
                <el-tag size="small">第{{ row.level }}级</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small">
                  {{ statusText(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" width="180">
              <template #default="{ row }">
                {{ formatDate(row.createdAt) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">项目状态分布</span>
          </div>
          <v-chart class="chart" :option="statusChartOption" autoresize />
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :span="16">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">项目创建趋势（近 6 个月）</span>
          </div>
          <v-chart v-if="hasTrendData" class="chart" :option="trendChartOption" autoresize />
          <el-empty v-else description="暂无数据" :image-size="80" />
        </div>
      </el-col>
      <el-col :span="8">
        <div class="card p-md system-status-card" @click="$router.push('/settings')">
          <div class="card-header">
            <span class="card-title">系统状态</span>
          </div>
          <div class="status-list">
            <div class="status-item">
              <span class="status-label">当前版本</span>
              <span class="status-value">{{ currentVersion || '-' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">更新状态</span>
              <span class="status-value">{{ updateStatusText }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">最近备份</span>
              <span class="status-value">{{ lastBackupText }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">备份份数</span>
              <span class="status-value">{{ backupCount }} 份</span>
            </div>
            <div class="status-item">
              <span class="status-label">备份地址</span>
              <el-tooltip
                :content="backupDirText"
                placement="top"
                :show-after="300"
                :disabled="backupDirText === '-'"
              >
                <span
                  class="status-value status-value-path"
                  @click.stop="openBackupFolder"
                >{{ backupDirShort }}</span>
              </el-tooltip>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :span="16">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">项目等级分布</span>
          </div>
          <v-chart class="chart" :option="levelChartOption" autoresize />
        </div>
      </el-col>
      <el-col :span="8">
        <div class="card p-md">
          <div class="card-header">
            <span class="card-title">快捷操作</span>
          </div>
          <div class="quick-actions">
            <div class="quick-action" @click="$router.push('/projects')">
              <el-icon color="#1B5FD9"><FolderAdd /></el-icon>
              <span>新建项目</span>
            </div>
            <div class="quick-action" @click="$router.push('/knowledge')">
              <el-icon color="#18A957"><Reading /></el-icon>
              <span>知识库</span>
            </div>
            <div class="quick-action" @click="$router.push('/ai-assistant')">
              <el-icon color="#D48806"><MagicStick /></el-icon>
              <span>AI助手</span>
            </div>
            <div class="quick-action" @click="$router.push('/settings')">
              <el-icon color="#5C6C8C"><Setting /></el-icon>
              <span>系统设置</span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- AI 工作台洞察卡片 -->
    <el-row :gutter="16" class="content-row">
      <el-col :span="24">
        <div class="card p-md ai-insight-card">
          <div class="card-header">
            <span class="card-title">AI 工作台洞察</span>
            <el-button
              v-if="!aiInsightLoading && !aiInsightData"
              type="primary"
              size="small"
              :disabled="aiInsightDisabled"
              @click="runAiInsight"
            >生成洞察</el-button>
            <el-button
              v-if="aiInsightLoading"
              type="primary"
              size="small"
              loading
            >生成中…</el-button>
            <el-button
              v-if="aiInsightData && !aiInsightLoading"
              type="primary"
              size="small"
              link
              @click="runAiInsight"
            >重新生成</el-button>
          </div>

          <div v-if="aiInsightLoading" class="ai-insight-loading">
            <el-skeleton :rows="4" animated />
          </div>

          <div v-else-if="aiInsightError" class="ai-insight-error">
            <el-alert :title="aiInsightError" type="error" :closable="false" show-icon />
          </div>

          <div v-else-if="aiInsightData" class="ai-insight-body">
            <div class="ai-insight-text" v-html="highlightInsight(aiInsightData.insight)" />
            <div v-if="aiInsightData.alerts.length > 0" class="ai-alerts">
              <div class="ai-alerts-title">异常预警（{{ aiInsightData.alerts.length }} 条）</div>
              <div
                v-for="alert in aiInsightData.alerts"
                :key="alert.key"
                class="ai-alert-item"
                :class="`ai-alert-${alert.severity}`"
              >
                <el-tag :type="alert.severity === 'high' ? 'danger' : alert.severity === 'medium' ? 'warning' : 'info'" size="small">
                  {{ alert.severity === 'high' ? '高' : alert.severity === 'medium' ? '中' : '低' }}
                </el-tag>
                <div class="ai-alert-content">
                  <div class="ai-alert-title">{{ alert.title }}</div>
                  <div class="ai-alert-detail">{{ alert.detail }}</div>
                  <div v-if="getAlertAdvice(alert.key)" class="ai-alert-advice">
                    <span class="ai-alert-advice-label">AI 建议：</span>{{ getAlertAdvice(alert.key) }}
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="ai-alerts-none">当前无命中异常预警</div>
          </div>

          <div v-else class="ai-insight-empty">
            <el-empty description="点击「生成洞察」按钮，AI 将基于当前项目、问题数据为您生成总体态势分析与异常预警解读" :image-size="64" />
          </div>
        </div>
      </el-col>
    </el-row>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import {
  Folder,
  Loading,
  CircleCheck,
  FolderAdd,
  Reading,
  MagicStick,
  Setting,
} from '@element-plus/icons-vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { PieChart, BarChart, LineChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { UpdateStatus } from '../../../shared/types';
import { ElMessage } from 'element-plus';

use([PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

const loading = ref(false);
const recentProjects = ref<any[]>([]);
const stats = ref({
  projectCount: 0,
  inProgressCount: 0,
  completedCount: 0,
  draftCount: 0,
  archivedCount: 0,
  level2Count: 0,
  level3Count: 0,
  level4Count: 0,
  otherLevelCount: 0,
  assetCount: 0,
});

const trendData = ref<{ months: string[]; created: number[]; cumulative: number[] }>({
  months: [],
  created: [],
  cumulative: [],
});
const currentVersion = ref('');
const updateStatus = ref<UpdateStatus | null>(null);
const backups = ref<Array<{ name: string; path: string; size: number; timestamp: string }>>([]);
const dataPath = ref('');

const isDark = ref(document.documentElement.classList.contains('dark'));

let themeObserver: MutationObserver | null = null;

onMounted(() => {
  themeObserver = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark');
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});

onUnmounted(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});

const statusChartOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: '0%', left: 'center' },
  series: [{
    type: 'pie',
    radius: ['40%', '70%'],
    avoidLabelOverlap: false,
    itemStyle: { borderRadius: 8, borderColor: isDark.value ? '#1E293B' : '#fff', borderWidth: 2 },
    label: { show: false },
    emphasis: {
      label: { show: true, fontSize: 14, fontWeight: 'bold' },
    },
    data: [
      { value: stats.value.inProgressCount, name: '进行中', itemStyle: { color: '#1B5FD9' } },
      { value: stats.value.completedCount, name: '已完成', itemStyle: { color: '#18A957' } },
      { value: stats.value.draftCount, name: '草稿', itemStyle: { color: '#909399' } },
    ],
  }],
}));

const levelChartOption = computed(() => {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, bottom: 30, top: 20 },
    xAxis: {
      type: 'category',
      data: ['二级', '三级', '四级', '其他'],
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{
      type: 'bar',
      data: [
        { value: stats.value.level2Count, itemStyle: { color: '#18A957' } },
        { value: stats.value.level3Count, itemStyle: { color: '#1B5FD9' } },
        { value: stats.value.level4Count, itemStyle: { color: '#D48806' } },
        { value: stats.value.otherLevelCount, itemStyle: { color: '#909399' } },
      ],
      barWidth: '50%',
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    }],
  };
});

const trendChartOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { bottom: '0%', left: 'center' },
  grid: { left: 60, right: 60, bottom: 60, top: 20 },
  xAxis: { type: 'category', data: trendData.value.months },
  yAxis: [
    { type: 'value', minInterval: 1, name: '新建' },
    { type: 'value', minInterval: 1, name: '累计', splitLine: { show: false } },
  ],
  series: [
    {
      name: '每月新建',
      type: 'bar',
      data: trendData.value.created,
      barWidth: '40%',
      itemStyle: { color: '#1B5FD9', borderRadius: [4, 4, 0, 0] },
    },
    {
      name: '累计项目',
      type: 'line',
      yAxisIndex: 1,
      data: trendData.value.cumulative,
      smooth: true,
      itemStyle: { color: '#18A957' },
    },
  ],
}));

const hasTrendData = computed(() => trendData.value.cumulative.some((v) => v > 0));

const updateStatusText = computed(() => {
  const s = updateStatus.value;
  if (!s) return '-';
  switch (s.status) {
    case 'checking':
      return '检查中';
    case 'downloading':
      return `下载中 ${Math.round(s.downloadProgress || 0)}%`;
    case 'available':
      return s.version ? `有新版本 v${s.version}` : '有新版本';
    case 'downloaded':
      return '待安装';
    case 'error':
      return '更新异常';
    case 'idle':
    case 'notavailable':
    default:
      return '已是最新';
  }
});

const lastBackupText = computed(() => {
  const first = backups.value[0];
  if (!first?.timestamp) return '暂无备份';
  const d = new Date(first.timestamp);
  if (Number.isNaN(d.getTime())) return '暂无备份';
  return formatDate(first.timestamp);
});

const backupCount = computed(() => backups.value.length);

// 备份目录：数据目录下的 backups 子目录（与 backup.service 的 getBackupRootPath 一致）
const backupDirText = computed(() => (dataPath.value ? `${dataPath.value}\\backups` : '-'));

// 从完整路径中提取盘符后的前两级目录，中间用 … 省略
const backupDirShort = computed(() => {
  if (!dataPath.value) return '-';
  const parts = backupDirText.value.split('\\').filter(Boolean);
  if (parts.length <= 3) return backupDirText.value;
  return `${parts[0]}\\…\\${parts[parts.length - 1]}`;
});

async function openBackupFolder() {
  if (!backupDirText.value || backupDirText.value === '-') return;
  const res = await window.api.shell.openPath(backupDirText.value);
  if (res && res.success === false) {
    ElMessage.error('打开备份目录失败：' + (res.error?.message || '目录可能不存在'));
  }
}

function statusType(status: string) {
  const map: Record<string, string> = {
    draft: 'info',
    in_progress: 'primary',
    completed: 'success',
    archived: 'warning',
  };
  return map[status] || 'info';
}

function statusText(status: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    in_progress: '进行中',
    completed: '已完成',
    archived: '已归档',
  };
  return map[status] || status;
}

function formatDate(date: string) {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN');
}

async function loadData() {
  loading.value = true;
  try {
    if (!window.api) {
      console.warn('window.api 未定义，跳过加载数据');
      return;
    }
    
    const [listRes, statsRes, trendRes, versionRes, statusRes, backupsRes, infoRes] = await Promise.all([
      window.api.project.list({ page: 1, pageSize: 5 }),
      window.api.project.getStatistics(),
      window.api.project.getTrend(),
      window.api.update.getCurrentVersion(),
      window.api.update.getStatus(),
      window.api.system.listBackups(),
      window.api.system.getInfo(),
    ]);

    if (listRes.success && listRes.data) {
      recentProjects.value = listRes.data.list;
    }

    if (statsRes.success && statsRes.data) {
      stats.value = {
        projectCount: statsRes.data.projectCount,
        inProgressCount: statsRes.data.inProgressCount,
        completedCount: statsRes.data.completedCount,
        draftCount: statsRes.data.draftCount,
        archivedCount: statsRes.data.archivedCount,
        level2Count: statsRes.data.level2Count,
        level3Count: statsRes.data.level3Count,
        level4Count: statsRes.data.level4Count,
        otherLevelCount: statsRes.data.otherLevelCount,
        assetCount: statsRes.data.assetCount,
      };
    }

    if (trendRes.success && trendRes.data) {
      trendData.value = trendRes.data;
    }

    if (versionRes.success && versionRes.data) {
      currentVersion.value = versionRes.data;
    }

    if (statusRes.success && statusRes.data) {
      updateStatus.value = statusRes.data;
    }

    if (backupsRes.success && backupsRes.data) {
      backups.value = backupsRes.data;
    }

    if (infoRes.success && infoRes.data) {
      dataPath.value = infoRes.data.dataPath || '';
    }
  } catch (err) {
    console.error('加载工作台数据失败:', err);
  } finally {
    loading.value = false;
  }
}

// ===== AI 工作台洞察 =====
interface AiInsightAlert {
  key: string;
  severity: string;
  title: string;
  detail: string;
}
interface AiInsightData {
  insight: string;
  alerts: AiInsightAlert[];
  alertAdvices: Array<{ key: string; advice: string }>;
}
const aiInsightData = ref<AiInsightData | null>(null);
const aiInsightLoading = ref(false);
const aiInsightError = ref('');

const aiInsightDisabled = computed(() => {
  if (!window.api?.ai) return true;
  return false;
});

async function runAiInsight() {
  if (!window.api?.ai) {
    aiInsightError.value = 'AI 通道未就绪，请检查窗口是否完整加载';
    return;
  }
  aiInsightLoading.value = true;
  aiInsightError.value = '';
  try {
    const cfgRes = await window.api.ai.getConfig();
    if (cfgRes.success && cfgRes.data) {
      const cfg: any = cfgRes.data;
      const hasKey = !!(cfg.apiKey && cfg.apiBase && cfg.model);
      const hasLocal = cfg.mode === 'local' && !!(cfg.localEngine);
      if (!hasKey && !hasLocal) {
        aiInsightError.value = '尚未配置 AI 服务，请前往「系统设置 → AI 服务」完成配置后再试';
        return;
      }
    }
    const res = await window.api.ai.dashboardInsight();
    if (res.success && res.data) {
      aiInsightData.value = res.data;
    } else {
      aiInsightError.value = res.error?.message || 'AI 生成洞察失败，请稍后重试';
    }
  } catch (err: any) {
    aiInsightError.value = err?.message || 'AI 生成洞察失败，请稍后重试';
  } finally {
    aiInsightLoading.value = false;
  }
}

function getAlertAdvice(key: string): string {
  if (!aiInsightData.value) return '';
  const found = aiInsightData.value.alertAdvices.find((a) => a.key === key);
  return found ? found.advice : '';
}

function highlightInsight(text: string): string {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  html = html.replace(/(项目总数|进行中|已完成|草稿|已归档|高风险|中风险|低风险|问题总数|整改|归档|趋势|停滞)/g, '<strong>$1</strong>');
  return html;
}

onMounted(loadData);
</script>

<style lang="scss" scoped>
.stats-row {
  margin-bottom: var(--spacing-lg);
}

.stat-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg);
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  border: 1px solid var(--color-border-light);
  
  .stat-icon {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    
    &.project { background: var(--color-primary-light); color: var(--color-primary); }
    &.inprogress { background: var(--color-warning-light); color: var(--color-warning); }
    &.completed { background: var(--color-success-light); color: var(--color-success); }
  }
  
  .stat-value {
    font-size: var(--font-size-2xl);
    font-weight: var(--font-weight-bold);
    color: var(--color-text-primary);
    line-height: 1.2;
  }
  
  .stat-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-tertiary);
    margin-top: var(--spacing-xs);
  }
}

.content-row {
  margin-bottom: var(--spacing-lg);

  .card {
    height: 100%;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-md);

    .card-title {
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }
  }
}

.content-row:last-child {
  margin-bottom: 0;
}

.system-status-card {
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    transform: translateY(-2px);
  }
}

.status-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);

  .status-item {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .status-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
    }

    .status-value {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      font-weight: var(--font-weight-semibold);
    }

    .status-value-path {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;

      &:hover {
        color: var(--color-primary);
      }
    }
  }
}

.quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
  
  .quick-action {
    padding: var(--spacing-lg) var(--spacing-md);
    background: var(--color-bg-hover);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-sm);
    cursor: pointer;
    transition: all 0.2s;
    
    &:hover {
      background: var(--color-bg-active);
      transform: translateY(-2px);
    }
    
    .el-icon {
      font-size: 24px;
    }
    
    span {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
  }
}

.chart {
  height: 260px;
  width: 100%;
}

/* ===== AI 洞察卡片 ===== */
.ai-insight-card {
  .ai-insight-loading {
    padding: var(--spacing-md) 0;
  }

  .ai-insight-error {
    margin: var(--spacing-sm) 0;
  }

  .ai-insight-body {
    .ai-insight-text {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      line-height: 1.8;
      margin-bottom: var(--spacing-md);
    }

    .ai-alerts {
      margin-top: var(--spacing-md);

      .ai-alerts-title {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-secondary);
        margin-bottom: var(--spacing-sm);
      }

      .ai-alert-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-sm);
        margin-bottom: var(--spacing-xs);
        border: 1px solid var(--color-border-light);

        &.ai-alert-high {
          background: var(--color-danger-light);
          border-color: var(--color-danger-light);
        }
        &.ai-alert-medium {
          background: var(--color-warning-light);
          border-color: var(--color-warning-light);
        }
        &.ai-alert-low {
          background: var(--color-info-light);
          border-color: var(--color-info-light);
        }

        .el-tag {
          flex-shrink: 0;
          margin-top: 2px;
        }

        .ai-alert-content {
          flex: 1;

          .ai-alert-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--color-text-primary);
            margin-bottom: 2px;
          }

          .ai-alert-detail {
            font-size: var(--font-size-xs);
            color: var(--color-text-secondary);
            line-height: 1.5;
          }

          .ai-alert-advice {
            margin-top: var(--spacing-xs);
            font-size: var(--font-size-xs);
            color: var(--color-text-primary);
            line-height: 1.5;
            padding: var(--spacing-xs) var(--spacing-sm);
            background: var(--color-bg-hover);
            border-radius: var(--radius-sm);

            .ai-alert-advice-label {
              font-weight: var(--font-weight-semibold);
              color: var(--color-primary);
            }
          }
        }
      }
    }

    .ai-alerts-none {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      padding: var(--spacing-sm);
    }
  }

  .ai-insight-empty {
    padding: var(--spacing-md) 0;
  }
}
</style>
