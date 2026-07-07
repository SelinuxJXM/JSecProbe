import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(true);
  const currentProjectId = ref<string>('');
  const theme = ref<'light' | 'dark'>('light');

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function setCurrentProject(id: string) {
    currentProjectId.value = id;
    localStorage.setItem('currentProjectId', id);
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
    theme,
    toggleSidebar,
    setCurrentProject,
    restoreAppState,
  };
});
