import { ipcMain } from 'electron';
import { wrap } from '../utils/ipc-wrapper';
import * as service from '../services/external-link.service';
import type { LinkOpenContext, NetworkZone } from '../services/external-link-core';

interface LinkInput {
  title: string;
  url: string;
  groupName?: string;
  description?: string;
  iconText?: string;
  networkZone?: NetworkZone;
  isHidden?: boolean;
  isFavorite?: boolean;
  sortOrder?: number;
}

interface LinkPatchInput {
  title?: string;
  url?: string;
  groupName?: string;
  description?: string;
  iconText?: string;
  networkZone?: NetworkZone;
  isHidden?: boolean;
  isFavorite?: boolean;
  isStale?: boolean;
  sortOrder?: number;
}

/**
 * 外链模块 IPC。所有通道默认强制会话（wrap 的安全默认值），
 * 统一出口 externalLink:open 内部还会再走一次 normalizeExternalUrl()。
 */
export function registerExternalLinkHandlers(): void {
  ipcMain.handle('externalLink:list', wrap(
    async () => service.listLinks(),
    { moduleName: 'externalLink' }
  ));

  ipcMain.handle('externalLink:create', wrap(
    async (_event, data: LinkInput) => service.createLink(data),
    { moduleName: 'externalLink' }
  ));

  ipcMain.handle('externalLink:update', wrap(
    async (_event, id: string, patch: LinkPatchInput) => service.updateLink(id, patch),
    { moduleName: 'externalLink' }
  ));

  ipcMain.handle('externalLink:delete', wrap(
    async (_event, id: string) => service.deleteLink(id),
    { moduleName: 'externalLink' }
  ));

  ipcMain.handle('externalLink:reorder', wrap(
    async (_event, orderedIds: string[]) => service.reorderLinks(orderedIds),
    { moduleName: 'externalLink' }
  ));

  ipcMain.handle('externalLink:open', wrap(
    async (_event, id: string, context?: LinkOpenContext) => service.openLink(id, context || {}),
    { moduleName: 'externalLink' }
  ));

  ipcMain.handle('externalLink:import', wrap(
    async (_event, payload: { format: 'sites' | 'bookmarks' | 'json'; content: string; groups?: string[] }) =>
      service.importLinks(payload),
    { moduleName: 'externalLink' }
  ));

  ipcMain.handle('externalLink:export', wrap(
    async () => service.exportLinks(),
    { moduleName: 'externalLink' }
  ));

}
