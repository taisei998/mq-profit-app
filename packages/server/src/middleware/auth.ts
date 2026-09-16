import type { NextFunction, Request, Response } from 'express';

// ===== 認証の差し込み口（現時点は未実装） =====
//
// 今回のフェーズでは認証は未実装です（社内利用のみを想定）。
// 将来、社内のOAuth2認証サーバー（リソースサーバー方式）と連携する際は、
// このミドルウェアの中で Authorization: Bearer <token> を検証し、
// req.user にユーザー情報をセットするように差し替えてください。
// 例: `express-oauth2-jwt-bearer` などでJWKSエンドポイントからトークンを検証する。
//
// 現状は何もせず次のミドルウェアへ進むだけの no-op です。
export function requireAuth(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

export interface AuthUser {
  id: string;
  displayName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// 登録者・更新者の記録用。認証が入るまでは常に null を返すので、
// Product.createdBy / updatedBy や ImportBatch.importedBy は null のまま保存される。
// requireAuth が req.user をセットするようになれば、呼び出し側を変えずに値が入る。
export function currentUserId(req: Request): string | null {
  return req.user?.id ?? null;
}
