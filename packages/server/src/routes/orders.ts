// 受注の取込と履歴。
//
// CSVの読み取りと集計は**ブラウザ側**で行い、ここは結果を保存するだけです
// （理由は products.ts の冒頭と同じ。本番のコンテナは小さい）。

import { Router } from 'express';
import { many, one } from '../db.js';
import { num, str, wrap, type AuthedRequest } from './helpers.js';

export function ordersRouter(): Router {
  const r = Router();

  /**
   * 取込実行。
   * 取込履歴と受注明細は**必ずセットで**保存したいので、DB側の関数を1回呼んで
   * 1トランザクションで書き込みます。途中で失敗しても中途半端に残りません。
   */
  r.post(
    '/import',
    wrap(async (req: AuthedRequest, res) => {
      const b = req.body ?? {};
      const batchId = await one<{ import_orders: string }>(
        `select public.import_orders($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as import_orders`,
        [
          str(b.shopId, '店舗'),
          str(b.fileName, 'ファイル名'),
          num(b.total ?? 0, '件数'),
          num(b.success ?? 0, '成功件数'),
          num(b.unmatched ?? 0, '未紐付け件数'),
          num(b.error ?? 0, 'エラー件数'),
          num(b.excluded ?? 0, '除外件数'),
          JSON.stringify(b.unmatchedDetail ?? {}),
          JSON.stringify(b.errorDetail ?? {}),
          JSON.stringify(b.orders ?? []),
          req.user?.id ?? null,
        ]
      );
      res.json({ batchId: batchId?.import_orders });
    })
  );

  r.get(
    '/batches',
    wrap(async (_req, res) => {
      res.json(
        await many(
          `select b.id, b."shopId", b."fileName", b."totalCount", b."successCount",
                  b."unmatchedCount", b."errorCount", b."excludedCount",
                  b."unmatchedDetail", b."errorDetail", b."importedAt", b."importedBy",
                  s.name as "shopName", m.name as "mallName"
             from public.import_batches b
             join public.shops s on s.id = b."shopId"
             join public.malls m on m.id = s."mallId"
            order by b."importedAt" desc
            limit 100`
        )
      );
    })
  );

  /** 取込単位の取消。受注明細は外部キーのCASCADEで一緒に消える */
  r.delete(
    '/batches/:id',
    wrap(async (req, res) => {
      await one(`delete from public.import_batches where id = $1 returning id`, [req.params.id]);
      res.json({ ok: true });
    })
  );

  return r;
}
