import { describe, expect, it } from 'vitest';
import {
  assignHistoryColumns,
  DEFAULT_DASHBOARD,
  historyLabel,
  scanDashboard,
  type DashboardLayout,
} from './dashboard.js';

// 追跡リストはシートそのもの。読み違えると測る対象を取り違えるし、
// 履歴の列わりあてを間違えると過去のデータに別のキーワードの値が混ざる。

const LAYOUT: DashboardLayout = { sheetName: 'SEO順位', ...DEFAULT_DASHBOARD };

// A列=キーワード, E列=ASIN の行を作る
const row = (keyword: string, asin: string) => [keyword, '', '', '', asin];

describe('scanDashboard', () => {
  it('キーワードとASINがそろった行を、行番号つきで拾う', () => {
    const { rows, skipped } = scanDashboard(
      [row('ミネラルウォーター 500ml', 'B0GVYMLPPC'), row('雑穀米', 'B0GMHRB752')],
      LAYOUT
    );
    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      { keyword: 'ミネラルウォーター 500ml', asin: 'B0GVYMLPPC', row: 4 },
      { keyword: '雑穀米', asin: 'B0GMHRB752', row: 5 },
    ]);
  });

  it('途中の空行は飛ばし、行番号はずれない', () => {
    const { rows, skipped } = scanDashboard([row('あ', 'B0AAAAAAAA'), [], row('い', 'B0BBBBBBBB')], LAYOUT);
    expect(skipped).toEqual([]);
    expect(rows.map((r) => r.row)).toEqual([4, 6]);
  });

  it('ASINは大文字に正規化し、前後の空白を落とす', () => {
    const { rows } = scanDashboard([row('  あ  ', ' b0aaaaaaaa ')], LAYOUT);
    expect(rows[0]).toMatchObject({ keyword: 'あ', asin: 'B0AAAAAAAA' });
  });

  it('書きかけの行は飛ばして、理由を報告する', () => {
    const { rows, skipped } = scanDashboard(
      [
        row('キーワードだけ', ''), // ASIN待ち
        row('', 'B0AAAAAAAA'), // キーワード待ち
        row('形式ちがい', '123'),
        row('ちゃんとした行', 'B0BBBBBBBB'),
      ],
      LAYOUT
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toBe(7);
    expect(skipped).toEqual([
      '4行目: 「キーワードだけ」のE列にASINが入っていません',
      '5行目: ASIN(B0AAAAAAAA)はありますが、A列のキーワードが空です',
      '6行目: 「形式ちがい」のASIN "123" は英数字10桁ではありません',
    ]);
  });

  it('列の位置を変えた設定にも従う', () => {
    const custom: DashboardLayout = { ...LAYOUT, startRow: 10, keywordColumn: 2, asinColumn: 3 };
    const { rows } = scanDashboard([['', '', 'あ', 'B0AAAAAAAA']], custom);
    expect(rows).toEqual([{ keyword: 'あ', asin: 'B0AAAAAAAA', row: 10 }]);
  });

  it('1件もなければ空で返す', () => {
    expect(scanDashboard([], LAYOUT)).toEqual({ rows: [], skipped: [] });
  });
});

describe('historyLabel', () => {
  const a = { keyword: '雑穀米', asin: 'B0AAAAAAAA' };
  const b = { keyword: '雑穀米', asin: 'B0BBBBBBBB' };
  const c = { keyword: '玄米', asin: 'B0CCCCCCCC' };

  it('キーワードが1つだけならキーワードそのもの', () => {
    expect(historyLabel(c, [a, c])).toBe('玄米');
  });

  it('同じキーワードを別のASINで追うときはASINを添えて区別する', () => {
    expect(historyLabel(a, [a, b, c])).toBe('雑穀米 (B0AAAAAAAA)');
    expect(historyLabel(b, [a, b, c])).toBe('雑穀米 (B0BBBBBBBB)');
  });
});

describe('assignHistoryColumns', () => {
  const targets = [
    { keyword: 'あ', asin: 'B0AAAAAAAA' },
    { keyword: 'い', asin: 'B0BBBBBBBB' },
  ];

  it('見出しに載っているキーワードは、その列をそのまま使う', () => {
    const header = ['日付', 'い', 'あ']; // わざと順番を入れ替えてある
    expect(assignHistoryColumns(header, targets, 0)).toEqual([
      { column: 2, label: 'あ', isNew: false },
      { column: 1, label: 'い', isNew: false },
    ]);
  });

  it('見出しに無いキーワードは右端に新しい列を作る', () => {
    const header = ['日付', 'あ'];
    expect(assignHistoryColumns(header, targets, 0)).toEqual([
      { column: 1, label: 'あ', isNew: false },
      { column: 2, label: 'い', isNew: true },
    ]);
  });

  it('見出しがまだ空でも、日付列を避けて割り当てる', () => {
    expect(assignHistoryColumns([], targets, 0)).toEqual([
      { column: 1, label: 'あ', isNew: true },
      { column: 2, label: 'い', isNew: true },
    ]);
  });

  it('日付列がA列でなくても、その列は使わない', () => {
    expect(assignHistoryColumns(['', '', '日付'], targets, 2).map((a) => a.column)).toEqual([3, 4]);
  });

  it('同じ列に2つのキーワードを割り当てない', () => {
    // 見出しに同じ文字が2つあっても、片方だけを使う
    const header = ['日付', 'あ', 'あ'];
    const got = assignHistoryColumns(header, [targets[0], { keyword: 'あ', asin: 'B0BBBBBBBB' }], 0);
    expect(new Set(got.map((g) => g.column)).size).toBe(2);
  });

  it('同名キーワードはASIN付きの見出しで別々の列になる', () => {
    const dup = [
      { keyword: '雑穀米', asin: 'B0AAAAAAAA' },
      { keyword: '雑穀米', asin: 'B0BBBBBBBB' },
    ];
    expect(assignHistoryColumns(['日付', '雑穀米 (B0BBBBBBBB)'], dup, 0)).toEqual([
      { column: 2, label: '雑穀米 (B0AAAAAAAA)', isNew: true },
      { column: 1, label: '雑穀米 (B0BBBBBBBB)', isNew: false },
    ]);
  });

  it('既存の見出しより右に空きがあっても、末尾から詰めていく', () => {
    const header = ['日付', 'あ', '', 'い']; // C列が空いている
    const got = assignHistoryColumns(header, [...targets, { keyword: 'う', asin: 'B0CCCCCCCC' }], 0);
    expect(got.map((g) => g.column)).toEqual([1, 3, 4]);
  });
});
