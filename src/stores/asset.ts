import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Asset } from '@shared/types';

export const useAssetStore = defineStore('asset', () => {
  const assets = ref<Asset[]>([]);
  const currentAsset = ref<Asset | null>(null);
  const categoryStats = ref<any[]>([]);
  const loading = ref(false);

  async function fetchAssets(projectId: string, category?: string, keyword?: string) {
    loading.value = true;
    try {
      const res = await window.api.asset.list({ projectId, category, keyword });
      if (res.success && res.data) {
        assets.value = res.data.list;
        categoryStats.value = res.data.categoryStats || [];
      }
      return res;
    } finally {
      loading.value = false;
    }
  }

  async function createAsset(data: any) {
    const res = await window.api.asset.create(data);
    if (res.success && res.data) {
      assets.value.push(res.data);
    }
    return res;
  }

  async function updateAsset(id: string, data: any) {
    const res = await window.api.asset.update(id, data);
    if (res.success && res.data) {
      const idx = assets.value.findIndex(a => a.id === id);
      if (idx !== -1) assets.value[idx] = res.data;
    }
    return res;
  }

  async function removeAsset(id: string) {
    const res = await window.api.asset.remove(id);
    if (res.success) {
      assets.value = assets.value.filter(a => a.id !== id);
    }
    return res;
  }

  async function importExcel(projectId: string, filePath: string) {
    return await window.api.asset.importExcel(projectId, filePath);
  }

  async function exportExcel(projectId: string, category: string) {
    return await window.api.asset.exportExcel(projectId, category);
  }

  return {
    assets,
    currentAsset,
    categoryStats,
    loading,
    fetchAssets,
    createAsset,
    updateAsset,
    removeAsset,
    importExcel,
    exportExcel,
  };
});