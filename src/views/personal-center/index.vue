<template>
  <div class="personal-center-page">
    <div class="page-header">
      <h2 class="page-title">个人中心</h2>
      <p class="page-desc">查看和管理您的账户信息</p>
    </div>

    <div class="content-grid">
      <!-- 基本信息卡片 -->
      <div class="info-card">
        <div class="card-header">
          <h3 class="card-title">基本信息</h3>
        </div>
        <div class="info-list">
          <div class="info-item">
            <span class="info-label">用户名</span>
            <span class="info-value">{{ userStore.user?.username || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">姓名</span>
            <span class="info-value">{{ userStore.user?.realName || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">角色</span>
            <span class="info-value">{{ formatRole(userStore.user?.role) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">邮箱</span>
            <span class="info-value">{{ userStore.user?.email || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">手机号</span>
            <span class="info-value">{{ userStore.user?.phone || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">最后登录时间</span>
            <span class="info-value">{{ formatDateTime(userStore.user?.lastLoginAt) }}</span>
          </div>
        </div>
      </div>

      <!-- 修改密码卡片 -->
      <div class="info-card">
        <div class="card-header">
          <h3 class="card-title">修改密码</h3>
        </div>
        <el-form ref="formRef" :model="form" :rules="rules" class="password-form">
          <el-form-item prop="oldPassword">
            <el-input
              v-model="form.oldPassword"
              type="password"
              placeholder="请输入旧密码"
              size="large"
              :prefix-icon="Lock"
              show-password
            />
          </el-form-item>

          <el-form-item prop="newPassword">
            <el-input
              v-model="form.newPassword"
              type="password"
              placeholder="请输入新密码"
              size="large"
              :prefix-icon="Lock"
              show-password
            />
          </el-form-item>

          <el-form-item prop="confirmPassword">
            <el-input
              v-model="form.confirmPassword"
              type="password"
              placeholder="请确认新密码"
              size="large"
              :prefix-icon="Lock"
              show-password
              @keyup.enter="handleSubmit"
            />
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              size="large"
              class="submit-btn"
              :loading="loading"
              @click="handleSubmit"
            >
              确认修改
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Lock } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const validateConfirm = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'));
  } else {
    callback();
  }
};

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于6位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' },
  ],
};

function formatRole(role?: string) {
  const roleMap: Record<string, string> = {
    admin: '管理员',
    user: '普通用户',
    operator: '操作员',
  };
  return role ? (roleMap[role] || role) : '-';
}

function formatDateTime(date?: string) {
  if (!date) return '-';
  try {
    return new Date(date).toLocaleString('zh-CN');
  } catch {
    return date;
  }
}

async function handleSubmit() {
  if (!formRef.value) return;

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  const userId = userStore.user?.id;
  if (!userId) {
    ElMessage.error('用户未登录');
    return;
  }

  loading.value = true;
  try {
    const res = await window.api.auth.changePassword(userId, form.oldPassword, form.newPassword);
    if (!res.success) {
      ElMessage.error(res.error?.message || '修改密码失败');
      return;
    }
    ElMessage.success('密码修改成功');
    form.oldPassword = '';
    form.newPassword = '';
    form.confirmPassword = '';
  } finally {
    loading.value = false;
  }
}
</script>

<style lang="scss" scoped>
.personal-center-page {
  padding: var(--spacing-lg);
  height: 100%;
  overflow-y: auto;
}

.page-header {
  margin-bottom: var(--spacing-lg);

  .page-title {
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    margin-bottom: var(--spacing-xs);
  }

  .page-desc {
    font-size: var(--font-size-base);
    color: var(--color-text-secondary);
  }
}

.content-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-lg);
  max-width: 1200px;
}

.info-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--spacing-lg);

  .card-header {
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--color-border-light);

    .card-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }
  }
}

.info-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-base);

  .info-label {
    color: var(--color-text-secondary);
  }

  .info-value {
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);
  }
}

.password-form {
  .el-form-item {
    margin-bottom: var(--spacing-md);
  }

  .submit-btn {
    width: 100%;
    height: 44px;
    font-size: var(--font-size-md);
  }
}

@media (max-width: 768px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}
</style>