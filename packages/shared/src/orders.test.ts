import { describe, expect, it } from 'vitest';
import {
  OrderColumnMapping,
  OrderProductLookup,
  aggregateOrders,
  classifyKind,
  matchKindByPrice,
  toDateKey,
  unitPriceOf,
} from './orders.js';

describe('toDateKey', () => {
  it('時刻つきの受注日時から日付だけを取り出す', () => {
    expect(toDateKey('2026-09-08 00:01:55')).toBe('2026-09-08');
    expect(toDateKey('2026-09-08T00:01:55')).toBe('2026-09-08');
  });

  it('スラッシュ区切り・1桁の月日を YYYY-MM-DD に正規化する', () => {
    expect(toDateKey('2026/9/8 0:01')).toBe('2026-09-08');
    expect(toDateKey('2026/09/08')).toBe('2026-09-08');
  });

  it('YYYYMMDD・和文表記も受け付ける', () => {
    expect(toDateKey('20260908')).toBe('2026-09-08');
    expect(toDateKey('2026年9月8日 10:00')).toBe('2026-09-08');
  });

  it('解釈できない書式は空白より前をそのまま返す / 空欄は空文字', () => {
    expect(toDateKey('第3営業日 12:00')).toBe('第3営業日');
    expect(toDateKey('')).toBe('');
    expect(toDateKey(null)).toBe('');
  });
});

// 粗利率50%の商品を1つだけ持つ商品マスタ
function lookup(): Record<string, OrderProductLookup> {
  const rates = [50, 50, 50, 50, 50];
  const prices = [1000, 900, 800, 800, 800];
  return {
    A001: {
      productId: 'prod-a001',
      name: 'テスト商品',
      category: '米',
      normal: { prices, rates },
      sale: { prices: [900, 900, 900, 900, 900], rates },
      coupon: { prices: [800, 800, 800, 800, 800], rates },
    },
  };
}

const mapping: OrderColumnMapping = {
  dateCol: 0,
  codeCol: 1,
  amountCol: 2,
  qtyCol: 3,
  saleMode: 'all_normal',
  saleCol: 4,
  unitCol: 5,
};

describe('aggregateOrders', () => {
  it('同じ日の受注は、時刻が違っても1日分にまとまる（旧アプリの日別集計バグの修正点）', () => {
    const rows = [
      ['2026-09-08 00:01:55', 'A001', '1000', '1'],
      ['2026-09-08 23:40:12', 'A001', '1000', '1'],
      ['2026-09-09 09:00:00', 'A001', '1000', '1'],
    ];
    const result = aggregateOrders(rows, mapping, lookup());

    expect(Object.keys(result.daily).sort()).toEqual(['2026-09-08', '2026-09-09']);
    expect(result.daily['2026-09-08'].count).toBe(2);
    expect(result.daily['2026-09-08'].sales).toBe(2000);
    expect(result.daily['2026-09-08'].profit).toBe(1000); // 粗利率50%
    expect(result.daily['2026-09-09'].count).toBe(1);
  });

  it('表記ゆれ（2026/9/8 と 2026-09-08）を同じ日として扱う', () => {
    const rows = [
      ['2026/9/8 10:00', 'A001', '1000', '1'],
      ['2026-09-08', 'A001', '1000', '1'],
    ];
    const result = aggregateOrders(rows, mapping, lookup());
    expect(Object.keys(result.daily)).toEqual(['2026-09-08']);
    expect(result.daily['2026-09-08'].count).toBe(2);
  });

  it('未登録の商品コードは missing に積み上げ、集計には入れない', () => {
    const rows = [
      ['2026-09-08 00:01:55', 'A001', '1000', '1'],
      ['2026-09-08 00:02:00', 'X999', '1000', '1'],
    ];
    const result = aggregateOrders(rows, mapping, lookup());
    expect(result.matched).toBe(1);
    expect(result.missing).toEqual({ X999: 1 });
    expect(result.totalSales).toBe(1000);
  });
});

// セットごとに粗利率が違う商品（1セット50% / 2セット60% / 3セット70%…）
function lookupVaryingRates(): Record<string, OrderProductLookup> {
  const prices = [1000, 2000, 3000, 4000, 5000];
  return {
    A001: {
      productId: 'prod-a001',
      name: 'セット別粗利率テスト',
      category: '米',
      normal: { prices, rates: [50, 60, 70, 80, 90] },
      sale: { prices, rates: [40, 50, 60, 70, 80] },
      coupon: { prices, rates: [30, 40, 50, 60, 70] },
    },
  };
}

// 2026-09-16決定（docs/design-gap.md §6-#6）。数量は「個数」であって「セット数」ではない。
// 旧実装は数量3なら3セット目の粗利率(70%)を使っていた。これは誤りで、常に1セット(50%)を使う。
describe('数量は個数として扱い、常に1セットの粗利率を適用する', () => {
  it('数量3でも3セット目ではなく1セット目の粗利率を使う', () => {
    const rows = [['2026-09-08 10:00:00', 'A001', '3000', '3']];
    const result = aggregateOrders(rows, mapping, lookupVaryingRates());

    // 売上3,000 × 1セットの粗利率50% = 1,500（3セット目の70%なら2,100になってしまう）
    expect(result.totalSales).toBe(3000);
    expect(result.totalProfit).toBe(1500);
  });

  it('数量が5を超えても破綻しない（登録は5セットまでだが個数に上限は無い）', () => {
    const rows = [['2026-09-08 10:00:00', 'A001', '11000', '11']];
    const result = aggregateOrders(rows, mapping, lookupVaryingRates());
    expect(result.totalProfit).toBe(5500); // 11,000 × 50%
  });

  it('区分が変われば、その区分の1セット粗利率を使う', () => {
    const byPrice: OrderColumnMapping = { ...mapping, saleMode: 'by_price' };
    // 単価1,000は3区分とも1セット価格が同じなので、normal(50%)が採用される
    const rows = [['2026-09-08 10:00:00', 'A001', '', '2', '', '1000']];
    const result = aggregateOrders(rows, byPrice, lookupVaryingRates());
    expect(result.totalSales).toBe(2000); // 単価1,000 × 2個
    expect(result.totalProfit).toBe(1000); // × 50%
  });
});

describe('classifyKind / matchKindByPrice', () => {
  it('列の文字列から区分を判定する', () => {
    expect(classifyKind('クーポン利用')).toBe('coupon');
    expect(classifyKind('SALE')).toBe('sale');
    expect(classifyKind('セール対象')).toBe('sale');
    expect(classifyKind('割引')).toBe('sale');
    expect(classifyKind('')).toBe('normal');
  });

  // 2026-09-16決定（docs/design-gap.md §6-#12）。近い区分に寄せず、一致しなければ未紐付けにする。
  it('単価が区分の1セット価格と一致したときだけその区分を返す', () => {
    const p = lookup().A001;
    expect(matchKindByPrice(p, 1000)).toBe('normal'); // normal の1セット価格
    expect(matchKindByPrice(p, 900)).toBe('sale');
    expect(matchKindByPrice(p, 800)).toBe('coupon');
  });

  it('どの区分の価格とも一致しなければ null を返す（近い方に寄せない）', () => {
    const p = lookup().A001;
    expect(matchKindByPrice(p, 890)).toBeNull(); // sale(900)に近いが一致しない
    expect(matchKindByPrice(p, 810)).toBeNull(); // coupon(800)に近いが一致しない
    expect(matchKindByPrice(p, 1)).toBeNull();
  });
});

describe('売価が一致しない受注は未紐付けとして除外する', () => {
  const byPrice: OrderColumnMapping = { ...mapping, saleMode: 'by_price' };

  it('一致しない行は集計から外し、内訳を priceMismatchDetail に残す', () => {
    const rows = [
      ['2026-09-08 10:00:00', 'A001', '', '1', '', '1000'], // normal と一致 → 集計される
      ['2026-09-08 11:00:00', 'A001', '', '2', '', '890'], // どの区分とも一致しない
      ['2026-09-08 12:00:00', 'A001', '', '1', '', '890'], // 同上（同じキーで件数が積み上がる）
    ];
    const result = aggregateOrders(rows, byPrice, lookup());

    expect(result.matched).toBe(1);
    expect(result.totalSales).toBe(1000);
    expect(result.priceMismatch).toBe(2);
    expect(result.priceMismatchDetail).toEqual({ 'A001 @890': 2 });
  });

  it('すべて一致すれば priceMismatchDetail は空', () => {
    const rows = [['2026-09-08 10:00:00', 'A001', '', '1', '', '800']];
    const result = aggregateOrders(rows, byPrice, lookup());
    expect(result.priceMismatch).toBe(0);
    expect(result.priceMismatchDetail).toEqual({});
    expect(result.byKind.coupon.count).toBe(1);
  });
});

// 2026-09-16決定 #15・#16。Amazonの注文レポート（単価の列が無い／Cancelledが混ざる）向け。
describe('Amazonの注文レポート形式（単価の列が無い・キャンセルあり）', () => {
  // 列: 0=purchase-date 1=order-status 2=sku 3=quantity 4=item-price
  const amazonMapping: OrderColumnMapping = {
    dateCol: 0,
    codeCol: 2,
    amountCol: 4,
    qtyCol: 3,
    saleMode: 'by_price',
    saleCol: 0,
    unitCol: 4,
    unitMode: 'divide',
    statusCol: 1,
    excludeStatuses: ['Cancelled'],
  };

  it('支払い金額÷数量で単価を出し、数量2以上でも区分を判定できる', () => {
    const rows = [
      ['2026-09-14T23:57:59+09:00', 'Pending', 'A001', '1', '1000'],
      ['2026-09-14T11:37:57+09:00', 'Pending', 'A001', '2', '2000'], // 2000÷2=1000 → normal
    ];
    const result = aggregateOrders(rows, amazonMapping, lookup());

    expect(result.matched).toBe(2);
    expect(result.priceMismatch).toBe(0);
    expect(result.totalSales).toBe(3000); // 1000 + 2000
    expect(result.totalProfit).toBe(1500); // 1セット粗利率50%を数量分
  });

  it('キャンセル行は除外し、未紐付けとしては数えない', () => {
    const rows = [
      ['2026-09-14T23:57:59+09:00', 'Pending', 'A001', '1', '1000'],
      ['2026-09-15T08:00:00+09:00', 'Cancelled', 'A001', '0', '2310'],
      ['2026-09-15T09:00:00+09:00', 'Cancelled', 'X999', '1', '950'], // 未登録コードだが除外が優先
    ];
    const result = aggregateOrders(rows, amazonMapping, lookup());

    expect(result.matched).toBe(1);
    expect(result.excluded).toBe(2);
    expect(result.excludedDetail).toEqual({ Cancelled: 2 });
    expect(result.missing).toEqual({}); // キャンセルは未紐付けに数えない
    expect(result.priceMismatch).toBe(0);
  });

  it('ISO8601（タイムゾーン付き）の受注日時も日別にまとまる', () => {
    const rows = [
      ['2026-09-14T23:57:59+09:00', 'Pending', 'A001', '1', '1000'],
      ['2026-09-14T00:01:00+09:00', 'Shipped', 'A001', '1', '1000'],
    ];
    const result = aggregateOrders(rows, amazonMapping, lookup());
    expect(Object.keys(result.daily)).toEqual(['2026-09-14']);
    expect(result.daily['2026-09-14'].count).toBe(2);
  });

  it('割り切れない単価は未紐付けになる（誤った区分に寄せない）', () => {
    const rows = [['2026-09-14T10:00:00+09:00', 'Pending', 'A001', '3', '2999']];
    const result = aggregateOrders(rows, amazonMapping, lookup());
    expect(result.matched).toBe(0);
    expect(result.priceMismatch).toBe(1);
  });

  it('ステータス列を指定しなければ除外は働かない（既存モールの挙動を変えない）', () => {
    const noStatus: OrderColumnMapping = { ...amazonMapping, statusCol: -1, excludeStatuses: [] };
    const rows = [['2026-09-15T08:00:00+09:00', 'Cancelled', 'A001', '1', '1000']];
    const result = aggregateOrders(rows, noStatus, lookup());
    expect(result.excluded).toBe(0);
    expect(result.matched).toBe(1);
  });

  it('除外する値の大文字小文字は区別しない', () => {
    const rows = [['2026-09-15T08:00:00+09:00', 'CANCELLED', 'A001', '1', '1000']];
    const result = aggregateOrders(rows, amazonMapping, lookup());
    expect(result.excluded).toBe(1);
  });
});

describe('unitPriceOf', () => {
  const base: OrderColumnMapping = {
    dateCol: 0, codeCol: 1, amountCol: 2, qtyCol: 3, saleMode: 'by_price', saleCol: 4, unitCol: 5,
  };

  it('既定は単価の列をそのまま読む', () => {
    expect(unitPriceOf(['', '', '2000', '2', '', '1000'], base, 2)).toBe(1000);
  });

  it('divide指定なら支払い金額÷数量', () => {
    expect(unitPriceOf(['', '', '4990', '2', '', ''], { ...base, unitMode: 'divide' }, 2)).toBe(2495);
  });

  it('金額が読めなければ null', () => {
    expect(unitPriceOf(['', '', '', '2', '', ''], { ...base, unitMode: 'divide' }, 2)).toBeNull();
  });
});
