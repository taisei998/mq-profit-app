import 'dotenv/config';
import { assignHistoryColumns, scanDashboard, type DashboardRow } from './dashboard.js';
import { clockHHMM, dateKey, timeZone } from './day.js';
import { diffFormula, linkFormula } from './formulas.js';
import { cellA1, findDateRow } from './layout.js';
import { loadRankConfig, RankConfigError, type RankConfig } from './rank-config.js';
import {
  columnLetter,
  isSheetsConfigured,
  listSheetTitles,
  loadServiceAccount,
  readRange,
  SheetsConfigError,
  writeRanges,
  type SheetRange,
} from './sheets.js';
import {
  AmazonBlockedError,
  countOnPages,
  fetchSearchPage,
  findRank,
  searchUrl,
  type RankHit,
  type SearchPage,
} from './search.js';

// ===== Amazon 検索順位 → Googleスプレッドシート 日次バッチ =====
//
//   npm run rank:collect      通常実行（毎朝タスクスケジューラから呼ぶ）
//   npm run rank:check        取得だけして結果を表示（シートには書かない）
//
// 処理の流れ:
//   1. 「SEO順位」タブのA列（キーワード）とE列（ASIN）を読んで追跡リストを作る
//   2. キーワードごとに検索結果ページを取り、対象ASINが何番目かを数える
//   3. B列に順位を書く。前日比とリンクの数式が空の行には、ついでに数式も入れる
//   4. 履歴タブに今日の1行を追記する（新しいキーワードには新しい列を作る）

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Update {
  a1: string;
  values: Array<Array<string | number>>;
}

interface Outcome {
  target: DashboardRow;
  hit: RankHit | null;
  total: number; // 数えた母数（例: 48）
  error?: string;
}

async function measure(target: DashboardRow, config: RankConfig): Promise<Outcome> {
  const pages: SearchPage[] = [];
  try {
    for (let page = 1; page <= config.maxPages; page++) {
      pages.push(await fetchSearchPage(target.keyword, page, { domain: config.domain }));
      // 途中のページで見つかったら、それ以降は取りに行かない
      if (findRank(pages, target.asin, config.kind)) break;
      if (page < config.maxPages) await sleep(config.intervalMs);
    }
  } catch (err) {
    return { target, hit: null, total: 0, error: err instanceof Error ? err.message : String(err) };
  }
  return {
    target,
    hit: findRank(pages, target.asin, config.kind),
    total: countOnPages(pages, config.kind),
  };
}

// 間隔に±30%のばらつきを付ける。きっちり等間隔だと機械的なアクセスとみなされやすい。
function pace(ms: number): number {
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

// 全キーワードを1件ずつ間隔をあけて測る。
//
// Amazonは短時間に何度も叩くと503やCAPTCHAを返してきます。これは一時的なもので、
// 少し時間をおくと通ることがほとんどです。そこで1周したあと、落ちたキーワードだけ
// まとめて時間をおいてから1回だけやり直します。
// （1周目で7件落ちても、2周目でほぼ拾えるようにするのが狙い）
async function measureAll(targets: DashboardRow[], config: RankConfig): Promise<Outcome[]> {
  const report = (o: Outcome) => {
    const line = describe(o, config);
    if (o.error) console.error(`[rank] ${line}`);
    else console.log(`[rank] ${line}`);
  };

  const outcomes: Outcome[] = [];
  for (const [i, target] of targets.entries()) {
    if (i > 0) await sleep(pace(config.intervalMs));
    const outcome = await measure(target, config);
    outcomes.push(outcome);
    report(outcome);
  }

  const retryIndexes = outcomes.map((o, i) => (o.error ? i : -1)).filter((i) => i >= 0);
  if (retryIndexes.length === 0) return outcomes;

  console.log(
    `[rank] ${retryIndexes.length}件が取得できませんでした。` +
      `${Math.round(config.retryPauseMs / 1000)}秒おいてから、この${retryIndexes.length}件だけやり直します。`
  );
  await sleep(config.retryPauseMs);

  let recovered = 0;
  for (const [n, i] of retryIndexes.entries()) {
    if (n > 0) await sleep(pace(config.intervalMs));
    const retried = await measure(targets[i], config);
    if (retried.error) {
      console.error(`[rank] 再試行しても取得できませんでした: 「${targets[i].keyword}」`);
      continue;
    }
    outcomes[i] = retried;
    recovered++;
    report(retried);
  }
  console.log(`[rank] 再試行で${recovered}件を回収しました（残り${retryIndexes.length - recovered}件）。`);
  return outcomes;
}

function describe(outcome: Outcome, config: RankConfig): string {
  const { target, hit, total } = outcome;
  const head = `${target.row}行目「${target.keyword}」/ ${target.asin}`;
  if (outcome.error) return `${head}: 取得失敗 — ${outcome.error}`;
  if (!hit) {
    const scope = config.maxPages === 1 ? '1ページ目' : `${config.maxPages}ページ目まで`;
    return `${head}: ${scope}（${total}件）に見つかりませんでした → "${config.notFoundText}"`;
  }
  const kindLabel = config.kind === 'organic' ? 'オーガニック' : '広告含む表示順';
  const pageNote = hit.page > 1 ? `${hit.page}ページ目 ` : '';
  const adNote =
    config.kind === 'organic' && hit.position !== hit.value ? `（広告込みの見た目では${hit.position}番目）` : '';
  return `${head}: ${pageNote}${kindLabel} ${hit.value}位 / ${total}件中${adNote}`;
}

// 「SEO順位」タブを読んで追跡リストを作る
async function readTargets(config: RankConfig): Promise<DashboardRow[]> {
  const d = config.dashboard;
  const target: SheetRange = { spreadsheetId: config.spreadsheetId, sheetName: d.sheetName };
  const lastCol = columnLetter(Math.max(d.keywordColumn, d.asinColumn, d.rankColumn));
  const values = await readRange(target, `${cellA1(0, d.startRow)}:${lastCol}`);
  const { rows, skipped } = scanDashboard(values, d);

  for (const note of skipped) {
    console.warn(`[rank] 飛ばしました → ${note}`);
  }
  return rows;
}

async function main(): Promise<number> {
  const config = loadRankConfig();
  const d = config.dashboard;
  const today = dateKey();

  console.log(`[rank] 対象ドメイン: ${config.domain} / 順位の数え方: ${config.kind} / 探索範囲: ${config.maxPages}ページ`);

  // --- 書き込み先の確認 ---
  const book = await listSheetTitles(config.spreadsheetId);
  console.log(`[rank] スプレッドシート: ${book.title}`);
  const wanted = new Set([d.sheetName]);
  if (config.updatedCell) wanted.add(config.updatedCell.sheetName);
  if (config.history) wanted.add(config.history.sheetName);
  const missing = [...wanted].filter((name) => !book.sheets.includes(name));
  if (missing.length > 0) {
    console.error(
      `[rank] 次のタブが見つかりません: ${missing.join(', ')}\n` +
        `       このスプレッドシートにあるタブ: ${book.sheets.join(', ')}\n` +
        `       npm run rank:init で作れます。`
    );
    return 1;
  }

  // --- 1. 追跡リストを読む ---
  const targets = await readTargets(config);
  if (targets.length === 0) {
    console.error(
      `[rank] 追跡対象が1件もありません。「${d.sheetName}」タブの${d.startRow}行目以降に、` +
        `${columnLetter(d.keywordColumn)}列へキーワード、${columnLetter(d.asinColumn)}列へASINを入れてください。`
    );
    return 1;
  }
  console.log(`[rank] 追跡対象 ${targets.length}件（${d.sheetName}タブ ${d.startRow}行目以降）:`);
  for (const t of targets) {
    console.log(`       ${d.sheetName}!${cellA1(d.rankColumn, t.row)} ← 「${t.keyword}」/ ${t.asin}`);
  }

  // --- 2. 順位を測る ---
  const outcomes = await measureAll(targets, config);
  const failed = outcomes.filter((o) => o.error);

  if (CHECK_ONLY) {
    console.log('[rank] --check のため、ここで終了します（書き込みなし）。');
    console.log(`[rank] 確認用URL: ${searchUrl(targets[0].keyword, 1, config.domain)}`);
    return failed.length > 0 ? 1 : 0;
  }

  // --- 3. 「SEO順位」タブに書く ---
  // 取得できなかったキーワードのセルは触らない（前日の値を消してしまわないため）。
  const dashboardTarget: SheetRange = { spreadsheetId: config.spreadsheetId, sheetName: d.sheetName };
  const updates: Update[] = [];
  for (const o of outcomes) {
    if (o.error) continue;
    updates.push({
      a1: cellA1(d.rankColumn, o.target.row),
      values: [[o.hit ? o.hit.value : config.notFoundText]],
    });
  }
  updates.push(...(await fillFormulas(config, targets)));

  // 最終更新セル。一部だけ失敗したときに「全部取れた」と誤解されないよう、
  // 失敗件数も一緒に書く（この誤解が実際に起きたため）。
  if (config.updatedCell && outcomes.some((o) => !o.error)) {
    const stamp =
      failed.length === 0
        ? `${today} ${clockHHMM()}`
        : `${today} ${clockHHMM()}（${outcomes.length}件中${failed.length}件が取得失敗）`;
    if (config.updatedCell.sheetName === d.sheetName) {
      updates.push({ a1: config.updatedCell.a1, values: [[stamp]] });
    } else {
      await writeRanges({ spreadsheetId: config.spreadsheetId, sheetName: config.updatedCell.sheetName }, [
        { a1: config.updatedCell.a1, values: [[stamp]] },
      ]);
    }
  }
  await writeRanges(dashboardTarget, updates);

  // --- 4. 履歴タブに追記する ---
  if (config.history) {
    await appendHistory(config, outcomes, today);
  }

  const written = outcomes.length - failed.length;
  console.log(`[rank] ${today} 完了: 書き込み${written}件 / 取得失敗${failed.length}件`);
  if (failed.length > 0) {
    console.error('[rank] 失敗したキーワードのセルは前回の値のまま残してあります。');
  }
  return failed.length > 0 ? 1 : 0;
}

// 前日比・確認リンクの数式が空の行に入れる。
// 新しいキーワードを1行足したとき、人が数式をコピーしなくて済むようにするため。
// すでに何か入っている行には触らない。
async function fillFormulas(config: RankConfig, targets: DashboardRow[]): Promise<Update[]> {
  const d = config.dashboard;
  const columns = [
    config.history && d.diffColumn != null ? { col: d.diffColumn, make: diffFormula } : null,
    d.linkColumn != null ? { col: d.linkColumn, make: linkFormula } : null,
  ].filter((x): x is { col: number; make: (c: RankConfig, row: number) => string } => x != null);
  if (columns.length === 0) return [];

  const target: SheetRange = { spreadsheetId: config.spreadsheetId, sheetName: d.sheetName };
  const from = Math.min(...columns.map((c) => c.col));
  const to = Math.max(...columns.map((c) => c.col));
  const lastRow = Math.max(...targets.map((t) => t.row));
  const existing = await readRange(target, `${cellA1(from, d.startRow)}:${cellA1(to, lastRow)}`);

  const updates: Update[] = [];
  for (const t of targets) {
    const row = existing[t.row - d.startRow] ?? [];
    for (const { col, make } of columns) {
      const current = row[col - from];
      if (current != null && String(current).trim() !== '') continue;
      updates.push({ a1: cellA1(col, t.row), values: [[make(config, t.row)]] });
    }
  }
  if (updates.length > 0) {
    console.log(`[rank] 数式を${updates.length}セルに補いました（新しく追加された行のぶん）。`);
  }
  return updates;
}

// 履歴タブに今日の1行を書く。BSRタブと同じで、日付列を上から見て
// 今日の行があればそこに、無ければ末尾に追記する（1日1行）。
// 見出しに無いキーワードは、右端に新しい列を作って見出しごと書く。
async function appendHistory(config: RankConfig, outcomes: Outcome[], today: string): Promise<void> {
  const history = config.history!;
  const target: SheetRange = { spreadsheetId: config.spreadsheetId, sheetName: history.sheetName };
  const dateCol = columnLetter(history.dateColumn);

  const headerValues = (await readRange(target, `${history.headerRow}:${history.headerRow}`))[0] ?? [];
  const assignments = assignHistoryColumns(
    headerValues,
    outcomes.map((o) => o.target),
    history.dateColumn
  );

  const dateValues = await readRange(target, `${dateCol}${history.startRow}:${dateCol}`);
  const { row, isNew } = findDateRow(dateValues, { dataStartRow: history.startRow }, today);

  const updates: Update[] = [];
  if (isNew) updates.push({ a1: cellA1(history.dateColumn, row), values: [[today]] });
  if (
    headerValues[history.dateColumn] == null ||
    String(headerValues[history.dateColumn]).trim() === ''
  ) {
    updates.push({ a1: cellA1(history.dateColumn, history.headerRow), values: [['日付']] });
  }

  const added: string[] = [];
  outcomes.forEach((o, i) => {
    const slot = assignments[i];
    if (slot.isNew) {
      updates.push({ a1: cellA1(slot.column, history.headerRow), values: [[slot.label]] });
      added.push(`${columnLetter(slot.column)}列=${slot.label}`);
    }
    if (o.error) return;
    updates.push({
      a1: cellA1(slot.column, row),
      values: [[o.hit ? o.hit.value : config.notFoundText]],
    });
  });

  await writeRanges(target, updates);
  if (added.length > 0) {
    console.log(`[rank] 履歴に新しい列を作りました: ${added.join(', ')}`);
  }
  console.log(`[rank] 履歴: ${history.sheetName}!${row}行目に${isNew ? '追記' : '上書き'}しました。`);
}

// ---- 実行 ----
if (!isSheetsConfigured()) {
  console.error('[rank] Googleスプレッドシートの設定が未完了です。docs/rank-tracking.md を参照してください。');
  try {
    console.error(`[rank] （サービスアカウント: ${loadServiceAccount().client_email}）`);
  } catch {
    /* キー自体が無い場合は何も出さない */
  }
  process.exitCode = 1;
} else {
  console.log(`[rank] 基準タイムゾーン: ${timeZone()}`);
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      if (err instanceof RankConfigError || err instanceof SheetsConfigError || err instanceof AmazonBlockedError) {
        console.error(`[rank] ${err.message}`);
      } else {
        console.error('[rank] エラー:', err instanceof Error ? err.message : err);
      }
      process.exitCode = 1;
    });
}
