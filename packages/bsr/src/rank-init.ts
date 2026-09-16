import 'dotenv/config';
import { cellA1 } from './layout.js';
import { loadRankConfig, RankConfigError, splitA1, type RankConfig } from './rank-config.js';
import {
  batchUpdate,
  columnLetter,
  ensureSheet,
  isSheetsConfigured,
  loadServiceAccount,
  readRange,
  SheetsConfigError,
  sheetIdOf,
  writeRanges,
} from './sheets.js';

// ===== 順位表シートの雛形づくり =====
//
//   npm run rank:init
//
// タブと見出しを用意します。最初に1回だけ実行すれば足ります。
// 何度実行しても安全です。**すでに何か入っているセルには一切触りません。**
//
// キーワードは、できあがったシートのA列に直接書いてください（このファイルには書きません）。
//
//        A            B        C       D      E       F     G
//   1  最終更新   2026-09-10 08:00
//   3  キーワード   現在順位  前日比   目標   ASIN    メモ   確認
//   4  ←ここから下に、キーワードとASINを書いていく

interface Update {
  a1: string;
  values: Array<Array<string | number>>;
}

// 空のセルにだけ書く。既存の記入を壊さないための共通処理。（row/col は0始まり）
function putIfBlank(updates: Update[], existing: any[][], row: number, col: number, value: string | number): void {
  const current = existing[row]?.[col];
  if (current != null && String(current).trim() !== '') return;
  updates.push({ a1: cellA1(col, row + 1), values: [[value]] });
}

async function buildDashboard(config: RankConfig): Promise<void> {
  const d = config.dashboard;
  const target = { spreadsheetId: config.spreadsheetId, sheetName: d.sheetName };

  const labels: Array<[number | null, string]> = [
    [d.keywordColumn, 'キーワード'],
    [d.rankColumn, '現在順位'],
    [d.diffColumn, '前日比'],
    [d.asinColumn, 'ASIN'],
    [d.linkColumn, '確認'],
  ];
  const lastCol = Math.max(...labels.map(([col]) => col ?? 0));
  const existing = await readRange(target, `A1:${columnLetter(lastCol)}${d.startRow}`);

  const updates: Update[] = [];

  // 「最終更新」の見出しを、日時セルの1つ左に置く
  if (config.updatedCell && config.updatedCell.sheetName === d.sheetName) {
    const u = splitA1(config.updatedCell.a1);
    if (u.col > 0) putIfBlank(updates, existing, u.row - 1, u.col - 1, '最終更新');
  }

  if (d.headerRow > 0) {
    for (const [col, label] of labels) {
      if (col != null) putIfBlank(updates, existing, d.headerRow - 1, col, label);
    }
    // 見出しの間の空き列（既定ではD列「目標」、F列「メモ」）にも名前を付けておく
    const named = new Set(labels.map(([col]) => col).filter((c): c is number => c != null));
    const spare = ['目標', 'メモ'];
    for (let col = 0; col <= lastCol && spare.length > 0; col++) {
      if (named.has(col)) continue;
      putIfBlank(updates, existing, d.headerRow - 1, col, spare.shift()!);
    }
  }

  await writeRanges(target, updates);
  if (d.headerRow > 0) {
    await styleSheet(config.spreadsheetId, d.sheetName, d.headerRow, 0, lastCol + 1);
  }
  console.log(
    `[init] ${d.sheetName}: 見出しを用意しました。` +
      `${d.startRow}行目以降の${columnLetter(d.keywordColumn)}列にキーワード、` +
      `${columnLetter(d.asinColumn)}列にASINを書いてください。`
  );
}

async function buildHistory(config: RankConfig): Promise<void> {
  const history = config.history!;
  const target = { spreadsheetId: config.spreadsheetId, sheetName: history.sheetName };
  const dateCol = columnLetter(history.dateColumn);

  const existing = await readRange(target, `A${history.headerRow}:${dateCol}${history.headerRow}`);
  const updates: Update[] = [];
  putIfBlank(updates, existing, 0, history.dateColumn, '日付');
  await writeRanges(target, updates);

  await styleSheet(config.spreadsheetId, history.sheetName, history.headerRow, history.dateColumn, 1);
  console.log(
    `[init] ${history.sheetName}: 見出しを用意しました。` +
      `キーワードごとの列は、バッチが実行時に自動で増やします。`
  );
}

// ---- 見た目を整える ----

async function styleSheet(
  spreadsheetId: string,
  sheetName: string,
  headerRow: number,
  firstCol: number,
  colCount: number
): Promise<void> {
  const sheetId = await sheetIdOf(spreadsheetId, sheetName);
  await batchUpdate(spreadsheetId, [
    // 見出し行を固定して、下にスクロールしても見えるようにする
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: headerRow } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // 見出しは太字＋薄いグレー背景
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: headerRow - 1,
          endRowIndex: headerRow,
          startColumnIndex: firstCol,
          endColumnIndex: firstCol + colCount,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
      },
    },
    // 1列目（キーワード / 日付）は幅を広めに
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: firstCol, endIndex: firstCol + 1 },
        properties: { pixelSize: 220 },
        fields: 'pixelSize',
      },
    },
  ]);
}

async function main(): Promise<number> {
  const config = loadRankConfig();

  const sheets = new Set([config.dashboard.sheetName]);
  if (config.updatedCell) sheets.add(config.updatedCell.sheetName);
  if (config.history) sheets.add(config.history.sheetName);

  for (const name of sheets) {
    const { created } = await ensureSheet(config.spreadsheetId, name);
    console.log(`[init] タブ「${name}」: ${created ? '新規作成しました' : 'すでにあります（そのまま使います）'}`);
  }

  await buildDashboard(config);
  if (config.history) await buildHistory(config);

  console.log('[init] 完了。キーワードを書いたら `npm run rank:check` で確認してください。');
  return 0;
}

// ---- 実行 ----
if (!isSheetsConfigured()) {
  console.error('[init] Googleスプレッドシートの設定が未完了です。docs/rank-tracking.md を参照してください。');
  try {
    console.error(`[init] （サービスアカウント: ${loadServiceAccount().client_email}）`);
  } catch {
    /* キー自体が無い場合は何も出さない */
  }
  process.exitCode = 1;
} else {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      if (err instanceof RankConfigError || err instanceof SheetsConfigError) {
        console.error(`[init] ${err.message}`);
      } else {
        console.error('[init] エラー:', err instanceof Error ? err.message : err);
      }
      process.exitCode = 1;
    });
}
