// ===== Amazon 検索結果ページの取得とパース =====
//
// キーワード検索の掲載順位（いわゆるSEO順位）はSP-APIでは取れないため、
// 検索結果ページのHTMLを1日1回だけ取得して順番を数えます。
//
// 大事な前提が2つあります。
//   1. Amazonの検索結果は閲覧環境（IP・ログイン状態・時間帯）で多少変わります。
//      絶対値ではなく「毎日同じ条件で測った相対的な変化」を見るための数字です。
//   2. 短時間に連続アクセスすると503を返してきます。1件ごとに数秒あけ、
//      503のときは待ち時間を伸ばして数回だけ再試行します。

export class AmazonBlockedError extends Error {}

export interface SearchItem {
  asin: string;
  position: number; // ページ内の見た目どおりの順番（スポンサー枠を含む。1始まり）
  organicPosition: number | null; // スポンサーを除いた順番。スポンサー枠なら null
  sponsored: boolean;
}

export interface SearchPage {
  keyword: string;
  page: number;
  items: SearchItem[];
}

export interface FetchOptions {
  domain?: string; // 既定 www.amazon.co.jp
  maxAttempts?: number;
  signal?: AbortSignal;
}

// ===== シークレットモード相当の取得条件 =====
//
// 順位は「誰が見ても同じ、素の検索結果」でないと比較になりません。ログイン状態や
// 閲覧・購買履歴が混じると、自社商品が実際より上に表示されてしまいます。
// そこでブラウザのシークレットウィンドウと同じ条件で取りにいきます。
//
//   - Cookieを一切送らない  … ログイン状態・セッション・閲覧履歴を持ち込まない
//   - キャッシュを使わない  … 毎回その時点のページを取り直す
//   - User-Agentは固定      … 日によって条件が変わらないようにする
//
// Node の fetch はCookieジャーを持たないので、放っておいてもCookieは送られません。
// それでも credentials:'omit' を明示し、テストでも「Cookieを付けない」ことを固定して、
// あとから誰かがCookie付きに変えてしまわないようにしています。

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function incognitoHeaders(): Record<string, string> {
  return {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'sec-ch-ua': '"Google Chrome";v="140", "Chromium";v="140", "Not=A?Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    // シークレットウィンドウを開いた直後と同じく、キャッシュを当てにしない
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
}

export function searchUrl(keyword: string, page: number, domain = 'www.amazon.co.jp'): string {
  const url = new URL(`https://${domain}/s`);
  url.searchParams.set('k', keyword);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

// ---- パース ----
//
// 検索結果の1件は必ず data-component-type="s-search-result" を持つ div で始まる。
// スポンサー枠かどうかは、その div に付く AdHolder クラスで判定できる。
// （本文中の「スポンサー」表記は隣の枠のものを拾ってしまうことがあるので使わない）

const ITEM_TAG = /<div [^>]*data-component-type="s-search-result"[^>]*>/g;

export function parseSearchPage(html: string, keyword: string, page: number): SearchPage {
  const items: SearchItem[] = [];
  let position = 0;
  let organic = 0;

  for (const match of html.matchAll(ITEM_TAG)) {
    const tag = match[0];
    const asin = /data-asin="([A-Z0-9]{10})"/.exec(tag)?.[1];
    if (!asin) continue; // ASINの無いプレースホルダ枠は数えない
    const sponsored = /\bAdHolder\b/.test(tag);
    position += 1;
    if (!sponsored) organic += 1;
    items.push({ asin, position, organicPosition: sponsored ? null : organic, sponsored });
  }
  return { keyword, page, items };
}

// ロボット判定・CAPTCHAのページかどうか。中身が検索結果でないのに200が返ることがある。
export function looksBlocked(html: string): boolean {
  if (/s-search-result/.test(html)) return false;
  return /captcha|Enter the characters you see below|自動的に処理/i.test(html) || html.length < 100_000;
}

export async function fetchSearchPage(keyword: string, page: number, opts: FetchOptions = {}): Promise<SearchPage> {
  const domain = opts.domain ?? 'www.amazon.co.jp';
  const maxAttempts = opts.maxAttempts ?? 4;
  const url = searchUrl(keyword, page, domain);
  let lastReason = '';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // 12秒 → 24秒 → 48秒（±20%のばらつきを付ける）。
      // 503は一時的な拒否なので、焦って叩き直すより待つほうが結局早く通る。
      const base = 12_000 * 2 ** (attempt - 1);
      await sleep(Math.round(base * (0.8 + Math.random() * 0.4)));
    }
    let res: Response;
    try {
      // credentials:'omit' でCookieを送らないことを明示する。
      // キャッシュ側は Cache-Control / Pragma ヘッダーで表明している
      // （Node の fetch はHTTPキャッシュを持たないので cache オプションは効かない）。
      res = await fetch(url, {
        headers: incognitoHeaders(),
        credentials: 'omit',
        redirect: 'follow',
        signal: opts.signal,
      });
    } catch (err) {
      lastReason = `通信エラー: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    const html = await res.text();

    if (res.status === 503 || res.status === 429) {
      lastReason = `Amazonがアクセスを一時的に拒否しました (${res.status})`;
      continue;
    }
    if (!res.ok) {
      lastReason = `検索ページの取得に失敗しました (${res.status})`;
      continue;
    }
    if (looksBlocked(html)) {
      lastReason = 'CAPTCHAまたはロボット判定のページが返りました';
      continue;
    }
    const parsed = parseSearchPage(html, keyword, page);
    if (parsed.items.length === 0) {
      lastReason = '検索結果が1件も読み取れませんでした（ページの作りが変わった可能性）';
      continue;
    }
    return parsed;
  }
  throw new AmazonBlockedError(`「${keyword}」の検索結果を取得できませんでした。${lastReason}`);
}

// ---- 順位の判定 ----

export type RankKind = 'organic' | 'overall';

export interface RankHit {
  page: number;
  position: number; // 見た目どおりの順番
  organicPosition: number | null;
  sponsored: boolean;
  value: number; // 実際にセルへ書く数値
}

// 複数ページぶんの結果から、対象ASINが最初に現れる位置を返す。
// organic 指定のときはスポンサー枠を飛ばす（広告で上位に見えるのを順位に含めないため）。
export function findRank(pages: SearchPage[], asin: string, kind: RankKind): RankHit | null {
  const target = asin.trim().toUpperCase();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.asin !== target) continue;
      if (kind === 'organic' && item.sponsored) continue;
      const value = kind === 'organic' ? item.organicPosition! : item.position;
      return {
        page: page.page,
        position: item.position,
        organicPosition: item.organicPosition,
        sponsored: item.sponsored,
        value,
      };
    }
  }
  return null;
}

// 1ページあたり何件あったか（「48件中12位」と出すため）
export function countOnPages(pages: SearchPage[], kind: RankKind): number {
  return pages.reduce(
    (sum, p) => sum + (kind === 'organic' ? p.items.filter((i) => !i.sponsored).length : p.items.length),
    0
  );
}
