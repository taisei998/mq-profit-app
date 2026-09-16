import { aggregateOrders, emptyGroup, GroupData, OrderProductLookup } from '@ec-ai/shared';
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { fromJsonString, toJsonString } from '../lib/json.js';
import type { OrderColumnMapping } from '@ec-ai/shared';
import { idParamSchema, orderAggregateInputSchema, orderImportInputSchema } from '../lib/validation.js';

export const ordersRouter = Router();

// 指定店舗の商品を「商品コード → 集計に必要な情報」の形にして返す。
// 商品コードは店舗ごとに一意なので、必ず店舗で絞る（2026-09-16決定 #17）。
async function buildLookup(shopId: string): Promise<Record<string, OrderProductLookup>> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new HttpError(400, '選択された店舗が見つかりません。');

  const products = await prisma.product.findMany({ where: { shopId }, orderBy: { productId: 'asc' } });
  const lookup: Record<string, OrderProductLookup> = {};
  for (const p of products) {
    lookup[p.code] = {
      productId: p.id,
      name: p.name,
      category: p.category,
      normal: fromJsonString<GroupData>(p.normalData, emptyGroup(p.priceTaxRate)),
      sale: fromJsonString<GroupData>(p.saleData, emptyGroup(p.priceTaxRate)),
      coupon: fromJsonString<GroupData>(p.couponData, emptyGroup(p.priceTaxRate)),
    };
  }
  return lookup;
}

ordersRouter.post(
  '/aggregate',
  asyncHandler(async (req, res) => {
    const { shopId, rows, mapping } = orderAggregateInputSchema.parse(req.body);

    const lookup = await buildLookup(shopId);
    const result = aggregateOrders(rows, mapping, lookup);
    res.json(result);
  })
);

// 取込実行: 集計に加えて、受注明細と取込履歴をDBに保存する
ordersRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const { shopId, rows, mapping, fileName } = orderImportInputSchema.parse(req.body);

    const lookup = await buildLookup(shopId);
    const result = aggregateOrders(rows, mapping as OrderColumnMapping, lookup, { withDetail: true });

    // 履歴と明細は必ずセットで残す（片方だけ残ると件数が合わなくなる）
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          shopId,
          fileName,
          totalCount: rows.length,
          successCount: result.matched,
          unmatchedCount: Object.values(result.missing).reduce((a, b) => a + b, 0),
          errorCount: result.priceMismatch,
          excludedCount: result.excluded,
          unmatchedDetail: toJsonString(result.missing),
          errorDetail: toJsonString(result.priceMismatchDetail),
          status: 'done',
        },
      });
      if (result.detail.length > 0) {
        await tx.order.createMany({
          data: result.detail.map((d) => ({
            batchId: created.id,
            shopId,
            orderNo: d.orderNo,
            orderDate: d.orderDate,
            productCode: d.productCode,
            productId: d.productId,
            unitPrice: d.unitPrice,
            quantity: d.quantity,
            amount: d.amount,
            kind: d.kind,
            profit: d.profit,
            profitRate: d.profitRate,
          })),
        });
      }
      return created;
    });

    // 明細はクライアントに返さない（件数が多く、画面では使わないため）
    res.status(201).json({ batchId: batch.id, ...result, detail: [] });
  })
);

// 取込履歴
ordersRouter.get(
  '/batches',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.importBatch.findMany({
      orderBy: { importedAt: 'desc' },
      take: 100,
      include: { shop: { include: { mall: true } } },
    });
    res.json(
      rows.map((b) => ({
        id: b.id,
        shopId: b.shopId,
        shopName: b.shop.name,
        mallName: b.shop.mall.name,
        fileName: b.fileName,
        importedAt: b.importedAt.toISOString(),
        totalCount: b.totalCount,
        successCount: b.successCount,
        unmatchedCount: b.unmatchedCount,
        errorCount: b.errorCount,
        excludedCount: b.excludedCount,
        unmatchedDetail: fromJsonString<Record<string, number>>(b.unmatchedDetail, {}),
        errorDetail: fromJsonString<Record<string, number>>(b.errorDetail, {}),
        status: b.status,
      }))
    );
  })
);

// 取込のやり直し用。1回ぶんの取込を明細ごと取り消す（全件削除の機能は設けない）
ordersRouter.delete(
  '/batches/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.importBatch.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '取込履歴が見つかりません。');
    await prisma.importBatch.delete({ where: { id } }); // 明細はCascadeで一緒に消える
    res.status(204).send();
  })
);
