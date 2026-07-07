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
    ],
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach(async (to, _from, next) => {
  document.title = `${to.meta.title || '等级保护测评系统'} - 等级保护现场测评系统`;

  // 登录和修改密码页面不需要验证
  const publicPages = ['/login', '/change-password'];
  const isPublicPage = publicPages.includes(to.path);

  // 检查登录状态
  const token = localStorage.getItem('token');

  if (!token && !isPublicPage) {
    // 未登录且访问非公开页面，重定向到登录页
    return next('/login');
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