import { registerAuthHandlers } from '../ipc/auth.ipc';
import { registerProjectHandlers } from '../ipc/project.ipc';
import { registerAssetHandlers } from '../ipc/asset.ipc';
import { registerAssessmentHandlers } from '../ipc/assessment.ipc';
import { registerIssueHandlers } from '../ipc/issue.ipc';
import { registerScreenshotHandlers } from '../ipc/screenshot.ipc';
import { registerStandardHandlers } from '../ipc/standard.ipc';
import { registerAIHandlers } from '../ipc/ai.ipc';
import { registerKnowledgeHandlers } from '../ipc/knowledge.ipc';
import { registerUserHandlers } from '../ipc/user.ipc';
import { registerSystemHandlers } from '../ipc/system.ipc';
import { registerReportHandlers } from '../ipc/report.ipc';
import { registerUpdateHandlers } from '../services/update.service';
import { registerDocumentHandlers } from '../ipc/document.ipc';

export function registerIpcHandlers(): void {
  registerAuthHandlers();
  registerProjectHandlers();
  registerAssetHandlers();
  registerAssessmentHandlers();
  registerIssueHandlers();
  registerScreenshotHandlers();
  registerStandardHandlers();
  registerAIHandlers();
  registerKnowledgeHandlers();
  registerUserHandlers();
  registerSystemHandlers();
  registerReportHandlers();
  registerUpdateHandlers();
  registerDocumentHandlers();
}