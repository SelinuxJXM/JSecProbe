/**
 * 证据文件引用读回的回归测试。
 *
 * 现场核查页每次切换测评对象 / 全局层面都会整表重建行。曾出现「全局层面」分支
 * 把 screenshots 硬编码成 []，而资产分支正常读库 —— 于是全局层面上传的文件
 * 一离开再回来就看不见，紧接着的自动保存又把 screenshot_paths 写成 []，
 * 引用被抹掉后被孤儿文件清理当成垃圾删掉原件，变成不可逆丢失。
 *
 * 这里守住两件事：① 项目级与资产级记录必须走同一套读回逻辑；② 脏数据不炸页面。
 */
import { describe, it, expect } from 'vitest';
import {
  safeParseScreenshots,
  screenshotsFromRecord,
} from '../../src/views/onsite-verification/utils/screenshots';

describe('screenshotsFromRecord：重建表格行时把证据引用读回来', () => {
  it('项目级记录（assetId=null / 全局层面）带截图时必须读回', () => {
    const record = {
      id: 'r1',
      assetId: null,
      screenshotPaths: JSON.stringify(['screenshots/p1/itm-1/a.png']),
    };

    expect(screenshotsFromRecord(record)).toEqual(['screenshots/p1/itm-1/a.png']);
  });

  it('资产级记录带多个文件（含中文与绝对路径）时全部读回', () => {
    const paths = [
      'evidence/p1/itm-2/1783322101711_核查记录.txt',
      'C:\\Users\\tester\\JSecProbeData\\screenshots\\p1\\itm-2\\截图.png',
    ];
    const record = { id: 'r2', assetId: 'a1', screenshotPaths: JSON.stringify(paths) };

    expect(screenshotsFromRecord(record)).toEqual(paths);
  });

  it('项目级与资产级必须得到一致结果（防止某一视图再次漏读）', () => {
    const raw = JSON.stringify(['screenshots/p1/itm-3/x.png']);
    const globalRecord = { assetId: null, screenshotPaths: raw };
    const assetRecord = { assetId: 'a1', screenshotPaths: raw };

    expect(screenshotsFromRecord(globalRecord)).toEqual(screenshotsFromRecord(assetRecord));
    expect(screenshotsFromRecord(globalRecord)).toHaveLength(1);
  });

  it('记录不存在或 screenshotPaths 为空时返回空数组', () => {
    expect(screenshotsFromRecord(null)).toEqual([]);
    expect(screenshotsFromRecord(undefined)).toEqual([]);
    expect(screenshotsFromRecord({})).toEqual([]);
    expect(screenshotsFromRecord({ screenshotPaths: null })).toEqual([]);
    expect(screenshotsFromRecord({ screenshotPaths: '' })).toEqual([]);
    expect(screenshotsFromRecord({ screenshotPaths: '[]' })).toEqual([]);
  });
});

describe('safeParseScreenshots：历史脏数据不炸页面', () => {
  it('非法 JSON 降级为空数组', () => {
    expect(safeParseScreenshots('{not json')).toEqual([]);
    expect(safeParseScreenshots('undefined')).toEqual([]);
  });

  it('合法 JSON 但不是数组时降级为空数组', () => {
    expect(safeParseScreenshots('{"path":"a.png"}')).toEqual([]);
    expect(safeParseScreenshots('"a.png"')).toEqual([]);
    expect(safeParseScreenshots('null')).toEqual([]);
  });

  it('数组里的非字符串 / 空串元素被过滤，不把脏值当文件路径', () => {
    expect(safeParseScreenshots(JSON.stringify(['a.png', null, 3, '', 'b.pdf']))).toEqual([
      'a.png',
      'b.pdf',
    ]);
  });
});
