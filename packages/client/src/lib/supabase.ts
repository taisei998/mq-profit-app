import { createClient } from '@supabase/supabase-js';

// 接続先は .env（開発）とGitHub Actionsのシークレット（公開版）から渡す。
//
// anon キーはブラウザに埋め込まれる＝公開される前提の鍵です。これは設計どおりで、
// データを守っているのはキーではなくDB側のアクセス制御（RLS）です。
// 「ログインしていない人は何も読めない」を supabase/01_schema.sql で設定しています。
// ※ service_role キーは絶対にここに書かないでください（RLSを無視できてしまいます）。
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  // 画面側で案内を出すので、ここでは落とさず警告だけにする
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されていません。');
}

export const supabase = createClient(url ?? 'http://localhost:0', anonKey ?? 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Supabaseのエラーを、画面にそのまま出せる日本語のメッセージに変換する。
// PostgresのエラーコードやRLS拒否は生のまま出しても伝わらないため。
export function toMessage(error: { message?: string; code?: string; hint?: string } | null): string {
  if (!error) return '不明なエラーが発生しました。';
  const raw = error.message ?? '';

  if (error.code === '23505' || raw.includes('duplicate key')) {
    return 'すでに同じものが登録されています。';
  }
  if (error.code === '23503' || raw.includes('violates foreign key')) {
    return '他のデータから参照されているため、この操作はできません。先に関連するデータを削除してください。';
  }
  if (error.code === '42501' || raw.includes('row-level security')) {
    return '権限がありません。ログインし直すか、管理者に権限の付与を依頼してください。';
  }
  // トリガーで raise exception した日本語メッセージはそのまま出す
  return raw || '処理に失敗しました。';
}

// クエリ結果のエラーを投げる小さなヘルパー。呼び出し側を短く保つため。
export function unwrap<T>(res: { data: T | null; error: { message?: string; code?: string } | null }): T {
  if (res.error) throw new Error(toMessage(res.error));
  return res.data as T;
}
