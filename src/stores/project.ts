import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Project, ProjectListParams } from '@shared/types';

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([]);
  const currentProject = ref<Project | null>(null);
  const loading = ref(false);
  const pagination = ref({ page: 1, pageSize: 20, total: 0 });

  const activeProjects = computed(() => 
    projects.value.filter(p => p.status !== 'archived')
  );
  
  const archivedProjects = computed(() => 
    projects.value.filter(p => p.status === 'archived')
  );

  async function list(params: ProjectListParams) {
    loading.value = true;
    try {
      const res = await window.api.project.list(params);
      if (res.success && res.data) {
        projects.value = res.data.list;
        pagination.value = { ...pagination.value, total: res.data.total };
      }
      return res;
    } finally {
      loading.value = false;
    }
  }

  async function get(id: string) {
    const res = await window.api.project.get(id);
    if (res.success && res.data) {
      currentProject.value = res.data;
    }
    return res;
  }

  async function create(data: Partial<Project>) {
    const res = await window.api.project.create(data);
    if (res.success && res.data) {
      projects.value.unshift(res.data);
    }
    return res;
  }

  async function update(id: string, data: Partial<Project>) {
    const res = await window.api.project.update(id, data);
    if (res.success && res.data) {
      const index = projects.value.findIndex(p => p.id === id);
      if (index !== -1) {
        projects.value[index] = res.data;
      }
      if (currentProject.value?.id === id) {
        currentProject.value = res.data;
      }
    }
    return res;
  }

  async function remove(id: string) {
    const res = await window.api.project.remove(id);
    if (res.success) {
      const index = projects.value.findIndex(p => p.id === id);
      if (index !== -1) {
        projects.value.splice(index, 1);
      }
      if (currentProject.value?.id === id) {
        currentProject.value = null;
      }
    }
    return res;
  }

  // 说明：旧的「从 Excel 导入项目」已移除——它只写 8 个字段、把 standard_id 写死成 L3，
  // 导入的项目在测评页会因标准不匹配而取不到题。完整数据的导入/导出请走项目归档
  // （window.api.project.exportArchive / importArchive）。

  async function exportAll() {
    return await window.api.project.exportAll();
  }

  return {
    projects,
    currentProject,
    loading,
    pagination,
    activeProjects,
    archivedProjects,
    list,
    get,
    create,
    update,
    remove,
    exportAll,
  };
});