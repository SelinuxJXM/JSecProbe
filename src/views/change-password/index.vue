<template>
  <div class="change-password-page">
    <div class="change-password-container">
      <div class="card">
        <h2 class="form-title">首次登录 — 请修改密码</h2>
        <p class="form-desc">为了账户安全，首次登录需要修改密码</p>

        <el-form ref="formRef" :model="form" :rules="rules" class="change-password-form">
          <el-form-item prop="oldPassword">
            <el-input
              v-model="form.oldPassword"
              type="password"
              placeholder="旧密码"
              size="large"
              :prefix-icon="Lock"
            />
          </el-form-item>

          <el-form-item prop="newPassword">
            <el-input
              v-model="form.newPassword"
              type="password"
              placeholder="新密码"
              size="large"
              :prefix-icon="Lock"
              show-password
            />
          </el-form-item>

          <el-form-item prop="confirmPassword">
            <el-input
              v-model="form.confirmPassword"
              type="password"
              placeholder="确认新密码"
              size="large"
              :prefix-icon="Lock"
              show-password
              @keyup.enter="handleSubmit"
            />
          </el-form-item>

          <el-button
            type="primary"
            size="large"
            class="submit-btn"
            :loading="loading"
            @click="handleSubmit"
          >
            确认修改
          </el-button>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Lock } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const userId = (route.query.userId as string) || '';

const form = reactive({
  oldPassword: 'admin123',
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

async function handleSubmit() {
  if (!formRef.value) return;

  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    const changeRes = await window.api.auth.changePassword(userId, form.oldPassword, form.newPassword);
    if (!changeRes.success) {
      ElMessage.error(changeRes.error?.message || '修改密码失败');
      return;
    }

    const loginRes = await window.api.auth.login(userStore.user?.username || '', form.newPassword);
    if (loginRes.success && loginRes.data?.success && loginRes.data.user) {
      userStore.setUser({ user: loginRes.data.user, token: loginRes.data.token });
      ElMessage.success('密码修改成功');
      router.push('/');
    } else {
      ElMessage.error('重新登录失败，请手动登录');
      router.push('/login');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style lang="scss" scoped>
.change-password-page {
  height: 100vh;
  width: 100vw;
  background: linear-gradient(135deg, #1B5FD9 0%, #0F3D8F 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.change-password-container {
  width: 440px;
}

.card {
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  padding: var(--spacing-2xl);
}

.form-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-xs);
  text-align: center;
}

.form-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-bottom: var(--spacing-xl);
  text-align: center;
}

.change-password-form {
  .el-form-item {
    margin-bottom: var(--spacing-md);
  }
}

.submit-btn {
  width: 100%;
  height: 44px;
  font-size: var(--font-size-md);
  margin-top: var(--spacing-sm);
}
</style>
