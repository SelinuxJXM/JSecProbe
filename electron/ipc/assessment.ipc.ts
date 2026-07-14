import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc, count, sql, inArray, lte, or, like } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { styleCell, getRowMaxHeight } from '../utils/excel-helper';
import { wrap } from '../utils/ipc-wrapper';
import { validateUuid, validateNotEmpty, validateComplianceStatus, sanitizeInput } from '../utils/validation';

export function registerAssessmentHandlers(): void {
  // 根据项目等级和扩展类型筛选测评项
  ipcMain.handle('assessment:getItems', wrap(async (_event, standardId: string, domain?: string, projectLevel?: number, extensionType?: string | string[]) => {
      console.log(`[assessment:getItems] 调用参数: standardId=${standardId}, domain=${domain}, level=${projectLevel}, extension=${JSON.stringify(extensionType)}`);
      const db = getDb();
      
      const conditions = [eq(schema.assessmentItems.standardId, standardId)];
      
      if (domain) {
        conditions.push(eq(schema.assessmentItems.domain, domain));
      }
      
      // 按等级筛选：只显示项目等级范围内的测评项
      if (projectLevel) {
        conditions.push(lte(schema.assessmentItems.minLevel, projectLevel));
      }
      
      // 按扩展类型筛选：只显示通用要求或匹配的扩展要求
      const extTypes = extensionType
        ? (Array.isArray(extensionType) ? extensionType : [extensionType])
        : [];
      const extConditions = [eq(schema.assessmentItems.extensionType, 'general')];
      for (const ext of extTypes) {
        extConditions.push(eq(schema.assessmentItems.extensionType, ext));
      }
      const extOr = or(...extConditions);
      if (extOr) conditions.push(extOr);

      const items = await db.query.assessmentItems.findMany({
        where: and(...conditions),
        orderBy: schema.assessmentItems.sortOrder,
      });

      // 重新排序：通用要求在前，扩展要求在后，各自内部按sortOrder排序
      const generalItems = items.filter(i => i.extensionType === 'general');
      const extensionItems = items.filter(i => i.extensionType !== 'general');
      const sortedItems = [...generalItems, ...extensionItems];

      console.log(`[assessment:getItems] 查询结果: ${sortedItems.length} 条（通用: ${generalItems.length}, 扩展: ${extensionItems.length}）`);
      return sortedItems.map((item) => ({
        ...item,
        isHighRisk: !!item.isHighRisk,
      }));
    })
  );

  ipcMain.handle('assessment:getRecords', wrap(async (_event, projectId: string, itemId: string) => {
      const db = getDb();
      const records = await db.query.assessmentRecords.findMany({
        where: and(
          eq(schema.assessmentRecords.projectId, projectId),
          eq(schema.assessmentRecords.itemId, itemId)
        ),
        orderBy: desc(schema.assessmentRecords.createdAt),
      });
      return records;
    })
  );

  // 按资产ID获取测评记录
  ipcMain.handle('assessment:getRecordsByAsset', wrap(async (_event, projectId: string, assetId: string) => {
      const db = getDb();
      const records = await db.query.assessmentRecords.findMany({
        where: and(
          eq(schema.assessmentRecords.projectId, projectId),
          eq(schema.assessmentRecords.assetId, assetId)
        ),
        orderBy: schema.assessmentRecords.createdAt,
      });
      return records;
    })
  );

  // 按资产ID和测评项ID获取单条记录
  ipcMain.handle('assessment:getRecordByAssetAndItem', wrap(async (_event, projectId: string, assetId: string, itemId: string) => {
      const db = getDb();
      const records = await db.query.assessmentRecords.findMany({
        where: and(
          eq(schema.assessmentRecords.projectId, projectId),
          eq(schema.assessmentRecords.assetId, assetId),
          eq(schema.assessmentRecords.itemId, itemId)
        ),
        limit: 1,
      });
      return records[0] || null;
    })
  );

  // 按层面获取全局测评记录（assetId为空的记录）
  ipcMain.handle('assessment:getRecordsByDomain', wrap(async (_event, projectId: string, domain: string, projectLevel?: number, extensionType?: string | string[]) => {
      console.log(`[assessment:getRecordsByDomain] 调用参数: projectId=${projectId}, domain=${domain}, level=${projectLevel}, extension=${JSON.stringify(extensionType)}`);
      const db = getDb();

      // 从项目获取standardId
      const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      const standardId = project?.standardId || 'gb-t-22239-2019-l3';

      const conditions = [
        eq(schema.assessmentItems.standardId, standardId),
        eq(schema.assessmentItems.domain, domain)
      ];
      
      if (projectLevel) {
        conditions.push(lte(schema.assessmentItems.minLevel, projectLevel));
      }
      
      // 按扩展类型筛选：只显示通用要求或匹配的扩展要求
      const extTypes = extensionType
        ? (Array.isArray(extensionType) ? extensionType : [extensionType])
        : [];
      const extConditions = [eq(schema.assessmentItems.extensionType, 'general')];
      for (const ext of extTypes) {
        extConditions.push(eq(schema.assessmentItems.extensionType, ext));
      }
      const extOr = or(...extConditions);
      if (extOr) conditions.push(extOr);

      // 先获取该层面的所有测评项ID
      const items = await db.query.assessmentItems.findMany({
        where: and(...conditions),
        columns: { id: true },
      });

      console.log(`[assessment:getRecordsByDomain] 找到测评项: ${items.length} 个`);
      const itemIds = items.map(i => i.id);
      if (itemIds.length === 0) return [];

      // 获取这些测评项的全局记录（assetId为空或null）
      const records = await db.query.assessmentRecords.findMany({
        where: and(
          eq(schema.assessmentRecords.projectId, projectId),
          inArray(schema.assessmentRecords.itemId, itemIds),
          sql`(${schema.assessmentRecords.assetId} IS NULL OR ${schema.assessmentRecords.assetId} = '')`
        ),
      });

      console.log(`[assessment:getRecordsByDomain] 找到记录: ${records.length} 条`);
      return records;
    })
  );

  ipcMain.handle('assessment:saveRecord', wrap(async (_event, data: any) => {
      validateNotEmpty(data.projectId, '项目ID');
      validateNotEmpty(data.itemId, '测评项ID');
      if (data.result) {
        validateComplianceStatus(data.result);
      }
      if (data.evidence) {
        data.evidence = sanitizeInput(data.evidence, 5000);
      }
      if (data.findings) {
        data.findings = sanitizeInput(data.findings, 10000);
      }

      const db = getDb();
      const now = new Date().toISOString();

      if (data.id) {
        validateUuid(data.id, '记录ID');
        await db.update(schema.assessmentRecords)
          .set({ ...data, updatedAt: now })
          .where(eq(schema.assessmentRecords.id, data.id));

        const record = await db.query.assessmentRecords.findFirst({
          where: eq(schema.assessmentRecords.id, data.id),
        });
        return record;
      } else {
        const id = randomUUID();
        await db.insert(schema.assessmentRecords).values({
          ...data,
          id,
          createdAt: now,
          updatedAt: now,
        });

        const record = await db.query.assessmentRecords.findFirst({
          where: eq(schema.assessmentRecords.id, id),
        });
        return record;
      }
    })
  );

  ipcMain.handle('assessment:getProgress', wrap(async (_event, projectId: string, standardId: string) => {
      const db = getDb();

      const totalItems = await db
        .select({ value: count() })
        .from(schema.assessmentItems)
        .where(eq(schema.assessmentItems.standardId, standardId));

      const testedRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          sql`result NOT IN ('untested', '')`
        ));

      const compliantRecords = await db
        .select({ value: count() })
        .from(schema.assessmentRecords)
        .where(and(
          eq(schema.assessmentRecords.projectId, projectId),
          sql`result IN ('compliant', 'conform')`
        ));

      const total = totalItems[0]?.value || 0;
      const tested = testedRecords[0]?.value || 0;
      const compliant = compliantRecords[0]?.value || 0;
      const complianceRate = tested > 0 ? Math.round((compliant / tested) * 100) : 0;

      return {
        total,
        tested,
        compliant,
        complianceRate,
        untested: Math.max(0, total - tested),
      };
    })
  );

  // 获取安全域列表
  ipcMain.handle('assessment:listDomains', wrap(async (_event, standardId?: string) => {
      const db = getDb();
      const conditions = [];
      if (standardId) {
        conditions.push(eq(schema.assessmentItems.standardId, standardId));
      }

      const items = await db.query.assessmentItems.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        columns: { domain: true },
      });

      // 去重并统计
      const domainMap = new Map<string, number>();
      items.forEach((item) => {
        const count = domainMap.get(item.domain) || 0;
        domainMap.set(item.domain, count + 1);
      });

      return Array.from(domainMap.entries()).map(([name, count]) => ({
        id: name,
        name,
        count,
      }));
    })
  );

  // 根据资产类别获取适用的测评项
  ipcMain.handle('assessment:getItemsByCategory', wrap(async (_event, category: string, projectId?: string) => {
      const db = getDb();

      // 从项目获取standardId
      let standardId = 'gb-t-22239-2019-l3';
      if (projectId) {
        const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
        standardId = project?.standardId || standardId;
      }

      // 资产类别到安全域的映射
      const categoryDomainMap: Record<string, string[]> = {
        server_storage: ['secure_computing'],
        dbms: ['secure_computing'],
        network_device: ['secure_computing'],
        security_device: ['secure_computing'],
        business_app: ['secure_computing'],
        terminal: ['secure_computing'],
        management_platform: ['secure_computing'],
        machine_room: ['secure_physical'],
        data_resource: ['secure_computing'],
        network_boundary: ['secure_boundary'],
      };

      const domains = categoryDomainMap[category] || ['secure_computing'];

      const items = await db.query.assessmentItems.findMany({
        where: and(
          eq(schema.assessmentItems.standardId, standardId),
          inArray(schema.assessmentItems.domain, domains)
        ),
        orderBy: schema.assessmentItems.sortOrder,
      });

      return items.map((item) => ({
        ...item,
        isHighRisk: !!item.isHighRisk,
      }));
    })
  );

  ipcMain.handle('assessment:exportExcel', async (_event, projectId: string, domain?: string) => {
    try {
      const db = getDb();
      const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      if (!project) return { success: false, error: { message: '项目不存在' } };

      const DOMAIN_SHEETS = [
        { domain: 'secure_physical', sheetName: '安全物理环境' },
        { domain: 'secure_communication', sheetName: '安全通信网络' },
        { domain: 'secure_boundary', sheetName: '安全区域边界' },
        { domain: 'secure_computing', sheetName: '安全计算环境' },
        { domain: 'secure_management', sheetName: '安全管理中心' },
        { domain: 'security_management', sheetName: '安全管理制度' },
        { domain: 'security_organization', sheetName: '安全管理机构' },
        { domain: 'security_personnel', sheetName: '安全管理人员' },
        { domain: 'security_construction', sheetName: '安全建设管理' },
        { domain: 'security_maintenance', sheetName: '安全运维管理' },
      ];

      const EXTENSION_GROUPS = [
        { key: 'general', label: '安全通用要求' },
        { key: 'cloud', label: '云计算安全扩展要求' },
        { key: 'mobile', label: '移动互联安全扩展要求' },
        { key: 'iot', label: '物联网安全扩展要求' },
        { key: 'industrial', label: '工业控制系统安全扩展要求' },
        { key: 'bigdata', label: '大数据安全扩展要求（国标附录）' },
      ];

      // 解析项目扩展类型
      const EXT_TYPE_MAP: Record<string, string> = {
        '安全通用要求': 'general',
        '云计算安全扩展要求': 'cloud',
        '移动互联安全扩展要求': 'mobile',
        '物联网安全扩展要求': 'iot',
        '工业控制系统安全扩展要求': 'industrial',
        '大数据安全扩展要求': 'bigdata',
        '大数据安全扩展要求（国标附录）': 'bigdata',
        '关键信息基础设施安全扩展要求': 'cii',
      };
      const projectExtCodes1: string[] = [];
      if (project.extensionType) {
        for (const t of project.extensionType.split(',').filter(Boolean)) {
          const code = EXT_TYPE_MAP[t.trim()] || t.trim();
          if (!projectExtCodes1.includes(code)) projectExtCodes1.push(code);
        }
      }
      const activeExtGroups1 = EXTENSION_GROUPS.filter(g =>
        g.key === 'general' || projectExtCodes1.includes(g.key)
      );

      const resultMap: Record<string, string> = {
        compliant: '符合', conform: '符合', partial: '部分符合',
        non_compliant: '不符合', nonconform: '不符合',
        not_applicable: '不适用', na: '不适用', untested: '',
      };

      const records = await db.query.assessmentRecords.findMany({ where: eq(schema.assessmentRecords.projectId, projectId) });
      const recordMap = new Map<string, any>();
      records.forEach((r) => recordMap.set(r.itemId, r));

      const workbook = new ExcelJS.Workbook();
      const sheetsToExport = domain ? DOMAIN_SHEETS.filter(d => d.domain === domain) : DOMAIN_SHEETS;

      for (const { domain: domainKey, sheetName } of sheetsToExport) {
        // 构建扩展类型过滤条件
        const extOrConditions1 = [eq(schema.assessmentItems.extensionType, 'general')];
        for (const ext of projectExtCodes1) {
          extOrConditions1.push(eq(schema.assessmentItems.extensionType, ext));
        }
        const extOr = or(...extOrConditions1);
        const items = await db.query.assessmentItems.findMany({
          where: and(
            eq(schema.assessmentItems.domain, domainKey),
            eq(schema.assessmentItems.standardId, project.standardId),
            ...(extOr ? [extOr] : [])
          ),
          orderBy: schema.assessmentItems.sortOrder,
        });
        if (items.length === 0) continue;

        const sortedItems = [...items.filter(i => i.extensionType === 'general'), ...items.filter(i => i.extensionType !== 'general')];
        const worksheet = workbook.addWorksheet(sheetName.substring(0, 31));

        worksheet.columns = [
          { key: 'seq', width: 7 },
          { key: 'controlPoint', width: 20 },
          { key: 'requirement', width: 50 },
          { key: 'result', width: 80 },
          { key: 'compliance', width: 12 },
          { key: 'evidence', width: 30 },
        ];

        const headerRow = worksheet.addRow(['序号', '控制点', '控制项', '结果记录', '符合情况', '证据文件']);
        headerRow.eachCell((cell) => {
          styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
        });
        headerRow.height = 28;

        const dataColIndexes = [1, 2, 3, 4, 5, 6];
        let seqNo = 0;
        let dataRowIndex = 0;

        for (const extGroup of activeExtGroups1) {
          const extItems = sortedItems.filter(i => i.extensionType === extGroup.key);
          if (extItems.length === 0) continue;

          const extHeaderRow = worksheet.addRow([extGroup.label, '', '', '', '', '']);
          worksheet.mergeCells(`A${extHeaderRow.number}:F${extHeaderRow.number}`);
          extHeaderRow.eachCell((cell) => {
            styleCell(cell, { bold: true, fontSize: 11, fontColor: 'FF2E7D32', bgColor: 'FFE8F5E9', alignH: 'center', alignV: 'middle', border: 'thin' });
          });
          extHeaderRow.height = 22;

          const cpRanges: Array<{startRow: number; endRow: number}> = [];
          let cpRangeStart = worksheet.rowCount + 1;
          let prevCP2 = '';
          let lastDataRowNum = 0;

          for (const item of extItems) {
            seqNo++;
            const record = recordMap.get(item.id);
            const compliance = resultMap[record?.result || ''] || '';
            const findings = record?.findings || '';
            const evidence = record?.evidence || '';
            const resultRecord = findings || evidence;

            let allFilePaths: string[] = [];
            if (record?.screenshotPaths) {
              try {
                const parsed = JSON.parse(record.screenshotPaths);
                if (Array.isArray(parsed)) {
                  allFilePaths = parsed.filter((p: string) => fs.existsSync(p));
                }
              } catch {}
            }

            const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
            const imagePaths = allFilePaths.filter(p => imageExts.includes(path.extname(p).toLowerCase()));
            const nonImagePaths = allFilePaths.filter(p => !imageExts.includes(path.extname(p).toLowerCase()));

            const fileCountText = allFilePaths.length > 0 ? `${allFilePaths.length} 个文件` : '';
            const evidenceText = evidence || '';
            const col6Value = evidenceText + (fileCountText ? (evidenceText ? '\n' + fileCountText : fileCountText) : '');
            const dataRow = worksheet.addRow([
              seqNo, item.controlPoint, item.requirement, resultRecord, compliance, col6Value,
            ]);

            const newCP = item.controlPoint || '';
            if (newCP !== prevCP2) {
              if (prevCP2 && dataRow.number - 1 > cpRangeStart) {
                cpRanges.push({ startRow: cpRangeStart, endRow: dataRow.number - 1 });
              }
              cpRangeStart = dataRow.number;
              prevCP2 = newCP;
            }
            lastDataRowNum = dataRow.number;

            const maxImgHeight = 80;
            const padding = 4;
            const lineHeight = 14;
            let totalHeight = 0;

            if (imagePaths.length > 0) {
              totalHeight += imagePaths.length * (maxImgHeight + padding);
            }
            if (nonImagePaths.length > 0) {
              totalHeight += nonImagePaths.length * (lineHeight + 2);
            }

            const rowHeightPx = Math.max(60, totalHeight + 10);
            dataRow.height = rowHeightPx;

            if (imagePaths.length > 0) {
              imagePaths.forEach((imgPath, imgIdx) => {
                try {
                  const ext = path.extname(imgPath).toLowerCase().replace('.', '');
                  const excelExt = ext === 'jpg' ? 'jpeg' : ext;
                  
                  const colIndex = 5;
                  const rowOffset = imgIdx * ((maxImgHeight + padding) / rowHeightPx);
                  
                  const imageId = workbook.addImage({
                    filename: imgPath,
                    extension: excelExt as any,
                  });
                  worksheet.addImage(imageId, {
                    tl: { col: colIndex + (imgIdx > 0 ? imgIdx * 0.001 : 0), row: dataRow.number - 1 + rowOffset },
                    br: { col: colIndex + 0.98, row: dataRow.number - 1 + rowOffset + ((maxImgHeight) / rowHeightPx) },
                    editing: 'absolute',
                  } as any);
                } catch (imgError) {
                  log.warn(`插入图片失败: ${imgPath}`, imgError);
                }
              });
            }

            if (nonImagePaths.length > 0) {
              const evidenceCell = dataRow.getCell(6);
              const baseText = evidenceCell.value || '';
              
              let currentRowIdx = 0;
              nonImagePaths.forEach((p, idx) => {
                const fileName = p.split('\\').pop()?.split('/').pop() || p;
                const ext = path.extname(p).toLowerCase();
                const typeLabel = ext === 'pdf' ? 'PDF' : ext === 'doc' || ext === 'docx' ? 'Word' : ext === 'xls' || ext === 'xlsx' ? 'Excel' : ext === 'md' || ext === 'txt' ? '文本' : '文件';
                const displayText = `📎 ${typeLabel}: ${fileName}`;
                const fileUrl = 'file:///' + p.replace(/\\/g, '/');
                
                if (idx === 0 && baseText) {
                  evidenceCell.value = {
                    richText: [
                      { text: baseText + '\n', font: { size: 11 } },
                      { text: displayText, font: { size: 10, color: { argb: 'FF1565C0' }, underline: true }, hyperlink: fileUrl } as any,
                    ],
                  } as any;
                } else {
                  const prev = evidenceCell.value;
                  if (prev && typeof prev === 'object' && (prev as any).richText) {
                    (prev as any).richText.push({ text: displayText, font: { size: 10, color: { argb: 'FF1565C0' }, underline: true }, hyperlink: fileUrl } as any);
                    if (idx < nonImagePaths.length - 1) (prev as any).richText.push({ text: '\n' });
                    evidenceCell.value = prev as any;
                  } else {
                    evidenceCell.value = {
                      richText: [
                        idx === 0 ? { text: baseText, font: { size: 11 } } : null,
                        idx === 0 ? { text: '\n' } : null,
                        { text: displayText, font: { size: 10, color: { argb: 'FF1565C0' }, underline: true }, hyperlink: fileUrl } as any,
                      ].filter(Boolean),
                    } as any;
                  }
                }
                
                currentRowIdx++;
              });
              
              evidenceCell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left' };
            }

            const rowHeight = getRowMaxHeight(dataRow, dataColIndexes, worksheet);
            if (rowHeight > dataRow.height) {
              dataRow.height = rowHeight;
            }

            const isZebra = dataRowIndex % 2 === 1;
            const complianceColor = compliance === '符合' ? 'FF2E7D32' : compliance === '不符合' ? 'FFC62828' : compliance === '部分符合' ? 'FFF57F17' : null;

            dataRow.eachCell((cell, colNumber) => {
              if (colNumber === 6 && nonImagePaths.length > 0) return;
              styleCell(cell, {
                bgColor: isZebra ? 'FFF7F9FC' : undefined,
                alignH: colNumber === 1 ? 'center' : (colNumber === 5 ? 'center' : 'left'),
                alignV: 'middle',
                border: 'medium',
              });
              if (colNumber === 5 && complianceColor) {
                cell.font = { size: 11, bold: true, color: { argb: complianceColor } };
              }
            });
            dataRowIndex++;
          }

          if (prevCP2 && lastDataRowNum > cpRangeStart) {
            cpRanges.push({ startRow: cpRangeStart, endRow: lastDataRowNum });
          }
          for (const range of cpRanges) {
            worksheet.mergeCells(`B${range.startRow}:B${range.endRow}`);
            const cell = worksheet.getCell(`B${range.startRow}`);
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          }
        }
        worksheet.getRow(1).height = 28;
      }

      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const defaultFileName = `${project.name || '测评项目'}_现场核查记录表_${timestamp}.xlsx`;
      const saveResult = await dialog.showSaveDialog({
        title: '导出评估结果', defaultPath: defaultFileName, filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      if (saveResult.canceled || !saveResult.filePath) return { success: false, error: { message: '用户取消' } };

      await workbook.xlsx.writeFile(saveResult.filePath);
      return { success: true, data: { path: saveResult.filePath } };
    } catch (error: any) {
      log.error('导出评估记录失败:', error);
      return { success: false, error: { message: error.message || '导出失败' } };
    }
  });

  // 按资产和全局层面导出评估记录到Excel
  ipcMain.handle('assessment:exportExcelByAssets', async (_event, projectId: string, assetIds: string[], domainIds: string[]) => {
    try {
      const db = getDb();
      
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });
      
      if (!project) {
        throw new Error('项目不存在');
      }
      
      const DOMAIN_NAMES: Record<string, string> = {
        'secure_physical': '安全物理环境',
        'secure_communication': '安全通信网络',
        'secure_boundary': '安全区域边界',
        'secure_computing': '安全计算环境',
        'secure_management': '安全管理中心',
        'security_management': '安全管理制度',
        'security_organization': '安全管理机构',
        'security_personnel': '安全管理人员',
        'security_construction': '安全建设管理',
        'security_maintenance': '安全运维管理',
      };
      
      const EXTENSION_GROUPS = [
        { key: 'general', label: '安全通用要求' },
        { key: 'cloud', label: '云计算安全扩展要求' },
        { key: 'mobile', label: '移动互联安全扩展要求' },
        { key: 'iot', label: '物联网安全扩展要求' },
        { key: 'industrial', label: '工业控制系统安全扩展要求' },
        { key: 'bigdata', label: '大数据安全扩展要求（国标附录）' },
      ];
      
      // 解析项目扩展类型（中文逗号分隔字符串 -> 英文代码数组）
      const EXT_TYPE_MAP: Record<string, string> = {
        '安全通用要求': 'general',
        '云计算安全扩展要求': 'cloud',
        '移动互联安全扩展要求': 'mobile',
        '物联网安全扩展要求': 'iot',
        '工业控制系统安全扩展要求': 'industrial',
        '大数据安全扩展要求': 'bigdata',
        '大数据安全扩展要求（国标附录）': 'bigdata',
        '关键信息基础设施安全扩展要求': 'cii',
      };
      const projectExtCodes: string[] = [];
      if (project.extensionType) {
        for (const t of project.extensionType.split(',').filter(Boolean)) {
          const code = EXT_TYPE_MAP[t.trim()] || t.trim();
          if (!projectExtCodes.includes(code)) projectExtCodes.push(code);
        }
      }
      // 只导出项目选择的扩展分组
      const activeExtGroups = EXTENSION_GROUPS.filter(g =>
        g.key === 'general' || projectExtCodes.includes(g.key)
      );
      
      const resultMap: Record<string, string> = {
        'compliant': '符合',
        'conform': '符合',
        'partial': '部分符合',
        'non_compliant': '不符合',
        'nonconform': '不符合',
        'not_applicable': '不适用',
        'na': '不适用',
        'untested': '',
      };
      
      const CATEGORY_TO_DOMAIN: Record<string, string> = {
        'server_storage': 'secure_computing',
        'dbms': 'secure_computing',
        'network_device': 'secure_computing',
        'security_device': 'secure_computing',
        'business_app': 'secure_computing',
        'terminal': 'secure_computing',
        'management_platform': 'secure_computing',
        'machine_room': 'secure_physical',
        'data_resource': 'secure_computing',
        'network_boundary': 'secure_boundary',
        'data_category': 'secure_computing',
      };
      
      // 获取项目所有测评记录
      const allRecords = await db.query.assessmentRecords.findMany({
        where: eq(schema.assessmentRecords.projectId, projectId),
      });
      
      // 全局记录（assetId为空或null）
      const globalRecords = allRecords.filter(r => !r.assetId);
      const globalRecordMap = new Map<string, any>();
      globalRecords.forEach((record) => {
        globalRecordMap.set(record.itemId, record);
      });
      
      // 使用ExcelJS创建美观的Excel
      const workbook = new ExcelJS.Workbook();
      
      // 生成单个sheet的辅助函数
      async function addSheet(sheetName: string, domainKey: string, recordMap: Map<string, any>) {
        // 构建扩展类型过滤条件：通用要求 + 项目选择的扩展要求
        const extOrConditions = [eq(schema.assessmentItems.extensionType, 'general')];
        for (const ext of projectExtCodes) {
          extOrConditions.push(eq(schema.assessmentItems.extensionType, ext));
        }

        const extOr = or(...extOrConditions);
        const items = await db.query.assessmentItems.findMany({
          where: and(
            eq(schema.assessmentItems.standardId, project!.standardId),
            eq(schema.assessmentItems.domain, domainKey),
            ...(extOr ? [extOr] : [])
          ),
          orderBy: schema.assessmentItems.sortOrder,
        });
        if (items.length === 0) return;

        const sortedItems = [...items.filter(i => i.extensionType === 'general'), ...items.filter(i => i.extensionType !== 'general')];
        const worksheet = workbook.addWorksheet(sheetName.substring(0, 31));

        worksheet.columns = [
          { key: 'seq', width: 7 },
          { key: 'controlPoint', width: 20 },
          { key: 'requirement', width: 50 },
          { key: 'result', width: 80 },
          { key: 'compliance', width: 12 },
          { key: 'evidence', width: 25 },
        ];

        const headerRow = worksheet.addRow(['序号', '控制点', '控制项', '结果记录', '符合情况', '证据文件']);
        headerRow.eachCell((cell) => {
          styleCell(cell, { bold: true, fontSize: 12, fontColor: 'FFFFFFFF', bgColor: 'FF409EFF', alignH: 'center', alignV: 'middle', border: 'medium' });
        });
        headerRow.height = 28;

        const dataColIndexes = [1, 2, 3, 4, 5, 6];
        let seqNo = 0;
        let dataRowIndex = 0;

        for (const extGroup of activeExtGroups) {
          const extItems = sortedItems.filter(i => i.extensionType === extGroup.key);
          if (extItems.length === 0) continue;

          const extHeaderRow = worksheet.addRow([extGroup.label, '', '', '', '', '']);
          worksheet.mergeCells(`A${extHeaderRow.number}:F${extHeaderRow.number}`);
          extHeaderRow.eachCell((cell) => {
            styleCell(cell, { bold: true, fontSize: 11, fontColor: 'FF2E7D32', bgColor: 'FFE8F5E9', alignH: 'center', alignV: 'middle', border: 'thin' });
          });
          extHeaderRow.height = 22;

          const cpRanges: Array<{startRow: number; endRow: number}> = [];
          let cpRangeStart = worksheet.rowCount + 1;
          let prevCP2 = '';
          let lastDataRowNum = 0;

          for (const item of extItems) {
            seqNo++;
            const record = recordMap.get(item.id);
            const compliance = resultMap[record?.result || ''] || '';
            const findings = record?.findings || '';
            const evidence = record?.evidence || '';
            const resultRecord = findings || evidence;

            let allFilePaths: string[] = [];
            if (record?.screenshotPaths) {
              try {
                const parsed = JSON.parse(record.screenshotPaths);
                if (Array.isArray(parsed)) {
                  allFilePaths = parsed.filter((p: string) => fs.existsSync(p));
                }
              } catch {}
            }

            const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
            const imagePaths = allFilePaths.filter(p => imageExts.includes(path.extname(p).toLowerCase()));
            const nonImagePaths = allFilePaths.filter(p => !imageExts.includes(path.extname(p).toLowerCase()));

            const evidenceText = evidence || '';
            let col6Value: any = evidenceText || '';

            if (nonImagePaths.length > 0) {
              const richTextParts: any[] = [];
              if (evidenceText) {
                richTextParts.push({ text: evidenceText, font: { size: 11 } });
              }
              nonImagePaths.forEach((p, idx) => {
                if (idx > 0 || evidenceText) {
                  richTextParts.push({ text: '\n', font: { size: 11 } });
                }
                const fileName = p.split('\\').pop()?.split('/').pop() || p;
                const ext = path.extname(p).toLowerCase();
                const typeLabel = ext === '.pdf' ? 'PDF' : ext === '.doc' || ext === '.docx' ? 'Word' : ext === '.xls' || ext === '.xlsx' ? 'Excel' : ext === '.md' || ext === '.txt' ? '文本' : '文件';
                let fileUrl = '';
                try {
                  fileUrl = pathToFileURL(p).href;
                } catch {
                  fileUrl = 'file:///' + p.replace(/\\/g, '/');
                }
                richTextParts.push({
                  text: `📎 ${typeLabel}: ${fileName}`,
                  font: { size: 10, color: { argb: 'FF1565C0' }, underline: true },
                  hyperlink: fileUrl,
                });
              });
              if (imagePaths.length > 0) {
                richTextParts.push({ text: '\n', font: { size: 11 } });
                richTextParts.push({ text: `🖼️ ${imagePaths.length} 张图片`, font: { size: 10, color: { argb: 'FF6B7280' } } });
              }
              col6Value = { richText: richTextParts };
            } else if (imagePaths.length > 0) {
              col6Value = evidenceText + (evidenceText ? '\n' : '') + `🖼️ ${imagePaths.length} 张图片`;
            }

            const dataRow = worksheet.addRow([
              seqNo, item.controlPoint, item.requirement, resultRecord, compliance, col6Value,
            ]);

            const newCP = item.controlPoint || '';
            if (newCP !== prevCP2) {
              if (prevCP2 && dataRow.number - 1 > cpRangeStart) {
                cpRanges.push({ startRow: cpRangeStart, endRow: dataRow.number - 1 });
              }
              cpRangeStart = dataRow.number;
              prevCP2 = newCP;
            }
            lastDataRowNum = dataRow.number;

            const maxImgHeight = 80;
            const padding = 4;
            const lineHeight = 14;
            let totalHeight = 0;

            if (imagePaths.length > 0) {
              totalHeight += imagePaths.length * (maxImgHeight + padding);
            }
            if (nonImagePaths.length > 0) {
              totalHeight += nonImagePaths.length * (lineHeight + 2);
            }

            const rowHeightPx = Math.max(60, totalHeight + 10);
            dataRow.height = rowHeightPx;

            if (imagePaths.length > 0) {
              imagePaths.forEach((imgPath, imgIdx) => {
                try {
                  const ext = path.extname(imgPath).toLowerCase().replace('.', '');
                  const excelExt = ext === 'jpg' ? 'jpeg' : ext;
                  
                  const colIndex = 5;
                  const rowOffset = imgIdx * ((maxImgHeight + padding) / rowHeightPx);
                  
                  const imageId = workbook.addImage({
                    filename: imgPath,
                    extension: excelExt as any,
                  });
                  worksheet.addImage(imageId, {
                    tl: { col: colIndex + (imgIdx > 0 ? imgIdx * 0.001 : 0), row: dataRow.number - 1 + rowOffset },
                    br: { col: colIndex + 0.98, row: dataRow.number - 1 + rowOffset + ((maxImgHeight) / rowHeightPx) },
                    editing: 'absolute',
                  } as any);
                } catch (imgError) {
                  log.warn(`插入图片失败: ${imgPath}`, imgError);
                }
              });
            }

            if (nonImagePaths.length > 0) {
              const evidenceCell = dataRow.getCell(6);
              evidenceCell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left' };
              const pathList = nonImagePaths.map(p => `• ${p}`).join('\n');
              const imgInfo = imagePaths.length > 0 ? `\n\n[包含 ${imagePaths.length} 张嵌入图片]` : '';
              evidenceCell.note = {
                texts: [{ text: `文件路径（点击复制）：\n${pathList}${imgInfo}`, font: { size: 9 } }],
                margins: { inset: [0.1, 0.1, 0.1, 0.1] },
              };
            }

            const rowHeight = getRowMaxHeight(dataRow, dataColIndexes, worksheet);
            if (rowHeight > dataRow.height) {
              dataRow.height = rowHeight;
            }

            const isZebra = dataRowIndex % 2 === 1;
            const complianceColor = compliance === '符合' ? 'FF2E7D32' : compliance === '不符合' ? 'FFC62828' : compliance === '部分符合' ? 'FFF57F17' : null;

            dataRow.eachCell((cell, colNumber) => {
              if (colNumber === 6 && nonImagePaths.length > 0) return;
              styleCell(cell, {
                bgColor: isZebra ? 'FFF7F9FC' : undefined,
                alignH: colNumber === 1 ? 'center' : (colNumber === 5 ? 'center' : 'left'),
                alignV: 'middle',
                border: 'medium',
              });
              if (colNumber === 5 && complianceColor) {
                cell.font = { size: 11, bold: true, color: { argb: complianceColor } };
              }
            });
            dataRowIndex++;
          }

          if (prevCP2 && lastDataRowNum > cpRangeStart) {
            cpRanges.push({ startRow: cpRangeStart, endRow: lastDataRowNum });
          }
          for (const range of cpRanges) {
            worksheet.mergeCells(`B${range.startRow}:B${range.endRow}`);
            const cell = worksheet.getCell(`B${range.startRow}`);
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          }
        }
        worksheet.getRow(1).height = 28;
      }
      
      let assets: any[] = [];
      
      // 1. 导出全局测评层面
      if (domainIds && domainIds.length > 0) {
        for (const domainId of domainIds) {
          const sheetName = `${DOMAIN_NAMES[domainId] || domainId}_全局层面`;
          await addSheet(sheetName, domainId, globalRecordMap);
        }
      }
      
      // 2. 导出资产相关测评记录
      if (assetIds && assetIds.length > 0) {
        assets = await db.query.assets.findMany({
          where: inArray(schema.assets.id, assetIds),
        });
        
        // 按资产ID建立记录映射
        const assetRecordMaps = new Map<string, Map<string, any>>();
        for (const asset of assets) {
          const assetRecords = allRecords.filter(r => r.assetId === asset.id);
          const recordMap = new Map<string, any>();
          assetRecords.forEach(r => recordMap.set(r.itemId, r));
          assetRecordMaps.set(asset.id, recordMap);
        }
        
        for (const asset of assets) {
          const domainId = CATEGORY_TO_DOMAIN[asset.category] || 'secure_computing';
          const domainName = DOMAIN_NAMES[domainId] || domainId;
          let recordMap = assetRecordMaps.get(asset.id);
          if (!recordMap || recordMap.size === 0) {
            recordMap = globalRecordMap;
          }
          const sheetName = `${domainName}_${asset.name}`;
          await addSheet(sheetName, domainId, recordMap);
        }
      }
      
      // 检查是否有数据可导出
      if (workbook.worksheets.length === 0) {
        return { success: false, error: { message: '没有可导出的数据' } };
      }
      
      // 生成文件名（包含具体层面或资产名称）
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      let contentLabel = '现场核查记录表';
      
      if (domainIds && domainIds.length === 1) {
        contentLabel = `${DOMAIN_NAMES[domainIds[0]] || domainIds[0]}_全局层面`;
      } else if (domainIds && domainIds.length > 1) {
        contentLabel = `多层面_全局层面`;
      } else if (assetIds && assetIds.length === 1) {
        const asset = assets.find(a => a.id === assetIds[0]);
        const domainId = CATEGORY_TO_DOMAIN[asset?.category] || 'secure_computing';
        const domainName = DOMAIN_NAMES[domainId] || domainId;
        contentLabel = `${domainName}_${asset?.name || '资产'}`;
      } else if (assetIds && assetIds.length > 1) {
        contentLabel = `多资产_现场核查记录`;
      } else if (domainIds && domainIds.length > 0 && assetIds && assetIds.length > 0) {
        contentLabel = `混合内容_现场核查记录`;
      }
      
      const defaultFileName = `${project.name || '测评项目'}_${contentLabel}_${timestamp}.xlsx`;
      
      // 打开保存对话框
      const saveResult = await dialog.showSaveDialog({
        title: '导出评估结果',
        defaultPath: defaultFileName,
        filters: [{ name: 'Excel文件', extensions: ['xlsx'] }],
      });
      
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: { message: '用户取消' } };
      }
      
      // 写入文件
      await workbook.xlsx.writeFile(saveResult.filePath);
      
      return { success: true, data: { path: saveResult.filePath } };
    } catch (error: any) {
      log.error('按资产导出评估记录失败:', error);
      return { success: false, error: { message: error.message || '导出失败' } };
    }
  });

  // 导入评估记录
  ipcMain.handle('assessment:importExcel', wrap(async (_event, projectId: string, filePath: string, domainIds?: string[], assetIds?: string[]) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('文件不存在');
      }

      const db = getDb();

      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });
      if (!project) {
        throw new Error('项目不存在');
      }

      const workbook = XLSX.readFile(filePath);

      const DOMAIN_NAMES: Record<string, string> = {
        '安全物理环境': 'secure_physical',
        '安全通信网络': 'secure_communication',
        '安全区域边界': 'secure_boundary',
        '安全计算环境': 'secure_computing',
        '安全管理中心': 'secure_management',
        '安全管理制度': 'security_management',
        '安全管理机构': 'security_organization',
        '安全管理人员': 'security_personnel',
        '安全建设管理': 'security_construction',
        '安全运维管理': 'security_maintenance',
      };

      const resultMap: Record<string, string> = {
        '符合': 'conform',
        '部分符合': 'partial',
        '不符合': 'nonconform',
        '不适用': 'na',
        '待判定': 'untested',
        '': 'untested',
      };

      let totalCount = 0;
      const now = new Date().toISOString();

      const selectedDomainIds = domainIds && domainIds.length > 0 ? domainIds : null;
      const selectedAssetIds = assetIds && assetIds.length > 0 ? assetIds : null;
      const hasSelection = selectedDomainIds || selectedAssetIds;

      const excelDataMap = new Map<string, {result: string, resultRecord: string, evidence: string, assetId: string | null, domainKey: string}>();

      for (const sheetName of workbook.SheetNames) {
        let domainKey: string | null = null;
        let assetId: string | null = null;

        // 解析sheet名：{层面名}_{全局层面/资产名}
        for (const [baseName, dKey] of Object.entries(DOMAIN_NAMES)) {
          const prefix = baseName + '_';
          if (sheetName.startsWith(prefix)) {
            domainKey = dKey;
            const suffix = sheetName.substring(prefix.length).trim();

            if (suffix === '全局层面') {
              // 全局层面sheet
            } else {
              // 资产sheet
              const assetName = suffix;
              if (assetName) {
                const asset = await db.query.assets.findFirst({
                  where: and(
                    eq(schema.assets.projectId, projectId),
                    eq(schema.assets.name, assetName)
                  ),
                });
                if (asset) {
                  assetId = asset.id;
                } else {
                  const fuzzyAssets = await db.query.assets.findMany({
                    where: and(
                      eq(schema.assets.projectId, projectId),
                      like(schema.assets.name, `%${assetName}%`)
                    ),
                    limit: 1,
                  });
                  if (fuzzyAssets.length > 0) assetId = fuzzyAssets[0].id;
                }
              }
            }
            break;
          }
        }
        if (!domainKey) continue;

        // 过滤选中的内容
        if (hasSelection) {
          if (assetId) {
            // 资产sheet：检查资产是否在选中列表中
            if (selectedAssetIds && !selectedAssetIds.includes(assetId)) {
              continue;
            }
            // 如果只选了层面没选资产，且该层面未被选中，也跳过
            if (!selectedAssetIds && selectedDomainIds && !selectedDomainIds.includes(domainKey)) {
              continue;
            }
          } else {
            // 全局层面sheet：检查层面是否在选中的全局层面列表中
            if (selectedDomainIds && !selectedDomainIds.includes(domainKey)) {
              continue;
            }
            // 如果只选了资产没选层面，全局层面不导入
            if (!selectedDomainIds && selectedAssetIds) {
              continue;
            }
          }
        }

        const worksheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (rows.length === 0) continue;

        let lastControlPoint = '';

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;

          const colA = row[0] ? String(row[0]).trim() : '';
          const colB = row[1] ? String(row[1]).trim() : '';
          const colC = row[2] ? String(row[2]).trim() : '';
          const colD = row[3] ? String(row[3]).trim() : '';
          const colE = row[4] ? String(row[4]).trim() : '';
          const colF = row[5] ? String(row[5]).trim() : '';

          // 跳过扩展分组行（如"安全通用要求"、"云计算安全扩展要求"等）
          const extGroupLabels = ['安全通用要求', '云计算安全扩展要求', '移动互联安全扩展要求', '物联网安全扩展要求', '工业控制系统安全扩展要求', '大数据安全扩展要求'];
          if (colA && extGroupLabels.some(label => colA.includes(label))) {
            lastControlPoint = '';
            continue;
          }

          // 跳过非数据行（A列非数字）
          if (!colA || isNaN(parseInt(colA))) continue;

          // 控制点列合并处理：如果为空，使用上一个有效控制点名称
          const controlPoint = colB || lastControlPoint;
          if (colB) lastControlPoint = colB;

          const requirement = colC;
          if (!requirement) continue;

          const resultRecord = colD;
          const compliance = colE;
          const evidence = colF;
          
          const resultValue = resultMap[compliance] || 'untested';

          const key = `${domainKey}||${assetId || 'null'}||${controlPoint}||${requirement}`;
          excelDataMap.set(key, {
            result: resultValue,
            resultRecord,
            evidence,
            assetId,
            domainKey,
          });
        }
      }

      // 第二步：查询项目信息，建立扩展分组过滤
      const DOMAIN_SHEETS = [
        { domain: 'secure_physical', sheetName: '安全物理环境' },
        { domain: 'secure_communication', sheetName: '安全通信网络' },
        { domain: 'secure_boundary', sheetName: '安全区域边界' },
        { domain: 'secure_computing', sheetName: '安全计算环境' },
        { domain: 'secure_management', sheetName: '安全管理中心' },
        { domain: 'security_management', sheetName: '安全管理制度' },
        { domain: 'security_organization', sheetName: '安全管理机构' },
        { domain: 'security_personnel', sheetName: '安全管理人员' },
        { domain: 'security_construction', sheetName: '安全建设管理' },
        { domain: 'security_maintenance', sheetName: '安全运维管理' },
      ];

      const EXTENSION_GROUPS = [
        { key: 'general', label: '安全通用要求' },
        { key: 'cloud', label: '云计算安全扩展要求' },
        { key: 'mobile', label: '移动互联安全扩展要求' },
        { key: 'iot', label: '物联网安全扩展要求' },
        { key: 'industrial', label: '工业控制系统安全扩展要求' },
        { key: 'bigdata', label: '大数据安全扩展要求（国标附录）' },
      ];

      const EXT_TYPE_MAP: Record<string, string> = {
        '安全通用要求': 'general', '云计算安全扩展要求': 'cloud',
        '移动互联安全扩展要求': 'mobile', '物联网安全扩展要求': 'iot',
        '工业控制系统安全扩展要求': 'industrial',
        '大数据安全扩展要求': 'bigdata',
        '大数据安全扩展要求（国标附录）': 'bigdata',
        '关键信息基础设施安全扩展要求': 'cii',
      };

      const projectExtCodes: string[] = [];
      if (project.extensionType) {
        for (const t of project.extensionType.split(',').filter(Boolean)) {
          const code = EXT_TYPE_MAP[t.trim()] || t.trim();
          if (!projectExtCodes.includes(code)) projectExtCodes.push(code);
        }
      }
      const activeExtGroups = EXTENSION_GROUPS.filter(g => g.key === 'general' || projectExtCodes.includes(g.key));

      // 第三步：确定需要遍历的层面
      // 如果有选中的资产，需要包含这些资产所在的层面
      const CATEGORY_TO_DOMAIN_MAP: Record<string, string> = {
        machine_room: 'secure_physical',
        network_boundary: 'secure_boundary',
        network_device: 'secure_computing',
        security_device: 'secure_computing',
        server_storage: 'secure_computing',
        dbms: 'secure_computing',
        business_app: 'secure_computing',
        terminal: 'secure_computing',
        data_resource: 'secure_computing',
        management_platform: 'secure_computing',
      };

      let domainsToImport = DOMAIN_SHEETS;
      if (hasSelection) {
        const domainSet = new Set<string>();
        if (selectedDomainIds) {
          for (const d of selectedDomainIds) domainSet.add(d);
        }
        if (selectedAssetIds) {
          // 查询选中资产所属的层面（通过category映射）
          const assets = await db.query.assets.findMany({
            where: and(
              eq(schema.assets.projectId, projectId),
              inArray(schema.assets.id, selectedAssetIds)
            ),
            columns: { category: true }
          });
          for (const a of assets) {
            const domainId = CATEGORY_TO_DOMAIN_MAP[a.category] || 'secure_computing';
            domainSet.add(domainId);
          }
        }
        domainsToImport = DOMAIN_SHEETS.filter(d => domainSet.has(d.domain));
      }

      for (const { domain: domainKey } of domainsToImport) {
        const extOrConditions = [eq(schema.assessmentItems.extensionType, 'general')];
        for (const ext of projectExtCodes) extOrConditions.push(eq(schema.assessmentItems.extensionType, ext));
        const extOr = or(...extOrConditions);

        const items = await db.query.assessmentItems.findMany({
          where: and(
            eq(schema.assessmentItems.domain, domainKey),
            eq(schema.assessmentItems.standardId, project.standardId),
            extOr,
          ),
          orderBy: schema.assessmentItems.sortOrder,
        });
        if (items.length === 0) continue;

        const sortedItems = [...items.filter(i => i.extensionType === 'general'), ...items.filter(i => i.extensionType !== 'general')];

        // 第四步：按扩展分组遍历（与导出完全一致）
        for (const extGroup of activeExtGroups) {
          const extItems = sortedItems.filter(i => i.extensionType === extGroup.key);
          if (extItems.length === 0) continue;

          for (const item of extItems) {
            // 需要处理的目标列表：选中的资产 + 全局层面（如果选中）
            const targetAssetIds: Array<string | null> = [];
            
            if (selectedAssetIds && selectedAssetIds.length > 0) {
              targetAssetIds.push(...selectedAssetIds);
            }
            
            if (selectedDomainIds && selectedDomainIds.includes(domainKey)) {
              targetAssetIds.push(null);
            }
            
            if (!hasSelection) {
              targetAssetIds.push(null);
            }
            
            for (const targetAssetId of targetAssetIds) {
              const key = `${domainKey}||${targetAssetId || 'null'}||${item.controlPoint}||${item.requirement}`;
              const data = excelDataMap.get(key);
              
              if (!data) continue;
              if (!data.resultRecord && data.result === 'untested') continue;

              // 按选择过滤
              if (hasSelection) {
                if (data.assetId) {
                  if (selectedAssetIds && !selectedAssetIds.includes(data.assetId)) {
                    continue;
                  }
                } else {
                  if (!selectedDomainIds || !selectedDomainIds.includes(domainKey)) {
                    continue;
                  }
                }
              }

              const existingConditions = [
                eq(schema.assessmentRecords.projectId, projectId),
                eq(schema.assessmentRecords.itemId, item.id),
              ];
              if (data.assetId) {
                existingConditions.push(eq(schema.assessmentRecords.assetId, data.assetId));
              } else {
                existingConditions.push(sql`${schema.assessmentRecords.assetId} IS NULL`);
              }
              const existing = await db.query.assessmentRecords.findFirst({
                where: and(...existingConditions),
              });

              const recordData: any = {
                projectId,
                assetId: data.assetId,
                itemId: item.id,
                result: data.result || 'untested',
                method: 'check',
                commandOutput: '',
                evidence: data.evidence || '',
                findings: data.resultRecord || '',
                assessor: '',
                assessmentDate: now,
                updatedAt: now,
              };

              if (existing) {
                await db.update(schema.assessmentRecords)
                  .set(recordData)
                  .where(eq(schema.assessmentRecords.id, existing.id));
              } else {
                await db.insert(schema.assessmentRecords).values({
                  id: randomUUID(),
                  ...recordData,
                  createdAt: now,
                });
              }
              totalCount++;
            }
          }
        }
      }

      return { count: totalCount };
    } catch (error: any) {
      log.error('导入评估记录失败:', error);
      throw error;
    }
  }));
}