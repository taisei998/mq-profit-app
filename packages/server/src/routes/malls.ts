import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { idParamSchema, mallInputSchema } from '../lib/validation.js';
import type { MallRecord } from '@ec-ai/shared';

export const mallsRouter = Router();

mallsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.mall.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { shops: true } } },
    });
    const out: MallRecord[] = rows.map((m) => ({
      id: m.id,
      name: m.name,
      sortOrder: m.sortOrder,
      shopCount: m._count.shops,
    }));
    res.json(out);
  })
);

// 名前が既にあれば更新、無ければ追加（サイトマスタと同じ挙動に揃えている）
mallsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = mallInputSchema.parse(req.body);
    const existing = await prisma.mall.findUnique({ where: { name: input.name } });
    const saved = await prisma.mall.upsert({
      where: { name: input.name },
      create: input,
      update: input,
    });
    const shopCount = await prisma.shop.count({ where: { mallId: saved.id } });
    const out: MallRecord = {
      id: saved.id,
      name: saved.name,
      sortOrder: saved.sortOrder,
      shopCount,
    };
    res.status(existing ? 200 : 201).json(out);
  })
);

mallsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.mall.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'モールが見つかりません。');

    // 店舗が残ったままモールを消すと店舗が迷子になるため、先に店舗を消してもらう
    const shopCount = await prisma.shop.count({ where: { mallId: id } });
    if (shopCount > 0) {
      throw new HttpError(
        409,
        `「${existing.name}」には店舗が${shopCount}件登録されています。先に店舗を削除してください。`
      );
    }

    await prisma.mall.delete({ where: { id } });
    res.status(204).send();
  })
);
