import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { User } from '@shared/types';
import router from '@/router';

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null);
  const token = ref<string>('');
  const isLoggedIn = computed(() => !!token.value && !!user.value);

  async function login(username: string, password: string) {
    if (!window.api) {
      return { success: false, message: '应用未初始化，请在 Electron 环境中运行' };
    }
    const res = await window.api.auth.login(username, password);
    if (res.success && res.data?.success && res.data.user) {
      user.value = res.data.user;
      token.value = res.data.token || '';
      localStorage.setItem('token', token.value);
      return { success: true, user: res.data.user };
    }
    return { success: false, message: res.error?.message || res.data?.message || '登录失败' };
  }

  async function logout() {
    if (window.api) {
      await window.api.auth.logout(token.value || undefined);
    }
    user.value = null;
    token.value = '';
    localStorage.removeItem('token');
  }

  async function restoreSession() {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      try {
        const res = await window.api.auth.validateSession(savedToken);
        if (res.success && res.data?.valid) {
          token.value = savedToken;
        } else {
          localStorage.removeItem('token');
        }
      } catch {
        localStorage.removeItem('token');
      }
    }
  }

  function clearSession() {
    user.value = null;
    token.value = '';
    localStorage.removeItem('token');
  }

  function setUser(loginResult: { user: User; token?: string }) {
    user.value = loginResult.user;
    token.value = loginResult.token || '';
    localStorage.setItem('token', token.value);
    if (loginResult.user.mustChangePassword && router.currentRoute.value.path !== '/change-password') {
      router.push('/change-password?userId=' + loginResult.user.id);
    }
  }

  return {
    user,
    token,
    isLoggedIn,
    login,
    logout,
    restoreSession,
    clearSession,
    setUser,
  };
});
