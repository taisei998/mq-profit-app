import {
  DashboardSummary,
  FieldLines,
  GroupData,
  ImportBatchRecord,
  MallRecord,
  MaterialRecord,
  OrderAggregationResult,
  OrderColumnMapping,
  OrderProductLookup,
  ProductRecord,
  ProductStatus,
  ShippingRateRecord,
  ShopRecord,
  SiteFeeRecord,
  aggregateOrders,
  cloneGroup,
  computeGroupFromLines,
  groupHasInput,
} from '@ec-ai/shared';
import { http, query } from './http.js';

// 画面とサーバーのやり取りをまとめた場所。
//
// 接続先は、同じコンテナが返す `/api/...` です。
// （以前はブラウザからSupabaseへ直接つないでいましたが、社内アプリ基盤の
//   動的レーンに合わせて、自前のサーバー経由に戻しました。経緯は docs/design-gap.md）
//
// 関数名と引数は以前のまま保っているので、各画面のコードは変えずに済みます。
//
// 【計算をどこでやるか】
//   粗利の計算(computeGroupFromLines)と受注の集計(aggregateOrders)は、
//   packages/shared にあるものを**ブラウザで**動かしています。
//   本番のコンテナはCPU 256と小さく、重い処理をサーバーでやると
//   ヘルスチェックが時間内に返せなくなり、使っている人全員が巻き添えになります。

export interface ProductInputPayload {
  shopId: string;
  status?: ProductStatus;
  mgmtNo?: string;
  code: string;
  name: string;
  spec: string;
  note: string;
  category: string;
  priceTaxRate: number;
  setCount: number;
  normalLines: FieldLines;
  saleLines?: FieldLines;
  couponLines?: FieldLines;
}

// 商品の3区分（通常/SALE/クーポン）を明細から計算する。
function buildGroups(input: ProductInputPayload): {
  normal: GroupData;
  sale: GroupData;
  coupon: GroupData;
} {
  if (!groupHasInput(input.normalLines)) {
    throw new Error('「通常時」1セットの販売金額を入力してください。');
  }
  const normal = computeGroupFromLines(input.normalLines, input.priceTaxRate);
  const sale =
    input.saleLines && groupHasInput(input.saleLines)
      ? computeGroupFromLines(input.saleLines, input.priceTaxRate)
      : cloneGroup(normal);
  const coupon =
    input.couponLines && groupHasInput(input.couponLines)
      ? computeGroupFromLines(input.couponLines, input.priceTaxRate)
      : cloneGroup(sale);
  return { normal, sale, coupon };
}

/** 受注CSVの商品コードから原価情報を引くための表を作る */
async function buildLookup(shopId: string): Promise<Record<string, OrderProductLookup>> {
  const rows = await http.get<
    Array<{
      id: string;
      code: string;
      name: string;
      category: string;
      normal: GroupData;
      sale: GroupData;
      coupon: GroupData;
    }>
  >(`/products/lookup${query({ shopId })}`);

  const lookup: Record<string, OrderProductLookup> = {};
  for (const p of rows) {
    lookup[p.code] = {
      productId: p.id,
      name: p.name,
      category: p.category,
      normal: p.normal,
      sale: p.sale,
      coupon: p.coupon,
    };
  }
  return lookup;
}

export const api = {
  /** ログイン中の利用者。未ログインなら NotLoggedIn が投げられる */
  me: () => http.get<{ id: string; name: string; division: string | null; email: string | null }>('/me'),

  products: {
    list: () => http.get<ProductRecord[]>('/products'),
    get: (id: string) => http.get<ProductRecord>(`/products/${id}`),
    save: (input: ProductInputPayload) => {
      const groups = buildGroups(input);
      // 同じ店舗に同じ商品コードがあれば上書き、無ければ追加。
      // 固有ID(A0001...)と登録者はサーバー側で保たれる（上書きされない）。
      return http.post<ProductRecord>('/products', {
        shopId: input.shopId,
        code: input.code,
        mgmtNo: input.mgmtNo || null,
        status: input.status ?? 'draft',
        name: input.name,
        spec: input.spec,
        note: input.note,
        category: input.category,
        priceTaxRate: input.priceTaxRate,
        setCount: input.setCount,
        normal: groups.normal,
        sale: groups.sale,
        coupon: groups.coupon,
      });
    },
    remove: async (id: string): Promise<void> => {
      await http.del(`/products/${id}`);
    },
    setStatus: (id: string, status: ProductStatus) =>
      http.post<ProductRecord>(`/products/${id}/status`, { status }),
  },

  sites: {
    list: () => http.get<SiteFeeRecord[]>('/sites'),
    save: (input: Omit<SiteFeeRecord, 'id'>) => http.post<SiteFeeRecord>('/sites', input),
    remove: async (id: string): Promise<void> => {
      await http.del(`/sites/${id}`);
    },
  },

  shipping: {
    list: () => http.get<ShippingRateRecord[]>('/shipping'),
    save: (input: Omit<ShippingRateRecord, 'id'>) => http.post<ShippingRateRecord>('/shipping', input),
    remove: async (id: string): Promise<void> => {
      await http.del(`/shipping/${id}`);
    },
  },

  materials: {
    list: () => http.get<MaterialRecord[]>('/materials'),
    save: (input: Omit<MaterialRecord, 'id'>) => http.post<MaterialRecord>('/materials', input),
    remove: async (id: string): Promise<void> => {
      await http.del(`/materials/${id}`);
    },
  },

  malls: {
    list: () => http.get<MallRecord[]>('/malls'),
    save: (input: { name: string; sortOrder: number }) => http.post<MallRecord>('/malls', input),
    remove: async (id: string): Promise<void> => {
      await http.del(`/malls/${id}`);
    },
  },

  shops: {
    list: () => http.get<ShopRecord[]>('/shops'),
    save: (input: { mallId: string; name: string; sortOrder: number }) =>
      http.post<ShopRecord>('/shops', input),
    remove: async (id: string): Promise<void> => {
      await http.del(`/shops/${id}`);
    },
  },

  orders: {
    /** プレビュー。保存はしない */
    aggregate: async (
      shopId: string,
      rows: string[][],
      mapping: OrderColumnMapping
    ): Promise<OrderAggregationResult> => {
      const lookup = await buildLookup(shopId);
      return aggregateOrders(rows, mapping, lookup);
    },

    /**
     * 取込実行。
     * 集計はここ（ブラウザ）で行い、結果だけサーバーへ送る。
     * サーバー側は取込履歴と受注明細を1トランザクションでまとめて保存するので、
     * 途中で失敗しても件数が合わなくなることはない。
     */
    import: async (
      shopId: string,
      rows: string[][],
      mapping: OrderColumnMapping,
      fileName: string
    ): Promise<OrderAggregationResult & { batchId: string }> => {
      const lookup = await buildLookup(shopId);
      const result = aggregateOrders(rows, mapping, lookup, { withDetail: true });
      const unmatchedTotal = Object.values(result.missing).reduce((a, b) => a + b, 0);

      const { batchId } = await http.post<{ batchId: string }>('/orders/import', {
        shopId,
        fileName,
        total: rows.length,
        success: result.matched,
        unmatched: unmatchedTotal,
        error: result.priceMismatch,
        excluded: result.excluded,
        unmatchedDetail: result.missing,
        errorDetail: result.priceMismatchDetail,
        orders: result.detail,
      });

      // 明細は画面で使わないので返さない（件数が多いとメモリを食うため）
      return { ...result, detail: [], batchId };
    },

    batches: () => http.get<ImportBatchRecord[]>('/orders/batches'),

    removeBatch: async (id: string): Promise<void> => {
      // 受注明細は外部キーのCASCADEで一緒に消える
      await http.del(`/orders/batches/${id}`);
    },
  },

  csvMappings: {
    list: () =>
      http.get<Array<{ mallId: string; config: OrderColumnMapping | null; updatedAt: string }>>(
        '/csv-mappings'
      ),
    save: (mallId: string, config: OrderColumnMapping) =>
      http.post<{ mallId: string; config: OrderColumnMapping | null }>('/csv-mappings', {
        mallId,
        config,
      }),
  },

  dashboard: {
    // 受注は件数が多いので、集計はDB側にやらせて結果だけ受け取る
    summary: (params: { from: string; to: string; mallId?: string; shopId?: string; status?: string }) =>
      http.get<DashboardSummary>(
        `/dashboard/summary${query({
          from: params.from,
          to: params.to,
          mallId: params.mallId,
          shopId: params.shopId,
          status: params.status,
        })}`
      ),
  },
};
