import 'dotenv/config';
import { dateKey, timeZone } from './day.js';
import { cellA1, findDateRow, layoutFromEnv, parseAsinRow, type AsinSlot } from './layout.js';
import {
  columnLetter,
  describeSheet,
  isSheetsConfigured,
  loadServiceAccount,
  readRange,
  SheetsConfigError,
  writeRanges,
  type SheetRange,
} from './sheets.js';
import { assertSpApiConfigured, fetchAsinCatalogBatch, SpApiConfigError } from './spapi.js';
import type { BsrRank, MarketplaceKey } from './types.js';

// ===== Amazon BSR → Googleスプレッドシート 日次バッチ =====
//
//   npm run collect --workspace=packages/bsr            通常実行
//   npm run collect --workspace=packages/bsr -- --force すでに値が入っていても上書き
//   npm run check   --workspace=packages/bsr            設定と接続の確認だけ（書き込みなし）
//
// 処理の流れ:
//   1. シートのASIN行を読んで、追跡対象のASINと列位置を得る
//   2. 日付列から今日の行を探す（無ければ末尾に追記する行番号を決める）
//   3. すでに値が入っているASINは飛ばして、残りをSP-APIに問い合わせる
//   4. 大カテゴリBSR・サブBSRをまとめて書き込む

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const CHECK_ONLY = args.includes('--check');

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || !v.trim()) {
    throw new SheetsConfigError(`.env に ${key} を設定してください。手順は docs/bsr-tracking.md を参照。`);
  }
  return v.trim();
}

// classificationRanks は複数返ることがあるので、最も順位の良いものを代表値にする
function best(ranks: BsrRank[], kind: BsrRank['kind']): BsrRank | undefined {
  return ranks.filter((r) => r.kind === kind).sort((a, b) => a.rank - b.rank)[0];
}

async function main(): Promise<number> {
  const target: SheetRange = {
    spreadsheetId: requireEnv('SPREADSHEET_ID'),
    sheetName: process.env.SHEET_NAME?.trim() || 'BSR',
  };
  const marketplace = (process.env.BSR_MARKETPLACE?.trim() || 'JP') as MarketplaceKey;
  const layout = layoutFromEnv();
  const today = dateKey();

  // --- 事前チェック ---
  const info = await describeSheet(target);
  console.log(`[bsr] スプレッドシート: ${info.title}  / シート: ${target.sheetName}`);
  if (!info.sheetExists) {
    console.error(`[bsr] シート「${target.sheetName}」が見つかりません。タブ名を確認してください。`);
    return 1;
  }

  // --- 1. ASIN行を読む ---
  const lastCol = columnLetter(layout.firstColumn + layout.colsPerAsin * 300);
  const asinRows = await readRange(target, `${cellA1(0, layout.asinRow)}:${lastCol}${layout.asinRow}`);
  const { slots, invalid } = parseAsinRow(asinRows[0] ?? [], layout);

  for (const bad of invalid) {
    console.warn(`[bsr] ASINとして読めないセルを飛ばしました → ${bad}`);
  }
  if (slots.length === 0) {
    console.error(
      `[bsr] 追跡対象のASINが1件もありません。` +
        `${target.sheetName}シートの${layout.asinRow}行目、${columnLetter(layout.firstColumn)}列から` +
        `${layout.colsPerAsin}列おきにASINを入れてください。`
    );
    return 1;
  }
  console.log(`[bsr] 追跡対象: ${slots.length}件 (${slots.map((s) => s.asin).join(', ')})`);

  if (CHECK_ONLY) {
    console.log('[bsr] --check のため、ここで終了します（書き込みなし）。');
    return 0;
  }

  // --- 2. 今日の行を探す ---
  const dateCol = columnLetter(layout.dateColumn);
  const dateValues = await readRange(target, `${dateCol}${layout.dataStartRow}:${dateCol}`);
  const { row, isNew } = findDateRow(dateValues, layout, today);
  console.log(`[bsr] ${today} → ${row}行目${isNew ? '（新規追加）' : '（既存の行に書き込み）'}`);

  // --- 3. すでに値が入っているASINを除く ---
  let existing: any[][] = [];
  if (!isNew && !FORCE) {
    const from = cellA1(layout.firstColumn, row);
    const to = `${columnLetter(layout.firstColumn + layout.colsPerAsin * slots.length)}${row}`;
    existing = await readRange(target, `${from}:${to}`);
  }
  const existingRow = existing[0] ?? [];
  const filled = (slot: AsinSlot) => {
    const v = existingRow[slot.colIndex - layout.firstColumn];
    return v != null && String(v).trim() !== '';
  };

  const targets = FORCE || isNew ? slots : slots.filter((s) => !filled(s));
  const skipped = slots.length - targets.length;
  if (targets.length === 0) {
    console.log(`[bsr] ${today} ぶんはすべて記入済みです（${skipped}件スキップ）。`);
    return 0;
  }

  // --- 4. SP-APIから取得して書き込む ---
  assertSpApiConfigured();
  const fetched = await fetchAsinCatalogBatch(targets.map((t) => ({ asin: t.asin, marketplace })));

  const updates: Array<{ a1: string; values: Array<Array<string | number | null>> }> = [];
  let ok = 0;
  let ng = 0;

  targets.forEach((slot, i) => {
    const res = fetched[i];
    if (res.error) {
      ng++;
      console.error(`[bsr] ${slot.asin}: ${res.error}`);
      return;
    }
    const ranks = res.result!.ranks;
    const dg = best(ranks, 'displayGroup');
    const sub = best(ranks, 'classification');
    if (!dg && !sub) {
      console.warn(`[bsr] ${slot.asin}: ランキング情報が返りませんでした（圏外の可能性）。`);
    }
    updates.push({
      a1: `${cellA1(slot.colIndex, row)}:${cellA1(slot.colIndex + 1, row)}`,
      values: [[dg?.rank ?? '', sub?.rank ?? '']],
    });
    ok++;
  });

  // 日付セル（新しい行なら書き込む）
  if (isNew) {
    updates.push({ a1: cellA1(layout.dateColumn, row), values: [[today]] });
  }
  // 見出し行が空なら「大カテゴリ / サブ」を入れておく（初回だけ効く）
  const labelUpdates = await buildLabelUpdates(target, layout, slots);
  updates.push(...labelUpdates);

  await writeRanges(target, updates);

  console.log(
    `[bsr] ${today} 完了: 成功${ok}件 / 失敗${ng}件 / スキップ${skipped}件 → ${target.sheetName}!${row}行目`
  );
  return ng > 0 ? 1 : 0;
}

// 各ASINの下（見出し行）が空なら「大カテゴリ」「サブ」を書く。
// すでに何か書いてあれば触らない（利用者が付けた見出しを壊さないため）。
async function buildLabelUpdates(
  target: SheetRange,
  layout: ReturnType<typeof layoutFromEnv>,
  slots: AsinSlot[]
): Promise<Array<{ a1: string; values: Array<Array<string>> }>> {
  if (layout.labelRow <= 0) return [];
  const lastCol = columnLetter(layout.firstColumn + layout.colsPerAsin * slots.length);
  const rows = await readRange(target, `${cellA1(0, layout.labelRow)}:${lastCol}${layout.labelRow}`);
  const current = rows[0] ?? [];
  const out: Array<{ a1: string; values: Array<Array<string>> }> = [];

  if (current[layout.dateColumn] == null || String(current[layout.dateColumn]).trim() === '') {
    out.push({ a1: cellA1(layout.dateColumn, layout.labelRow), values: [['日付']] });
  }
  for (const slot of slots) {
    const a = current[slot.colIndex];
    const b = current[slot.colIndex + 1];
    if ((a == null || String(a).trim() === '') && (b == null || String(b).trim() === '')) {
      out.push({
        a1: `${cellA1(slot.colIndex, layout.labelRow)}:${cellA1(slot.colIndex + 1, layout.labelRow)}`,
        values: [['大カテゴリ', 'サブ']],
      });
    }
  }
  return out;
}

// ---- 実行 ----
if (!isSheetsConfigured()) {
  console.error('[bsr] Googleスプレッドシートの設定が未完了です。docs/bsr-tracking.md を参照してください。');
  try {
    console.error(`[bsr] （サービスアカウント: ${loadServiceAccount().client_email}）`);
  } catch {
    /* キー自体が無い場合は何も出さない */
  }
  process.exitCode = 1;
} else {
  console.log(`[bsr] 集計日の基準タイムゾーン: ${timeZone()}`);
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      if (err instanceof SpApiConfigError || err instanceof SheetsConfigError) {
        console.error(`[bsr] ${err.message}`);
      } else {
        console.error('[bsr] エラー:', err instanceof Error ? err.message : err);
      }
      process.exitCode = 1;
    });
}
