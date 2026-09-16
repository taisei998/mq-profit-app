import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { HttpError } from '../middleware/errorHandler.js';
import { fromJsonString, toJsonString } from '../lib/json.js';
import { idParamSchema, siteFeeInputSchema } from '../lib/validation.js';
import type { SiteFee } from '@prisma/client';
import type { SiteFeeOther, SiteFeeRecord } from '@ec-ai/shared';

export const sitesRouter = Router();

function toRecord(s: SiteFee): SiteFeeRecord {
  return {
    id: s.id,
    name: s.name,
    fee: s.fee,
    couponFee: s.couponFee,
    consultFee: s.consultFee,
    otherFees: fromJsonString<SiteFeeOther[]>(s.otherFees, []),
    note: s.note,
  };
}

sitesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.siteFee.findMany({ orderBy: { name: 'asc' } });
    res.json(rows.map(toRecord));
  })
);

sitesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = siteFeeInputSchema.parse(req.body);
    const data = { ...input, otherFees: toJsonString(input.otherFees) };
    const existing = await prisma.siteFee.findUnique({ where: { name: input.name } });
    const saved = await prisma.siteFee.upsert({
      where: { name: input.name },
      create: data,
      update: data,
    });
    res.status(existing ? 200 : 201).json(toRecord(saved));
  })
);

sitesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.siteFee.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'サイトが見つかりません。');
    await prisma.siteFee.delete({ where: { id } });
    res.status(204).send();
  })
);
