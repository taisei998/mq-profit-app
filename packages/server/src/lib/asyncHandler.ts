import type { NextFunction, Request, RequestHandler, Response } from 'express';

// async な express ハンドラの例外を errorHandler に渡すためのラッパー
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
