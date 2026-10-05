// 業務APIの入口。ここから先はログイン必須。
//
// Supabase版は「RLSが唯一のアクセス制御」でしたが、共有RDSには利用者ごとのDBロールが
// 無いため、**アクセス制御はここで行います**。requireAuth を通さないルートを
// この配下に足さないでください。

import { Router } from 'express';
import { currentUser } from '../auth.js';
import { many, one } from '../db.js';
import { mastersRouter } from './masters.js';
import { ordersRouter } from './orders.js';
import { productsRouter } from './products.js';
import { UserError, str, toUserMessage, wrap, type AuthedRequest } from './helpers.js';

export function apiRouter(): Router {
  const r = Router();

  // --- ログイン確認 ---
  r.use(
    wrap(async (req: AuthedRequest, res, next) => {
      const user = await currentUser(req);
      if (!user) {
        res.status(401).json({ error: 'ログインしてください。' });
        return;
      }
      req.user = user;
      next();
    })
  );

  r.use('/products', productsRouter());
  r.use('/orders', ordersRouter());
  r.use('/', mastersRouter());

  // --- ダッシュボード集計 ---
  // 受注は月に数千〜数万件貯まる。全部ブラウザに落として計算するのは現実的でないので、
  // ここだけはDB側で集計して結果だけ返す
  r.get(
    '/dashboard/summary',
    wrap(async (req, res) => {
      const row = await one<{ dashboard_summary: unknown }>(
        `select public.dashboard_summary($1,$2,$3,$4,$5) as dashboard_summary`,
        [
          str(req.query.from, '開始日'),
          str(req.query.to, '終了日'),
          (req.query.mallId as string) || null,
          (req.query.shopId as string) || null,
          (req.query.status as string) || null,
        ]
      );
      res.json(row?.dashboard_summary ?? null);
    })
  );

  // --- ジョブカン連携の状況 ---
  r.get(
    '/jobcan/status',
    wrap(async (_req, res) => {
      const rows = await many<{ jobcan_sync_status: unknown }>(
        `select public.jobcan_sync_status() as jobcan_sync_status`
      );
      res.json(rows[0]?.jobcan_sync_status ?? null);
    })
  );

  // --- APIのエラー処理 ---
  // 画面にそのまま出せる日本語にして返す。
  // DB側のトリガーが出した日本語メッセージ（ステータスの遷移制限など）はそのまま通す。
  r.use((err: unknown, _req: AuthedRequest, res: import('express').Response, next: import('express').NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof UserError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const { status, message } = toUserMessage(err);
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: message });
  });

  return r;
}
