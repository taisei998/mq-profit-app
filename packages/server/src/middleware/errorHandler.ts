import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 集約エラーハンドラ。スタックトレースや内部詳細をクライアントに漏らさない。
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: '入力内容が正しくありません。', details: err.flatten() });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Prisma の一意制約違反など
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
    res.status(409).json({ error: 'すでに同じ値が登録されています。' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'サーバー内部でエラーが発生しました。' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: '指定されたリソースが見つかりません。' });
}
