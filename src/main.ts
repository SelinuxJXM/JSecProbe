import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import App from './App.vue';
import router from './router';
import './styles/global.scss';

// 应用启动时清除登录状态，强制重新登录
localStorage.removeItem('token');

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

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });

app.mount('#app');
