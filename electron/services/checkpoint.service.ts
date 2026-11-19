/**
 * 测评点知识库 IO 层：解析赛飞 V2.0 指导书 Excel → 预览 → 落库。
 *
 * 安全：导入文件必须经用户对话框选过（isUserAuthorizedFile + validateReadablePath），
 * 不接受渲染层任意路径；解析只读，不修改源文件。
 */
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import {
  cellText, toDomainKey, toDeviceKey, buildSemanticKey,
  detectHeaderFields, splitCheckpoints, fuzzyRequirementMatch, resolveCheckpointUpdate, type HeaderField,
} from './checkpoint-core';

export interface PreviewRow {
  seq: string;
  domain: string;
  controlPoint: string;
  requirement: string;
  checkpoints: string[];
  interpretation?: string;
  resultTemplate?: string;
  catalogNo?: string;
  deviceKey: string;
  semanticKey: string;
  /** 和标准条款的匹配情况 */
  match: 'auto' | 'fuzzy' | 'unmatched';
  matchedItemId?: string;
  matchedRequirement?: string;
  /** 覆盖导入时是否替换已有同键记录 */
  overwrite?: boolean;
}

export interface PreviewResult {
  file: string;
  rows: PreviewRow[];
  stats: { total: number; auto: number; fuzzy: number; unmatched: number; sheets: number };
}

/** 从标准库加载 要求文本 → item 的索引，用于匹配 */
function loadStandardIndex(): Array<{ id: string; requirement: string; domain: string; controlPoint: string }> {
  const db = getDb();
  return db.select({
    id: schema.assessmentItems.id,
    requirement: schema.assessmentItems.requirement,
    domain: schema.assessmentItems.domain,
    controlPoint: schema.assessmentItems.controlPoint,
  }).from(schema.assessmentItems).all().map(r => ({
    id: r.id, requirement: String(r.requirement || ''),
    domain: String(r.domain || ''), controlPoint: String(r.controlPoint || ''),
  }));
}

/** 在标准索引里找最匹配的一条。优先同域/同控制点，再比要求文本。 */
function matchStandard(
  row: { domain: string; controlPoint: string; requirement: string },
  index: Array<{ id: string; requirement: string; domain: string; controlPoint: string }>,
): { kind: 'auto' | 'fuzzy' | 'unmatched'; itemId?: string; matchedReq?: string } {
  const domainKey = toDomainKey(row.domain);
  const cp = String(row.controlPoint || '').trim();
  // 先按域+控制点缩小范围（若指导书给了这些列）
  let candidates = index;
  if (domainKey) {
    const scoped = index.filter(i => i.domain === domainKey || toDomainKey(i.domain) === domainKey);
    if (scoped.length) candidates = scoped;
  }
  if (cp) {
    const scoped = candidates.filter(i => String(i.controlPoint || '').trim() === cp);
    if (scoped.length) candidates = scoped;
  }
  let best: { kind: 'auto' | 'fuzzy' | 'unmatched'; itemId?: string; matchedReq?: string; score: number } =
    { kind: 'unmatched', score: -1 };
  for (const c of candidates) {
    const m = fuzzyRequirementMatch(row.requirement, c.requirement);
    if (!m) continue;
    const score = m === 'exact' ? 3 : m === 'contains' ? 2 : 1;
    if (score > best.score) best = { kind: m === 'fuzzy' ? 'fuzzy' : 'auto', itemId: c.id, matchedReq: c.requirement, score };
    if (score === 3) break;
  }
  // 域/控制点限定后没命中，退回全库再找一次（应对指导书域名不标准）
  if (best.score < 0 && candidates !== index) {
    for (const c of index) {
      const m = fuzzyRequirementMatch(row.requirement, c.requirement);
      if (!m) continue;
      const score = m === 'exact' ? 3 : m === 'contains' ? 2 : 1;
      if (score > best.score) best = { kind: m === 'fuzzy' ? 'fuzzy' : 'auto', itemId: c.id, matchedReq: c.requirement, score };
      if (score === 3) break;
    }
  }
  return { kind: best.kind, itemId: best.itemId, matchedReq: best.matchedReq };
}

/** 从一个 sheet 解析预览行 */
function parseSheet(
  ws: ExcelJS.Worksheet, sheetName: string, stdIndex: Array<{ id: string; requirement: string; domain: string; controlPoint: string }>,
): PreviewRow[] {
  // 找表头行：前 8 行里，识别出的字段数最多的那行
  let headerRowNum = 0, fields = new Map<number, HeaderField>(), bestCount = 0;
  for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(ws.getRow(r).getCell(c).value));
    const f = detectHeaderFields(vals);
    if (f.size > bestCount) { bestCount = f.size; headerRowNum = r; fields = f; }
  }
  // 至少要能拿到 requirement + 测评点来源。
  // 赛飞「物理+管理」分册只有「预期结果」列（无测评方法/测评要求列），
  // 但该列内容本身就是逐条编号的核查点（经核查，1)...2)...），要兼容为测评点来源。
  const hasRequirement = [...fields.values()].includes('requirement');
  const hasCheckpoints = [...fields.values()].includes('checkpoints');
  const hasResultTemplate = [...fields.values()].includes('resultTemplate');
  if (!headerRowNum || !hasRequirement || (!hasCheckpoints && !hasResultTemplate)) return [];

  const col = (field: HeaderField, row: ExcelJS.Row): string => {
    for (const [c, f] of fields) if (f === field) return cellText(row.getCell(c).value).trim();
    return '';
  };
  const rows: PreviewRow[] = [];
  // 设备类型：优先 sheet 里的设备列，否则从 sheet 名猜
  const deviceFromName = toDeviceKey(sheetName);
  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    let requirement = col('requirement', row);
    const domain = col('domain', row);
    const controlPoint = col('controlPoint', row);
    const interpretation = col('interpretation', row);
    const resultTemplate = col('resultTemplate', row);
    // 「物理+管理」分册没有测评方法列，用「预期结果」列（本身就是编号核查点）兜底
    let checkpointsText = col('checkpoints', row);
    if (!checkpointsText && !hasCheckpoints && resultTemplate) checkpointsText = resultTemplate;
    if (!requirement || !checkpointsText) continue;
    const catalogNo = col('catalogNo', row);
    const deviceType = col('deviceType', row);
    const deviceKey = toDeviceKey(deviceType) || deviceFromName;
    const semanticKey = buildSemanticKey(domain, controlPoint, requirement);
    const m = matchStandard({ domain, controlPoint, requirement }, stdIndex);
    rows.push({
      seq: col('seq', row), domain, controlPoint, requirement,
      checkpoints: splitCheckpoints(checkpointsText),
      interpretation: interpretation || undefined,
      resultTemplate: resultTemplate || undefined,
      catalogNo: catalogNo || undefined,
      deviceKey, semanticKey,
      match: m.kind, matchedItemId: m.itemId, matchedRequirement: m.matchedReq,
    });
  }
  return rows;
}

/** 预览：解析文件（只读，不落库） */
export async function previewCheckpointFile(filePath: string): Promise<PreviewResult> {
  if (!fs.existsSync(filePath)) throw new Error('文件不存在');
  const stdIndex = loadStandardIndex();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const all: PreviewRow[] = [];
  let sheets = 0;
  for (const ws of wb.worksheets) {
    // 跳过封面/说明等非数据 sheet（按行内容判断，不按名字硬猜）
    const rows = parseSheet(ws, ws.name, stdIndex);
    if (rows.length) { all.push(...rows); sheets++; }
  }
  const stats = {
    total: all.length,
    auto: all.filter(r => r.match === 'auto').length,
    fuzzy: all.filter(r => r.match === 'fuzzy').length,
    unmatched: all.filter(r => r.match === 'unmatched').length,
    sheets,
  };
  return { file: filePath.split(/[\\/]/).pop() || filePath, rows: all, stats };
}

/** 确认落库：前端可编辑/剔除行后提交。事务写入，按语义键+设备键去重。 */
export function commitCheckpointRows(rows: PreviewRow[], clearFirst = false): { inserted: number; updated: number; skipped: number } {
  const db = getDb();
  const now = new Date().toISOString();
  let inserted = 0, updated = 0, skipped = 0;
  db.transaction((tx) => {
    // S5：清空与写入同一事务——写失败时清空也回滚，不会出现"库空了但导入没成"
    if (clearFirst) tx.delete(schema.assessmentCheckpoints).run();
    for (const r of rows) {
      // M9：checkpoints 必须是字符串数组，防止双重编码 / 坏数据
      const validPoints = Array.isArray(r.checkpoints)
        ? r.checkpoints.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : [];
      if (!r.requirement?.trim() || validPoints.length === 0) { skipped++; continue; }
      // M9：语义键/设备键服务端重算，不信前端传值（前端编辑了文本也能正确落键）
      const semanticKey = buildSemanticKey(r.domain || '', r.controlPoint || '', r.requirement);
      const deviceKey = r.deviceKey ?? ''; // S2：保留导入时从 sheet 名算出的设备键
      const existing = tx.select().from(schema.assessmentCheckpoints)
        .where(sql`${schema.assessmentCheckpoints.semanticKey} = ${semanticKey} AND ${schema.assessmentCheckpoints.deviceKey} = ${deviceKey}`)
        .get();
      const values = {
        semanticKey,
        deviceKey,
        domain: r.domain || null,
        controlPoint: r.controlPoint || null,
        requirement: r.requirement,
        checkpoints: JSON.stringify(validPoints),
        interpretation: r.interpretation || null,
        resultTemplate: r.resultTemplate || null,
        catalogNo: r.catalogNo || null,
        source: r.matchedItemId ? `赛飞/${r.matchedItemId}` : '赛飞/未匹配',
        updatedAt: now,
      };
      if (existing) {
        if (r.overwrite === false) { skipped++; continue; }
        tx.update(schema.assessmentCheckpoints).set(values).where(eq(schema.assessmentCheckpoints.id, existing.id)).run();
        updated++;
      } else {
        tx.insert(schema.assessmentCheckpoints).values({ id: randomUUID(), ...values, createdAt: now }).run();
        inserted++;
      }
    }
  });
  log.info(`[测评点导入] 新增${inserted} 更新${updated} 跳过${skipped}`);
  return { inserted, updated, skipped };
}

/** 列出已导入的测评点（供管理页展示） */
export function listCheckpointStats(): { total: number; withDevice: number; unmatched: number } {
  const db = getDb();
  const rows = db.select({
    deviceKey: schema.assessmentCheckpoints.deviceKey,
    source: schema.assessmentCheckpoints.source,
  }).from(schema.assessmentCheckpoints).all();
  return {
    total: rows.length,
    withDevice: rows.filter(r => r.deviceKey).length,
    unmatched: rows.filter(r => (r.source || '').includes('未匹配')).length,
  };
}

/**
 * 列出库内已导入的测评点记录（导入后管理：编辑/删除）。
 * keyword 对 requirement / controlPoint / deviceKey / catalogNo 做大小写不敏感的包含匹配。
 */
export function listCheckpoints(keyword?: string): Array<{
  id: string; domain: string | null; controlPoint: string | null; requirement: string;
  checkpoints: string[]; interpretation: string | null; resultTemplate: string | null;
  catalogNo: string | null; deviceKey: string; semanticKey: string; source: string | null;
  /** 匹配标准条款的情况：auto/fuzzy/unmatched，供列表标注 */
  match: 'auto' | 'fuzzy' | 'unmatched';
  updatedAt: string;
}> {
  const db = getDb();
  const all = db.select().from(schema.assessmentCheckpoints)
    .orderBy(sql`${schema.assessmentCheckpoints.updatedAt} DESC`).all();
  const kw = String(keyword || '').trim().toLowerCase();
  return all.map(r => {
    let checkpoints: string[] = [];
    try {
      const parsed = JSON.parse(r.checkpoints || '[]');
      checkpoints = Array.isArray(parsed) ? parsed.filter((p: any) => typeof p === 'string') : [];
    } catch { /* 坏数据按空处理 */ }
    // 与预览口径一致：source 以「赛飞/<itemId>」为已匹配，「赛飞/未匹配」为未匹配；
    // 其它形式（含裸「赛飞」历史数据）一律按未匹配处理。
    const src = r.source || '';
    let match: 'auto' | 'fuzzy' | 'unmatched';
    if (src.includes('未匹配')) match = 'unmatched';
    else if (src.startsWith('赛飞/') && src.length > '赛飞/'.length) match = 'auto';
    else match = 'unmatched';
    return {
      id: r.id, domain: r.domain, controlPoint: r.controlPoint, requirement: r.requirement,
      checkpoints, interpretation: r.interpretation, resultTemplate: r.resultTemplate,
      catalogNo: r.catalogNo, deviceKey: r.deviceKey, semanticKey: r.semanticKey,
      source: r.source, match,
      updatedAt: r.updatedAt,
    };
  }).filter(r => !kw
    || (r.requirement || '').toLowerCase().includes(kw)
    || (r.controlPoint || '').toLowerCase().includes(kw)
    || (r.deviceKey || '').toLowerCase().includes(kw)
    || (r.catalogNo || '').toLowerCase().includes(kw));
}

/** 单条更新结果 */
export interface UpdateCheckpointInput {
  id: string;
  domain?: string | null;
  controlPoint?: string | null;
  requirement?: string;
  checkpoints?: string[];
  interpretation?: string | null;
  resultTemplate?: string | null;
  catalogNo?: string | null;
  deviceKey?: string;
}
export interface UpdateCheckpointResult {
  ok: boolean;
  reason?: 'not_found' | 'empty_requirement' | 'empty_checkpoints' | 'conflict';
  duplicateOf?: string;
}

/**
 * 更新一条已入库测评点（服务端重算语义键，不信前端传值）。
 * 改到与另一条记录「同语义键 + 同设备」时判冲突，直接拒绝——
 * 否则会因唯一索引冲突导致整批事务回滚。
 */
export function updateCheckpointRow(input: UpdateCheckpointInput): UpdateCheckpointResult {
  const db = getDb();
  const existing = db.select().from(schema.assessmentCheckpoints)
    .where(eq(schema.assessmentCheckpoints.id, input.id)).get();
  if (!existing) return { ok: false, reason: 'not_found' };

  // 决策（空校验/语义键重算）抽到纯函数，可单测且不与 DB 纠缠
  const decision = resolveCheckpointUpdate(existing as any, input);
  if (!decision.ok) return { ok: false, reason: decision.reason };

  // 语义键/设备变化后是否撞已有记录（排除自己）——撞唯一索引会整批回滚，必须先拒
  const dup = db.select({ id: schema.assessmentCheckpoints.id }).from(schema.assessmentCheckpoints)
    .where(sql`${schema.assessmentCheckpoints.semanticKey} = ${decision.semanticKey}
      AND ${schema.assessmentCheckpoints.deviceKey} = ${decision.values.deviceKey}
      AND ${schema.assessmentCheckpoints.id} != ${input.id}`).get();
  if (dup) return { ok: false, reason: 'conflict', duplicateOf: dup.id };

  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(schema.assessmentCheckpoints).set({
      ...decision.values,
      updatedAt: now,
    }).where(eq(schema.assessmentCheckpoints.id, input.id)).run();
  });
  return { ok: true };
}

/** 删除一条记录 */
export function deleteCheckpointRow(id: string): boolean {
  const db = getDb();
  const existing = db.select({ id: schema.assessmentCheckpoints.id }).from(schema.assessmentCheckpoints)
    .where(eq(schema.assessmentCheckpoints.id, id)).get();
  if (!existing) return false;
  db.delete(schema.assessmentCheckpoints).where(eq(schema.assessmentCheckpoints.id, id)).run();
  return true;
}

/**
 * 按测评项 + 设备类型召回测评点（AI 分析前调用）。
 * 优先精确语义键+设备；未命中则退回同语义键的通用条目（deviceKey=''）；
 * 再未命中用模糊匹配找同控制点/同域的近似要求。
 */
export function recallCheckpoints(params: {
  controlPoint?: string;
  requirement?: string;
  domain?: string;
  assetCategory?: string;
  assetOs?: string;
}): { found: boolean; source: 'exact' | 'generic' | 'fuzzy' | 'none'; checkpoints: string[]; interpretation?: string; resultTemplate?: string; catalogNo?: string } {
  const empty = { found: false, source: 'none' as const, checkpoints: [] as string[] };
  if (!params.requirement?.trim()) return empty;
  const db = getDb();
  const semanticKey = buildSemanticKey(params.domain || '', params.controlPoint || '', params.requirement);
  const deviceKey = toDeviceKey(params.assetCategory, params.assetOs) || '';

  // 1) 精确语义键 + 设备
  let rows = db.select().from(schema.assessmentCheckpoints)
    .where(sql`${schema.assessmentCheckpoints.semanticKey} = ${semanticKey} AND ${schema.assessmentCheckpoints.deviceKey} = ${deviceKey}`)
    .all();
  let source: 'exact' | 'generic' | 'fuzzy' = 'exact';
  // 2) 同语义键的通用条目
  if (!rows.length && deviceKey) {
    rows = db.select().from(schema.assessmentCheckpoints)
      .where(sql`${schema.assessmentCheckpoints.semanticKey} = ${semanticKey} AND ${schema.assessmentCheckpoints.deviceKey} = ''`)
      .all();
    source = 'generic';
  }
  // 3) 模糊匹配：同控制点下要求文本近似的（取第一条最像的）
  if (!rows.length) {
    // 无控制点时此前用 sql`1 = 1` 会把整张知识库加载到内存做 JS 模糊匹配，
    // 数据量大时每次 AI 召回都全表扫描。这里给无控制点的兜底查询加上界，
    // 保留召回能力的同时杜绝全表加载；有控制点时走 control_point_idx 索引，规模可控。
    const fallbackQuery = db.select().from(schema.assessmentCheckpoints);
    const candidates = params.controlPoint
      ? fallbackQuery.where(eq(schema.assessmentCheckpoints.controlPoint, params.controlPoint.trim())).all()
      : fallbackQuery.where(sql`1 = 1`).limit(300).all();
    let best: typeof rows[number] | null = null, bestScore = 0;
    for (const c of candidates) {
      const m = fuzzyRequirementMatch(params.requirement, c.requirement);
      if (!m) continue;
      const score = m === 'exact' ? 3 : m === 'contains' ? 2 : 1;
      if (score > bestScore) { bestScore = score; best = c; }
      if (score === 3) break;
    }
    if (best) { rows = [best]; source = 'fuzzy'; }
  }
  if (!rows.length) return empty;
  const r = rows[0];
  // M9：JSON 解析必须校验数组类型，坏数据（null/对象/字符串双重编码）不能流向 AI 的 forEach
  let checkpoints: string[] = [];
  try {
    const parsed = JSON.parse(r.checkpoints || '[]');
    checkpoints = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch { /* 数据损坏，空 */ }
  if (!checkpoints.length) return empty; // found=true 但空清单没有意义，且会触发提示词矛盾
  log.debug(`[测评点召回] ${source} 命中 ${checkpoints.length} 个测评点 (设备=${deviceKey || '通用'})`);
  return {
    found: true, source,
    checkpoints,
    interpretation: r.interpretation || undefined,
    resultTemplate: r.resultTemplate || undefined,
    catalogNo: r.catalogNo || undefined,
  };
}

/**
 * 生成统一导入模板（xlsx）到指定路径。
 *
 * 表头用导入器同义词识别的标准列名；三个 sheet：
 *  1) 测评点模板：表头 + 3 行示例（通用/Linux/边界，覆盖不同设备与分册写法）
 *  2) 填写说明：每列含义、设备类型可选值、语义键匹配说明
 *  3) 设备类型参考：推荐值清单，供填写者对照（也用于数据验证下拉）
 */
export async function generateImportTemplate(savePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JSecProbe 等级保护测评系统';
  wb.created = new Date();

  // ── Sheet 1：模板主体 ──
  // 已移除对导入无作用的「序号」「备注」两列（导入器解析后从未使用）。
  // 8 列分三档：必填=测评项/测评方法；强烈建议=安全层面/控制点；选填=其余四列。
  const ws = wb.addWorksheet('测评点模板');
  const headers = [
    '安全层面', '控制点', '测评项', '测评方法',
    '预期结果', '要求解读', '设备类型', '标准条款号',
  ];
  ws.addRow(headers);
  // 示例行：完整填写的标准样例，照抄格式效果最佳
  ws.addRow([
    '安全物理环境', '物理位置选择',
    'a) 机房场地应选择在具有防震、防风和防雨等能力的建筑内；',
    '1) 应核查建筑物抗震设防审批验收文件；2) 应核查机房无天花板/窗台下水渗漏现象；3) 应核查墙体门窗地面无开裂。',
    '经核查，建筑物具备抗震设防审批文件，机房无渗漏、无开裂。',
    '机房选址须避免自然灾害与建筑结构风险。',
    '', '',
  ]);
  ws.addRow([
    '安全计算环境', '身份鉴别',
    'b) 应具有登录失败处理功能，应配置并启用结束会话、限制非法登录次数等相关措施；',
    '1) 应核查是否配置并启用登录失败处理功能；2) 应核查登录失败达到一定次数后是否锁定账户；3) 应核查连接超时是否自动退出。',
    '经核查，/etc/login.defs 中配置 FAIL_MAX_ENTRIES=5、FAIL_INTERVAL=300。',
    '登录失败处理用于抵御口令爆破。',
    'linux', 'GBT22239-2019-8.1.4.1',
  ]);
  ws.addRow([
    '安全区域边界', '访问控制',
    'a) 应在网络边界部署访问控制设备，启用访问控制功能；',
    '1) 应核查网络边界是否部署访问控制设备；2) 应核查是否启用并配置访问控制策略。',
    '经核查，边界部署防火墙并启用访问控制策略。',
    '', 'network_device', '',
  ]);

  // 表头样式：文本保持精确匹配（导入器靠表头文字识别列），只用底色区分三档。
  // 橙红=必填，深蓝=强烈建议，浅灰=选填可留空。
  const headerRow = ws.getRow(1);
  headerRow.height = 26;
  const headerColors = [
    'FF1B5FD9', // 1 安全层面 - 建议
    'FF1B5FD9', // 2 控制点 - 建议
    'FFC0392B', // 3 测评项 - 必填
    'FFC0392B', // 4 测评方法 - 必填
    'FF8A95A5', // 5 预期结果 - 选填
    'FF8A95A5', // 6 要求解读 - 选填
    'FF8A95A5', // 7 设备类型 - 选填
    'FF8A95A5', // 8 标准条款号 - 选填
  ];
  headerColors.forEach((argb, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  // 列宽（与 8 列新顺序一致）
  const widths = [16, 16, 58, 70, 50, 40, 18, 26];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  // 数据行样式：自动换行、顶端对齐、行高
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.height = 92;
    row.alignment = { vertical: 'top', wrapText: true };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]; // 冻结表头
  // 数据验证下拉：安全层面(A列)、设备类型(G列)（减少填错）
  const domainList = '"安全物理环境,安全通信网络,安全区域边界,安全计算环境,安全管理中心,安全管理制度,安全管理机构,安全人员管理,安全建设管理,安全运维管理"';
  const deviceList = '"通用,linux,windows,nginx,tomcat,mysql,oracle,mongodb,network_device,security_device,business_app,terminal,firewall,router,switch,database,cloud,industrial,mobile,iot"';
  for (let r = 2; r <= 500; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [domainList],
      promptTitle: '安全层面', prompt: '建议填写，影响 AI 召回精度；留空按通用处理',
    };
    ws.getCell(`G${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [deviceList],
      promptTitle: '设备类型', prompt: '选填；与设备无关的条款留空即可',
    };
  }

  // ── Sheet 2：填写说明 ──
  const guide = wb.addWorksheet('填写说明');
  guide.columns = [{ width: 18 }, { width: 96 }];
  guide.addRow(['统一导入模板 · 填写说明']);
  guide.getRow(1).font = { bold: true, size: 13 };
  guide.addRow([]);
  guide.addRow(['★ 最少只填 2 列就能导入']);
  const titleRow = guide.getRow(guide.rowCount);
  titleRow.font = { bold: true, size: 12, color: { argb: 'FFC0392B' } };
  const mustRow = (() => { guide.addRow(['必填', '测评项 + 测评方法（橙红两列）。测评项是匹配用的标准条款原文；测评方法逐条写出要核查的点，系统据此拆成测评点。两列缺一整行都会被跳过。']); return guide.getRow(guide.rowCount); })();
  const shouldRow = (() => { guide.addRow(['强建议', '安全层面 + 控制点（深蓝两列）。不填仍能导入，但 AI 现场分析时无法按语义键精确召回，核查点会失准——尤其「控制点」留空会让召回彻底落空。']); return guide.getRow(guide.rowCount); })();
  const optionalRow = (() => { guide.addRow(['可留空', '预期结果、要求解读、设备类型、标准条款号（浅灰四列），以及已删除的序号/备注。留空不影响导入和召回；设备类型与设备无关的条款（物理/管理）本就该留空。']); return guide.getRow(guide.rowCount); })();
  mustRow.getCell(1).font = { bold: true, color: { argb: 'FFC0392B' } };
  shouldRow.getCell(1).font = { bold: true, color: { argb: 'FF1B5FD9' } };
  optionalRow.getCell(1).font = { bold: true, color: { argb: 'FF8A95A5' } };
  for (const r of [mustRow, shouldRow, optionalRow]) {
    r.getCell(2).alignment = { vertical: 'top', wrapText: true };
    r.getCell(1).alignment = { vertical: 'top' };
    r.height = 40;
  }
  guide.addRow([]);
  const guideRows: Array<[string, string]> = [
    ['安全层面', '强建议。如安全物理环境/安全计算环境等，可从下拉选择；留空按通用处理，会降低召回精度。'],
    ['控制点', '强建议。如身份鉴别/访问控制/物理位置选择，与「测评项」共同决定匹配精度；留空会导致 AI 现场分析召不到本条测评点。'],
    ['测评项', '必填。标准条款原文（如「a) 机房场地应选择在…」）。导入时据此与系统标准库自动匹配。'],
    ['测评方法', '必填。核心列：逐条列出需要核查的测评点，用 1) 2) 3) 编号，一格内换行或分号分隔均可。'],
    ['预期结果', '选填。该测评项核查通过时应看到的配置/状态示例，如「/etc/login.defs 中 PASS_MAX_DAYS=90」，会注入 AI 提示词。'],
    ['要求解读', '选填。条款含义与关键风险点说明，会注入 AI 提示词帮助理解。'],
    ['设备类型', '选填。决定同一条款在不同设备上用哪套核查点。可从下拉选；不确定就留空（通用）。'],
    ['标准条款号', '选填。如 GBT22239-2019-8.1.4.1，有则填，便于溯源。'],
    ['匹配机制', '导入时按「安全层面 + 控制点 + 测评项文本」生成语义键与系统标准条款匹配；完全相同的算「自动」，措辞相近的算「模糊」，只标黄不阻断。'],
    ['修改已有数据', '同一语义键 + 设备类型的记录再次导入会更新覆盖，不会重复。'],
    ['建议', '先复制「测评点模板」sheet 填写，删除示例行后导入；导入前会弹出预览，确认无误再落库。'],
  ];
  for (const [k, v] of guideRows) {
    guide.addRow([k, v]);
    const row = guide.getRow(guide.rowCount);
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { vertical: 'top' };
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    row.height = 32;
  }

  // ── Sheet 3：设备类型参考 ──
  const ref = wb.addWorksheet('设备类型参考');
  ref.columns = [{ width: 26 }, { width: 60 }];
  ref.addRow(['设备类型', '适用场景 / 示例']);
  ref.getRow(1).font = { bold: true };
  const deviceRefs: Array<[string, string]> = [
    ['(留空)', '通用条款，与具体设备无关（如物理环境、安全管理制度）'],
    ['linux', 'Linux 服务器/操作系统（CentOS、Ubuntu、RedHat 等）'],
    ['windows', 'Windows 服务器/操作系统'],
    ['nginx', 'Nginx 中间件'],
    ['tomcat', 'Tomcat 中间件'],
    ['mysql', 'MySQL 数据库'],
    ['oracle', 'Oracle 数据库'],
    ['mongodb', 'MongoDB 数据库'],
    ['network_device', '交换机、路由器等网络设备'],
    ['security_device', '防火墙、WAF、IDS/IPS、堡垒机等安全设备'],
    ['business_app', '业务应用系统'],
    ['terminal', '业务终端、运维终端'],
    ['database', '未指明具体类型的数据库'],
    ['cloud', '云计算扩展要求'],
    ['industrial', '工业控制扩展要求'],
    ['mobile', '移动互联扩展要求'],
    ['iot', '物联网扩展要求'],
  ];
  for (const [k, v] of deviceRefs) ref.addRow([k, v]);

  await wb.xlsx.writeFile(savePath);
}

/** 清空知识库（重新导入前） */
export function clearCheckpoints(): number {
  const db = getDb();
  // 计数与删除放进同一事务，与 commitCheckpointRows 的写法保持一致；
  // 单用户桌面库无并发，但统一风格可避免日后引入并发时 counted≠deleted。
  return db.transaction((tx) => {
    const before = tx.select({ id: schema.assessmentCheckpoints.id }).from(schema.assessmentCheckpoints).all().length;
    tx.delete(schema.assessmentCheckpoints).run();
    return before;
  });
}
