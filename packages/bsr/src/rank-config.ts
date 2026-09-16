import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DASHBOARD, type DashboardLayout } from './dashboard.js';
import type { RankKind } from './search.js';
import { columnIndex } from './sheets.js';

// ===== 検索順位バッチの設定（rank-targets.json）=====
//
// **追跡するキーワードはここには書きません。**「SEO順位」タブのA列とE列が追跡リストです。
// このファイルには「どのスプレッドシートの、どのタブの、どの列を使うか」だけを書きます。
// 一度決めたらほとんど触りません。
//
//   {
//     "spreadsheetId": "1AbC...",           ← 省略すると .env の SPREADSHEET_ID を使う
//     "sheet": "SEO順位",                    ← 追跡リスト兼・現在順位の表
//     "updatedCell": "SEO順位!B1",           ← 省略可。実行日時をここに書く
//     "history": { "sheet": "SEO順位履歴" }   ← 省略可。日付で1行ずつ増える履歴
//   }

export class RankConfigError extends Error {}

export interface CellRef {
  sheetName: string;
  a1: string; // "B2" のような単一セル
}

// 日付で1行ずつ増えていく履歴タブの形。BSRタブと同じ考え方。
export interface HistoryLayout {
  sheetName: string;
  dateColumn: number; // 0始まり。既定はA列
  headerRow: number; // キーワード名が並ぶ行。ここを手がかりに列を決める
  startRow: number; // 日付データが始まる行
}

export interface RankConfig {
  spreadsheetId: string;
  dashboard: DashboardLayout;
  updatedCell?: CellRef;
  history?: HistoryLayout;
  // 以下は .env 由来
  kind: RankKind;
  maxPages: number;
  notFoundText: string;
  domain: string;
  intervalMs: number; // キーワード1件ごとの待ち時間
  retryPauseMs: number; // 1周したあと、失敗ぶんをやり直すまでの待ち時間
}

const SINGLE_CELL = /^\$?[A-Z]{1,3}\$?[1-9]\d*$/;

// "SEO順位!B2" / "'売上 集計'!B2" / "B2" のいずれも受け付ける
export function parseCellRef(raw: unknown, defaultSheet: string, where: string): CellRef {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new RankConfigError(`${where}: セルは "SEO順位!B1" の形式で指定してください。`);
  }
  const text = raw.trim();
  const bang = text.lastIndexOf('!');
  let sheetName = defaultSheet;
  let a1 = text;

  if (bang >= 0) {
    sheetName = text.slice(0, bang).trim();
    a1 = text.slice(bang + 1).trim();
    // 'シート名' のようにクォートされていれば外す
    if (sheetName.startsWith("'") && sheetName.endsWith("'") && sheetName.length >= 2) {
      sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
    }
    if (sheetName === '') {
      throw new RankConfigError(`${where}: "${text}" のシート名が空です。`);
    }
  }
  a1 = a1.replace(/\$/g, '').toUpperCase();
  if (!SINGLE_CELL.test(a1)) {
    throw new RankConfigError(`${where}: "${text}" は単一セルで指定してください（範囲指定は不可）。`);
  }
  return { sheetName, a1 };
}

export function formatCellRef(cell: CellRef): string {
  return `${cell.sheetName}!${cell.a1}`;
}

// A1表記のセルを行番号（1始まり）と列番号（0始まり）に分ける
export function splitA1(a1: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(a1);
  if (!m) throw new RankConfigError(`セルの指定が読めません: ${a1}`);
  return { row: Number(m[2]), col: columnIndex(m[1]) };
}

function intOf(raw: unknown, key: string, fallback: number, min: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new RankConfigError(`${key} は${min}以上の整数で指定してください（現在: ${String(raw)}）`);
  }
  return n;
}

function colOf(raw: unknown, key: string, fallback: number): number {
  if (raw == null || String(raw).trim() === '') return fallback;
  try {
    return columnIndex(String(raw));
  } catch {
    throw new RankConfigError(`${key} は列名（A, B, AA…）で指定してください（現在: ${String(raw)}）`);
  }
}

function optionalColOf(raw: unknown, key: string, fallback: number | null): number | null {
  if (raw === null || raw === '') return null; // 明示的に「使わない」
  if (raw == null) return fallback;
  return colOf(raw, key, fallback ?? 0);
}

// ---- 「SEO順位」タブの列わりあて ----

function parseDashboard(raw: unknown, sheetName: string): DashboardLayout {
  const l = (raw ?? {}) as Record<string, unknown>;
  const layout: DashboardLayout = {
    sheetName,
    headerRow: intOf(l.headerRow, 'layout.headerRow', DEFAULT_DASHBOARD.headerRow, 0),
    startRow: intOf(l.startRow, 'layout.startRow', DEFAULT_DASHBOARD.startRow, 1),
    keywordColumn: colOf(l.keyword, 'layout.keyword', DEFAULT_DASHBOARD.keywordColumn),
    rankColumn: colOf(l.rank, 'layout.rank', DEFAULT_DASHBOARD.rankColumn),
    diffColumn: optionalColOf(l.diff, 'layout.diff', DEFAULT_DASHBOARD.diffColumn),
    asinColumn: colOf(l.asin, 'layout.asin', DEFAULT_DASHBOARD.asinColumn),
    linkColumn: optionalColOf(l.link, 'layout.link', DEFAULT_DASHBOARD.linkColumn),
  };

  if (layout.headerRow >= layout.startRow) {
    throw new RankConfigError('layout.headerRow は startRow より上の行にしてください。');
  }
  // 同じ列に2つの役割を割り当てると、片方が消える
  const used = new Map<number, string>();
  const claim = (col: number | null, name: string) => {
    if (col == null) return;
    const other = used.get(col);
    if (other) {
      throw new RankConfigError(`layout.${name} と layout.${other} が同じ列を指しています。別々の列にしてください。`);
    }
    used.set(col, name);
  };
  claim(layout.keywordColumn, 'keyword');
  claim(layout.rankColumn, 'rank');
  claim(layout.diffColumn, 'diff');
  claim(layout.asinColumn, 'asin');
  claim(layout.linkColumn, 'link');

  return layout;
}

// ---- 履歴タブ ----

function parseHistory(raw: unknown, defaultSheet: string): HistoryLayout | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RankConfigError('history は { "sheet": "SEO順位履歴" } の形で書いてください。');
  }
  const h = raw as Record<string, unknown>;
  const layout: HistoryLayout = {
    sheetName: typeof h.sheet === 'string' && h.sheet.trim() ? h.sheet.trim() : `${defaultSheet}履歴`,
    dateColumn: colOf(h.dateColumn, 'history.dateColumn', 0),
    headerRow: intOf(h.headerRow, 'history.headerRow', 1, 1),
    startRow: intOf(h.startRow, 'history.startRow', 2, 2),
  };
  if (layout.headerRow >= layout.startRow) {
    throw new RankConfigError('history.headerRow は startRow より上の行にしてください。');
  }
  return layout;
}

// ---- 読み込み ----

export function loadRankConfig(cwd = process.cwd()): RankConfig {
  const file = path.resolve(cwd, process.env.RANK_TARGETS_FILE?.trim() || './rank-targets.json');
  if (!fs.existsSync(file)) {
    throw new RankConfigError(
      `設定ファイルが見つかりません: ${file}\n` +
        `rank-targets.example.json をコピーして rank-targets.json を作ってください。手順は docs/rank-tracking.md を参照。`
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new RankConfigError(
      `${path.basename(file)} がJSONとして読めません。カンマや括弧の書き忘れを確認してください。\n` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  const spreadsheetId = String(parsed.spreadsheetId ?? process.env.SPREADSHEET_ID ?? '').trim();
  if (!spreadsheetId) {
    throw new RankConfigError(
      `書き込み先のスプレッドシートが未設定です。${path.basename(file)} の spreadsheetId か、.env の SPREADSHEET_ID を設定してください。`
    );
  }

  const sheetName =
    (typeof parsed.sheet === 'string' && parsed.sheet.trim()) || process.env.RANK_SHEET_NAME?.trim() || 'SEO順位';

  const kindRaw = (process.env.RANK_VALUE?.trim() || 'organic') as RankKind;
  if (kindRaw !== 'organic' && kindRaw !== 'overall') {
    throw new RankConfigError(`.env の RANK_VALUE は organic か overall のどちらかにしてください（現在: ${kindRaw}）`);
  }

  const envInt = (key: string, fallback: number, min: number) => {
    const raw = process.env[key];
    if (raw == null || raw.trim() === '') return fallback;
    return intOf(raw, `.env の ${key}`, fallback, min);
  };

  return {
    spreadsheetId,
    dashboard: parseDashboard(parsed.layout, sheetName),
    updatedCell:
      parsed.updatedCell == null ? undefined : parseCellRef(parsed.updatedCell, sheetName, 'updatedCell'),
    history: parseHistory(parsed.history, sheetName),
    kind: kindRaw,
    maxPages: envInt('RANK_MAX_PAGES', 1, 1),
    notFoundText: process.env.RANK_NOT_FOUND_TEXT ?? '圏外',
    domain: process.env.RANK_DOMAIN?.trim() || 'www.amazon.co.jp',
    // Amazonは短時間の連続アクセスに厳しいので、既定を長めに取る。
    // 8キーワードなら 8×15秒 ≒ 2分。朝のバッチなので速度より確実さを優先する。
    intervalMs: envInt('RANK_INTERVAL_MS', 15000, 0),
    retryPauseMs: envInt('RANK_RETRY_PAUSE_MS', 120000, 0),
  };
}
