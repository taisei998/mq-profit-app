import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARD } from './dashboard.js';
import { diffFormula, linkFormula } from './formulas.js';
import type { RankConfig } from './rank-config.js';

// 数式そのものの計算結果はスプレッドシート側でしか確かめられないので、
// ここでは「参照先がずれていないか」を見る。
// 実際の計算（空行をまたぐ・圏外が混ざる・同名キーワード）は
// 使い捨てタブを作って実シートで確認済み。

const config = {
  domain: 'www.amazon.co.jp',
  dashboard: { sheetName: 'SEO順位', ...DEFAULT_DASHBOARD },
  history: { sheetName: 'SEO順位履歴', dateColumn: 0, headerRow: 4, startRow: 5 },
} as unknown as RankConfig;

describe('diffFormula', () => {
  const formula = diffFormula(config, 7);

  it('履歴タブの見出し行を検索して列を決める（列の位置を決め打ちしない）', () => {
    expect(formula).toContain("'SEO順位履歴'!$4:$4");
    expect(formula).toContain('MATCH(key, hdr, 0)');
  });

  it('自分の行のキーワードとASINを見る', () => {
    expect(formula).toContain('$A7');
    expect(formula).toContain('$E7');
  });

  it('同名キーワードがあるときだけ見出しにASINを添える', () => {
    expect(formula).toContain('IF(COUNTIF($A$4:$A,$A7)>1, $A7&" ("&$E7&")", $A7)');
  });

  it('日付の最終行ではなく、実際に値が入っている最後の2つを比べる', () => {
    // 先の日付まで流し込んであっても、間に抜けた日があっても正しく比較するため
    expect(formula).toContain('FILTER(all, all<>"")');
    expect(formula).toContain('INDEX(vals, n-1) - INDEX(vals, n)');
    expect(formula).not.toContain('COUNTA(\'SEO順位履歴\'!$A$5:$A)');
  });

  it('履歴の参照はA列から始める（MATCHが返す列番号と桁を合わせるため）', () => {
    expect(formula).toContain("INDEX('SEO順位履歴'!$A$5:$ZZ, 0, col)");
  });

  it('キーワードが履歴に無いとき・記録が1日分のときは空欄になる', () => {
    expect(formula).toContain('IF(col=0, ""');
    expect(formula).toContain('IF(n<2, ""');
  });

  it('シート名のクォートをエスケープする', () => {
    const odd = { ...config, history: { ...config.history!, sheetName: "It's 履歴" } } as RankConfig;
    expect(diffFormula(odd, 4)).toContain("'It''s 履歴'!$4:$4");
  });

  it('列の割り当てを変えれば参照も変わる', () => {
    const moved = {
      ...config,
      dashboard: { ...config.dashboard, keywordColumn: 2, asinColumn: 3, startRow: 10 },
    } as RankConfig;
    const f = diffFormula(moved, 12);
    expect(f).toContain('$C12');
    expect(f).toContain('$D12');
    expect(f).toContain('$C$10:$C');
  });
});

describe('linkFormula', () => {
  it('その行のキーワードで検索ページを開くリンクになる', () => {
    expect(linkFormula(config, 8)).toBe(
      '=HYPERLINK("https://www.amazon.co.jp/s?k="&ENCODEURL($A8), "検索を開く")'
    );
  });

  it('対象ドメインを変えればリンク先も変わる', () => {
    const us = { ...config, domain: 'www.amazon.com' } as RankConfig;
    expect(linkFormula(us, 4)).toContain('https://www.amazon.com/s?k=');
  });
});
