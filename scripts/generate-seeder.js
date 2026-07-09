const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const excelPath = path.join(__dirname, '..', 'S2A2G2.xlsx');

const DOMAIN_ORDER = [
  { key: 'secure_physical', name: '安全物理环境', sheet: '安全物理环境' },
  { key: 'secure_communication', name: '安全通信网络', sheet: '安全通信网络' },
  { key: 'secure_boundary', name: '安全区域边界', sheet: '安全区域边界-XX边界' },
  { key: 'secure_computing', name: '安全计算环境', sheet: '安全计算环境-XX服务器' },
  { key: 'secure_management', name: '安全管理中心', sheet: '安全管理中心' },
  { key: 'security_management', name: '安全管理制度', sheet: '安全管理制度' },
  { key: 'security_organization', name: '安全管理机构', sheet: '安全管理机构' },
  { key: 'security_personnel', name: '安全管理人员', sheet: '安全管理人员' },
  { key: 'security_construction', name: '安全建设管理', sheet: '安全建设管理' },
  { key: 'security_maintenance', name: '安全运维管理', sheet: '安全运维管理' },
];

const EXTENSION_TYPES = {
  '安全通用要求': 'general',
  '云计算安全扩展要求': 'cloud',
  '移动互联安全扩展要求': 'mobile',
  '物联网安全扩展要求': 'iot',
  '工业控制系统安全扩展要求': 'industrial',
  '大数据安全扩展要求（国标附录）': 'bigdata',
};

function extractControlName(requirement) {
  if (!requirement) return '';
  const match = requirement.match(/^[a-z]+）\s*(.+)/);
  if (match) return match[1].replace(/[。；]$/, '');
  return requirement.replace(/[。；]$/, '');
}

function parseSheet(worksheet) {
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const items = [];
  let currentExtension = 'general';
  let currentControlPoint = '';
  let sortOrder = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const colA = row[0] ? String(row[0]).trim() : '';
    const colB = row[1] ? String(row[1]).trim() : '';

    if (EXTENSION_TYPES[colA]) {
      currentExtension = EXTENSION_TYPES[colA];
      continue;
    }

    if (!colA || isNaN(parseInt(colA))) continue;

    const controlPoint = colB || '';
    const requirement = row[2] ? String(row[2]).trim() : '';

    if (!requirement) continue;

    sortOrder++;
    items.push({
      controlPoint,
      requirement,
      extensionType: currentExtension,
      sortOrder,
      controlName: extractControlName(requirement),
    });
  }

  return items;
}

function generateSeeder() {
  const workbook = XLSX.readFile(excelPath);
  const allItems = [];
  let globalSortOrder = 0;

  for (const domain of DOMAIN_ORDER) {
    const worksheet = workbook.Sheets[domain.sheet];
    if (!worksheet) {
      console.warn(`Sheet not found: ${domain.sheet}`);
      continue;
    }

    const items = parseSheet(worksheet);
    for (const item of items) {
      globalSortOrder++;
      const id = `gb22239-${domain.key}-${globalSortOrder}`;
      allItems.push({
        id,
        standardId: 'gb-t-22239-2019-l3',
        domain: domain.key,
        controlPoint: item.controlPoint,
        controlName: item.controlName,
        requirement: item.requirement,
        minLevel: 2,
        maxLevel: 4,
        extensionType: item.extensionType,
        isHighRisk: 0,
        sortOrder: globalSortOrder,
      });
    }
    console.log(`${domain.name}: ${items.length} 项`);
  }

  console.log(`\n总计: ${allItems.length} 项`);

  const escape = (s) => s.replace(/'/g, "\\'").replace(/\n/g, '\\n');

  const lines = [];
  lines.push("import type { InferInsertModel } from 'drizzle-orm';");
  lines.push("import * as schema from '../schema';");
  lines.push('');
  lines.push('export const DEFAULT_STANDARD = {');
  lines.push("  id: 'gb-t-22239-2019-l3',");
  lines.push("  name: '信息安全技术 网络安全等级保护基本要求',");
  lines.push("  code: 'GB/T 22239-2019-L3',");
  lines.push("  version: '2.0',");
  lines.push("  description: '网络安全等级保护2.0基本要求，涵盖二级、三级信息系统，支持各类扩展指标',");
  lines.push('  grade: 3,');
  lines.push('  isDefault: 1,');
  lines.push('};');
  lines.push('');
  lines.push('const SECURITY_DOMAINS = [');
  lines.push("  { id: 'secure_physical', name: '安全物理环境', icon: 'OfficeBuilding' },");
  lines.push("  { id: 'secure_communication', name: '安全通信网络', icon: 'Connection' },");
  lines.push("  { id: 'secure_boundary', name: '安全区域边界', icon: 'Grid' },");
  lines.push("  { id: 'secure_computing', name: '安全计算环境', icon: 'Monitor' },");
  lines.push("  { id: 'secure_management', name: '安全管理中心', icon: 'Setting' },");
  lines.push("  { id: 'security_management', name: '安全管理制度', icon: 'Document' },");
  lines.push("  { id: 'security_organization', name: '安全管理机构', icon: 'Briefcase' },");
  lines.push("  { id: 'security_personnel', name: '安全管理人员', icon: 'User' },");
  lines.push("  { id: 'security_construction', name: '安全建设管理', icon: 'Tools' },");
  lines.push("  { id: 'security_maintenance', name: '安全运维管理', icon: 'Box' },");
  lines.push('];');
  lines.push('');
  lines.push('export const EXTENSION_TYPES = [');
  lines.push("  { id: 'general', name: '安全通用要求', description: '适用于所有信息系统' },");
  lines.push("  { id: 'cloud', name: '云计算安全扩展', description: '适用于云计算平台' },");
  lines.push("  { id: 'mobile', name: '移动互联安全扩展', description: '适用于移动互联应用' },");
  lines.push("  { id: 'iot', name: '物联网安全扩展', description: '适用于物联网系统' },");
  lines.push("  { id: 'industrial', name: '工业控制系统安全扩展', description: '适用于工业控制系统' },");
  lines.push("  { id: 'bigdata', name: '大数据安全扩展', description: '适用于大数据平台' },");
  lines.push('];');
  lines.push('');
  lines.push('interface AssessmentItemSeed {');
  lines.push('  id?: string;');
  lines.push('  standardId?: string;');
  lines.push('  domain: string;');
  lines.push('  controlPoint: string;');
  lines.push('  controlName: string;');
  lines.push('  requirement: string;');
  lines.push('  minLevel?: number;');
  lines.push('  maxLevel?: number;');
  lines.push('  extensionType?: string;');
  lines.push('  isHighRisk?: number;');
  lines.push('  sortOrder: number;');
  lines.push('}');
  lines.push('');
  lines.push('const ASSESSMENT_ITEMS: AssessmentItemSeed[] = [');

  let currentDomain = '';
  for (const item of allItems) {
    const domainInfo = DOMAIN_ORDER.find(d => d.key === item.domain);
    if (item.domain !== currentDomain) {
      currentDomain = item.domain;
      lines.push('');
      lines.push(`  // ==================== ${domainInfo?.name || item.domain} ====================`);
    }
    lines.push('  {');
    lines.push(`    id: '${item.id}',`);
    lines.push(`    standardId: '${item.standardId}',`);
    lines.push(`    domain: '${item.domain}',`);
    lines.push(`    controlPoint: '${escape(item.controlPoint)}',`);
    lines.push(`    controlName: '${escape(item.controlName)}',`);
    lines.push(`    requirement: '${escape(item.requirement)}',`);
    lines.push(`    minLevel: ${item.minLevel},`);
    lines.push(`    maxLevel: ${item.maxLevel},`);
    lines.push(`    extensionType: '${item.extensionType}',`);
    lines.push(`    isHighRisk: ${item.isHighRisk},`);
    lines.push(`    sortOrder: ${item.sortOrder},`);
    lines.push('  },');
  }

  lines.push('];');
  lines.push('');
  lines.push('export function getStandardSeed() {');
  lines.push('  return {');
  lines.push('    standard: DEFAULT_STANDARD,');
  lines.push('    domains: SECURITY_DOMAINS,');
  lines.push('    extensionTypes: EXTENSION_TYPES,');
  lines.push('    items: ASSESSMENT_ITEMS,');
  lines.push('  };');
  lines.push('}');
  lines.push('');

  const outputPath = path.join(__dirname, '..', 'electron', 'db', 'seeds', 'standard-gbt22239.ts');
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  console.log(`\n已生成: ${outputPath}`);
}

generateSeeder();
