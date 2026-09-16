import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countOnPages,
  fetchSearchPage,
  findRank,
  incognitoHeaders,
  looksBlocked,
  parseSearchPage,
  searchUrl,
} from './search.js';

// 検索結果の並びを1つでも取り違えると順位が丸ごとずれるので、
// 実際のページから取ったHTMLを固定して数え方を検証する。

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, '__fixtures__', 'search-page.html'), 'utf8');

describe('parseSearchPage', () => {
  const page = parseSearchPage(fixture, '珪藻土 バスマット', 1);

  it('1ページ目の全枠を並び順どおりに読む', () => {
    expect(page.items).toHaveLength(60);
    expect(page.items.map((i) => i.position)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('スポンサー枠を AdHolder クラスで見分ける', () => {
    // 実データでは冒頭4枠が広告
    expect(page.items.slice(0, 4).every((i) => i.sponsored)).toBe(true);
    expect(page.items.filter((i) => i.sponsored)).toHaveLength(12);
  });

  it('スポンサー枠を除くと1ページ目はちょうど48件になる', () => {
    const organic = page.items.filter((i) => !i.sponsored);
    expect(organic).toHaveLength(48);
    expect(organic.map((i) => i.organicPosition)).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
  });

  it('スポンサー枠には順位を付けない', () => {
    expect(page.items.filter((i) => i.sponsored).every((i) => i.organicPosition === null)).toBe(true);
  });

  it('ASINの無い枠は数に入れない', () => {
    const html =
      '<div data-asin="B0ABC12345" data-component-type="s-search-result"></div>' +
      '<div data-asin="" data-component-type="s-search-result"></div>' +
      '<div data-asin="B0XYZ98765" data-component-type="s-search-result"></div>';
    expect(parseSearchPage(html, 'k', 1).items.map((i) => i.asin)).toEqual(['B0ABC12345', 'B0XYZ98765']);
  });
});

describe('findRank', () => {
  const page = parseSearchPage(fixture, '珪藻土 バスマット', 1);

  it('広告と自然検索の両方に出る商品は、organic では自然検索側の順位を返す', () => {
    // B0CLY5DKXP は1番目（広告）と6番目（自然検索の2位）に出ている
    expect(findRank([page], 'B0CLY5DKXP', 'organic')).toMatchObject({
      page: 1,
      position: 6,
      value: 2,
      sponsored: false,
    });
    expect(findRank([page], 'B0CLY5DKXP', 'overall')).toMatchObject({ position: 1, value: 1, sponsored: true });
  });

  it('広告に出ていない商品は見た目の順番と自然検索の順位が別になる', () => {
    // B01GDT86Y8 は見た目5番目・自然検索1位
    expect(findRank([page], 'B01GDT86Y8', 'organic')).toMatchObject({ position: 5, value: 1 });
    expect(findRank([page], 'B01GDT86Y8', 'overall')).toMatchObject({ position: 5, value: 5 });
  });

  it('ASINは大文字小文字・前後の空白を無視して照合する', () => {
    expect(findRank([page], '  b01gdt86y8 ', 'organic')?.value).toBe(1);
  });

  it('見つからなければ null', () => {
    expect(findRank([page], 'B000000000', 'organic')).toBeNull();
  });

  it('複数ページを渡すと、前のページから順に探す', () => {
    const p1 = parseSearchPage('<div data-asin="B0AAAAAAAA" data-component-type="s-search-result"></div>', 'k', 1);
    const p2 = parseSearchPage(
      '<div data-asin="B0BBBBBBBB" data-component-type="s-search-result"></div>' +
        '<div data-asin="B0CCCCCCCC" data-component-type="s-search-result"></div>',
      'k',
      2
    );
    expect(findRank([p1, p2], 'B0CCCCCCCC', 'organic')).toMatchObject({ page: 2, position: 2, value: 2 });
  });
});

describe('countOnPages', () => {
  it('順位の母数を数え方に合わせて返す', () => {
    const page = parseSearchPage(fixture, 'k', 1);
    expect(countOnPages([page], 'organic')).toBe(48);
    expect(countOnPages([page], 'overall')).toBe(60);
  });
});

describe('searchUrl', () => {
  it('キーワードをURLエンコードし、2ページ目以降だけ page を付ける', () => {
    expect(searchUrl('珪藻土 バスマット', 1)).toBe(
      'https://www.amazon.co.jp/s?k=%E7%8F%AA%E8%97%BB%E5%9C%9F+%E3%83%90%E3%82%B9%E3%83%9E%E3%83%83%E3%83%88'
    );
    expect(searchUrl('bath mat', 3)).toBe('https://www.amazon.co.jp/s?k=bath+mat&page=3');
    expect(searchUrl('bath mat', 1, 'www.amazon.com')).toBe('https://www.amazon.com/s?k=bath+mat');
  });
});

describe('looksBlocked', () => {
  it('検索結果が入っていれば正常とみなす', () => {
    expect(looksBlocked(fixture)).toBe(false);
  });

  it('CAPTCHAページや中身の薄いページはブロックとみなす', () => {
    expect(looksBlocked('<html><body>Enter the characters you see below</body></html>')).toBe(true);
    expect(looksBlocked('<html><body>申し訳ございません</body></html>')).toBe(true);
  });
});

// 順位は「ログインしていない素の検索結果」で測る約束になっている。
// うっかりCookieを付けたりUAを日替わりにしたりすると、数字の意味が変わってしまうので固定する。
describe('シークレットモード相当の取得条件', () => {
  it('Cookieに類するヘッダーを一切付けない', () => {
    const keys = Object.keys(incognitoHeaders()).map((k) => k.toLowerCase());
    expect(keys).not.toContain('cookie');
    expect(keys).not.toContain('authorization');
    expect(keys).not.toContain('x-amz-access-token');
  });

  it('キャッシュを使わない指定になっている', () => {
    const h = incognitoHeaders();
    expect(h['Cache-Control']).toBe('no-cache');
    expect(h.Pragma).toBe('no-cache');
  });

  it('User-Agentは呼ぶたびに同じ（日によって条件が変わらない）', () => {
    expect(incognitoHeaders()['User-Agent']).toBe(incognitoHeaders()['User-Agent']);
    expect(incognitoHeaders()['User-Agent']).toMatch(/^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\).*Chrome\//);
  });

  it('実際のリクエストでもCookieを送らない', async () => {
    const calls: RequestInit[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: RequestInit) => {
      calls.push(init);
      return new Response(fixture, { status: 200 });
    }) as typeof fetch;
    try {
      await fetchSearchPage('珪藻土 バスマット', 1);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].credentials).toBe('omit');
    const sent = Object.keys(calls[0].headers as Record<string, string>).map((k) => k.toLowerCase());
    expect(sent).not.toContain('cookie');
    expect((calls[0].headers as Record<string, string>)['Cache-Control']).toBe('no-cache');
  });
});
