import crypto from 'node:crypto';
import fs from 'node:fs';

// ===== Googleスプレッドシート クライアント =====
//
// サービスアカウント方式。googleapis パッケージは使わず、JWTを自前で組み立てて
// アクセストークンを取ります（依存を増やさないため。SP-API側も同じ方針）。
//
// 使う前に、対象のスプレッドシートを「サービスアカウントのメールアドレス」に
// 編集者として共有しておく必要があります。手順は docs/bsr-tracking.md を参照。

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsConfigError extends Error {}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

let cachedKey: ServiceAccountKey | null = null;

export function loadServiceAccount(): ServiceAccountKey {
  if (cachedKey) return cachedKey;

  // キーはファイルパス指定か、JSONそのものを環境変数に入れる方式のどちらでもよい
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;

  let raw: string;
  if (inline && inline.trim()) {
    raw = inline;
  } else if (file && file.trim()) {
    if (!fs.existsSync(file)) {
      throw new SheetsConfigError(
        `サービスアカウントのキーファイルが見つかりません: ${file}\n手順は docs/bsr-tracking.md を参照してください。`
      );
    }
    raw = fs.readFileSync(file, 'utf8');
  } else {
    throw new SheetsConfigError(
      'Googleの認証情報が未設定です（.env に GOOGLE_SERVICE_ACCOUNT_KEY_FILE を設定してください）。手順は docs/bsr-tracking.md を参照。'
    );
  }

  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(raw) as ServiceAccountKey;
  } catch {
    throw new SheetsConfigError('サービスアカウントのキーがJSONとして読めません。ファイルの中身を確認してください。');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new SheetsConfigError('サービスアカウントのキーに client_email / private_key がありません。');
  }
  cachedKey = parsed;
  return parsed;
}

export function isSheetsConfigured(): boolean {
  try {
    loadServiceAccount();
    return Boolean(process.env.SPREADSHEET_ID);
  } catch {
    return false;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let cachedToken: { value: string; expiresAt: number } | null = null;

// サービスアカウントの秘密鍵でJWTを署名し、アクセストークンと交換する
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const key = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  // .env 経由で渡すと改行が \n のままになりがちなので戻す
  const pem = key.private_key.replace(/\\n/g, '\n');
  const signature = base64url(signer.sign(pem));

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Googleのアクセストークン取得に失敗しました (${res.status})。${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function call(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403) {
      const email = loadServiceAccount().client_email;
      throw new Error(
        `スプレッドシートへのアクセスが拒否されました (403)。\n` +
          `対象のシートを次のアドレスに「編集者」として共有してください:\n  ${email}`
      );
    }
    if (res.status === 404) {
      throw new Error(`スプレッドシートが見つかりません (404)。.env の SPREADSHEET_ID を確認してください。`);
    }
    throw new Error(`スプレッドシートの操作に失敗しました (${res.status})。${body.slice(0, 300)}`);
  }
  return res.json();
}

// ---- A1記法のヘルパー ----

// 0始まりの列番号を A, B, ... Z, AA, AB ... に変換する
export function columnLetter(index0: number): string {
  let n = index0 + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// シート名にスペースや記号が入っていてもいいようにクォートする
function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

// ---- 日付シリアル値の変換 ----
//
// スプレッドシートの日付は「1899-12-30 からの経過日数」で保持される。
// 読み取り時に SERIAL_NUMBER 指定で数値として受け取り、こちらで日付に直して比較する。
// （書式が 2026/09/10 でも 2026-09-10 でも同じ数値になるので、表記ゆれに強い）
const EPOCH = Date.UTC(1899, 11, 30);

export function dateToSerial(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86_400_000);
}

export function serialToDate(serial: number): string {
  const ms = EPOCH + Math.round(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ---- 読み書き ----

export interface SheetRange {
  spreadsheetId: string;
  sheetName: string;
}

export async function readRange(target: SheetRange, a1: string): Promise<any[][]> {
  const range = encodeURIComponent(`${quoteSheet(target.sheetName)}!${a1}`);
  const json = await call(
    `${target.spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`
  );
  return (json.values ?? []) as any[][];
}

// 複数の範囲をまとめて書く。USER_ENTERED なので "2026-09-10" は日付として入る。
export async function writeRanges(
  target: SheetRange,
  updates: Array<{ a1: string; values: Array<Array<string | number | null>> }>
): Promise<void> {
  if (updates.length === 0) return;
  await call(`${target.spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates.map((u) => ({
        range: `${quoteSheet(target.sheetName)}!${u.a1}`,
        values: u.values,
      })),
    }),
  });
}

// シートの存在確認とタイトル取得（設定ミスを早めに知らせるため）
export async function describeSheet(target: SheetRange): Promise<{ title: string; sheetExists: boolean }> {
  const json = await call(`${target.spreadsheetId}?fields=properties.title,sheets.properties.title`);
  const titles = (json.sheets ?? []).map((s: any) => s.properties.title as string);
  return {
    title: json.properties?.title ?? '(不明)',
    sheetExists: titles.includes(target.sheetName),
  };
}

// スプレッドシート内のタブ名を全部返す（書き込み前にタブの存在を確認するため）
export async function listSheetTitles(spreadsheetId: string): Promise<{ title: string; sheets: string[] }> {
  const json = await call(`${spreadsheetId}?fields=properties.title,sheets.properties.title`);
  return {
    title: json.properties?.title ?? '(不明)',
    sheets: (json.sheets ?? []).map((s: any) => s.properties.title as string),
  };
}

// A, B, ... Z, AA ... を0始まりの列番号に戻す（columnLetter の逆）
export function columnIndex(letter: string): number {
  const upper = letter.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(upper)) throw new Error(`列名として読めません: "${letter}"`);
  let n = 0;
  for (const ch of upper) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// シート（タブ）の追加や書式設定に使う spreadsheets.batchUpdate。
// 値の書き込みは values:batchUpdate（writeRanges）と別APIなので注意。
export async function batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<any> {
  if (requests.length === 0) return null;
  return call(`${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}

// 無ければタブを作る。既にあれば何もしない（作り直して中身を消さないため）。
export async function ensureSheet(spreadsheetId: string, title: string): Promise<{ created: boolean }> {
  const book = await listSheetTitles(spreadsheetId);
  if (book.sheets.includes(title)) return { created: false };
  await batchUpdate(spreadsheetId, [{ addSheet: { properties: { title } } }]);
  return { created: true };
}

// タブ名から sheetId（書式設定のリクエストで必要）を引く
export async function sheetIdOf(spreadsheetId: string, title: string): Promise<number> {
  const json = await call(`${spreadsheetId}?fields=sheets.properties(sheetId,title)`);
  const found = (json.sheets ?? []).find((s: any) => s.properties.title === title);
  if (!found) throw new Error(`タブが見つかりません: ${title}`);
  return found.properties.sheetId as number;
}

// 指定した範囲を空にする。空文字を書き込むのと違い、本当に「未入力」に戻る
// （空文字を書くと COUNTA などが1件として数えてしまう）。
export async function clearRanges(target: SheetRange, a1List: string[]): Promise<void> {
  if (a1List.length === 0) return;
  await call(`${target.spreadsheetId}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: a1List.map((a1) => `${quoteSheet(target.sheetName)}!${a1}`) }),
  });
}
