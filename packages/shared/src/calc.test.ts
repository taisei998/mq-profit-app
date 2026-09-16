import { describe, expect, it } from 'vitest';
import {
  applyDirectPriceInput,
  computeGroupFromLines,
  emptyFieldLines,
  feeTotal,
  lineAmount,
  linesTotal,
  pointMultSum,
  r,
} from './calc.js';

describe('computeGroupFromLines', () => {
  it('computes gross margin rate for a simple product (price 1000, cost 300 ex-tax @10%)', () => {
    const lines = emptyFieldLines();
    lines.price[0] = [{ unit: '1000', qty: '1', incl: true }];
    lines.cost[0] = [{ unit: '300', tax: '10', qty: '1', yld: '100' }];

    const group = computeGroupFromLines(lines, 10);

    // 税込: 1000 - (300*1.1) = 670 → 67.0%
    expect(group.prices[0]).toBe(1000);
    expect(group.profits[0]).toBe(670);
    expect(group.rates[0]).toBeCloseTo(67.0, 5);

    // 税抜: price 1000/1.1=909.09, cost 300(税抜そのまま) → profit 609, rate 66.99..%
    expect(group.profitsEx[0]).toBe(609);
    expect(group.ratesEx[0]).toBeCloseTo(66.99, 1);
  });

  it('carries the 1-set values forward to empty sets (2〜5セット踏襲)', () => {
    const lines = emptyFieldLines();
    lines.price[0] = [{ unit: '1000', qty: '1', incl: true }];
    const group = computeGroupFromLines(lines, 10);
    expect(group.prices[1]).toBe(1000);
    expect(group.rates[1]).toBe(group.rates[0]);
  });

  it('returns null rate when price is zero or unset', () => {
    const lines = emptyFieldLines();
    const group = computeGroupFromLines(lines, 10);
    expect(group.rates[0]).toBeNull();
  });

  it('applies coupon tax rate (8%) for tax-exclusive coupon conversion', () => {
    const lines = emptyFieldLines();
    lines.price[0] = [{ unit: '1000', qty: '1', incl: true }];
    lines.coupon[0] = [{ unit: '100', qty: '1', incl: true }];
    const group = computeGroupFromLines(lines, 10);
    // 税込: 1000 - 100 = 900
    expect(group.profits[0]).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// 設計書「MQ率計算アプリ_設計書.md」§6.1 の必須テストケース。
// ここの数値は旧アプリ（legacy/MQ率計算アプリ.html）の計算結果であり、業務上の正解。
// 1円でもズレたら経営判断に影響するため、リファクタ時は必ずこのブロックを通すこと。
// ---------------------------------------------------------------------------
describe('設計書§6.1 必須テストケース', () => {
  it('[税込換算] 税抜333円 × 税率8% × 数量1 → 360円（359.64の四捨五入）', () => {
    expect(lineAmount({ unit: '333', tax: '8', qty: '1' })).toBe(360);
  });

  it('[歩留まり] 税抜1,000円 × 税率10% × 数量2 ÷ 歩留まり90% → 2,444円', () => {
    expect(lineAmount({ unit: '1000', tax: '10', qty: '2', yld: '90' })).toBe(2444);
  });

  it('[歩留まり] 歩留まり100%なら等倍 → 2,200円', () => {
    expect(lineAmount({ unit: '1000', tax: '10', qty: '2', yld: '100' })).toBe(2200);
  });

  it('[歩留まり] 空欄・0はゼロ除算を避けて係数1として扱う', () => {
    expect(lineAmount({ unit: '1000', tax: '10', qty: '2', yld: '' })).toBe(2200);
    expect(lineAmount({ unit: '1000', tax: '10', qty: '2', yld: '0' })).toBe(2200);
  });

  it('[手数料] base税込1,500円 × 10% × (1+10%) → 税込165円 / 税抜150円', () => {
    const lines = [{ desc: 'サイト手数料', pct: '10', ftax: '10', fee: true }];
    expect(r(feeTotal(1500, lines, 'incl'))).toBe(165);
    expect(r(feeTotal(1500, lines, 'ex'))).toBe(150);
  });

  it('[ポイントUP] 販売金額5,500円 × 3倍 → 165円', () => {
    expect(r((5500 * pointMultSum([{ mult: '3' }])) / 100)).toBe(165);
  });

  it('[ポイントUP] 販売金額5,555円 × 3倍 → 167円（166.65の四捨五入）', () => {
    expect(r((5555 * pointMultSum([{ mult: '3' }])) / 100)).toBe(167);
  });

  it('[販売金額の自動計算] 1セット税込3,000円 → 2〜5セットに3,000×セット数を自動入力', () => {
    const filled = applyDirectPriceInput(emptyFieldLines().price, 0, '3000');
    expect(filled.map((ls) => linesTotal(ls))).toEqual([3000, 6000, 9000, 12000, 15000]);
  });

  it('[販売金額の自動計算] 2セット目以降は手動上書きできる（まとめ買い割引）', () => {
    let price = applyDirectPriceInput(emptyFieldLines().price, 0, '3000');
    price = applyDirectPriceInput(price, 1, '5500'); // 2セットを割引価格に
    expect(price.map((ls) => linesTotal(ls))).toEqual([3000, 5500, 9000, 12000, 15000]);

    // 1セット目を変更すると2セット目以降は自動計算で上書きされる（設計書§3.6の注意書き）
    price = applyDirectPriceInput(price, 0, '4000');
    expect(price.map((ls) => linesTotal(ls))).toEqual([4000, 8000, 12000, 16000, 20000]);
  });

  it('[粗利] 販売5,500 / クーポン540 / 原価(税抜)2,000・税率10% → 2,760円・50.2% / 2,500円・50.0%', () => {
    const lines = emptyFieldLines();
    lines.price[0] = [{ unit: '5500', qty: '1', incl: true }];
    lines.coupon[0] = [{ unit: '540', qty: '1', incl: true }];
    lines.cost[0] = [{ desc: '原価', unit: '2000', tax: '10', qty: '1', yld: '100' }];

    const group = computeGroupFromLines(lines, 10);

    expect(group.profits[0]).toBe(2760);
    expect(group.rates[0]!.toFixed(1)).toBe('50.2');
    expect(group.profitsEx[0]).toBe(2500);
    expect(group.ratesEx[0]!.toFixed(1)).toBe('50.0');
  });
});
