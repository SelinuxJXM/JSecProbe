/**
 * Project Types
 * 项目相关类型定义
 */

export interface Project {
  id: string;
  name: string;
  projectNo?: string;
  systemName: string;
  assessedUnit?: string;
  standardSystem?: string;
  levelCombo?: string;
  extensionType?: string;
  level: number;
  standardId: string;
  status: 'draft' | 'in_progress' | 'completed' | 'archived';
  customerName?: string;
  assessor?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  assetCount: number;
  complianceRate?: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  level?: number;
  excludeArchived?: boolean;
}

export interface ProjectListResult {
  list: Project[];
  total: number;
}

export interface CreateProjectParams {
  name: string;
  projectNo?: string;
  systemName: string;
  assessedUnit?: string;
  standardSystem?: string;
  levelCombo?: string;
  extensionType?: string;
  level: number;
  standardId?: string;
  status?: string;
  customerName?: string;
  assessor?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  progress?: number;
}

export interface UpdateProjectParams {
  name?: string;
  projectNo?: string;
  systemName?: string;
  assessedUnit?: string;
  standardSystem?: string;
  levelCombo?: string;
  extensionType?: string;
  level?: number;
  standardId?: string;
  status?: string;
  customerName?: string;
  assessor?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  progress?: number;
}