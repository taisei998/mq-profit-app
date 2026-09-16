import { CATEGORIES, FIELDS, FieldKey } from '@ec-ai/shared';
import { z } from 'zod';

export const lineItemSchema = z
  .object({
    desc: z.string().max(200).optional(),
    unit: z.string().max(30).optional(),
    tax: z.string().max(10).optional(),
    qty: z.string().max(10).optional(),
    incl: z.boolean().optional(),
    yld: z.string().max(10).optional(),
    mult: z.string().max(10).optional(),
    fee: z.boolean().optional(),
    pct: z.string().max(10).optional(),
    ftax: z.string().max(10).optional(),
    amount: z.string().max(30).optional(),
  })
  .strict();

const fieldKeys = FIELDS.map((f) => f.key) as [FieldKey, ...FieldKey[]];

// 1区分ぶんの入力（項目ごとに5セット分の明細配列）
const fieldLinesShape = Object.fromEntries(
  fieldKeys.map((key) => [key, z.array(z.array(lineItemSchema)).length(5)])
) as Record<FieldKey, z.ZodArray<z.ZodArray<typeof lineItemSchema>>>;
export const fieldLinesSchema = z.object(fieldLinesShape).strict();

export const productInputSchema = z.object({
  // 商品コードは「店舗＋コード」で一意（#11）。どの店舗の商品かが分からないと登録できない
  shopId: z.string().min(1, '店舗を選んでください'),
  mgmtNo: z.string().trim().max(100).optional().default(''),
  code: z.string().trim().min(1, '商品コードは必須です').max(100),
  name: z.string().trim().max(200).optional().default(''),
  spec: z.string().trim().max(200).optional().default(''),
  note: z.string().trim().max(4000).optional().default(''),
  category: z.enum(CATEGORIES),
  priceTaxRate: z.number().int().min(0).max(100).default(10),
  setCount: z.number().int().min(1).max(5).default(5),
  status: z.enum(['draft', 'pending', 'approved', 'rejected', 'selling', 'ended']).default('draft'),
  normalLines: fieldLinesSchema,
  saleLines: fieldLinesSchema.optional(),
  couponLines: fieldLinesSchema.optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const siteFeeOtherSchema = z.object({
  desc: z.string().trim().max(100).default(''),
  pct: z.number().nullable(),
});

export const siteFeeInputSchema = z.object({
  name: z.string().trim().min(1, 'サイト名は必須です').max(100),
  fee: z.number().nullable().optional(),
  couponFee: z.number().nullable().optional(),
  consultFee: z.number().nullable().optional(),
  otherFees: z.array(siteFeeOtherSchema).max(50).default([]),
  note: z.string().trim().max(2000).optional().default(''),
});
export type SiteFeeInput = z.infer<typeof siteFeeInputSchema>;

export const shippingRateInputSchema = z.object({
  carrier: z.string().trim().max(100).optional().default(''),
  temp: z.string().trim().max(100).optional().default(''),
  size: z.string().trim().max(100).optional().default(''),
  unitPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100).default(10),
});
export type ShippingRateInput = z.infer<typeof shippingRateInputSchema>;

export const materialInputSchema = z.object({
  name: z.string().trim().min(1, '資材名は必須です').max(100),
  unitPrice: z.number().min(0),
  taxRate: z.number().min(0).max(100).default(10),
});
export type MaterialInput = z.infer<typeof materialInputSchema>;

export const mallInputSchema = z.object({
  name: z.string().trim().min(1, 'モール名は必須です').max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type MallInput = z.infer<typeof mallInputSchema>;

export const shopInputSchema = z.object({
  mallId: z.string().min(1, 'モールを選んでください'),
  name: z.string().trim().min(1, '店舗名は必須です').max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type ShopInput = z.infer<typeof shopInputSchema>;

export const idParamSchema = z.object({ id: z.string().min(1) });

// 商品ステータス。draft→pending→approved→selling→ended、pending→rejected→draft
export const PRODUCT_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'selling', 'ended'] as const;
export const productStatusInputSchema = z.object({
  status: z.enum(PRODUCT_STATUSES),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const dashboardQuerySchema = z.object({
  from: z.string().regex(DATE_RE, '日付は YYYY-MM-DD で指定してください'),
  to: z.string().regex(DATE_RE, '日付は YYYY-MM-DD で指定してください'),
  mallId: z.string().min(1).optional(),
  shopId: z.string().min(1).optional(),
  // 受注が紐づいた商品のステータスで絞り込む
  status: z.enum(PRODUCT_STATUSES).optional(),
});

// ③粗利集計: 受注CSVの行データ＋列マッピング
const MAX_ORDER_ROWS = 50_000;
const MAX_ORDER_COLS = 200;

export const orderAggregateInputSchema = z.object({
  // どの店舗の受注ファイルかを必ず指定する（2026-09-16決定 #17）。
  // 商品コードは店舗ごとに一意なので、店舗が分からないと商品を引き当てられない。
  shopId: z.string().min(1, '店舗を選んでください'),
  rows: z
    .array(z.array(z.string().max(500)).max(MAX_ORDER_COLS))
    .max(MAX_ORDER_ROWS, `一度に集計できるのは${MAX_ORDER_ROWS}行までです。`),
  mapping: z.object({
    dateCol: z.number().int().min(0),
    codeCol: z.number().int().min(0),
    amountCol: z.number().int().min(0),
    qtyCol: z.number().int().min(0),
    saleMode: z.enum(['all_normal', 'all_sale', 'all_coupon', 'by_column', 'by_price']),
    saleCol: z.number().int().min(0),
    unitCol: z.number().int().min(0),
    // 注文番号の列（任意）。受注を保存するときの参照用
    orderNoCol: z.number().int().min(-1).optional(),
    // 単価の列が無いモール（Amazon）向け。'divide' なら支払い金額÷数量で単価を出す
    unitMode: z.enum(['column', 'divide']).optional(),
    // 注文ステータスによる除外（Amazonの 'Cancelled' など）。-1 は「使わない」
    statusCol: z.number().int().min(-1).optional(),
    excludeStatuses: z.array(z.string().trim().max(50)).max(20).optional(),
  }),
});
export type OrderAggregateInput = z.infer<typeof orderAggregateInputSchema>;

// 取込実行（集計に加えてファイル名を受け取り、受注明細と履歴をDBに保存する）
export const orderImportInputSchema = orderAggregateInputSchema.extend({
  fileName: z.string().trim().min(1).max(300),
});
export type OrderImportInput = z.infer<typeof orderImportInputSchema>;

// モール別CSV列マッピングの保存
export const mallCsvMappingInputSchema = z.object({
  mallId: z.string().min(1),
  config: orderAggregateInputSchema.shape.mapping,
});
export type MallCsvMappingInput = z.infer<typeof mallCsvMappingInputSchema>;
