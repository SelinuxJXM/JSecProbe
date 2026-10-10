/**
 * 项目内页面跳转。
 *
 * `goToPhase(phase)` 在问题管理 / 现场核查 / 系统构成三处各写了一遍，
 * 逻辑一模一样（拿当前 projectId 拼 `/projects/{id}/{phase}`），
 * 但取 id 的来源不同（一个用 computed、两个用 route.params.id），
 * 抽出来统一，并让"没有 projectId 就什么都不做"的行为保持一致。
 */
import { useRouter, useRoute } from 'vue-router';
import type { Ref } from 'vue';

/** `/projects/{id}/{phase}` */
export function projectPhasePath(projectId: string, phase: string): string {
  return `/projects/${projectId}/${phase}`;
}

export function useProjectNav(projectId?: Ref<string | undefined>) {
  const router = useRouter();
  const route = useRoute();

  function currentProjectId(): string | undefined {
    // 显式传入优先（问题管理页自己维护 projectId），否则取路由参数
    return projectId?.value || (route.params.id as string | undefined);
  }

  /** 跳到该项目的某个测评阶段；拿不到 projectId 时静默跳过，不跳到空路由 */
  function goToPhase(phase: string): void {
    const id = currentProjectId();
    if (!id) return;
    void router.push(projectPhasePath(id, phase));
  }

  function goBack(): void {
    router.back();
  }

  return { goToPhase, goBack, projectPhasePath, currentProjectId };
}
