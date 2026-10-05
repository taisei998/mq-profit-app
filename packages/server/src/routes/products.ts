// 商品（粗利）。
//
// 【計算をどこでやるか】
//   粗利の計算は**ブラウザ側**（@ec-ai/shared）で行い、サーバーは結果を保存するだけです。
//   本番のコンテナはCPU 256・メモリ512と小さく、重い処理でCPUを使い切ると
//   ヘルスチェックまで時間内に返せなくなり、基盤に「停止した」と判断されて
//   コンテナごと入れ替えられます（＝その時使っている全員が巻き添えになる）。
//   アプリ実装ガイドライン3章。

import { Router } from 'express';
import { many, one } from '../db.js';
import { nullableStr, num, str, wrap, type AuthedRequest } from './helpers.js';

// 商品1件を画面用の形で取るクエリ。モール・店舗名も一緒に引く
const SELECT = `
  select p.id, p."productId", p."mgmtNo", p.code, p."shopId", p.name, p.spec, p.note,
         p.category, p."priceTaxRate", p."setCount", p.status,
         p."createdBy", p."updatedBy", p."createdAt", p."updatedAt",
         p."normalData" as normal, p."saleData" as sale, p."couponData" as coupon,
         p."jobcanRequestId", p."jobcanStatus", p."jobcanTitle",
         p."jobcanAppliedAt", p."jobcanApprovedAt", p."jobcanSyncedAt",
         s.name as "shopName", s."mallId", m.name as "mallName"
    from public.products p
    join public.shops s on s.id = p."shopId"
    join public.malls m on m.id = s."mallId"
`;

export function productsRouter(): Router {
  const r = Router();

  r.get(
    '/',
    wrap(async (_req, res) => {
      res.json(await many(`${SELECT} order by p."productId"`));
    })
  );

  // 受注CSVの突き合わせ用。商品コードから原価情報を引くための一覧
  r.get(
    '/lookup',
    wrap(async (req, res) => {
      const shopId = str(req.query.shopId, '店舗');
      res.json(
        await many(
          `select id, code, name, category,
                  "normalData" as normal, "saleData" as sale, "couponData" as coupon
             from public.products where "shopId" = $1`,
          [shopId]
        )
      );
    })
  );

  r.get(
    '/:id',
    wrap(async (req, res) => {
      const row = await one(`${SELECT} where p.id = $1`, [req.params.id]);
      if (!row) {
        res.status(404).json({ error: '商品が見つかりません。' });
        return;
      }
      res.json(row);
    })
  );

  /**
   * 登録・更新。同じ店舗に同じ商品コードがあれば上書きする。
   * 固有ID(A0001...) と createdBy は**上書きしない**（元の登録者を残すため）。
   */
  r.post(
    '/',
    wrap(async (req: AuthedRequest, res) => {
      const b = req.body ?? {};
      const row = await one(
        `insert into public.products
           ("shopId", code, "mgmtNo", status, name, spec, note, category,
            "priceTaxRate", "setCount", "normalData", "saleData", "couponData",
            "createdBy", "updatedBy")
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
         on conflict ("shopId", code) do update
           set "mgmtNo" = excluded."mgmtNo",
               status = excluded.status,
               name = excluded.name,
               spec = excluded.spec,
               note = excluded.note,
               category = excluded.category,
               "priceTaxRate" = excluded."priceTaxRate",
               "setCount" = excluded."setCount",
               "normalData" = excluded."normalData",
               "saleData" = excluded."saleData",
               "couponData" = excluded."couponData",
               "updatedBy" = excluded."updatedBy"
         returning id`,
        [
          str(b.shopId, '店舗'),
          str(b.code, '商品コード'),
          nullableStr(b.mgmtNo),
          typeof b.status === 'string' ? b.status : 'draft',
          str(b.name, '商品名'),
          nullableStr(b.spec),
          nullableStr(b.note),
          str(b.category, 'カテゴリ'),
          num(b.priceTaxRate ?? 10, '税率'),
          num(b.setCount ?? 5, 'セット数'),
          JSON.stringify(b.normal ?? {}),
          JSON.stringify(b.sale ?? {}),
          JSON.stringify(b.coupon ?? {}),
          req.user?.id ?? null,
        ]
      );
      res.json(await one(`${SELECT} where p.id = $1`, [(row as { id: string }).id]));
    })
  );

  /**
   * ステータス変更。
   * 2026-09-17決定: ログインしている人なら誰でも変更できる。
   * 稟議そのものはジョブカンで回しており、ここは記録するだけのため。
   * ただし**遷移の順序**はDB側のトリガーが強制する。
   */
  r.post(
    '/:id/status',
    wrap(async (req: AuthedRequest, res) => {
      await one(`update public.products set status = $2, "updatedBy" = $3 where id = $1 returning id`, [
        req.params.id,
        str(req.body?.status, 'ステータス'),
        req.user?.id ?? null,
      ]);
      res.json(await one(`${SELECT} where p.id = $1`, [req.params.id]));
    })
  );

  r.delete(
    '/:id',
    wrap(async (req, res) => {
      await one(`delete from public.products where id = $1 returning id`, [req.params.id]);
      res.json({ ok: true });
    })
  );

  return r;
}
