import type { RankConfig } from './rank-config.js';
import { columnLetter } from './sheets.js';

// ===== 「SEO順位」タブに入れる数式 =====
//
// 前日比の数式は、履歴タブの**見出しの文字でキーワードを探します**（列の位置では探しません）。
// そのおかげで、あとから行を並べ替えても、履歴の列を動かしても壊れません。
// キーワードを1行足したときも、この数式をそのままコピーすれば動きます
// （バッチが空欄の行に自動で入れるので、普通は人が触る必要はありません）。

function quote(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

// 履歴の見出しに使うラベルを組み立てるシート側の式。
// 同じキーワードが複数行あるときだけ "キーワード (ASIN)" にする —
// dashboard.ts の historyLabel() と同じ規則。
function labelExpression(config: RankConfig, row: number): string {
  const d = config.dashboard;
  const kw = `$${columnLetter(d.keywordColumn)}${row}`;
  const asin = `$${columnLetter(d.asinColumn)}${row}`;
  const kwRange = `$${columnLetter(d.keywordColumn)}$${d.startRow}:$${columnLetter(d.keywordColumn)}`;
  return `IF(COUNTIF(${kwRange},${kw})>1, ${kw}&" ("&${asin}&")", ${kw})`;
}

// 前日比。順位は小さいほど良いので、上がった（数字が減った）ときに正の数になる。
//
// 「日付列の最終行」ではなく「そのキーワードの列に実際に入っている値の最後の2つ」を比べます。
// 日付をあらかじめ先の日付まで流し込んであっても、バッチを動かせなかった日が
// 間に挟まっていても、正しく直前の記録と比較できます。
// キーワードが履歴にまだ無いうち、記録が1日分しかないうちは空欄になります。
export function diffFormula(config: RankConfig, row: number): string {
  const h = config.history!;
  const sheet = quote(h.sheetName);
  // INDEXの範囲はA列から始める（MATCHが返す列番号と桁を合わせるため）
  const body = `${sheet}!$A$${h.startRow}:$ZZ`;

  return (
    `=LET(` +
    `hdr, ${sheet}!$${h.headerRow}:$${h.headerRow}, ` +
    `key, ${labelExpression(config, row)}, ` +
    `col, IFERROR(MATCH(key, hdr, 0), 0), ` +
    `IF(col=0, "", LET(` +
    `all, INDEX(${body}, 0, col), ` +
    `vals, IFERROR(FILTER(all, all<>""), ""), ` +
    `n, COUNTA(vals), ` +
    `IF(n<2, "", IFERROR(INDEX(vals, n-1) - INDEX(vals, n), "")))))`
  );
}

// その場でAmazonの検索結果を開くリンク。数字が怪しいときの目視確認用。
export function linkFormula(config: RankConfig, row: number): string {
  const kw = `$${columnLetter(config.dashboard.keywordColumn)}${row}`;
  return `=HYPERLINK("https://${config.domain}/s?k="&ENCODEURL(${kw}), "検索を開く")`;
}
