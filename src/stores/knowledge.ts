import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useKnowledgeStore = defineStore('knowledge', () => {
  const categories = ref<any[]>([]);
  const documents = ref<any[]>([]);
  const currentDocument = ref<any | null>(null);
  const loading = ref(false);

  async function fetchCategories() {
    const res = await window.api.knowledge.listCategories();
    if (res.success && res.data) {
      categories.value = res.data;
    }
    return res;
  }

  async function fetchDocuments(params: { categoryId?: string; keyword?: string; page?: number; pageSize?: number }) {
    loading.value = true;
    try {
      const res = await window.api.knowledge.listDocuments(params);
      if (res.success && res.data) {
        documents.value = res.data.list;
      }
      return res;
    } finally {
      loading.value = false;
    }
  }

  async function getDocument(id: string) {
    const res = await window.api.knowledge.getDocument(id);
    if (res.success) {
      currentDocument.value = res.data;
    }
    return res;
  }

  async function createDocument(data: any) {
    const res = await window.api.knowledge.createDocument(data);
    if (res.success) {
      return res.data;
    }
    return res;
  }

  async function updateDocument(id: string, data: any) {
    const res = await window.api.knowledge.updateDocument(id, data);
    if (res.success) {
      const idx = documents.value.findIndex(d => d.id === id);
      if (idx !== -1) {
        const getRes = await getDocument(id);
        if (getRes.success) documents.value[idx] = getRes.data;
      }
    }
    return res;
  }

  async function deleteDocument(id: string) {
    const res = await window.api.knowledge.deleteDocument(id);
    if (res.success) {
      documents.value = documents.value.filter(d => d.id !== id);
    }
    return res;
  }

  return {
    categories,
    documents,
    currentDocument,
    loading,
    fetchCategories,
    fetchDocuments,
    getDocument,
    createDocument,
    updateDocument,
    deleteDocument,
  };
});