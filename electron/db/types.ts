export interface StandardItem {
  id: string;
  standardId: string;
  domain: string;
  controlPoint: string;
  controlName: string;
  requirement: string;
  minLevel: number;
  maxLevel?: number;
  extensionType?: string;
  isHighRisk?: number;
  sortOrder: number;
  parentId?: string | null;
}
