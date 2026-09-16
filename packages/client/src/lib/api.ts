import type {
  DashboardSummary,
  FieldLines,
  ImportBatchRecord,
  MallRecord,
  MaterialRecord,
  OrderAggregationResult,
  OrderColumnMapping,
  ProductRecord,
  ProductStatus,
  ShippingRateRecord,
  ShopRecord,
  SiteFeeRecord,
} from '@ec-ai/shared';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `リクエストに失敗しました (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // レスポンスがJSONでない場合はデフォルトメッセージのまま
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

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

export const api = {
  products: {
    list: () => request<ProductRecord[]>('/products'),
    get: (id: string) => request<ProductRecord>(`/products/${id}`),
    save: (input: ProductInputPayload) =>
      request<ProductRecord>('/products', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/products/${id}`, { method: 'DELETE' }),
    setStatus: (id: string, status: ProductStatus) =>
      request<ProductRecord>(`/products/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  },
  sites: {
    list: () => request<SiteFeeRecord[]>('/sites'),
    save: (input: Omit<SiteFeeRecord, 'id'>) =>
      request<SiteFeeRecord>('/sites', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/sites/${id}`, { method: 'DELETE' }),
  },
  shipping: {
    list: () => request<ShippingRateRecord[]>('/shipping'),
    save: (input: Omit<ShippingRateRecord, 'id'>) =>
      request<ShippingRateRecord>('/shipping', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/shipping/${id}`, { method: 'DELETE' }),
  },
  materials: {
    list: () => request<MaterialRecord[]>('/materials'),
    save: (input: Omit<MaterialRecord, 'id'>) =>
      request<MaterialRecord>('/materials', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/materials/${id}`, { method: 'DELETE' }),
  },
  malls: {
    list: () => request<MallRecord[]>('/malls'),
    save: (input: { name: string; sortOrder: number }) =>
      request<MallRecord>('/malls', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/malls/${id}`, { method: 'DELETE' }),
  },
  shops: {
    list: () => request<ShopRecord[]>('/shops'),
    save: (input: { mallId: string; name: string; sortOrder: number }) =>
      request<ShopRecord>('/shops', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/shops/${id}`, { method: 'DELETE' }),
  },
  orders: {
    // プレビュー（DBには保存しない）
    aggregate: (shopId: string, rows: string[][], mapping: OrderColumnMapping) =>
      request<OrderAggregationResult>('/orders/aggregate', {
        method: 'POST',
        body: JSON.stringify({ shopId, rows, mapping }),
      }),
    // 取込実行（受注明細と履歴をDBに保存する）
    import: (shopId: string, rows: string[][], mapping: OrderColumnMapping, fileName: string) =>
      request<OrderAggregationResult & { batchId: string }>('/orders/import', {
        method: 'POST',
        body: JSON.stringify({ shopId, rows, mapping, fileName }),
      }),
    batches: () => request<ImportBatchRecord[]>('/orders/batches'),
    removeBatch: (id: string) => request<void>(`/orders/batches/${id}`, { method: 'DELETE' }),
  },
  csvMappings: {
    list: () => request<Array<{ mallId: string; config: OrderColumnMapping | null; updatedAt: string }>>('/csv-mappings'),
    save: (mallId: string, config: OrderColumnMapping) =>
      request<{ mallId: string; config: OrderColumnMapping | null }>('/csv-mappings', {
        method: 'POST',
        body: JSON.stringify({ mallId, config }),
      }),
  },
  dashboard: {
    summary: (params: { from: string; to: string; mallId?: string; shopId?: string; status?: string }) => {
      const q = new URLSearchParams({ from: params.from, to: params.to });
      if (params.mallId) q.set('mallId', params.mallId);
      if (params.shopId) q.set('shopId', params.shopId);
      if (params.status) q.set('status', params.status);
      return request<DashboardSummary>(`/dashboard/summary?${q.toString()}`);
    },
  },
};
