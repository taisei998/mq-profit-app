// サーバーとのやり取り。
//
// 同じコンテナが画面とAPIの両方を返すので、宛先は同じオリジンの `/api/...` です。
// 手元の開発では Vite が `/api` をサーバー（8080番）へ中継します。

/** ログインしていない／セッションが切れたときに投げる */
export class NotLoggedIn extends Error {
  constructor() {
    super('ログインしてください。');
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    // セッションのCookieを送る
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    throw new NotLoggedIn();
  }

  // サーバーは失敗時に { error: "日本語のメッセージ" } を返す
  if (!res.ok) {
    let message = '処理に失敗しました。時間をおいて試してください。';
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      // JSONで返ってこない場合（サーバーが落ちている等）は既定の文言のまま
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** クエリ文字列を組み立てる。null/undefined/空文字の項目は落とす */
export function query(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** ログイン画面（社内認証システム）へ送る。戻ってきたとき今の画面に復帰する */
export function goToLogin(): void {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function goToLogout(): void {
  window.location.href = '/auth/logout';
}
