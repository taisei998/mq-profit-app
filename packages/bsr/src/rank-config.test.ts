import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatCellRef, loadRankConfig, parseCellRef, RankConfigError, splitA1 } from './rank-config.js';

// 設定を読み違えると、関係ないセルを上書きしたり、履歴の列がずれたりする。
// 異常系は実行前に止めたいので、ここで固めておく。

describe('parseCellRef', () => {
  it('"シート名!セル" を分解する', () => {
    expect(parseCellRef('SEO順位!B1', '既定', 'x')).toEqual({ sheetName: 'SEO順位', a1: 'B1' });
  });

  it('シート名を省略したら既定のシート名を使う', () => {
    expect(parseCellRef('B1', '既定', 'x')).toEqual({ sheetName: '既定', a1: 'B1' });
  });

  it('スペースや記号を含むシート名はクォートで囲める', () => {
    expect(parseCellRef("'売上 集計'!AA10", '既定', 'x')).toEqual({ sheetName: '売上 集計', a1: 'AA10' });
    expect(parseCellRef("'It''s'!A1", '既定', 'x')).toEqual({ sheetName: "It's", a1: 'A1' });
  });

  it('シート名に!が含まれていても最後の!で切る', () => {
    expect(parseCellRef("'A!B'!C3", '既定', 'x')).toEqual({ sheetName: 'A!B', a1: 'C3' });
  });

  it('$付き・小文字の列名も受け付ける', () => {
    expect(parseCellRef('$b$2', '既定', 'x').a1).toBe('B2');
  });

  it('範囲指定や空欄は設定ミスとして止める', () => {
    for (const bad of ['SEO順位!B2:C3', 'SEO順位!B', '2', '', 'SEO順位!', '  ', 'SEO順位!B0', '!B2']) {
      expect(() => parseCellRef(bad, '既定', 'updatedCell')).toThrow(RankConfigError);
    }
  });
});

describe('formatCellRef / splitA1', () => {
  it('表示用に戻す・行と列に分ける', () => {
    expect(formatCellRef({ sheetName: 'SEO順位', a1: 'B1' })).toBe('SEO順位!B1');
    expect(splitA1('B1')).toEqual({ row: 1, col: 1 });
    expect(splitA1('AA12')).toEqual({ row: 12, col: 26 });
  });
});

describe('loadRankConfig', () => {
  let dir: string;
  const saved = { ...process.env };

  const write = (json: unknown) =>
    fs.writeFileSync(path.join(dir, 'rank-targets.json'), JSON.stringify(json), 'utf8');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-config-'));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('RANK_') || key === 'SPREADSHEET_ID') delete process.env[key];
    }
    process.env.SPREADSHEET_ID = 'FROM_ENV';
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  it('ほぼ空の設定でも、既定のシートの形で動く', () => {
    write({});
    const config = loadRankConfig(dir);
    expect(config.spreadsheetId).toBe('FROM_ENV');
    expect(config.dashboard).toEqual({
      sheetName: 'SEO順位',
      headerRow: 3,
      startRow: 4,
      keywordColumn: 0, // A
      rankColumn: 1, // B
      diffColumn: 2, // C
      asinColumn: 4, // E
      linkColumn: 6, // G
    });
    expect(config.history).toBeUndefined();
    expect(config).toMatchObject({
      kind: 'organic',
      maxPages: 1,
      notFoundText: '圏外',
      domain: 'www.amazon.co.jp',
      intervalMs: 15000,
      retryPauseMs: 120000,
    });
  });

  it('設定ファイルの spreadsheetId が .env より優先される', () => {
    write({ spreadsheetId: 'FROM_FILE' });
    expect(loadRankConfig(dir).spreadsheetId).toBe('FROM_FILE');
  });

  it('どちらにもスプレッドシートIDが無ければ止める', () => {
    delete process.env.SPREADSHEET_ID;
    write({});
    expect(() => loadRankConfig(dir)).toThrow(/スプレッドシート/);
  });

  it('ファイルが無いときは作り方を案内する', () => {
    expect(() => loadRankConfig(dir)).toThrow(/rank-targets.example.json/);
  });

  it('JSONとして壊れていれば止める', () => {
    fs.writeFileSync(path.join(dir, 'rank-targets.json'), '{ "sheet": }', 'utf8');
    expect(() => loadRankConfig(dir)).toThrow(/JSONとして読めません/);
  });

  it('.env で数え方・探索ページ数・圏外の表記を変えられる', () => {
    write({});
    Object.assign(process.env, {
      RANK_VALUE: 'overall',
      RANK_MAX_PAGES: '3',
      RANK_NOT_FOUND_TEXT: '-',
      RANK_DOMAIN: 'www.amazon.com',
      RANK_INTERVAL_MS: '0',
    });
    expect(loadRankConfig(dir)).toMatchObject({
      kind: 'overall',
      maxPages: 3,
      notFoundText: '-',
      domain: 'www.amazon.com',
      intervalMs: 0,
    });
  });

  it('RANK_VALUE に想定外の値が入っていれば止める', () => {
    write({});
    process.env.RANK_VALUE = 'natural';
    expect(() => loadRankConfig(dir)).toThrow(/organic/);
  });

  it('RANK_MAX_PAGES が数でなければ止める', () => {
    write({});
    process.env.RANK_MAX_PAGES = '0';
    expect(() => loadRankConfig(dir)).toThrow(/RANK_MAX_PAGES/);
  });
});

describe('loadRankConfig の layout', () => {
  let dir: string;
  const saved = { ...process.env };

  const write = (json: unknown) =>
    fs.writeFileSync(path.join(dir, 'rank-targets.json'), JSON.stringify(json), 'utf8');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-layout-'));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('RANK_') || key === 'SPREADSHEET_ID') delete process.env[key];
    }
    process.env.SPREADSHEET_ID = 'X';
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  it('列と行を自由に指定できる', () => {
    write({ sheet: '順位表', layout: { headerRow: 1, startRow: 2, keyword: 'C', rank: 'D', diff: 'E', asin: 'F', link: 'G' } });
    expect(loadRankConfig(dir).dashboard).toEqual({
      sheetName: '順位表',
      headerRow: 1,
      startRow: 2,
      keywordColumn: 2,
      rankColumn: 3,
      diffColumn: 4,
      asinColumn: 5,
      linkColumn: 6,
    });
  });

  it('diff と link は null にすると数式を入れない', () => {
    write({ layout: { diff: null, link: null } });
    const d = loadRankConfig(dir).dashboard;
    expect(d.diffColumn).toBeNull();
    expect(d.linkColumn).toBeNull();
  });

  it('2つの役割が同じ列を指していたら止める', () => {
    write({ layout: { rank: 'A' } }); // keyword も既定でA列
    expect(() => loadRankConfig(dir)).toThrow(/同じ列/);
  });

  it('見出し行がデータ開始行より下なら止める', () => {
    write({ layout: { headerRow: 5, startRow: 4 } });
    expect(() => loadRankConfig(dir)).toThrow(/layout.headerRow/);
  });

  it('列名として読めない指定は止める', () => {
    write({ layout: { keyword: '3' } });
    expect(() => loadRankConfig(dir)).toThrow(/列名/);
  });
});

describe('loadRankConfig の history', () => {
  let dir: string;
  const saved = { ...process.env };

  const write = (json: unknown) =>
    fs.writeFileSync(path.join(dir, 'rank-targets.json'), JSON.stringify(json), 'utf8');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-history-'));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('RANK_') || key === 'SPREADSHEET_ID') delete process.env[key];
    }
    process.env.SPREADSHEET_ID = 'X';
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  it('タブ名だけ書けば残りは既定値で埋まる', () => {
    write({ history: { sheet: 'SEO順位履歴' } });
    expect(loadRankConfig(dir).history).toEqual({
      sheetName: 'SEO順位履歴',
      dateColumn: 0,
      headerRow: 1,
      startRow: 2,
    });
  });

  it('タブ名を省略すると「（タブ名）履歴」になる', () => {
    write({ sheet: '順位表', history: {} });
    expect(loadRankConfig(dir).history?.sheetName).toBe('順位表履歴');
  });

  it('BSRタブのように見出しが下の行にある形も指定できる', () => {
    write({ history: { sheet: '履歴', headerRow: 4, startRow: 5, dateColumn: 'A' } });
    expect(loadRankConfig(dir).history).toEqual({
      sheetName: '履歴',
      dateColumn: 0,
      headerRow: 4,
      startRow: 5,
    });
  });

  it('見出し行がデータ開始行より下にあれば止める', () => {
    write({ history: { sheet: '履歴', headerRow: 5, startRow: 2 } });
    expect(() => loadRankConfig(dir)).toThrow(/history.headerRow/);
  });

  it('history がオブジェクトでなければ止める', () => {
    write({ history: 'SEO順位履歴' });
    expect(() => loadRankConfig(dir)).toThrow(/history は/);
  });
});
