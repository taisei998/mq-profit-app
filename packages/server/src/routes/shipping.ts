import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { idParamSchema, shippingRateInputSchema } from '../lib/validation.js';
import type { ShippingRate } from '@prisma/client';
import type { ShippingRateRecord } from '@ec-ai/shared';

export const shippingRouter = Router();

function toRecord(s: ShippingRate): ShippingRateRecord {
  return {
    id: s.id,
    carrier: s.carrier,
    temp: s.temp,
    size: s.size,
    unitPrice: s.unitPrice,
    taxRate: s.taxRate,
  };
}

shippingRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.shippingRate.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(rows.map(toRecord));
  })
);

shippingRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = shippingRateInputSchema.parse(req.body);
    const saved = await prisma.shippingRate.create({ data: input });
    res.status(201).json(toRecord(saved));
  })
);

shippingRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.shippingRate.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '送料が見つかりません。');
    await prisma.shippingRate.delete({ where: { id } });
    res.status(204).send();
  })
);
