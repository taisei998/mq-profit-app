import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, cellA1, findDateRow, parseAsinRow } from './layout.js';
import { columnLetter, dateToSerial, serialToDate } from './sheets.js';

// シートのどのセルに書くかを決める計算。ここを間違えると別の商品の列を
// 上書きしてしまうため、境界も含めて固めておく。

describe('columnLetter', () => {
  it('0始まりの列番号をA1記法の列名に変換する', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(1)).toBe('B');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
    expect(columnLetter(701)).toBe('ZZ');
    expect(columnLetter(702)).toBe('AAA');
  });
});

describe('日付シリアル値', () => {
  it('スプレッドシートの内部表現と相互変換できる', () => {
    // 1900-01-01 は Google/Excel ともにシリアル値 2
    expect(dateToSerial('1900-01-01')).toBe(2);
    expect(dateToSerial('2026-09-10')).toBe(46275);
    expect(serialToDate(46275)).toBe('2026-09-10');
    expect(serialToDate(dateToSerial('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('parseAsinRow', () => {
  const L = DEFAULT_LAYOUT; // ASIN行=1, B列から2列おき

  it('2列おきに並んだASINと列位置を取り出す', () => {
    const row = ['', 'B0ABC12345', '', 'B0XYZ98765', '', 'B00PGZP0NQ', ''];
    const { slots, invalid } = parseAsinRow(row, L);
    expect(invalid).toEqual([]);
    expect(slots).toEqual([
      { asin: 'B0ABC12345', colIndex: 1 },
      { asin: 'B0XYZ98765', colIndex: 3 },
      { asin: 'B00PGZP0NQ', colIndex: 5 },
    ]);
  });

  it('小文字で書かれていても大文字に揃える', () => {
    const { slots } = parseAsinRow(['', 'b0abc12345'], L);
    expect(slots[0].asin).toBe('B0ABC12345');
  });

  it('途中の空セルは飛ばして、後ろのASINも拾う', () => {
    const row = ['', '', '', 'B0XYZ98765'];
    const { slots } = parseAsinRow(row, L);
    expect(slots).toEqual([{ asin: 'B0XYZ98765', colIndex: 3 }]);
  });

  it('ASINの形をしていないセルは無効として位置つきで報告する', () => {
    const row = ['', 'メモ', '', 'B0XYZ98765'];
    const { slots, invalid } = parseAsinRow(row, L);
    expect(slots).toEqual([{ asin: 'B0XYZ98765', colIndex: 3 }]);
    expect(invalid).toEqual(['B1: "メモ"']);
  });

  it('2列目（サブ側）に書かれた値はASINとして拾わない', () => {
    // C列は「サブ」の値の列なので、ここを走査対象にしてはいけない
    const row = ['', 'B0ABC12345', 'B0XYZ98765'];
    const { slots } = parseAsinRow(row, L);
    expect(slots).toEqual([{ asin: 'B0ABC12345', colIndex: 1 }]);
  });

  it('日付列（A列）のヘッダー文字列は無視する', () => {
    const row = ['日付', 'B0ABC12345'];
    const { slots, invalid } = parseAsinRow(row, L);
    expect(slots).toEqual([{ asin: 'B0ABC12345', colIndex: 1 }]);
    expect(invalid).toEqual([]);
  });
});

describe('findDateRow', () => {
  const L = DEFAULT_LAYOUT; // データ開始=3行目

  it('日付がシリアル値で入っている既存行を見つける', () => {
    const col = [[dateToSerial('2026-09-08')], [dateToSerial('2026-09-09')], [dateToSerial('2026-09-10')]];
    expect(findDateRow(col, L, '2026-09-10')).toEqual({ row: 5, isNew: false });
    expect(findDateRow(col, L, '2026-09-08')).toEqual({ row: 3, isNew: false });
  });

  it('日付が文字列で入っていても見つける', () => {
    const col = [['2026-09-08'], ['2026-09-09']];
    expect(findDateRow(col, L, '2026-09-09')).toEqual({ row: 4, isNew: false });
  });

  it('無ければ最後に使われた行の次を返す', () => {
    const col = [[dateToSerial('2026-09-08')], [dateToSerial('2026-09-09')]];
    expect(findDateRow(col, L, '2026-09-10')).toEqual({ row: 5, isNew: true });
  });

  it('1行もなければデータ開始行を返す', () => {
    expect(findDateRow([], L, '2026-09-10')).toEqual({ row: 3, isNew: true });
  });

  it('途中の空行は詰めず、実際に埋まっている最後の行の次に追記する', () => {
    // 3行目=9/08、4行目=空、5行目=9/09、6行目=空 → 追記先は6行目
    const col = [[dateToSerial('2026-09-08')], [], [dateToSerial('2026-09-09')], []];
    expect(findDateRow(col, L, '2026-09-11')).toEqual({ row: 6, isNew: true });
  });

  it('小数のシリアル値（時刻つき）でも同じ日付として扱う', () => {
    const col = [[dateToSerial('2026-09-10') + 0.4]];
    expect(findDateRow(col, L, '2026-09-10')).toEqual({ row: 3, isNew: false });
  });
});

describe('cellA1', () => {
  it('列番号と行番号からセル参照を作る', () => {
    expect(cellA1(0, 1)).toBe('A1');
    expect(cellA1(1, 3)).toBe('B3');
    expect(cellA1(26, 10)).toBe('AA10');
  });
});
