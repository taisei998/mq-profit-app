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
import { supabase, unwrap } from './supabase.js';

// 以前はExpressのREST APIを叩いていたが、Supabaseへ直接つなぐ形に変えた。
// 画面側のコードを変えずに済むよう、関数名と引数は以前のまま保っている。
//
// 粗利の計算(computeGroupFromLines)や受注の集計(aggregateOrders)は
// packages/shared にあり、ブラウザでもそのまま動く。テスト済みのロジックを
// 書き換えずに流用できるので、数値がずれる心配がない。

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

// 商品1件（店舗・モールを一緒に引いたもの）を画面用の形に直す
interface ProductRow {
  id: string;
  productId: string;
  mgmtNo: string | null;
  code: string;
  shopId: string;
  name: string;
  spec: string | null;
  note: string | null;
  category: string;
  priceTaxRate: number;
  setCount: number;
  status: ProductStatus;
  createdBy: string | null;
  updatedBy: string | null;
  normalData: GroupData;
  saleData: GroupData;
  couponData: GroupData;
  createdAt: string;
  updatedAt: string;
  shop: { id: string; name: string; mallId: string; mall: { id: string; name: string } } | null;
}

const PRODUCT_SELECT = '*, shop:shops(id, name, mallId, mall:malls(id, name))';

function toProduct(r: ProductRow): ProductRecord {
  return {
    id: r.id,
    productId: r.productId,
    mgmtNo: r.mgmtNo,
    status: r.status,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    code: r.code,
    shopId: r.shopId,
    shopName: r.shop?.name ?? '',
    mallId: r.shop?.mallId ?? '',
    mallName: r.shop?.mall?.name ?? '',
    name: r.name,
    spec: r.spec,
    note: r.note,
    category: r.category,
    priceTaxRate: r.priceTaxRate,
    setCount: r.setCount,
    normal: r.normalData,
    sale: r.saleData,
    coupon: r.couponData,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// 商品の3区分（通常/SALE/クーポン）を明細から計算する。
// 以前はサーバー側でやっていた処理をそのまま持ってきたもの。
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

// 指定店舗の商品を「商品コード → 集計に必要な情報」の形にする。
// 商品コードは店舗ごとに一意なので、必ず店舗で絞る。
async function buildLookup(shopId: string): Promise<Record<string, OrderProductLookup>> {
  const rows = unwrap(
    await supabase
      .from('products')
      .select('id, code, name, category, normalData, saleData, couponData')
      .eq('shopId', shopId)
  ) as Array<{
    id: string;
    code: string;
    name: string;
    category: string;
    normalData: GroupData;
    saleData: GroupData;
    couponData: GroupData;
  }>;

  const lookup: Record<string, OrderProductLookup> = {};
  for (const p of rows) {
    lookup[p.code] = {
      productId: p.id,
      name: p.name,
      category: p.category,
      normal: p.normalData,
      sale: p.saleData,
      coupon: p.couponData,
    };
  }
  return lookup;
}

export const api = {
  products: {
    list: async (): Promise<ProductRecord[]> => {
      const rows = unwrap(
        await supabase.from('products').select(PRODUCT_SELECT).order('productId', { ascending: true })
      ) as unknown as ProductRow[];
      return rows.map(toProduct);
    },
    get: async (id: string): Promise<ProductRecord> => {
      const row = unwrap(
        await supabase.from('products').select(PRODUCT_SELECT).eq('id', id).single()
      ) as unknown as ProductRow;
      return toProduct(row);
    },
    save: async (input: ProductInputPayload): Promise<ProductRecord> => {
      const groups = buildGroups(input);
      // 同じ店舗に同じ商品コードがあれば上書き、無ければ追加。
      // productId(A0001...) と createdBy はDB側の既定値に任せる（上書きしない）。
      const row = unwrap(
        await supabase
          .from('products')
          .upsert(
            {
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
              normalData: groups.normal,
              saleData: groups.sale,
              couponData: groups.coupon,
            },
            { onConflict: 'shopId,code' }
          )
          .select(PRODUCT_SELECT)
          .single()
      ) as unknown as ProductRow;
      return toProduct(row);
    },
    remove: async (id: string): Promise<void> => {
      unwrap(await supabase.from('products').delete().eq('id', id).select('id'));
    },
    setStatus: async (id: string, status: ProductStatus): Promise<ProductRecord> => {
      const row = unwrap(
        await supabase.from('products').update({ status }).eq('id', id).select(PRODUCT_SELECT).single()
      ) as unknown as ProductRow;
      return toProduct(row);
    },
  },

  sites: {
    list: async (): Promise<SiteFeeRecord[]> =>
      unwrap(await supabase.from('site_fees').select('*').order('name')) as SiteFeeRecord[],
    save: async (input: Omit<SiteFeeRecord, 'id'>): Promise<SiteFeeRecord> =>
      unwrap(
        await supabase.from('site_fees').upsert(input, { onConflict: 'name' }).select('*').single()
      ) as SiteFeeRecord,
    remove: async (id: string): Promise<void> => {
      unwrap(await supabase.from('site_fees').delete().eq('id', id).select('id'));
    },
  },

  shipping: {
    list: async (): Promise<ShippingRateRecord[]> =>
      unwrap(
        await supabase.from('shipping_rates').select('*').order('createdAt')
      ) as ShippingRateRecord[],
    save: async (input: Omit<ShippingRateRecord, 'id'>): Promise<ShippingRateRecord> =>
      unwrap(await supabase.from('shipping_rates').insert(input).select('*').single()) as ShippingRateRecord,
    remove: async (id: string): Promise<void> => {
      unwrap(await supabase.from('shipping_rates').delete().eq('id', id).select('id'));
    },
  },

  materials: {
    list: async (): Promise<MaterialRecord[]> =>
      unwrap(await supabase.from('materials').select('*').order('name')) as MaterialRecord[],
    save: async (input: Omit<MaterialRecord, 'id'>): Promise<MaterialRecord> =>
      unwrap(
        await supabase.from('materials').upsert(input, { onConflict: 'name' }).select('*').single()
      ) as MaterialRecord,
    remove: async (id: string): Promise<void> => {
      unwrap(await supabase.from('materials').delete().eq('id', id).select('id'));
    },
  },

  malls: {
    list: async (): Promise<MallRecord[]> => {
      const rows = unwrap(
        await supabase
          .from('malls')
          .select('id, name, sortOrder, shops(count)')
          .order('sortOrder')
          .order('name')
      ) as Array<{ id: string; name: string; sortOrder: number; shops: Array<{ count: number }> }>;
      return rows.map((m) => ({
        id: m.id,
        name: m.name,
        sortOrder: m.sortOrder,
        shopCount: m.shops?.[0]?.count ?? 0,
      }));
    },
    save: async (input: { name: string; sortOrder: number }): Promise<MallRecord> => {
      const row = unwrap(
        await supabase.from('malls').upsert(input, { onConflict: 'name' }).select('id, name, sortOrder').single()
      ) as { id: string; name: string; sortOrder: number };
      const { count } = await supabase
        .from('shops')
        .select('id', { count: 'exact', head: true })
        .eq('mallId', row.id);
      return { ...row, shopCount: count ?? 0 };
    },
    remove: async (id: string): Promise<void> => {
      // 店舗が残っているモールは外部キーで弾かれる。件数を先に見て分かりやすい文言にする。
      const { count } = await supabase
        .from('shops')
        .select('id', { count: 'exact', head: true })
        .eq('mallId', id);
      if ((count ?? 0) > 0) {
        throw new Error(`このモールには店舗が${count}件登録されています。先に店舗を削除してください。`);
      }
      unwrap(await supabase.from('malls').delete().eq('id', id).select('id'));
    },
  },

  shops: {
    list: async (): Promise<ShopRecord[]> => {
      const rows = unwrap(
        await supabase
          .from('shops')
          .select('id, mallId, name, sortOrder, mall:malls(name, sortOrder)')
          .order('sortOrder')
          .order('name')
      ) as unknown as Array<{
        id: string;
        mallId: string;
        name: string;
        sortOrder: number;
        mall: { name: string; sortOrder: number } | null;
      }>;
      return rows
        .map((s) => ({
          id: s.id,
          mallId: s.mallId,
          mallName: s.mall?.name ?? '',
          name: s.name,
          sortOrder: s.sortOrder,
          _mallOrder: s.mall?.sortOrder ?? 0,
        }))
        .sort((a, b) => a._mallOrder - b._mallOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map(({ _mallOrder, ...rest }) => rest);
    },
    save: async (input: { mallId: string; name: string; sortOrder: number }): Promise<ShopRecord> => {
      const row = unwrap(
        await supabase
          .from('shops')
          .upsert(input, { onConflict: 'mallId,name' })
          .select('id, mallId, name, sortOrder, mall:malls(name)')
          .single()
      ) as unknown as { id: string; mallId: string; name: string; sortOrder: number; mall: { name: string } | null };
      return {
        id: row.id,
        mallId: row.mallId,
        mallName: row.mall?.name ?? '',
        name: row.name,
        sortOrder: row.sortOrder,
      };
    },
    remove: async (id: string): Promise<void> => {
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('shopId', id);
      if ((count ?? 0) > 0) {
        throw new Error(`この店舗には商品が${count}件登録されています。先に商品を削除してください。`);
      }
      unwrap(await supabase.from('shops').delete().eq('id', id).select('id'));
    },
  },

  orders: {
    // プレビュー（DBには保存しない）
    aggregate: async (
      shopId: string,
      rows: string[][],
      mapping: OrderColumnMapping
    ): Promise<OrderAggregationResult> => {
      const lookup = await buildLookup(shopId);
      return aggregateOrders(rows, mapping, lookup);
    },

    // 取込実行。受注明細と履歴は「まとめて保存」でないと件数が合わなくなるため、
    // DB側の関数(import_orders)を1回呼んで1トランザクションで書き込む。
    import: async (
      shopId: string,
      rows: string[][],
      mapping: OrderColumnMapping,
      fileName: string
    ): Promise<OrderAggregationResult & { batchId: string }> => {
      const lookup = await buildLookup(shopId);
      const result = aggregateOrders(rows, mapping, lookup, { withDetail: true });
      const unmatchedTotal = Object.values(result.missing).reduce((a, b) => a + b, 0);

      const batchId = unwrap(
        await supabase.rpc('import_orders', {
          p_shop_id: shopId,
          p_file_name: fileName,
          p_total: rows.length,
          p_success: result.matched,
          p_unmatched: unmatchedTotal,
          p_error: result.priceMismatch,
          p_excluded: result.excluded,
          p_unmatched_detail: result.missing,
          p_error_detail: result.priceMismatchDetail,
          p_orders: result.detail,
        })
      ) as string;

      // 明細は画面で使わないので返さない（件数が多いとメモリを食うため）
      return { ...result, detail: [], batchId };
    },

    batches: async (): Promise<ImportBatchRecord[]> => {
      const rows = unwrap(
        await supabase
          .from('import_batches')
          .select('*, shop:shops(name, mall:malls(name))')
          .order('importedAt', { ascending: false })
          .limit(100)
      ) as unknown as Array<
        Omit<ImportBatchRecord, 'shopName' | 'mallName'> & {
          shop: { name: string; mall: { name: string } | null } | null;
        }
      >;
      return rows.map((b) => ({
        ...b,
        shopName: b.shop?.name ?? '',
        mallName: b.shop?.mall?.name ?? '',
      }));
    },

    removeBatch: async (id: string): Promise<void> => {
      // 受注明細は外部キーのCASCADEで一緒に消える
      unwrap(await supabase.from('import_batches').delete().eq('id', id).select('id'));
    },
  },

  csvMappings: {
    list: async (): Promise<Array<{ mallId: string; config: OrderColumnMapping | null; updatedAt: string }>> =>
      unwrap(await supabase.from('mall_csv_mappings').select('mallId, config, updatedAt')) as Array<{
        mallId: string;
        config: OrderColumnMapping | null;
        updatedAt: string;
      }>,
    save: async (mallId: string, config: OrderColumnMapping) =>
      unwrap(
        await supabase
          .from('mall_csv_mappings')
          .upsert({ mallId, config }, { onConflict: 'mallId' })
          .select('mallId, config')
          .single()
      ) as { mallId: string; config: OrderColumnMapping | null },
  },

  dashboard: {
    // 受注は件数が多いので、集計はDB側の関数にやらせて結果だけ受け取る
    summary: async (params: {
      from: string;
      to: string;
      mallId?: string;
      shopId?: string;
      status?: string;
    }): Promise<DashboardSummary> =>
      unwrap(
        await supabase.rpc('dashboard_summary', {
          p_from: params.from,
          p_to: params.to,
          p_mall_id: params.mallId ?? null,
          p_shop_id: params.shopId ?? null,
          p_status: params.status ?? null,
        })
      ) as DashboardSummary,
  },
};
