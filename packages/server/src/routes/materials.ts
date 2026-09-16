import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { idParamSchema, materialInputSchema } from '../lib/validation.js';
import type { Material } from '@prisma/client';
import type { MaterialRecord } from '@ec-ai/shared';

export const materialsRouter = Router();

function toRecord(m: Material): MaterialRecord {
  return { id: m.id, name: m.name, unitPrice: m.unitPrice, taxRate: m.taxRate };
}

materialsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.material.findMany({ orderBy: { name: 'asc' } });
    res.json(rows.map(toRecord));
  })
);

materialsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = materialInputSchema.parse(req.body);
    const existing = await prisma.material.findUnique({ where: { name: input.name } });
    const saved = await prisma.material.upsert({
      where: { name: input.name },
      create: input,
      update: input,
    });
    res.status(existing ? 200 : 201).json(toRecord(saved));
  })
);

materialsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.material.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, '資材が見つかりません。');
    await prisma.material.delete({ where: { id } });
    res.status(204).send();
  })
);
