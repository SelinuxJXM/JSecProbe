import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { User } from '@shared/types';
import router from '@/router';

export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null);
  // 登录态的唯一真相源放在 store 里：初值直接从 localStorage 承接，
  // 这样路由守卫只需认 store，不必再去读一遍 localStorage（此前两处各读各的，
  // 一旦某处漏同步就会「守卫放行、store 认为未登录」）。
  const token = ref<string>(localStorage.getItem('token') || '');
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
    if (!savedToken) return;
    try {
      const res = await window.api.auth.validateSession(savedToken);
      if (res.success && res.data?.valid && res.data.user) {
        token.value = savedToken;
        user.value = res.data.user;
        if (res.data.user.mustChangePassword && router.currentRoute.value.path !== '/change-password') {
          router.push('/change-password?userId=' + res.data.user.id);
        }
      } else {
        token.value = '';
        user.value = null;
        localStorage.removeItem('token');
        const publicPages = ['/login', '/change-password'];
        if (!publicPages.includes(router.currentRoute.value.path)) {
          router.push('/login');
        }
      }
    } catch {
      localStorage.removeItem('token');
    }
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
    setUser,
  };
});
