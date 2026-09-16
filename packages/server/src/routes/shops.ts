import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { idParamSchema, shopInputSchema } from '../lib/validation.js';
import type { ShopRecord } from '@ec-ai/shared';

export const shopsRouter = Router();

shopsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.shop.findMany({
      orderBy: [{ mall: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { mall: true },
    });
    const out: ShopRecord[] = rows.map((s) => ({
      id: s.id,
      mallId: s.mallId,
      mallName: s.mall.name,
      name: s.name,
      sortOrder: s.sortOrder,
    }));
    res.json(out);
  })
);

// 同じモール内に同名の店舗があれば更新、無ければ追加
shopsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = shopInputSchema.parse(req.body);

    const mall = await prisma.mall.findUnique({ where: { id: input.mallId } });
    if (!mall) throw new HttpError(400, '選択されたモールが見つかりません。');

    const existing = await prisma.shop.findUnique({
      where: { mallId_name: { mallId: input.mallId, name: input.name } },
    });
    const saved = await prisma.shop.upsert({
      where: { mallId_name: { mallId: input.mallId, name: input.name } },
      create: input,
      update: input,
    });
    const out: ShopRecord = {
      id: saved.id,
      mallId: saved.mallId,
      mallName: mall.name,
      name: saved.name,
      sortOrder: saved.sortOrder,
    };
    res.status(existing ? 200 : 201).json(out);
  })
);

shopsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.shop.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '店舗が見つかりません。');

    // 商品が残ったまま店舗を消すと商品が迷子になるため、先に商品を消してもらう
    const productCount = await prisma.product.count({ where: { shopId: id } });
    if (productCount > 0) {
      throw new HttpError(
        409,
        `「${existing.name}」には商品が${productCount}件登録されています。先に商品を削除してください。`
      );
    }

    await prisma.shop.delete({ where: { id } });
    res.status(204).send();
  })
);
