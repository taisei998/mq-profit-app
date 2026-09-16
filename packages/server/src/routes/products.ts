import { cloneGroup, computeGroupFromLines, emptyGroup, GroupData, groupHasInput, ProductRecord, ProductStatus, STATUS_LABEL } from '@ec-ai/shared';
import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { fromJsonString, toJsonString } from '../lib/json.js';
import { idParamSchema, productInputSchema, productStatusInputSchema } from '../lib/validation.js';
import { currentUserId } from '../middleware/auth.js';
import type { Mall, Product, Shop } from '@prisma/client';

// 一覧・詳細では店舗とモールを一緒に引く（画面でモール名・店舗名を出すため）
type ProductWithShop = Product & { shop: Shop & { mall: Mall } };
const withShop = { shop: { include: { mall: true } } } as const;

export const productsRouter = Router();

function toRecord(p: ProductWithShop): ProductRecord {
  return {
    id: p.id,
    productId: p.productId,
    mgmtNo: p.mgmtNo,
    status: p.status as ProductStatus,
    createdBy: p.createdBy,
    updatedBy: p.updatedBy,
    code: p.code,
    shopId: p.shopId,
    shopName: p.shop.name,
    mallId: p.shop.mallId,
    mallName: p.shop.mall.name,
    name: p.name,
    spec: p.spec,
    note: p.note,
    category: p.category,
    priceTaxRate: p.priceTaxRate,
    setCount: p.setCount,
    normal: fromJsonString<GroupData>(p.normalData, emptyGroup(p.priceTaxRate)),
    sale: fromJsonString<GroupData>(p.saleData, emptyGroup(p.priceTaxRate)),
    coupon: fromJsonString<GroupData>(p.couponData, emptyGroup(p.priceTaxRate)),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// 固有ID採番 (A0001, A0002, ...)。既存の最大値の続きから発番する。
async function nextProductId(): Promise<string> {
  const products = await prisma.product.findMany({ select: { productId: true } });
  let maxN = 0;
  for (const p of products) {
    const m = /^A(\d+)$/.exec(p.productId || '');
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    }
  }
  return 'A' + String(maxN + 1).padStart(4, '0');
}

productsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      orderBy: { productId: 'asc' },
      include: withShop,
    });
    res.json(products.map(toRecord));
  })
);

// 空グループ（新規フォームの初期値取得などクライアント側の便宜用）
// ※ "/:id" より前に定義すること（順序を逆にすると "util" がidとして拾われる）
productsRouter.get(
  '/util/empty-group',
  asyncHandler(async (req, res) => {
    const taxRate = Number(req.query.priceTaxRate ?? 10);
    res.json(emptyGroup(taxRate));
  })
);

productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const product = await prisma.product.findUnique({ where: { id }, include: withShop });
    if (!product) throw new HttpError(404, '商品が見つかりません。');
    res.json(toRecord(product));
  })
);

productsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = productInputSchema.parse(req.body);

    if (!groupHasInput(input.normalLines)) {
      throw new HttpError(400, '「通常時」1セットの販売金額を入力してください。');
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

    const shop = await prisma.shop.findUnique({ where: { id: input.shopId } });
    if (!shop) throw new HttpError(400, '選択された店舗が見つかりません。');

    // 同じ店舗に同じ商品コードがあれば上書き。別店舗の同じコードは別商品として扱う（#11）
    const where = { shopId_code: { shopId: input.shopId, code: input.code } };
    const existing = await prisma.product.findUnique({ where });
    const productId = existing ? existing.productId : await nextProductId();
    const userId = currentUserId(req);

    const saved = await prisma.product.upsert({
      where,
      include: withShop,
      create: {
        productId,
        shopId: input.shopId,
        mgmtNo: input.mgmtNo || null,
        status: input.status,
        createdBy: userId,
        updatedBy: userId,
        code: input.code,
        name: input.name,
        spec: input.spec,
        note: input.note,
        category: input.category,
        priceTaxRate: input.priceTaxRate,
        setCount: input.setCount,
        normalData: toJsonString(normal),
        saleData: toJsonString(sale),
        couponData: toJsonString(coupon),
      },
      update: {
        mgmtNo: input.mgmtNo || null,
        status: input.status,
        updatedBy: userId,
        name: input.name,
        spec: input.spec,
        note: input.note,
        category: input.category,
        priceTaxRate: input.priceTaxRate,
        setCount: input.setCount,
        normalData: toJsonString(normal),
        saleData: toJsonString(sale),
        couponData: toJsonString(coupon),
      },
    });

    res.status(existing ? 200 : 201).json(toRecord(saved));
  })
);

// ステータスだけを変える（稟議申請・承認・却下・販売中・販売終了）。
// 稟議そのものはジョブカンで回すため、ここでは状態の記録だけを行う（2026-09-16決定 #10）。
const label = (s: string): string => STATUS_LABEL[s as ProductStatus] ?? s;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending'],
  pending: ['approved', 'rejected'],
  approved: ['selling', 'draft'],
  rejected: ['draft'],
  selling: ['ended'],
  ended: ['selling'],
};

productsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { status } = productStatusInputSchema.parse(req.body);

    const existing = await prisma.product.findUnique({ where: { id }, include: withShop });
    if (!existing) throw new HttpError(404, '商品が見つかりません。');

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (existing.status !== status && !allowed.includes(status)) {
      throw new HttpError(
        400,
        `「${label(existing.status)}」から「${label(status)}」には変更できません。`
      );
    }

    const saved = await prisma.product.update({
      where: { id },
      data: { status, updatedBy: currentUserId(req) },
      include: withShop,
    });
    res.json(toRecord(saved));
  })
);

productsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '商品が見つかりません。');
    await prisma.product.delete({ where: { id } });
    res.status(204).send();
  })
);
