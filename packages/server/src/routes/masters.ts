// マスタ管理（モール・店舗・手数料・送料・資材・CSV列設定）。

import { Router } from 'express';
import { many, one } from '../db.js';
import { UserError, nullableNum, nullableStr, num, str, wrap } from './helpers.js';

export function mastersRouter(): Router {
  const r = Router();

  // ------------------------------------------------------------
  // モール
  // ------------------------------------------------------------
  r.get(
    '/malls',
    wrap(async (_req, res) => {
      // 店舗数は「削除してよいか」の判断に使うので一緒に返す
      const rows = await many(
        `select m.id, m.name, m."sortOrder",
                (select count(*)::int from public.shops s where s."mallId" = m.id) as "shopCount"
           from public.malls m
          order by m."sortOrder", m.name`
      );
      res.json(rows);
    })
  );

  r.post(
    '/malls',
    wrap(async (req, res) => {
      const row = await one(
        `insert into public.malls (name, "sortOrder") values ($1, $2)
         on conflict (name) do update set "sortOrder" = excluded."sortOrder"
         returning id, name, "sortOrder"`,
        [str(req.body?.name, 'モール名'), num(req.body?.sortOrder ?? 0, '並び順')]
      );
      res.json({ ...(row as object), shopCount: 0 });
    })
  );

  r.delete(
    '/malls/:id',
    wrap(async (req, res) => {
      const used = await one<{ n: number }>(
        `select count(*)::int as n from public.shops where "mallId" = $1`,
        [req.params.id]
      );
      if ((used?.n ?? 0) > 0) {
        throw new UserError(
          `このモールには店舗が${used!.n}件登録されています。先に店舗を削除してください。`,
          409
        );
      }
      await one(`delete from public.malls where id = $1 returning id`, [req.params.id]);
      res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------
  // 店舗
  // ------------------------------------------------------------
  r.get(
    '/shops',
    wrap(async (_req, res) => {
      const rows = await many(
        `select s.id, s."mallId", s.name, s."sortOrder", m.name as "mallName"
           from public.shops s
           join public.malls m on m.id = s."mallId"
          order by m."sortOrder", s."sortOrder", s.name`
      );
      res.json(rows);
    })
  );

  r.post(
    '/shops',
    wrap(async (req, res) => {
      const row = await one(
        `insert into public.shops ("mallId", name, "sortOrder") values ($1, $2, $3)
         on conflict ("mallId", name) do update set "sortOrder" = excluded."sortOrder"
         returning id, "mallId", name, "sortOrder"`,
        [str(req.body?.mallId, 'モール'), str(req.body?.name, '店舗名'), num(req.body?.sortOrder ?? 0, '並び順')]
      );
      const mall = await one<{ name: string }>(`select name from public.malls where id = $1`, [
        (row as { mallId: string }).mallId,
      ]);
      res.json({ ...(row as object), mallName: mall?.name ?? '' });
    })
  );

  r.delete(
    '/shops/:id',
    wrap(async (req, res) => {
      const used = await one<{ n: number }>(
        `select count(*)::int as n from public.products where "shopId" = $1`,
        [req.params.id]
      );
      if ((used?.n ?? 0) > 0) {
        throw new UserError(
          `この店舗には商品が${used!.n}件登録されています。先に商品を削除してください。`,
          409
        );
      }
      await one(`delete from public.shops where id = $1 returning id`, [req.params.id]);
      res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------
  // 手数料マスタ
  // ------------------------------------------------------------
  r.get(
    '/sites',
    wrap(async (_req, res) => {
      res.json(
        await many(
          `select id, name, fee, "couponFee", "consultFee", "otherFees", note
             from public.site_fees order by name`
        )
      );
    })
  );

  r.post(
    '/sites',
    wrap(async (req, res) => {
      const b = req.body ?? {};
      res.json(
        await one(
          `insert into public.site_fees (name, fee, "couponFee", "consultFee", "otherFees", note)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (name) do update
             set fee = excluded.fee,
                 "couponFee" = excluded."couponFee",
                 "consultFee" = excluded."consultFee",
                 "otherFees" = excluded."otherFees",
                 note = excluded.note
           returning id, name, fee, "couponFee", "consultFee", "otherFees", note`,
          [
            str(b.name, 'サイト名'),
            nullableNum(b.fee),
            nullableNum(b.couponFee),
            nullableNum(b.consultFee),
            JSON.stringify(b.otherFees ?? []),
            nullableStr(b.note),
          ]
        )
      );
    })
  );

  r.delete(
    '/sites/:id',
    wrap(async (req, res) => {
      await one(`delete from public.site_fees where id = $1 returning id`, [req.params.id]);
      res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------
  // 送料マスタ
  // ------------------------------------------------------------
  r.get(
    '/shipping',
    wrap(async (_req, res) => {
      res.json(
        await many(
          `select id, carrier, temp, size, "unitPrice", "taxRate"
             from public.shipping_rates order by carrier, temp, size`
        )
      );
    })
  );

  r.post(
    '/shipping',
    wrap(async (req, res) => {
      const b = req.body ?? {};
      res.json(
        await one(
          `insert into public.shipping_rates (carrier, temp, size, "unitPrice", "taxRate")
           values ($1, $2, $3, $4, $5)
           returning id, carrier, temp, size, "unitPrice", "taxRate"`,
          [
            nullableStr(b.carrier),
            nullableStr(b.temp),
            nullableStr(b.size),
            num(b.unitPrice, '単価'),
            num(b.taxRate ?? 10, '税率'),
          ]
        )
      );
    })
  );

  r.delete(
    '/shipping/:id',
    wrap(async (req, res) => {
      await one(`delete from public.shipping_rates where id = $1 returning id`, [req.params.id]);
      res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------
  // 資材マスタ
  // ------------------------------------------------------------
  r.get(
    '/materials',
    wrap(async (_req, res) => {
      res.json(
        await many(`select id, name, "unitPrice", "taxRate" from public.materials order by name`)
      );
    })
  );

  r.post(
    '/materials',
    wrap(async (req, res) => {
      const b = req.body ?? {};
      res.json(
        await one(
          `insert into public.materials (name, "unitPrice", "taxRate") values ($1, $2, $3)
           on conflict (name) do update
             set "unitPrice" = excluded."unitPrice", "taxRate" = excluded."taxRate"
           returning id, name, "unitPrice", "taxRate"`,
          [str(b.name, '資材名'), num(b.unitPrice, '単価'), num(b.taxRate ?? 10, '税率')]
        )
      );
    })
  );

  r.delete(
    '/materials/:id',
    wrap(async (req, res) => {
      await one(`delete from public.materials where id = $1 returning id`, [req.params.id]);
      res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------
  // モールごとのCSV列設定
  // ------------------------------------------------------------
  r.get(
    '/csv-mappings',
    wrap(async (_req, res) => {
      res.json(await many(`select "mallId", config, "updatedAt" from public.mall_csv_mappings`));
    })
  );

  r.post(
    '/csv-mappings',
    wrap(async (req, res) => {
      res.json(
        await one(
          `insert into public.mall_csv_mappings ("mallId", config) values ($1, $2)
           on conflict ("mallId") do update set config = excluded.config
           returning "mallId", config`,
          [str(req.body?.mallId, 'モール'), JSON.stringify(req.body?.config ?? {})]
        )
      );
    })
  );

  return r;
}
