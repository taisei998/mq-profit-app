import { MARKETPLACES, type BsrRank, type MarketplaceKey } from './types.js';

// ===== Amazon SP-API（Selling Partner API）クライアント =====
//
// 認証は LWA(Login with Amazon) の refresh_token だけで完結します。
// 2023年10月以降、SP-API は AWS SigV4署名 / IAMロールを要求しなくなったため、
// アクセストークンを x-amz-access-token ヘッダに入れるだけで呼べます。
// （＝aws-sdk などの依存は不要です）
//
// 必要な環境変数はすべて packages/server/.env に入れてください。
// 取得手順は docs/bsr-tracking.md を参照。

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

// getCatalogItem のレート制限は 2 req/sec（バースト2）。
// 余裕をもって1件あたり700msあけ、429が返ったら指数バックオフで3回まで再試行する。
const REQUEST_INTERVAL_MS = 700;
const MAX_RETRIES = 3;

export class SpApiConfigError extends Error {}

interface SpApiCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function readCredentials(): SpApiCredentials {
  const clientId = process.env.SPAPI_LWA_CLIENT_ID ?? '';
  const clientSecret = process.env.SPAPI_LWA_CLIENT_SECRET ?? '';
  const refreshToken = process.env.SPAPI_REFRESH_TOKEN ?? '';
  const missing = [
    !clientId && 'SPAPI_LWA_CLIENT_ID',
    !clientSecret && 'SPAPI_LWA_CLIENT_SECRET',
    !refreshToken && 'SPAPI_REFRESH_TOKEN',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new SpApiConfigError(
      `SP-APIの設定が未完了です（.env に ${missing.join(', ')} を設定してください）。手順は docs/bsr-tracking.md を参照。`
    );
  }
  return { clientId, clientSecret, refreshToken };
}

export function isSpApiConfigured(): boolean {
  try {
    readCredentials();
    return true;
  } catch {
    return false;
  }
}

// 設定が無ければ SpApiConfigError を投げる（未設定のまま取得を走らせないため）
export function assertSpApiConfigured(): void {
  readCredentials();
}

// アクセストークンは1時間有効。プロセス内でキャッシュし、期限1分前に取り直す。
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { clientId, clientSecret, refreshToken } = readCredentials();
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // リフレッシュトークン失効が一番ありがちなので、原因が分かる文言にしておく
    throw new Error(
      `LWAアクセストークンの取得に失敗しました (${res.status})。リフレッシュトークンやクライアント情報を確認してください。${body.slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- Catalog Items API のレスポンス型（使う部分だけ） ----
interface CatalogItemResponse {
  asin: string;
  summaries?: Array<{ marketplaceId: string; itemName?: string; websiteDisplayGroupName?: string }>;
  salesRanks?: Array<{
    marketplaceId: string;
    displayGroupRanks?: Array<{ websiteDisplayGroup?: string; title?: string; link?: string; rank: number }>;
    classificationRanks?: Array<{ classificationId?: string; title?: string; link?: string; rank: number }>;
  }>;
}

export interface AsinCatalogResult {
  asin: string;
  itemName: string | null;
  ranks: BsrRank[];
}

// 1ASIN分のカタログ情報（BSR含む）を取得する。
export async function fetchAsinCatalog(asin: string, marketplace: MarketplaceKey): Promise<AsinCatalogResult> {
  const mp = MARKETPLACES[marketplace];
  if (!mp) throw new Error(`未対応のマーケットプレイスです: ${marketplace}`);

  const url = new URL(`https://${mp.host}/catalog/2022-04-01/items/${encodeURIComponent(asin)}`);
  url.searchParams.set('marketplaceIds', mp.id);
  url.searchParams.set('includedData', 'salesRanks,summaries');
  url.searchParams.set('locale', mp.locale);

  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url, {
      headers: { 'x-amz-access-token': token, accept: 'application/json' },
    });

    if (res.ok) {
      const json = (await res.json()) as CatalogItemResponse;
      return parseCatalogItem(json, mp.id);
    }

    if (res.status === 404) {
      throw new Error(`ASIN ${asin} が ${mp.label} のカタログに見つかりませんでした。`);
    }
    // 429(スロットリング) と 5xx は再試行の価値がある
    if (res.status === 429 || res.status >= 500) {
      lastError = `HTTP ${res.status}`;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 403) {
      // トークンは1時間有効だが、期限切れ以外(権限不足)でも403が返る
      cachedToken = null;
      const body = await res.text().catch(() => '');
      throw new Error(
        `SP-APIへのアクセスが拒否されました (403)。アプリのロールに「Product Listing」等のカタログ参照権限があるか確認してください。${body.slice(0, 200)}`
      );
    }
    const body = await res.text().catch(() => '');
    throw new Error(`SP-APIの呼び出しに失敗しました (${res.status})。${body.slice(0, 200)}`);
  }
  throw new Error(`SP-APIの呼び出しが${MAX_RETRIES}回とも失敗しました（${lastError}）。`);
}

function parseCatalogItem(json: CatalogItemResponse, marketplaceId: string): AsinCatalogResult {
  const summary = json.summaries?.find((s) => s.marketplaceId === marketplaceId);
  const salesRank = json.salesRanks?.find((s) => s.marketplaceId === marketplaceId);

  const ranks: BsrRank[] = [];
  for (const r of salesRank?.displayGroupRanks ?? []) {
    ranks.push({
      kind: 'displayGroup',
      title: r.title || r.websiteDisplayGroup || '',
      rank: r.rank,
      link: r.link,
    });
  }
  for (const r of salesRank?.classificationRanks ?? []) {
    ranks.push({ kind: 'classification', title: r.title || '', rank: r.rank, link: r.link });
  }

  return {
    asin: json.asin,
    itemName: summary?.itemName ?? null,
    ranks,
  };
}

// 複数ASINを順番に取得する。レート制限に引っかからないよう間隔をあけ、
// 1件失敗しても残りは続行して { asin: 結果 or エラー } を返す。
export async function fetchAsinCatalogBatch(
  targets: Array<{ asin: string; marketplace: MarketplaceKey }>
): Promise<Array<{ asin: string; marketplace: MarketplaceKey; result?: AsinCatalogResult; error?: string }>> {
  const out: Array<{ asin: string; marketplace: MarketplaceKey; result?: AsinCatalogResult; error?: string }> = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (i > 0) await sleep(REQUEST_INTERVAL_MS);
    try {
      out.push({ ...t, result: await fetchAsinCatalog(t.asin, t.marketplace) });
    } catch (err) {
      out.push({ ...t, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
