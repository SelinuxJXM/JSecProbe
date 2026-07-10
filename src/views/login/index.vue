<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-left">
        <div class="brand">
          <img src="@/assets/Logo.png" class="brand-logo" alt="logo" />
          <h1 class="brand-title">JSecProbe</h1>
          <p class="brand-subtitle">等级保护现场测评系统</p>
          <p class="brand-slogan">以安全标准为尺，行现场探测之实！</p>
          <a href="https://github.com/SelinuxJXM/JSecProbe" target="_blank" class="brand-github">
            <svg class="github-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
            <span>GitHub</span>
          </a>
        </div>
        <div class="features">
          <div class="feature-item">
            <el-icon><CircleCheck /></el-icon>
            <span>支持等保2.0标准</span>
          </div>
          <div class="feature-item">
            <el-icon><CircleCheck /></el-icon>
            <span>智能AI辅助测评</span>
          </div>
          <div class="feature-item">
            <el-icon><CircleCheck /></el-icon>
            <span>一键生成分析报告</span>
          </div>
        </div>
      </div>
      
      <div class="login-right">
        <div class="login-form-wrapper">
          <h2 class="form-title">账号登录</h2>
          <p class="form-desc">请输入您的账号信息</p>
          
          <el-form ref="formRef" :model="form" :rules="rules" class="login-form">
            <el-form-item prop="username">
              <el-input
                v-model="form.username"
                placeholder="请输入用户名"
                size="large"
                :prefix-icon="User"
                autocomplete="off"
              />
            </el-form-item>

            <el-form-item prop="password">
              <el-input
                v-model="form.password"
                type="password"
                placeholder="请输入密码"
                size="large"
                :prefix-icon="Lock"
                show-password
                autocomplete="off"
                @keyup.enter="handleLogin"
              />
            </el-form-item>
            
            <el-button
              type="primary"
              size="large"
              class="login-btn"
              :loading="loading"
              @click="handleLogin"
            >
              登 录
            </el-button>
          </el-form>
          
          <p class="tip">
            默认账号：<span class="tip-text">admin / admin123</span>
          </p>
        </div>
        <div class="login-footer">
          <p>Copyright © 2025 景景. All rights reserved.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { User, Lock, CircleCheck } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  username: '',
  password: '',
});

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function handleLogin() {
  if (!formRef.value) return;
  
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  
  loading.value = true;
  try {
    const result = await userStore.login(form.username, form.password);
    if (result.success) {
      if (result.user?.mustChangePassword) {
        router.push('/change-password?userId=' + result.user.id);
      } else {
        ElMessage.success('登录成功');
        router.push('/dashboard');
      }
    } else {
      ElMessage.error(result.message || '登录失败');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style lang="scss" scoped>
.login-page {
  height: 100vh;
  width: 100vw;
  background: linear-gradient(135deg, #1B5FD9 0%, #0F3D8F 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.login-container {
  width: 960px;
  height: 560px;
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  display: flex;
  overflow: hidden;
}

.login-left {
  width: 55%;
  background: linear-gradient(180deg, #1B5FD9 0%, #154DB0 100%);
  padding: var(--spacing-2xl);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.brand {
  .brand-logo {
    width: 72px;
    height: 72px;
    margin-bottom: var(--spacing-lg);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.12);
    padding: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    object-fit: cover;
  }
  
  .brand-title {
    font-size: var(--font-size-2xl);
    font-weight: var(--font-weight-bold);
    margin-bottom: var(--spacing-xs);
  }
  
  .brand-subtitle {
    font-size: var(--font-size-base);
    opacity: 0.8;
  }

  .brand-slogan {
    font-size: var(--font-size-base);
    opacity: 0.8;
    margin-top: var(--spacing-sm);
  }

  .brand-github {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: var(--spacing-lg);
    font-size: var(--font-size-sm);
    color: rgba(255, 255, 255, 0.75);
    text-decoration: none;
    transition: all 0.25s ease;
    
    .github-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      opacity: 0.75;
      transition: all 0.25s ease;
    }
    
    &:hover {
      color: #fff;
      
      .github-icon {
        opacity: 1;
        transform: scale(1.1);
      }
    }
  }
}

.features {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  
  .feature-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--font-size-base);
    
    .el-icon {
      font-size: 18px;
    }
  }
}

.login-right {
  width: 45%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl);
}

.login-form-wrapper {
  width: 100%;
  max-width: 320px;
  
  .form-title {
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    margin-bottom: var(--spacing-xs);
  }
  
  .form-desc {
    font-size: var(--font-size-sm);
    color: var(--color-text-tertiary);
    margin-bottom: var(--spacing-xl);
  }
}

.login-form {
  .el-form-item {
    margin-bottom: var(--spacing-md);
  }
}

.login-btn {
  width: 100%;
  height: 44px;
  font-size: var(--font-size-md);
  margin-top: var(--spacing-sm);
}

.tip {
  margin-top: var(--spacing-lg);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  
  .tip-text {
    color: var(--color-primary);
    font-weight: var(--font-weight-medium);
  }
}

.login-footer {
  margin-top: auto;
  padding: var(--spacing-lg) 0;
  text-align: center;
  
  p {
    font-size: var(--font-size-xs);
    color: var(--color-text-tertiary);
    margin: 0;
  }
}
</style>
