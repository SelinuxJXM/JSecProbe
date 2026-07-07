import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AssessmentRecord } from '@shared/types';

export const useAssessmentStore = defineStore('assessment', () => {
  const records = ref<AssessmentRecord[]>([]);
  const currentRecord = ref<AssessmentRecord | null>(null);
  const loading = ref(false);
  const progress = ref({ total: 0, tested: 0, compliant: 0, complianceRate: 0, untested: 0 });

  async function fetchRecords(projectId: string, itemId: string) {
    loading.value = true;
    try {
      const res = await window.api.assessment.getRecords(projectId, itemId);
      if (res.success && res.data) {
        records.value = res.data;
      }
      return res;
    } finally {
      loading.value = false;
    }
  }

  async function saveRecord(data: any) {
    const res = await window.api.assessment.saveRecord(data);
    if (res.success && res.data) {
      if (data.id) {
        const idx = records.value.findIndex(r => r.id === data.id);
        if (idx !== -1) records.value[idx] = res.data;
      } else {
        records.value.push(res.data);
      }
    }
    return res;
  }

  async function fetchProgress(projectId: string, standardId: string) {
    const res = await window.api.assessment.getProgress(projectId, standardId);
    if (res.success && res.data) {
      progress.value = res.data;
    }
    return res;
  }

  async function fetchItems(standardId: string, domain?: string) {
    return await window.api.assessment.getItems(standardId, domain);
  }

  return {
    records,
    currentRecord,
    loading,
    progress,
    fetchRecords,
    saveRecord,
    fetchProgress,
    fetchItems,
  };
});