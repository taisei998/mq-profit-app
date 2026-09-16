import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ProductInputPayload } from './api.js';
import type { MaterialRecord, OrderColumnMapping, ProductStatus, ShippingRateRecord, SiteFeeRecord } from '@ec-ai/shared';

export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: api.products.list });
}

export function useSaveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInputPayload) => api.products.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.products.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useSites() {
  return useQuery({ queryKey: ['sites'], queryFn: api.sites.list });
}
export function useSaveSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SiteFeeRecord, 'id'>) => api.sites.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}
export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.sites.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });
}

export function useShipping() {
  return useQuery({ queryKey: ['shipping'], queryFn: api.shipping.list });
}
export function useSaveShipping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ShippingRateRecord, 'id'>) => api.shipping.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipping'] }),
  });
}
export function useDeleteShipping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.shipping.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipping'] }),
  });
}

export function useMaterials() {
  return useQuery({ queryKey: ['materials'], queryFn: api.materials.list });
}
export function useSaveMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<MaterialRecord, 'id'>) => api.materials.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  });
}
export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.materials.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  });
}

export function useMalls() {
  return useQuery({ queryKey: ['malls'], queryFn: api.malls.list });
}
export function useSaveMall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; sortOrder: number }) => api.malls.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['malls'] }),
  });
}
export function useDeleteMall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.malls.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['malls'] }),
  });
}

export function useShops() {
  return useQuery({ queryKey: ['shops'], queryFn: api.shops.list });
}
export function useSaveShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { mallId: string; name: string; sortOrder: number }) => api.shops.save(input),
    // 店舗を足すとモール側の店舗数表示も変わるため、両方を更新する
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shops'] });
      qc.invalidateQueries({ queryKey: ['malls'] });
    },
  });
}
export function useDeleteShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.shops.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shops'] });
      qc.invalidateQueries({ queryKey: ['malls'] });
    },
  });
}

export function useImportBatches() {
  return useQuery({ queryKey: ['batches'], queryFn: api.orders.batches });
}
export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.orders.removeBatch(id),
    // 取込を取り消すとダッシュボードの数字も変わる
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCsvMappings() {
  return useQuery({ queryKey: ['csvMappings'], queryFn: api.csvMappings.list });
}
export function useSaveCsvMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { mallId: string; config: OrderColumnMapping }) =>
      api.csvMappings.save(input.mallId, input.config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['csvMappings'] }),
  });
}

export function useDashboard(params: { from: string; to: string; mallId?: string; shopId?: string; status?: string }) {
  return useQuery({
    queryKey: ['dashboard', params],
    queryFn: () => api.dashboard.summary(params),
  });
}

export function useSetProductStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: ProductStatus }) => api.products.setStatus(input.id, input.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
