/**
 * 项目下拉选项的加载。
 *
 * AI 助手与自动采集都用「拉一批项目塞进下拉框」这一种用法，此前各写一份
 * （一份 pageSize=100、一份 200，错误处理也各不同），抽出来统一：
 * 只负责取数，选中项的默认/失效处理仍由各页面按自己的交互决定。
 */
interface ProjectOptionLite {
  id: string;
  name: string;
  [key: string]: any;
}

export async function fetchProjectOptions(pageSize = 100): Promise<ProjectOptionLite[]> {
  if (!window.api) return [];
  try {
    const res = await window.api.project.list({ page: 1, pageSize });
    if (res.success && res.data) {
      return (res.data.list || []) as ProjectOptionLite[];
    }
    return [];
  } catch (error) {
    console.error('[项目选项] 加载项目列表失败:', error);
    return [];
  }
}
