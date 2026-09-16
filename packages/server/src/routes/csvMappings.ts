import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { fromJsonString, toJsonString } from '../lib/json.js';
import { mallCsvMappingInputSchema } from '../lib/validation.js';
import type { OrderColumnMapping } from '@ec-ai/shared';

export const csvMappingsRouter = Router();

// モールごとのCSV列マッピング。列構成はモール単位で決まっているので店舗別には持たない。
csvMappingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.mallCsvMapping.findMany();
    res.json(
      rows.map((r) => ({
        mallId: r.mallId,
        config: fromJsonString<OrderColumnMapping | null>(r.config, null),
        updatedAt: r.updatedAt.toISOString(),
      }))
    );
  })
);

csvMappingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = mallCsvMappingInputSchema.parse(req.body);
    const mall = await prisma.mall.findUnique({ where: { id: input.mallId } });
    if (!mall) throw new HttpError(400, 'モールが見つかりません。');

    const config = toJsonString(input.config);
    const saved = await prisma.mallCsvMapping.upsert({
      where: { mallId: input.mallId },
      create: { mallId: input.mallId, config },
      update: { config },
    });
    res.json({
      mallId: saved.mallId,
      config: fromJsonString<OrderColumnMapping | null>(saved.config, null),
      updatedAt: saved.updatedAt.toISOString(),
    });
  })
);
