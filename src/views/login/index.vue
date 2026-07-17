<template>
  <div class="login-page">
    <!-- 背景粒子 -->
    <canvas ref="particleCanvas" class="particle-canvas"></canvas>
    
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

            <div class="remember-row">
              <el-checkbox v-model="rememberUsername">记住账号</el-checkbox>
              <el-checkbox v-model="rememberPassword">记住密码</el-checkbox>
            </div>
            
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
import { reactive, ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { User, Lock, CircleCheck } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);
const particleCanvas = ref<HTMLCanvasElement>();
const rememberUsername = ref(false);
const rememberPassword = ref(false);

const form = reactive({
  username: '',
  password: '',
});

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

// 简单的 Base64 编码/解码
function encodeBase64(str: string): string {
  return btoa(encodeURIComponent(str));
}

function decodeBase64(str: string): string {
  try {
    return decodeURIComponent(atob(str));
  } catch {
    return '';
  }
}

// 加载保存的账号密码
function loadSavedCredentials() {
  const savedUsername = localStorage.getItem('jsecprobe_username');
  const savedPassword = localStorage.getItem('jsecprobe_password');
  const savedRememberUsername = localStorage.getItem('jsecprobe_remember_username');
  const savedRememberPassword = localStorage.getItem('jsecprobe_remember_password');

  if (savedRememberUsername === 'true') {
    rememberUsername.value = true;
    if (savedUsername) {
      form.username = decodeBase64(savedUsername);
    }
  }

  if (savedRememberPassword === 'true') {
    rememberPassword.value = true;
    if (savedPassword) {
      form.password = decodeBase64(savedPassword);
    }
  }
}

// 保存账号密码
function saveCredentials() {
  if (rememberUsername.value) {
    localStorage.setItem('jsecprobe_username', encodeBase64(form.username));
    localStorage.setItem('jsecprobe_remember_username', 'true');
  } else {
    localStorage.removeItem('jsecprobe_username');
    localStorage.removeItem('jsecprobe_remember_username');
  }

  if (rememberPassword.value) {
    localStorage.setItem('jsecprobe_password', encodeBase64(form.password));
    localStorage.setItem('jsecprobe_remember_password', 'true');
  } else {
    localStorage.removeItem('jsecprobe_password');
    localStorage.removeItem('jsecprobe_remember_password');
  }
}

// 粒子动画
let animationId: number;
let particles: Array<{ x: number; y: number; vx: number; vy: number; size: number; opacity: number }> = [];

function initParticles() {
  const canvas = particleCanvas.value;
  if (!canvas) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  particles = [];
  const count = Math.floor((canvas.width * canvas.height) / 15000);
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.5 + 0.2,
    });
  }
}

function animateParticles() {
  const canvas = particleCanvas.value;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < 0) p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
    if (p.y < 0) p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
    ctx.fill();
  }

  // 连线
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 120) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * (1 - dist / 120)})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }

  animationId = requestAnimationFrame(animateParticles);
}

async function handleLogin() {
  if (!formRef.value) return;
  
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  
  loading.value = true;
  try {
    const result = await userStore.login(form.username, form.password);
    if (result.success) {
      saveCredentials();
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

onMounted(() => {
  loadSavedCredentials();
  initParticles();
  animateParticles();

  window.addEventListener('resize', initParticles);
});

onUnmounted(() => {
  cancelAnimationFrame(animationId);
  window.removeEventListener('resize', initParticles);
});
</script>

<style lang="scss" scoped>
.login-page {
  height: 100vh;
  width: 100vw;
  background: linear-gradient(135deg, #1B5FD9 0%, #0F3D8F 50%, #1B5FD9 100%);
  background-size: 200% 200%;
  animation: gradientFlow 15s ease infinite;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.particle-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

@keyframes gradientFlow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.login-container {
  width: 960px;
  height: 560px;
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  display: flex;
  overflow: hidden;
  position: relative;
  z-index: 1;
  animation: fadeInUp 0.8s ease-out;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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
    animation: logoBreath 3s ease-in-out infinite;
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

@keyframes logoBreath {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
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

  :deep(.el-input__wrapper) {
    transition: all 0.3s ease;
    
    &:hover {
      box-shadow: 0 0 0 1px var(--color-primary) inset;
    }
    
    &.is-focus {
      box-shadow: 0 0 0 2px var(--color-primary) inset, 0 0 8px rgba(27, 95, 217, 0.2);
    }
  }
}

.remember-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-lg);
  padding: 0 4px;

  :deep(.el-checkbox__label) {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
  }
}

.login-btn {
  width: 100%;
  height: 44px;
  font-size: var(--font-size-md);
  transition: all 0.3s ease;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(27, 95, 217, 0.4);
  }
  
  &:active {
    transform: translateY(0);
  }
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
