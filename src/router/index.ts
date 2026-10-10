import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { useAppStore } from '@/stores/app';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/change-password',
    name: 'ChangePassword',
    component: () => import('@/views/change-password/index.vue'),
    meta: { title: '修改密码' },
  },
  {
    path: '/',
    component: () => import('@/layout/MainLayout.vue'),
    redirect: '/projects',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '工作台', icon: 'DataAnalysis' },
      },
      {
        path: 'projects',
        name: 'Projects',
        redirect: '/projects/list',
        meta: { title: '项目首页', icon: 'Folder' },
        children: [
          {
            path: 'list',
            name: 'ProjectList',
            component: () => import('@/views/projects/index.vue'),
            meta: { title: '项目列表', icon: 'Folder' },
          },
          {
            path: ':id/assets',
            name: 'ProjectAssets',
            component: () => import('@/views/system-composition/index.vue'),
            meta: { title: '系统构成', icon: 'Monitor', requiresProject: true },
          },
          {
            path: ':id/assessment',
            name: 'ProjectAssessment',
            component: () => import('@/views/onsite-verification/index.vue'),
            meta: { title: '现场核查', icon: 'List', requiresProject: true },
          },
          {
            path: ':id/issues',
            name: 'ProjectIssues',
            component: () => import('@/views/issues/index.vue'),
            meta: { title: '问题清单', icon: 'Warning', requiresProject: true },
          },
        ],
      },
      {
        path: 'ai-assistant',
        name: 'AiAssistant',
        component: () => import('@/views/ai-assistant/index.vue'),
        meta: { title: 'AI智能辅助', icon: 'MagicStick' },
      },
      {
        path: 'knowledge',
        name: 'Knowledge',
        component: () => import('@/views/knowledge-base/index.vue'),
        meta: { title: '知识库', icon: 'Reading' },
      },
      {
        path: 'collection',
        name: 'AutoCollection',
        component: () => import('@/views/auto-collection/index.vue'),
        meta: { title: '自动采集', icon: 'Cpu' },
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/settings/index.vue'),
        meta: { title: '系统设置', icon: 'Setting' },
      },
      {
        path: 'personal-center',
        name: 'PersonalCenter',
        component: () => import('@/views/personal-center/index.vue'),
        meta: { title: '个人中心', icon: 'User' },
      },
      // 兜底路由：原先没有 catch-all，访问不存在的 hash 路径时 MainLayout 还在、
      // 但内容区是空的，用户既看不到报错也不知道该去哪。
      // 放在 MainLayout 内是为了保留侧边导航，用户能直接点回其它页面。
      // 必须排在同级最后：`:pathMatch(.*)*` 会吞掉写在其后的路由。
      {
        path: ':pathMatch(.*)*',
        name: 'NotFound',
        component: () => import('@/views/not-found/index.vue'),
        meta: { title: '页面不存在' },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(async (to, _from, next) => {
  document.title = `${to.meta.title || 'JSecProbe'} - JSecProbe`;

  // 登录和修改密码页面不需要验证
  const publicPages = ['/login', '/change-password'];
  const isPublicPage = publicPages.includes(to.path);

  // 登录态统一认 userStore（它的初值已承接 localStorage）。
  // 这里用动态 import 而非顶层 import：user store 内部反过来引用了 router
  // （改密跳转要用），顶层互相 import 会形成循环依赖；守卫本来就是 async，代价为零。
  const { useUserStore } = await import('@/stores/user');
  const hasToken = !!useUserStore().token;

  if (!hasToken && !isPublicPage) {
    // 未登录且访问非公开页面，重定向到登录页
    return next('/login');
  }

  // 已登录还去登录页：直接送回业务页，避免顶着有效会话再登一次。
  // 带上 redirect 参数是为了保留「从某个深链接被踢出、登录后想回去」的场景。
  if (hasToken && to.path === '/login') {
    // 只接受站内绝对路径，防止 ?redirect= 被拿去构造跳转（如伪协议 / 外链）。
    const raw = typeof to.query.redirect === 'string' ? to.query.redirect : '';
    const redirect = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/projects';
    return next(redirect);
  }

  // 同步项目上下文：从路由参数中提取项目ID
  const appStore = useAppStore();
  const projectId = to.params.id as string;
  if (projectId && to.meta.requiresProject) {
    appStore.setCurrentProject(projectId);
  }

  next();
});

export default router;