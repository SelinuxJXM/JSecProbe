import { defineStore } from 'pinia';
import { ref } from 'vue';

interface AIAnalysisResult {
  result: 'compliant' | 'partial' | 'non_compliant' | 'not_applicable';
  evidence: string;
  findings: string;
  confidence: number;
  screenshotPaths?: string[];
}

export const useAIStore = defineStore('ai', () => {
  const analysisResult = ref<AIAnalysisResult | null>(null);
  const isFilling = ref(false);

  function setAnalysisResult(result: AIAnalysisResult) {
    analysisResult.value = result;
  }

  function clearAnalysisResult() {
    analysisResult.value = null;
  }

  function getAnalysisResult(): AIAnalysisResult | null {
    return analysisResult.value;
  }

  return {
    analysisResult,
    isFilling,
    setAnalysisResult,
    clearAnalysisResult,
    getAnalysisResult,
  };
});