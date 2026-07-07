<template>
  <div class="page-container">
    <div class="page-header">
      <div class="page-header-title">工作台</div>
      <div class="page-header-desc">欢迎使用等级保护现场测评系统</div>
    </div>
    
    <el-row :gutter="16" class="stats-row">
      <el-col :span="6">
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
      <el-col :span="6">
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
      <el-col :span="6">
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
      <el-col :span="6">
        <div class="stat-card">
          <div class="stat-icon asset">
            <el-icon><Monitor /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-value">{{ stats.assetCount }}</div>
            <div class="stat-label">资产总数</div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  Folder,
  Loading,
  CircleCheck,
  Monitor,
  FolderAdd,
  Reading,
  MagicStick,
  Setting,
} from '@element-plus/icons-vue';

const loading = ref(false);
const recentProjects = ref<any[]>([]);
const stats = ref({
  projectCount: 0,
  inProgressCount: 0,
  completedCount: 0,
  assetCount: 0,
});

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
    const res = await window.api.project.list({ page: 1, pageSize: 5 });
    if (res.success && res.data) {
      recentProjects.value = res.data.list;
      stats.value.projectCount = res.data.total;
      stats.value.inProgressCount = res.data.list.filter(
        (p: any) => p.status === 'in_progress'
      ).length;
      stats.value.completedCount = res.data.list.filter(
        (p: any) => p.status === 'completed'
      ).length;
      stats.value.assetCount = res.data.list.reduce(
        (sum: number, p: any) => sum + (p.assetCount || 0),
        0
      );
    }
  } finally {
    loading.value = false;
  }
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
    &.asset { background: var(--color-primary-light); color: var(--color-primary); }
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
</style>
