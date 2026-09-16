import { toNum } from './calc.js';

export type SaleMode = 'all_normal' | 'all_sale' | 'all_coupon' | 'by_column' | 'by_price';

export interface OrderColumnMapping {
  dateCol: number;
  codeCol: number;
  amountCol: number;
  qtyCol: number;
  saleMode: SaleMode;
  saleCol: number;
  unitCol: number;
  // 単価をどこから取るか。'column'（既定）は unitCol の列をそのまま使う。
  // 'divide' は単価の列が無いモール（Amazonの注文レポートなど）向けに「支払い金額 ÷ 数量」で求める。
  unitMode?: 'column' | 'divide';
  // 注文番号の列（任意）。受注を保存するときの参照用で、集計には使わない
  orderNoCol?: number;
  // 注文ステータスの列。指定した場合だけ excludeStatuses による除外が働く
  statusCol?: number;
  // 集計から除外する注文ステータスの値（例: Amazonの 'Cancelled'）。大文字小文字は区別しない
  excludeStatuses?: string[];
}

// 集計に必要な商品情報の最小形（1セットあたりの価格候補と粗利率テーブル）
export interface OrderProductLookup {
  productId: string; // 受注を永続化するときに紐づけるDBのレコードID
  name: string;
  category: string;
  normal: { prices: Array<number | null>; rates: Array<number | null> };
  sale: { prices: Array<number | null>; rates: Array<number | null> };
  coupon: { prices: Array<number | null>; rates: Array<number | null> };
}

export type ProductKind = 'normal' | 'sale' | 'coupon';

interface Bucket {
  sales: number;
  profit: number;
  count: number;
}

export interface OrderAggregationResult {
  daily: Record<string, Bucket>;
  product: Record<string, Bucket & { name: string; category: string }>;
  category: Record<string, Bucket>;
  byKind: Record<ProductKind, Bucket>;
  totalSales: number;
  totalProfit: number;
  matched: number;
  missing: Record<string, number>; // 未登録の商品コード → 件数
  priceMismatch: number; // 単価がどの区分の価格とも一致せず判定できなかった件数
  // 上記の内訳。「商品コード @単価」→ 件数。未紐付け一覧で「どの商品がいくらで売れて弾かれたか」を出すため
  priceMismatchDetail: Record<string, number>;
  excluded: number; // 注文ステータスにより除外した件数（キャンセルなど）
  excludedDetail: Record<string, number>; // 除外した理由（ステータスの値）→ 件数
  // 集計できた受注の明細。DBに保存するときだけ使う（withDetail を指定したときのみ入る）。
  // 画面のプレビューでは件数が多くなりすぎるため既定では空にしている。
  detail: OrderDetailRow[];
}

// 保存用の受注1行
export interface OrderDetailRow {
  orderNo: string | null;
  orderDate: string;
  productCode: string;
  productId: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  kind: ProductKind;
  profit: number;
  profitRate: number;
}

// 受注CSVの日付列は「2026-09-08 00:01:55」のように時刻まで入っていることが多い。
// 文字列のまま集計キーにすると1件ごとに別の日として数えられ、日別集計が成立しない。
// そのため日付部分だけを取り出し、表記ゆれ（/ 区切り・YYYYMMDD・和暦風の「年月日」）を
// YYYY-MM-DD に寄せてから集計キーにする。解釈できない書式はそのまま（空白より前）を返す。
export function toDateKey(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const head = s.split(/[ T]/)[0];
  const pad = (v: string) => v.padStart(2, '0');

  const ymd = head.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${pad(ymd[2])}-${pad(ymd[3])}`;

  const compact = head.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  const jp = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (jp) return `${jp[1]}-${pad(jp[2])}-${pad(jp[3])}`;

  return head;
}

// 区分判定用テキスト分類（CSVの列の文字列から通常/SALE/クーポンを推定）
export function classifyKind(text: unknown): ProductKind {
  const s = String(text || '').toLowerCase();
  if (s.indexOf('クーポン') !== -1 || s.indexOf('coupon') !== -1) return 'coupon';
  if (s.indexOf('sale') !== -1 || s.indexOf('セール') !== -1 || s.indexOf('割引') !== -1) return 'sale';
  return 'normal';
}

// 単価を各区分の1セット目価格と照合して区分を特定する。
// 受注と商品マスタは「商品コード＆売価」で紐づける方針のため、どの区分の価格とも一致しない場合は
// 近い区分に寄せず null を返し、呼び出し側で未紐付けとして扱う（2026-09-16決定。docs/design-gap.md §6-#12）。
// 値下げ直後などで一致しない受注を、気づかないまま誤った粗利率で集計してしまうのを防ぐのが狙い。
export function matchKindByPrice(product: OrderProductLookup, unitPrice: number): ProductKind | null {
  const candidates: Record<ProductKind, number | null> = {
    normal: product.normal.prices[0],
    sale: product.sale.prices[0],
    coupon: product.coupon.prices[0],
  };
  // 複数区分が同額のときは normal → sale → coupon の順で先に一致したものを採用する
  const order: ProductKind[] = ['normal', 'sale', 'coupon'];
  for (const k of order) {
    const p = candidates[k];
    if (p != null && p === unitPrice) return k;
  }
  return null;
}

function emptyBucket(): Bucket {
  return { sales: 0, profit: 0, count: 0 };
}

// 1行ぶんの単価を求める。単価の列が無いモール（Amazon）は「支払い金額 ÷ 数量」で算出する。
// 割り切れない場合は商品登録の価格（整数）と一致しないため、未紐付けとして弾かれる。
export function unitPriceOf(
  row: string[],
  mapping: OrderColumnMapping,
  qty: number
): number | null {
  if (mapping.unitMode === 'divide') {
    const amt = toNum(row[mapping.amountCol]);
    if (amt === null || qty <= 0) return null;
    return amt / qty;
  }
  return toNum(row[mapping.unitCol]);
}

// 注文ステータスが除外対象か判定する（2026-09-16決定 #15。Amazonの 'Cancelled' など）
export function isExcludedStatus(row: string[], mapping: OrderColumnMapping): string | null {
  const { statusCol, excludeStatuses } = mapping;
  if (statusCol == null || statusCol < 0) return null;
  if (!excludeStatuses || excludeStatuses.length === 0) return null;
  const value = (row[statusCol] || '').trim();
  if (!value) return null;
  const hit = excludeStatuses.some((s) => s.trim().toLowerCase() === value.toLowerCase());
  return hit ? value : null;
}

// 受注CSV(行の配列)＋列マッピング＋商品マスタ から、日別・カテゴリ別・商品別の売上/粗利を集計
export function aggregateOrders(
  rows: string[][],
  mapping: OrderColumnMapping,
  products: Record<string, OrderProductLookup>,
  options: { withDetail?: boolean } = {}
): OrderAggregationResult {
  const daily: OrderAggregationResult['daily'] = {};
  const product: OrderAggregationResult['product'] = {};
  const category: OrderAggregationResult['category'] = {};
  const byKind: OrderAggregationResult['byKind'] = {
    normal: emptyBucket(),
    sale: emptyBucket(),
    coupon: emptyBucket(),
  };
  const missing: Record<string, number> = {};
  const priceMismatchDetail: Record<string, number> = {};
  const excludedDetail: Record<string, number> = {};
  let totalSales = 0;
  let totalProfit = 0;
  const detail: OrderDetailRow[] = [];
  let matched = 0;
  let priceMismatch = 0;
  let excluded = 0;

  rows.forEach((row) => {
    // キャンセルなどの除外ステータスは、未登録コードや単価不一致より先に弾く。
    // （キャンセル行を「未紐付け」として数えてしまうと、対応が必要な件数に見えてしまうため）
    const excludedBy = isExcludedStatus(row, mapping);
    if (excludedBy !== null) {
      excluded++;
      excludedDetail[excludedBy] = (excludedDetail[excludedBy] || 0) + 1;
      return;
    }

    const date = toDateKey(row[mapping.dateCol]);
    const code = (row[mapping.codeCol] || '').trim();
    let qty = toNum(row[mapping.qtyCol]);
    if (qty === null || qty < 1) qty = 1;
    qty = Math.round(qty);

    let amount: number;
    let kind: ProductKind;

    if (mapping.saleMode === 'by_price') {
      const unitPrice = unitPriceOf(row, mapping, qty);
      if (!code || unitPrice === null) return;
      const p = products[code];
      if (!p) {
        missing[code] = (missing[code] || 0) + 1;
        return;
      }
      const matchedKind = matchKindByPrice(p, unitPrice);
      if (matchedKind === null) {
        priceMismatch++;
        const key = `${code} @${unitPrice}`;
        priceMismatchDetail[key] = (priceMismatchDetail[key] || 0) + 1;
        return;
      }
      kind = matchedKind;
      amount = unitPrice * qty;
    } else {
      const amt = toNum(row[mapping.amountCol]);
      if (!code || amt === null) return;
      if (!(code in products)) {
        missing[code] = (missing[code] || 0) + 1;
        return;
      }
      amount = amt;
      if (mapping.saleMode === 'all_normal') kind = 'normal';
      else if (mapping.saleMode === 'all_sale') kind = 'sale';
      else if (mapping.saleMode === 'all_coupon') kind = 'coupon';
      else kind = classifyKind(row[mapping.saleCol]);
    }

    const p = products[code];
    const grp = p[kind];
    // 受注CSVの数量は「個数」であって「セット数」ではない（2026-09-16決定。docs/design-gap.md §6-#6）。
    // 2個買われても同梱はせず送料・資材費は2回分かかるため、常に1セットの粗利率を数量分かける。
    // まとめ買い（2セット以上で資材をまとめる商品）は別の商品コードで出品されており、
    // その商品は商品コード＆売価で別レコードとして紐づくので、ここでセットを選び直す必要はない。
    const rate = grp.rates[0];
    if (rate == null) return;

    const profit = (amount * rate) / 100;
    matched++;

    if (options.withDetail) {
      const orderNo =
        mapping.orderNoCol != null && mapping.orderNoCol >= 0
          ? (row[mapping.orderNoCol] || '').trim() || null
          : null;
      detail.push({
        orderNo,
        orderDate: date,
        productCode: code,
        productId: p.productId,
        unitPrice: qty > 0 ? amount / qty : amount,
        quantity: qty,
        amount,
        kind,
        profit,
        profitRate: rate,
      });
    }

    if (!daily[date]) daily[date] = emptyBucket();
    daily[date].sales += amount;
    daily[date].profit += profit;
    daily[date].count++;

    if (!product[code]) {
      product[code] = { ...emptyBucket(), name: p.name, category: p.category || 'その他' };
    }
    product[code].sales += amount;
    product[code].profit += profit;
    product[code].count++;

    const cat = p.category || 'その他';
    if (!category[cat]) category[cat] = emptyBucket();
    category[cat].sales += amount;
    category[cat].profit += profit;
    category[cat].count++;

    byKind[kind].sales += amount;
    byKind[kind].profit += profit;
    byKind[kind].count++;

    totalSales += amount;
    totalProfit += profit;
  });

  return {
    daily,
    product,
    category,
    byKind,
    totalSales,
    totalProfit,
    matched,
    missing,
    priceMismatch,
    priceMismatchDetail,
    excluded,
    excludedDetail,
    detail,
  };
}
