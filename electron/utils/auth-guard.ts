import { app, type IpcMainInvokeEvent } from "electron";
import { join, sep } from "path";
import { pathToFileURL } from "url";
import { AuthService } from "../services/auth.service";
import { logger } from "./logger";

/**
 * IPC 鉴权守卫：校验渲染进程调用方的来源是否受信
 *
 * 设计要点：
 * 1. 渲染进程通过 preload 暴露的显式 API 调用 IPC（已移除泛化 on/invoke 通道）
 * 2. 所有 IPC 调用都校验 senderFrame 来源（file:// 或 localhost 开发源）
 * 3. 敏感操作（删除、导出、系统设置）额外校验会话令牌
 *
 * 用法：
 *   ipcMain.handle("xxx", wrap(async (event, ...args) => {
 *     requireAuth(event);
 *     ...
 *   }));
 */

/**
 * 校验调用方是否为受信来源（渲染进程 frame）
 * 拒绝非受信来源（如被注入的恶意网页）调用任意 IPC 通道
 */
/**
 * 受信渲染进程来源白名单。
 *
 * 原实现把「任意 `file://`」都判为受信：本机任何一个 HTML（邮件附件、下载目录里的网页、
 * 其它软件丢进来的 .html）只要被设法载进窗口，就能调用全部 IPC 通道。改为只认
 * 本应用自己的渲染产物目录（打包态）与本地开发服务器（dev 态）。
 *
 * 计算失败时降级为旧的宽松判定并告警——宁可放宽一次，也不能把正常用户挡在门外。
 */
function trustedRendererPrefixes(): string[] {
  const isDev = !app.isPackaged || process.env.NODE_ENV === "development";
  if (isDev) {
    return ["http://localhost", "http://127.0.0.1"];
  }
  try {
    const rendererDir = join(app.getAppPath(), "dist-renderer");
    return [pathToFileURL(rendererDir + sep).href, "app://"];
  } catch (error) {
    logger.warn("[auth-guard] 无法定位渲染产物目录，回退到宽松来源判定", { error: String(error) });
    return ["file://", "app://"];
  }
}

export function requireAuth(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame) {
    throw new Error("未授权：无法识别调用来源");
  }
  const url = frame.url || "";
  // dev 态判定与 main/index.ts 的窗口加载逻辑保持一致（NODE_ENV），不能只依赖
  // app.isPackaged：IDE（本身是 Electron 应用）可能向子进程注入
  // ELECTRON_FORCE_IS_PACKAGED=true，导致 dev 模式被误判为打包态而拒绝 localhost 来源
  const prefixes = trustedRendererPrefixes();
  const isTrusted = prefixes.some((prefix) => url.startsWith(prefix));

  // 空 URL（尚未完成导航的 frame）：保持放行，避免误伤 preload 的首批调用
  const isEmpty = url === "" || url === "about:blank";

  if (!isTrusted && !isEmpty) {
    logger.error("[auth-guard] 拒绝非受信来源的 IPC 调用", {
      url,
      isPackaged: app.isPackaged,
      prefixes,
    });
    throw new Error("未授权：调用来源不受信任");
  }
}

/**
 * 校验调用方会话（用于敏感操作：删除、导出、系统设置、读取文件等）
 * 渲染进程若传入 token 则按令牌校验；未传 token 时回退到进程级活动会话判定
 * （单用户桌面应用：登录后置位活动会话，登出/改密后清除）。
 * 注意：仅做来源校验（requireAuth）不足以保护敏感操作，必须在此强制会话。
 */
export function requireSession(event: IpcMainInvokeEvent, token?: string): void {
  requireAuth(event);

  // 传入令牌时按令牌校验；未传令牌时回退到进程级活动会话判定
  const authed = token
    ? !!AuthService.getSession(token)
    : AuthService.isAuthenticated();

  if (!authed) {
    throw new Error("会话无效或已过期，请重新登录");
  }
}

/**
 * 校验调用方角色（用于管理类操作：用户管理、系统设置等）
 *
 * 在会话校验之上再强制角色判定。角色每次实时从数据库读取，避免"已提权/已降权
 * 但仍沿用内存旧角色"的问题；用户被禁用（isActive=0）时视为无角色，一律拒绝。
 *
 * @param allowedRoles 允许执行该操作的角色列表，如 ['admin']
 * @throws 会话无效或角色不在允许列表中
 */
export async function requireRole(
  event: IpcMainInvokeEvent,
  allowedRoles: string[],
  token?: string
): Promise<void> {
  requireSession(event, token);

  const session = token ? AuthService.getSession(token) : AuthService.getActiveSession();
  if (!session) {
    throw new Error("会话无效或已过期，请重新登录");
  }

  const role = await AuthService.getUserRole(session.userId);
  if (!role || !allowedRoles.includes(role)) {
    logger.error("[auth-guard] 拒绝越权的 IPC 调用", {
      role: role ?? "(无)",
      allowedRoles,
      userId: session.userId,
    });
    throw new Error("权限不足：当前用户无权执行该操作");
  }
}

/**
 * 服务端强制改密（E2）。
 *
 * 默认管理员账号（admin/admin123）在库中带 `mustChangePassword=1`，
 * 但此前只有前端在登录成功后跳转改密页，**服务端完全不拦截** ——
 * 用户只要不跳转（或直接调 IPC）就能带着初始口令使用全部功能，
 * 而本工具保存着被测系统的拓扑、漏洞与主机凭据，初始口令等同于公开凭据。
 *
 * 在会话校验之后调用。放行 `auth` 模块（改密流程只依赖 auth:changePassword / auth:login）
 * 与 `window` 模块（窗口控制），否则会把改密页自身也拦死。
 */
// event 参数仅为与 requireSession / requireRole 保持签名一致（便于调用方统一传 event），
// 实际判定只依赖进程级活动会话，因此这里不读取它
export function requirePasswordChanged(_event: IpcMainInvokeEvent, token?: string): void {
  const session = token ? AuthService.getSession(token) : AuthService.getActiveSession();
  if (!session) return; // 会话有效性由 requireSession 负责，这里拿不到会话就不重复判定
  if (AuthService.mustChangePassword(session.userId)) {
    logger.warn("[auth-guard] 拒绝未修改初始密码的用户调用业务通道", { userId: session.userId });
    throw new Error("请先修改初始密码后再使用其他功能");
  }
}
