import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useIssueStore = defineStore('issue', () => {
  const issues = ref<any[]>([]);
  const currentIssue = ref<any | null>(null);
  const loading = ref(false);
  const summary = ref<any>(null);

  async function fetchIssues(params: {
    projectId: string;
    riskLevel?: string;
    status?: string;
    securityDomain?: string;
    page?: number;
    pageSize?: number;
  }) {
    loading.value = true;
    try {
      const res = await window.api.issue.list(params);
      if (res.success && res.data) {
        issues.value = res.data.list;
      }
      return res;
    } finally {
      loading.value = false;
    }
  }

  async function getIssue(id: string) {
    const res = await window.api.issue.get(id);
    if (res.success) {
      currentIssue.value = res.data;
    }
    return res;
  }

  async function createIssue(data: any) {
    const res = await window.api.issue.create(data);
    if (res.success) {
      return res.data;
    }
    return res;
  }

  async function updateIssue(id: string, data: any) {
    const res = await window.api.issue.update(id, data);
    if (res.success) {
      const idx = issues.value.findIndex(i => i.id === id);
      if (idx !== -1) {
        const getRes = await getIssue(id);
        if (getRes.success) issues.value[idx] = getRes.data;
      }
    }
    return res;
  }

  async function deleteIssue(id: string) {
    const res = await window.api.issue.remove(id);
    if (res.success) {
      issues.value = issues.value.filter(i => i.id !== id);
    }
    return res;
  }

  async function generateFromRecords(projectId: string) {
    return await window.api.issue.generateFromRecords(projectId);
  }

  async function fetchSummary(projectId: string) {
    const res = await window.api.issue.getSummary(projectId);
    if (res.success) {
      summary.value = res.data;
    }
    return res;
  }

  async function exportExcel(projectId: string) {
    return await window.api.issue.exportExcel(projectId);
  }

  return {
    issues,
    currentIssue,
    loading,
    summary,
    fetchIssues,
    getIssue,
    createIssue,
    updateIssue,
    deleteIssue,
    generateFromRecords,
    fetchSummary,
    exportExcel,
  };
});