import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import App from './App.vue';
import router from './router';
import { restorePrimaryColor } from './utils/theme';
import { useUserStore } from './stores/user';
import { useAppStore } from './stores/app';
import './styles/global.scss';

// Global unhandled error/rejection guard (best-effort console + log to preload)
window.addEventListener('error', (e) => {
  console.error('[全局] 未捕获异常:', e.error || e.message);
});

window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  console.error('[全局] 未处理的 Promise 拒绝:', e.reason);
});
function applyInitialTheme() {
  const savedTheme = localStorage.getItem('themeMode') || 'light';
  const html = document.documentElement;
  if (savedTheme === 'dark') {
    html.classList.add('dark');
    html.setAttribute('data-theme', 'dark');
  } else if (savedTheme === 'light') {
    html.classList.remove('dark');
    html.setAttribute('data-theme', 'light');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      html.classList.add('dark');
      html.setAttribute('data-theme', 'dark');
    } else {
      html.classList.remove('dark');
      html.setAttribute('data-theme', 'light');
    }
  }
}
applyInitialTheme();
restorePrimaryColor();

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });

// 开发模式下监听主进程日志，输出到 DevTools Console
if (import.meta.env.DEV && window.api?.onMainLog) {
  window.api.onMainLog((data: { level: string; message: string; timestamp: string; context?: any }) => {
    const prefix = `[MainProcess ${new Date(data.timestamp).toLocaleTimeString()}]`;
    switch (data.level) {
      case 'error':
        console.error(prefix, data.message, data.context || '');
        break;
      case 'warn':
        console.warn(prefix, data.message, data.context || '');
        break;
      case 'debug':
        console.debug(prefix, data.message, data.context || '');
        break;
      default:
        console.log(prefix, data.message, data.context || '');
    }
  });
}

// 启动时先校验会话再挂载，消除"先进受保护页 → 再被踢回登录页"的闪烁窗口。
// 加 3 秒超时兜底：即便 IPC 卡住也能保证挂载，不会永久空白。
async function bootstrap() {
  try {
    useAppStore().restoreAppState();
    const userStore = useUserStore();
    await Promise.race([
      userStore.restoreSession(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (e) {
    console.error('[启动] 会话恢复失败:', e);
  }
  app.mount('#app');
}

void bootstrap();
