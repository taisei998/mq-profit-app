import { columnLetter, dateToSerial } from './sheets.js';

// ===== シートのレイアウト計算 =====
//
// 想定しているシートの形（既定値）:
//
//        A        |     B      C    |     D      E
//   1             |  B0ABC12345     |  B0XYZ98765      ← ASINを2列おきに書く
//   2   日付       | 大カテゴリ サブ  | 大カテゴリ サブ    ← 見出し（無ければ自動で書く）
//   3   2026-09-10|    333     1    |   1,717    12
//   4   2026-09-11|    405     1    |   1,321    13
//
// 行・列の開始位置は .env で変えられるようにしてあるので、
// 既存シートの途中から始めることもできます。

export interface Layout {
  asinRow: number; // ASINを書いている行（1始まり）
  labelRow: number; // 「大カテゴリ / サブ」の見出し行
  dataStartRow: number; // 日付データが始まる行
  firstColumn: number; // 最初のASINの列（0始まり。B列なら1）
  colsPerAsin: number; // 1ASINあたりの列数（大カテゴリ・サブで2）
  dateColumn: number; // 日付の列（0始まり。A列なら0）
}

export const DEFAULT_LAYOUT: Layout = {
  asinRow: 1,
  labelRow: 2,
  dataStartRow: 3,
  firstColumn: 1, // B列
  colsPerAsin: 2,
  dateColumn: 0, // A列
};

export function layoutFromEnv(): Layout {
  const num = (key: string, fallback: number) => {
    const v = process.env[key];
    if (v == null || v.trim() === '') return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`.env の ${key} は0以上の整数で指定してください（現在: ${v}）`);
    }
    return n;
  };
  const layout: Layout = {
    asinRow: num('SHEET_ASIN_ROW', DEFAULT_LAYOUT.asinRow),
    labelRow: num('SHEET_LABEL_ROW', DEFAULT_LAYOUT.labelRow),
    dataStartRow: num('SHEET_DATA_START_ROW', DEFAULT_LAYOUT.dataStartRow),
    firstColumn: num('SHEET_FIRST_COLUMN', DEFAULT_LAYOUT.firstColumn),
    colsPerAsin: DEFAULT_LAYOUT.colsPerAsin,
    dateColumn: num('SHEET_DATE_COLUMN', DEFAULT_LAYOUT.dateColumn),
  };
  if (layout.dataStartRow <= layout.asinRow) {
    throw new Error('.env の SHEET_DATA_START_ROW は SHEET_ASIN_ROW より下の行にしてください。');
  }
  return layout;
}

// ASIN行に並んだセルから、追跡対象のASINと、その列位置を取り出す。
// 2列で1組なので、1つめの列だけを見る（2つめは空のはず）。
export interface AsinSlot {
  asin: string;
  colIndex: number; // 大カテゴリBSRを書く列（0始まり）
}

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export function parseAsinRow(row: any[], layout: Layout): { slots: AsinSlot[]; invalid: string[] } {
  const slots: AsinSlot[] = [];
  const invalid: string[] = [];
  for (let col = layout.firstColumn; col < row.length; col += layout.colsPerAsin) {
    const raw = row[col];
    if (raw == null || String(raw).trim() === '') continue;
    const asin = String(raw).trim().toUpperCase();
    if (!ASIN_PATTERN.test(asin)) {
      invalid.push(`${columnLetter(col)}${layout.asinRow}: "${String(raw).trim()}"`);
      continue;
    }
    slots.push({ asin, colIndex: col });
  }
  return { slots, invalid };
}

// 日付列から、対象日の行番号を探す。無ければ「次に追記すべき行番号」を返す。
// 検索順位バッチの履歴タブからも使うので、必要な dataStartRow だけを受け取る。
export function findDateRow(
  dateColumnValues: any[][],
  layout: Pick<Layout, 'dataStartRow'>,
  ymd: string
): { row: number; isNew: boolean } {
  const serial = dateToSerial(ymd);
  let lastUsed = layout.dataStartRow - 1;

  for (let i = 0; i < dateColumnValues.length; i++) {
    const rowNumber = layout.dataStartRow + i;
    const cell = dateColumnValues[i]?.[0];
    if (cell == null || String(cell).trim() === '') continue;
    lastUsed = rowNumber;
    // 日付として入っていれば数値（シリアル値）、文字列で入っていれば文字列で比較
    if (typeof cell === 'number' ? Math.round(cell) === serial : String(cell).trim() === ymd) {
      return { row: rowNumber, isNew: false };
    }
  }
  return { row: lastUsed + 1, isNew: true };
}

export function cellA1(col: number, row: number): string {
  return `${columnLetter(col)}${row}`;
}
