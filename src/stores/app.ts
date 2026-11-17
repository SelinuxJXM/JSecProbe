import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(true);
  const currentProjectId = ref<string>('');

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function setCurrentProject(id: string) {
    currentProjectId.value = id;
    localStorage.setItem('currentProjectId', id);
  }

  /** 清除失效的项目上下文（例如 localStorage 里残留了已被删除的项目 ID）。 */
  function clearCurrentProject() {
    currentProjectId.value = '';
    localStorage.removeItem('currentProjectId');
  }

  function restoreAppState() {
    const savedProject = localStorage.getItem('currentProjectId');
    if (savedProject) {
      currentProjectId.value = savedProject;
    }
  }

  return {
    sidebarCollapsed,
    currentProjectId,
    toggleSidebar,
    setCurrentProject,
    clearCurrentProject,
    restoreAppState,
  };
});
