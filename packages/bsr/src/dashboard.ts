import { columnLetter } from './sheets.js';

// ===== 「SEO順位」タブ＝追跡リスト =====
//
// 追跡するキーワードは、PC上の設定ファイルではなく**シートそのもの**に書きます。
// BSRバッチで「1行目にASINを足せば追跡が始まる」のと同じ考え方です。
//
//        A                     B        C       D      E            F      G
//   3  キーワード            現在順位  前日比  目標   ASIN         メモ   確認
//   4  ミネラルウォーター 500ml    5      +2      3    B0GVYMLPPC   …     検索を開く
//   5  雑穀米                  圏外              30    B0GMHRB752   …     検索を開く
//   6  ★A列とE列を書き足すだけで、次回から追跡対象になる★
//
// A列（キーワード）とE列（ASIN）が両方そろっている行が対象です。
// B・C・G列はバッチが埋めるので、人が触る必要はありません。

export interface DashboardLayout {
  sheetName: string;
  headerRow: number; // 見出しの行（1始まり）
  startRow: number; // キーワードが始まる行
  keywordColumn: number; // 以下すべて0始まりの列番号
  rankColumn: number;
  diffColumn: number | null; // 前日比。null なら数式を入れない
  asinColumn: number;
  linkColumn: number | null; // 検索ページへのリンク。null なら入れない
}

export const DEFAULT_DASHBOARD: Omit<DashboardLayout, 'sheetName'> = {
  headerRow: 3,
  startRow: 4,
  keywordColumn: 0, // A
  rankColumn: 1, // B
  diffColumn: 2, // C
  asinColumn: 4, // E
  linkColumn: 6, // G
};

export interface DashboardRow {
  keyword: string;
  asin: string;
  row: number; // シート上の行番号（1始まり）
}

export interface DashboardScan {
  rows: DashboardRow[];
  skipped: string[]; // 書きかけ・書き間違いの行。処理は続けて警告だけ出す
}

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

// シートから読んだ値の並びを、追跡対象の一覧に変換する。
// values[0] が startRow の行に対応する（readRange で startRow から読む前提）。
export function scanDashboard(values: any[][], layout: DashboardLayout): DashboardScan {
  const rows: DashboardRow[] = [];
  const skipped: string[] = [];
  const cell = (row: any[] | undefined, col: number) => String(row?.[col] ?? '').trim();

  for (let i = 0; i < values.length; i++) {
    const rowNumber = layout.startRow + i;
    const keyword = cell(values[i], layout.keywordColumn);
    const asin = cell(values[i], layout.asinColumn).toUpperCase();

    if (keyword === '' && asin === '') continue; // 空行は黙って飛ばす

    const where = `${rowNumber}行目`;
    if (keyword === '') {
      skipped.push(`${where}: ASIN(${asin})はありますが、${columnLetter(layout.keywordColumn)}列のキーワードが空です`);
      continue;
    }
    if (asin === '') {
      skipped.push(`${where}: 「${keyword}」の${columnLetter(layout.asinColumn)}列にASINが入っていません`);
      continue;
    }
    if (!ASIN_PATTERN.test(asin)) {
      skipped.push(`${where}: 「${keyword}」のASIN "${asin}" は英数字10桁ではありません`);
      continue;
    }
    rows.push({ keyword, asin, row: rowNumber });
  }
  return { rows, skipped };
}

// ---- 履歴タブの列わりあて ----
//
// 履歴タブの見出し行（既定は1行目）に書かれたキーワードを手がかりに、
// 「このキーワードはこの列」と決めます。見出しに無いキーワード（＝新しく足された分）は
// 右端に新しい列を作って見出しを書きます。
//
// 列の位置ではなく見出しの文字で照合するので、**あとからシートの行を並べ替えても
// 過去のデータがずれません。**

// 同じキーワードを複数のASINで追う場合だけ、見出しにASINを添えて区別する。
// （ダッシュボードの前日比の数式も同じ規則で組み立てている）
export function historyLabel(target: { keyword: string; asin: string }, all: Array<{ keyword: string }>): string {
  const duplicated = all.filter((t) => t.keyword === target.keyword).length > 1;
  return duplicated ? `${target.keyword} (${target.asin})` : target.keyword;
}

export interface HistoryAssignment {
  column: number; // 0始まり
  label: string;
  isNew: boolean; // 見出しを書き足す必要があるか
}

export function assignHistoryColumns(
  headerValues: any[],
  targets: Array<{ keyword: string; asin: string }>,
  dateColumn: number
): HistoryAssignment[] {
  const header = headerValues.map((v) => String(v ?? '').trim());
  // 既存の見出しの右端。ここより右に新しい列を足していく
  let nextFree = Math.max(header.length, dateColumn + 1);
  const taken = new Set<number>([dateColumn]);

  return targets.map((target) => {
    const label = historyLabel(target, targets);
    const found = header.findIndex((text, i) => text === label && i !== dateColumn && !taken.has(i));
    if (found >= 0) {
      taken.add(found);
      return { column: found, label, isNew: false };
    }
    while (taken.has(nextFree)) nextFree++;
    taken.add(nextFree);
    return { column: nextFree++, label, isNew: true };
  });
}
