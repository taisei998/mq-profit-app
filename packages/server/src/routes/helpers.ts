// ルート共通の小道具。

import type { NextFunction, Request, Response } from 'express';
import type { AppUser } from '../auth.js';

/** ログイン済みの利用者。requireAuth を通ったあとは必ず入っている */
export interface AuthedRequest extends Request {
  user?: AppUser;
}

/** async のルートで throw された例外を Express のエラー処理へ渡す */
export function wrap(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * 画面にそのまま出してよいエラー。
 * 「何をすればいいか」が分かる日本語で投げること。
 */
export class UserError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/**
 * PostgreSQLのエラーを、画面に出せる日本語に直す。
 * DB側のトリガーが raise exception した日本語メッセージはそのまま使う。
 */
export function toUserMessage(e: unknown): { status: number; message: string } {
  const err = e as { code?: string; message?: string; detail?: string };
  switch (err.code) {
    case '23505': // unique_violation
      return { status: 409, message: 'すでに同じものが登録されています。' };
    case '23503': // foreign_key_violation
      return {
        status: 409,
        message: '他のデータから参照されているため、この操作はできません。先に関連するデータを削除してください。',
      };
    case '23514': // check_violation … ステータスの遷移制限などで使っている
    case 'P0001': // raise exception
      return { status: 400, message: err.message ?? '入力内容を確認してください。' };
    default:
      return { status: 500, message: '処理に失敗しました。時間をおいて試してください。' };
  }
}

/** 必須の文字列を取り出す */
export function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new UserError(`${name}を入力してください。`);
  }
  return v.trim();
}

/** 任意の文字列。空文字は null にする */
export function nullableStr(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v.trim();
}

/** 数値。未入力は null */
export function nullableNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 必須の数値 */
export function num(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UserError(`${name}は数値で入力してください。`);
  return n;
}
