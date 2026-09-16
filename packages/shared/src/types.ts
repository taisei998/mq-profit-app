// 商品登録の区分（通常時／SALE時／SALE＋クーポン時）
export const GROUPS = ['normal', 'sale', 'coupon'] as const;
export type GroupKey = (typeof GROUPS)[number];

export const GROUP_LABEL: Record<GroupKey, string> = {
  normal: '通常',
  sale: 'SALE',
  coupon: 'SALE+クーポン',
};

export const GROUP_COLOR: Record<GroupKey, string> = {
  normal: 'var(--accent)',
  sale: 'var(--sale)',
  coupon: 'var(--coupon)',
};

// 各区分に登録できる項目（原価・送料・手数料など）
export const FIELDS = [
  { key: 'price', label: '販売金額' },
  { key: 'coupon', label: 'クーポン' },
  { key: 'cost', label: '商品原価', tip: '仕入れ値など、商品そのものの原価' },
  { key: 'mfg', label: '製造原価', tip: '人件費や精米費など' },
  { key: 'pack', label: '荷造包装費', tip: '受注費、出荷費など' },
  { key: 'material', label: '資材費', tip: '同梱ツール、袋、箱など' },
  { key: 'ship', label: '発送運賃', tip: '送料' },
  { key: 'fee', label: '手数料', tip: 'LINE送信費やクーポン手数料やモール手数料やコンサル手数料や支援金など' },
  { key: 'pointup', label: 'ポイントUP', tip: 'ポイント倍率' },
  { key: 'other', label: 'その他', tip: '上記に含まれないものがあれば' },
] as const;

export type FieldKey = (typeof FIELDS)[number]['key'];
export const FIELD_LABEL: Record<FieldKey, string> = Object.fromEntries(
  FIELDS.map((f) => [f.key, f.label])
) as Record<FieldKey, string>;

// 粗利計算で「販売金額」から差し引く項目
export const DEDUCT_KEYS: FieldKey[] = [
  'coupon', 'cost', 'mfg', 'pack', 'material', 'ship', 'fee', 'pointup', 'other',
];

export const SET_SLOTS = 5; // 1〜5セット固定

// 明細1行分。項目の種類によって使うプロパティが変わる（原価/送料/資材＝単価×数量、
// 販売金額/クーポン＝税込単価×数量、ポイントUP＝倍率%、手数料＝%＋税率%）
export interface LineItem {
  desc?: string;
  unit?: string;   // 単価（税抜 or 税込。incl フラグで判定）
  tax?: string;     // 税率%（原価類）
  qty?: string;     // 数量
  incl?: boolean;   // true: 税込単価入力 / false: 税抜単価入力
  yld?: string;      // 歩留まり%（商品原価のみ）
  mult?: string;     // ポイント倍率%（ポイントUPのみ）
  fee?: boolean;      // 手数料行フラグ
  pct?: string;       // 手数料%
  ftax?: string;      // 手数料の税率%
  amount?: string;    // 未使用（将来拡張用の直接金額）
}

// setIndex(0-4) ごとの明細配列
export type LineSet = LineItem[][]; // length 5

export type FieldLines = Record<FieldKey, LineSet>;
export type FieldTotals = Record<FieldKey, Array<number | null>>; // 各フィールドの5セット分・税込合算

// 1区分（通常/SALE/クーポン）の計算結果一式
export interface GroupData {
  fields: FieldTotals;      // 項目ごとの税込合算 [5]
  lines: FieldLines;        // 項目ごとの明細 [5][]
  prices: Array<number | null>;    // 販売金額(税込) [5]
  rates: Array<number | null>;     // 粗利率(税込%) [5]
  ratesEx: Array<number | null>;   // 粗利率(税抜%) [5]
  profits: Array<number | null>;   // 粗利額(税込) [5]
  profitsEx: Array<number | null>; // 粗利額(税抜) [5]
}

// 稟議ステータス。稟議そのものはジョブカンで回し、ここでは状態の記録だけを持つ
export const PRODUCT_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'selling', 'ended'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const STATUS_LABEL: Record<ProductStatus, string> = {
  draft: '下書き',
  pending: '稟議中',
  approved: '承認済み',
  rejected: '却下',
  selling: '販売中',
  ended: '販売終了',
};

export interface ProductRecord {
  id: string;          // DBのレコードID
  productId: string;   // 固有ID (A0001...)
  mgmtNo?: string | null; // 管理番号（MZ0001など。同じ商品を複数モールに出す場合の横断キーに使える）
  status: ProductStatus;
  createdBy?: string | null; // 認証未実装のため現状は常にnull
  updatedBy?: string | null;
  code: string;        // 商品コード（店舗ごとにprefixが変わるため、店舗＋コードで一意）
  shopId: string;      // 出品している店舗
  shopName: string;    // 一覧表示用
  mallId: string;      // 店舗から辿ったモール（絞り込み・集計軸用）
  mallName: string;
  name: string;
  spec?: string | null;
  note?: string | null;
  category: string;
  priceTaxRate: number; // 販売金額の税率%
  setCount: number;     // 表示するセット数(1〜5)
  normal: GroupData;
  sale: GroupData;
  coupon: GroupData;
  createdAt?: string;
  updatedAt?: string;
}

export interface SiteFeeOther {
  desc: string;
  pct: number | null;
}

// モールマスタ（楽天市場 / Yahoo!ショッピング / au PAY マーケット / Amazon / 自社EC）
export interface MallRecord {
  id: string;
  name: string;
  sortOrder: number;
  shopCount: number; // ぶら下がっている店舗数。削除できるかの判断に使う
}

// 店舗マスタ。1モールに複数店舗がぶら下がる
export interface ShopRecord {
  id: string;
  mallId: string;
  mallName: string; // 一覧表示用（Shop単体では親モール名が分からないため付けて返す）
  name: string;
  sortOrder: number;
}

export interface SiteFeeRecord {
  id: string;
  name: string;
  fee: number | null;
  couponFee: number | null;
  consultFee: number | null;
  otherFees: SiteFeeOther[];
  note?: string | null;
}

export interface ShippingRateRecord {
  id: string;
  carrier?: string | null;
  temp?: string | null;
  size?: string | null;
  unitPrice: number;
  taxRate: number;
}

export interface MaterialRecord {
  id: string;
  name: string;
  unitPrice: number;
  taxRate: number;
}

export const CATEGORIES = [
  '青果', '精肉・肉加工品', '魚介・水産加工品', '雑穀米', '米',
  '惣菜・調味料', '水・ソフトドリンク', 'お菓子・パン', 'その他',
] as const;
export type Category = (typeof CATEGORIES)[number];

// 取込履歴1件（設計書§5.4の「取込履歴」）
export interface ImportBatchRecord {
  id: string;
  shopId: string;
  shopName: string;
  mallName: string;
  fileName: string;
  importedAt: string;
  totalCount: number;
  successCount: number;
  unmatchedCount: number;
  errorCount: number;
  excludedCount: number;
  unmatchedDetail: Record<string, number>;
  errorDetail: Record<string, number>;
  status: string;
}

// HOMEダッシュボードの集計結果
export interface DashboardSummary {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  kpi: {
    sales: number;
    profit: number;
    rate: number | null;
    count: number;
    prevSales: number;
    prevProfit: number;
    prevRate: number | null;
    prevCount: number;
  };
  monthly: Array<{ month: string; sales: number; profit: number; count: number }>;
  daily: Array<{ date: string; sales: number; profit: number; count: number }>;
  byMall: Array<{ mallId: string; mallName: string; sales: number; profit: number; count: number }>;
  topProducts: Array<{
    rank: number;
    productId: string;
    name: string;
    code: string;
    sales: number;
    profit: number;
    count: number;
  }>;
  alerts: { unmatched: number; errors: number; mallsWithoutImport: string[] };
}
