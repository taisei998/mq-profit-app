import {
  DEDUCT_KEYS,
  FIELDS,
  FieldKey,
  FieldLines,
  FieldTotals,
  GroupData,
  LineItem,
  SET_SLOTS,
} from './types.js';

// 税込単価のみで入力する項目（税抜単価・税率を使わない）
const TAX_INCL_FIELDS: FieldKey[] = ['price', 'coupon'];
const POINT_KEY: FieldKey = 'pointup';
const FEE_KEY: FieldKey = 'fee';
export const COUPON_TAX = 8; // クーポンの税抜換算は8%固定

export function isTaxInclField(key: FieldKey): boolean {
  return TAX_INCL_FIELDS.includes(key);
}
export function isPointField(key: FieldKey): boolean {
  return key === POINT_KEY;
}
export function isFeeField(key: FieldKey): boolean {
  return key === FEE_KEY;
}

// マスに直接入力する項目（販売金額・クーポン）。それ以外は明細オーバーレイ経由。
const DIRECT_FIELDS: FieldKey[] = ['price', 'coupon'];
export function isDirectField(key: FieldKey): boolean {
  return DIRECT_FIELDS.includes(key);
}

// 文字列入力を数値化。空欄・不正値は null
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

// 四捨五入
export function r(n: number): number {
  return Math.round(n);
}

// 明細1行 → 税込金額
export function lineAmount(ln: LineItem): number {
  if (ln.fee) {
    const amt = toNum(ln.amount);
    return amt === null ? 0 : r(amt);
  }
  const unit = toNum(ln.unit);
  const qty = toNum(ln.qty);
  if (unit === null) return 0;
  const q = qty === null ? 1 : qty;
  const yv = ln.yld != null ? toNum(ln.yld) : null;
  const ydiv = yv != null && yv > 0 ? yv / 100 : 1;
  if (ln.incl) {
    return r((unit * q) / ydiv);
  }
  const tax = toNum(ln.tax);
  const t = tax === null ? 0 : tax;
  return r((unit * (1 + t / 100) * q) / ydiv);
}

export function linesTotal(lines: LineItem[] | undefined): number {
  let s = 0;
  (lines || []).forEach((ln) => {
    s += lineAmount(ln);
  });
  return s;
}

// 税抜額換算
export function lineAmountEx(ln: LineItem, inclTaxRate: number | null): number {
  if (ln.fee) {
    const amt = toNum(ln.amount);
    return amt === null ? 0 : amt;
  }
  const unit = toNum(ln.unit);
  const qty = toNum(ln.qty);
  if (unit === null) return 0;
  const q = qty === null ? 1 : qty;
  const yv = ln.yld != null ? toNum(ln.yld) : null;
  const ydiv = yv != null && yv > 0 ? yv / 100 : 1;
  if (ln.incl) {
    const t = inclTaxRate == null ? 0 : inclTaxRate;
    return (unit * q) / ydiv / (1 + t / 100);
  }
  return (unit * q) / ydiv;
}

export function linesExTotal(lines: LineItem[] | undefined, inclTaxRate: number | null): number {
  let s = 0;
  (lines || []).forEach((ln) => {
    s += lineAmountEx(ln, inclTaxRate);
  });
  return s;
}

// ポイントUP明細の倍率(%)合計
export function pointMultSum(lines: LineItem[] | undefined): number {
  let s = 0;
  (lines || []).forEach((ln) => {
    const m = toNum(ln.mult);
    if (m !== null) s += m;
  });
  return s;
}

// 手数料1行ぶんの税込金額（明細入力オーバーレイでの行プレビュー用）
export function feeLineAmount(ln: LineItem, base: number): number {
  const pct = toNum(ln.pct);
  if (pct === null) return 0;
  const ft = toNum(ln.ftax);
  const tf = (ft === null ? 0 : ft) / 100;
  return base * (pct / 100) * (1 + tf);
}

// 手数料の負担額: Σ( base × pct% × (1+ftax%) )  ※modeが'ex'なら税抜のまま
export function feeTotal(base: number, lines: LineItem[] | undefined, mode: 'ex' | 'incl'): number {
  let s = 0;
  (lines || []).forEach((ln) => {
    const pct = toNum(ln.pct);
    if (pct === null) return;
    const ft = toNum(ln.ftax);
    const tf = (ft === null ? 0 : ft) / 100;
    const ex = base * (pct / 100);
    s += mode === 'ex' ? ex : ex * (1 + tf);
  });
  return s;
}

function emptyFieldTotals(): FieldTotals {
  const f = {} as FieldTotals;
  FIELDS.forEach((x) => {
    f[x.key] = [null, null, null, null, null];
  });
  return f;
}

export function emptyFieldLines(): FieldLines {
  const l = {} as FieldLines;
  FIELDS.forEach((x) => {
    l[x.key] = [[], [], [], [], []];
  });
  return l;
}

export function groupHasInput(lines: FieldLines): boolean {
  return (lines.price?.[0] || []).length > 0;
}

// 入力中の明細(FieldLines)から1区分(通常/SALE/クーポン)分の計算結果を生成
export function computeGroupFromLines(lines: FieldLines, priceTaxRate: number): GroupData {
  const fields = emptyFieldTotals();
  const priceTotals: number[] = [];
  for (let i = 0; i < SET_SLOTS; i++) {
    const ls = lines.price?.[i] || [];
    priceTotals.push(ls.length ? linesTotal(ls) : 0);
  }
  const netTotals: number[] = [];
  for (let i = 0; i < SET_SLOTS; i++) {
    netTotals.push(priceTotals[i] - linesTotal(lines.coupon?.[i] || []));
  }
  const clonedLines = emptyFieldLines();
  FIELDS.forEach((f) => {
    for (let i = 0; i < SET_SLOTS; i++) {
      const ls = lines[f.key]?.[i] || [];
      clonedLines[f.key][i] = JSON.parse(JSON.stringify(ls));
      if (isPointField(f.key)) {
        fields[f.key][i] = ls.length ? r((priceTotals[i] * pointMultSum(ls)) / 100) : null;
      } else if (isFeeField(f.key)) {
        fields[f.key][i] = ls.length ? r(feeTotal(netTotals[i], ls, 'incl')) : null;
      } else {
        fields[f.key][i] = ls.length ? linesTotal(ls) : null;
      }
    }
  });
  return finalizeGroup({ fields, lines: clonedLines }, priceTaxRate);
}

// fields(税込合算[5])から prices/rates/ratesEx/profits/profitsEx を確定。
// 空セットは1セット目を踏襲する。
export function finalizeGroup(
  g: { fields: FieldTotals; lines?: FieldLines },
  pTax: number | null | undefined
): GroupData {
  const priceTax = pTax == null ? 10 : pTax;
  FIELDS.forEach((f) => {
    const arr = g.fields[f.key];
    const v1 = arr[0];
    for (let i = 0; i < SET_SLOTS; i++) {
      if (arr[i] === null) arr[i] = v1;
    }
    if (g.lines) {
      for (let i = 0; i < SET_SLOTS; i++) {
        if (!g.lines[f.key][i] || g.lines[f.key][i].length === 0) {
          g.lines[f.key][i] = JSON.parse(JSON.stringify(g.lines[f.key][0] || []));
        }
      }
    }
  });

  const lines = g.lines ?? emptyFieldLines();
  const prices = g.fields.price.slice();
  const rates: Array<number | null> = [];
  const ratesEx: Array<number | null> = [];
  const profits: Array<number | null> = [];
  const profitsEx: Array<number | null> = [];

  function exTotal(fieldKey: FieldKey, i: number): number {
    const ls = lines[fieldKey][i] || [];
    if (isPointField(fieldKey)) {
      const priceEx = linesExTotal(lines.price[i] || [], priceTax);
      return r((priceEx || 0) * (pointMultSum(ls) / 100));
    }
    if (isFeeField(fieldKey)) {
      const baseEx =
        linesExTotal(lines.price[i] || [], priceTax) - linesExTotal(lines.coupon[i] || [], COUPON_TAX);
      if (ls.length) return r(feeTotal(baseEx, ls, 'ex'));
      const v = g.fields[fieldKey][i];
      return v == null ? 0 : v;
    }
    let rate: number | null = null;
    if (fieldKey === 'price') rate = priceTax;
    else if (fieldKey === 'coupon') rate = COUPON_TAX;
    if (ls.length) return linesExTotal(ls, rate);
    const v = g.fields[fieldKey][i];
    return v == null ? 0 : v;
  }

  for (let i = 0; i < SET_SLOTS; i++) {
    const price = g.fields.price[i];
    if (price === null || price <= 0) {
      rates.push(null);
      ratesEx.push(null);
      profits.push(null);
      profitsEx.push(null);
      continue;
    }
    let deduct = 0;
    DEDUCT_KEYS.forEach((k) => {
      const v = g.fields[k][i];
      if (v !== null) deduct += v;
    });
    const profit = r(price - deduct);
    profits.push(profit);
    rates.push((profit / price) * 100);

    const priceEx = exTotal('price', i);
    let deductEx = 0;
    DEDUCT_KEYS.forEach((k) => {
      deductEx += exTotal(k, i);
    });
    const profitEx = r(priceEx - deductEx);
    profitsEx.push(profitEx);
    ratesEx.push(priceEx > 0 ? (profitEx / priceEx) * 100 : null);
  }

  return { fields: g.fields, lines, prices, rates, ratesEx, profits, profitsEx };
}

export function cloneGroup(src: GroupData): GroupData {
  const fields = {} as FieldTotals;
  const lines = {} as FieldLines;
  FIELDS.forEach((f) => {
    fields[f.key] = src.fields[f.key].slice();
    lines[f.key] = JSON.parse(JSON.stringify(src.lines[f.key]));
  });
  return {
    fields,
    lines,
    prices: src.prices.slice(),
    rates: src.rates.slice(),
    ratesEx: src.ratesEx.slice(),
    profits: src.profits.slice(),
    profitsEx: src.profitsEx.slice(),
  };
}

export function emptyGroup(priceTaxRate: number): GroupData {
  return finalizeGroup({ fields: emptyFieldTotals(), lines: emptyFieldLines() }, priceTaxRate);
}

// 明細1行分の初期値（項目の種類に応じてテンプレートを変える）
export function newLine(fieldKey: FieldKey, setIndex: number): LineItem {
  if (isPointField(fieldKey)) return { mult: '' };
  if (isFeeField(fieldKey)) return { desc: '', pct: '', ftax: '10', fee: true };
  if (fieldKey === 'price') return { desc: '', unit: '', qty: String(setIndex + 1), incl: true };
  if (isTaxInclField(fieldKey)) return { desc: '', unit: '', qty: '1', incl: true };
  if (fieldKey === 'cost') return { desc: '', unit: '', tax: '10', qty: String(setIndex + 1), yld: '100' };
  return { desc: '', unit: '', tax: '10', qty: '1' };
}

// 販売金額マスへの直接入力 → price明細(5セット分)を更新する。
// 1セット目に入力したときは、2〜5セット目へ「1セット単価 × セット数」を自動入力する。
// 2セット目以降への入力は、そのセットだけを上書きする（まとめ買い割引などの手動指定用）。
// ※1セット目を後から変更すると、2セット目以降の手入力は自動計算で上書きされる。
export function applyDirectPriceInput(
  current: LineItem[][],
  setIndex: number,
  value: unknown
): LineItem[][] {
  const v = toNum(value);
  const next = current.slice();
  if (setIndex === 0) {
    for (let k = 0; k < SET_SLOTS; k++) {
      next[k] = v === null ? [] : [{ unit: String(v), qty: String(k + 1), incl: true }];
    }
  } else {
    next[setIndex] = v === null ? [] : [{ unit: String(v), qty: '1', incl: true }];
  }
  return next;
}

// オーバーレイを開いた時点で明細が空の場合の初期行（荷造包装費・商品原価・手数料は業務上よく使う項目を先出しする）
export function defaultDraftLines(fieldKey: FieldKey, setIndex: number): LineItem[] {
  if (fieldKey === 'pack') {
    return [
      { desc: '受注費', unit: '', tax: '10', qty: '1' },
      { desc: '出荷費', unit: '', tax: '10', qty: '1' },
    ];
  }
  if (fieldKey === 'cost') {
    return [{ desc: '原価', unit: '', tax: '10', qty: String(setIndex + 1), yld: '100' }];
  }
  if (fieldKey === 'fee') {
    return [{ desc: 'サイト手数料', pct: '', ftax: '10', fee: true }];
  }
  return [newLine(fieldKey, setIndex)];
}
