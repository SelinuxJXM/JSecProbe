import { app, type IpcMainInvokeEvent } from "electron";
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
export function requireAuth(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame) {
    throw new Error("未授权：无法识别调用来源");
  }
  const url = frame.url || "";
  const isPackaged = app.isPackaged;
  const isTrusted = isPackaged
    ? url.startsWith("file://") || url.startsWith("app://")
    : url.startsWith("http://localhost") || url.startsWith("file://");

  if (!isTrusted) {
    logger.error("[auth-guard] 拒绝非受信来源的 IPC 调用", { url, isPackaged });
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
