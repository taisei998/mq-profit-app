// 社内認証システム（アクセスゲートウェイ）連携。
//
// OAuth2 Authorization Code + PKCE。このアプリはパスワードを一切扱いません。
// 仕様は「社内認証システム連携の仕組み.md」、実装上の注意は
// 「アプリ実装ガイドライン.md」13章。
//
// 【踏まないよう気をつけた落とし穴】
//   - `<アプリ名>.*` を持つ人の permissions に `<アプリ名>.access` は**入らない**。
//     access だけを見る判定にすると、権限を一番多く持つ人だけログインできなくなる
//   - 判定できなかったときは**通さない側に倒す**
//   - ログアウトはアプリ側のセッション破棄とゲートウェイへのリダイレクトの**両方**。
//     片方だけだと、ログアウト直後に確認なしで再ログインが成立してしまう
//   - PKCEの値はサーバーのメモリに置かない（コンテナが複数台になりうるため）

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Config } from './config.js';
import { gatewayReady } from './config.js';
import { db, one } from './db.js';

const SESSION_COOKIE = 'mq_session';
const FLOW_TTL_MINUTES = 10;

export interface AppUser {
  id: string;
  gatewayUserId: number;
  name: string;
  division: string | null;
  email: string | null;
  permissions: string[];
}

// ------------------------------------------------------------
// 小さな道具
// ------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

/** Cookieに入れる生のトークン。DBにはこのハッシュだけを保存する */
function newToken(): { raw: string; hash: string } {
  const raw = base64url(randomBytes(32));
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}

/**
 * ログイン後の戻り先。**アプリ内の相対パスだけ**を許可する。
 * 外部URLをそのまま受け入れると、ログインを踏み台にした誘導に使われる。
 */
function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '/';
  // 「//」始まりは別ホストへのプロトコル相対URL。弾く
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// ------------------------------------------------------------
// ログイン開始
// ------------------------------------------------------------

export async function startLogin(req: Request, res: Response, config: Config): Promise<void> {
  if (!gatewayReady(config)) {
    res.status(503).type('text/plain; charset=utf-8').send(
      'ログインの準備がまだ整っていません。社内認証システムの接続先が未設定です。\n' +
        '公開申請が完了すると使えるようになります。'
    );
    return;
  }

  const state = base64url(randomBytes(24));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(sha256(codeVerifier));

  await db().query(
    `insert into public.auth_flows (state, "codeVerifier", "returnTo", "expiresAt")
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [state, codeVerifier, safeReturnTo(req.query.returnTo), String(FLOW_TTL_MINUTES)]
  );

  const url = new URL(`${config.gateway.url}/oauth/authorize`);
  url.searchParams.set('client_id', config.gateway.clientId!);
  // 登録値と完全一致が必要。末尾スラッシュの有無も不一致になる
  url.searchParams.set('redirect_uri', redirectUri(config));
  url.searchParams.set('response_type', 'code');
  // permissions は必須。これが無いと「使ってよい人か」を判定できない
  url.searchParams.set('scope', 'profile permissions');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  res.redirect(url.toString());
}

export function redirectUri(config: Config): string {
  return `${config.appUrl}/auth/callback`;
}

// ------------------------------------------------------------
// コールバック
// ------------------------------------------------------------

interface UserInfo {
  id: number;
  name?: string;
  division?: string;
  email?: string;
  permissions?: string[];
}

export async function handleCallback(req: Request, res: Response, config: Config): Promise<void> {
  if (!gatewayReady(config)) {
    res.status(503).type('text/plain; charset=utf-8').send('ログインの準備がまだ整っていません。');
    return;
  }

  // 利用者が同意画面で拒否した場合
  if (typeof req.query.error === 'string') {
    res.status(400).type('text/plain; charset=utf-8').send(
      req.query.error === 'access_denied'
        ? 'ログインがキャンセルされました。'
        : `ログインに失敗しました（${req.query.error}）。`
    );
    return;
  }

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!state || !code) {
    res.status(400).type('text/plain; charset=utf-8').send('ログインの情報が足りません。最初からやり直してください。');
    return;
  }

  // state は1回限り。取り出すと同時に消す（使い回しを防ぐ）
  const flow = await one<{ codeVerifier: string; returnTo: string }>(
    `delete from public.auth_flows
      where state = $1 and "expiresAt" > now()
      returning "codeVerifier", "returnTo"`,
    [state]
  );
  if (!flow) {
    res.status(400).type('text/plain; charset=utf-8').send(
      'ログインの手続きが期限切れか、既に使われています。最初からやり直してください。'
    );
    return;
  }

  // --- 認可コードをトークンに交換する（サーバーから直接。ブラウザは通さない） ---
  const tokenRes = await fetch(`${config.gateway.url}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.gateway.clientId!,
      redirect_uri: redirectUri(config),
      code,
      code_verifier: flow.codeVerifier,
      // client_secret は発行されない（Publicクライアント）。送らないこと
    }),
  });
  if (!tokenRes.ok) {
    console.error('[auth] トークン交換に失敗', tokenRes.status, await tokenRes.text().catch(() => ''));
    res.status(502).type('text/plain; charset=utf-8').send('ログインに失敗しました。時間をおいて試してください。');
    return;
  }
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) {
    res.status(502).type('text/plain; charset=utf-8').send('ログインに失敗しました。');
    return;
  }

  // --- 利用者情報を取る ---
  // access_token は5分で切れる短命なもの。保存せず、ここで使い切る
  const infoRes = await fetch(`${config.gateway.url}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!infoRes.ok) {
    console.error('[auth] userinfo の取得に失敗', infoRes.status);
    // 判定できなかったときは通さない
    res.status(502).type('text/plain; charset=utf-8').send('ログインに失敗しました。');
    return;
  }
  const info = (await infoRes.json()) as UserInfo;

  // --- このアプリを使ってよい人かを判定する ---
  if (!Array.isArray(info.permissions)) {
    // permissions が無い＝判定できない。通さない側に倒す
    console.error('[auth] userinfo に permissions がありません');
    res.status(403).type('text/plain; charset=utf-8').send('利用可否を確認できませんでした。管理者にお問い合わせください。');
    return;
  }
  if (!canUseApp(info.permissions, config.appName)) {
    res.status(403).type('text/plain; charset=utf-8').send(
      'このアプリの利用を許可されていません。\n必要な場合は管理者に利用権限の付与を依頼してください。'
    );
    return;
  }

  // --- 利用者とセッションを作る ---
  const user = await one<{ id: string }>(
    `insert into public.app_users ("gatewayUserId", name, division, email, permissions, "lastLoginAt")
     values ($1, $2, $3, $4, $5, now())
     on conflict ("gatewayUserId") do update
       set name = excluded.name,
           division = excluded.division,
           email = excluded.email,
           permissions = excluded.permissions,
           "lastLoginAt" = now(),
           "updatedAt" = now()
     returning id`,
    [info.id, info.name ?? '', info.division ?? null, info.email ?? null, info.permissions]
  );

  const { raw, hash } = newToken();
  await db().query(
    `insert into public.sessions ("tokenHash", "userId", "expiresAt")
     values ($1, $2, now() + ($3 || ' hours')::interval)`,
    [hash, user!.id, String(config.sessionHours)]
  );

  res.cookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: 'lax',
    // HTTPSはALBで終端される。元がhttpsだったかはヘッダーで分かる
    secure: req.protocol === 'https',
    path: '/',
    maxAge: config.sessionHours * 60 * 60 * 1000,
  });
  res.redirect(flow.returnTo);
}

/**
 * 利用可否の判定。
 * `<アプリ名>.*` を持つ人の配列に `<アプリ名>.access` は入らないので、
 * **どちらかがあれば可**とする。
 */
export function canUseApp(permissions: string[], appName: string): boolean {
  return permissions.includes(`${appName}.access`) || permissions.includes(`${appName}.*`);
}

// ------------------------------------------------------------
// ログアウト
// ------------------------------------------------------------

export async function logout(req: Request, res: Response, config: Config): Promise<void> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw === 'string' && raw !== '') {
    const hash = createHash('sha256').update(raw).digest('hex');
    await db().query(`delete from public.sessions where "tokenHash" = $1`, [hash]);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });

  if (!gatewayReady(config)) {
    res.redirect('/logged-out');
    return;
  }

  // アプリのセッションを消すだけでは、ゲートウェイ側のログインが残り、
  // 次の認可リクエストで確認なく再ログインしてしまう
  const url = new URL(`${config.gateway.url}/oauth/logout`);
  url.searchParams.set('client_id', config.gateway.clientId!);
  // 登録済み redirect_uri と**同一オリジン**の絶対URLであること
  url.searchParams.set('post_logout_redirect_uri', `${config.appUrl}/logged-out`);
  res.redirect(url.toString());
}

// ------------------------------------------------------------
// セッションの読み取り
// ------------------------------------------------------------

export async function currentUser(req: Request): Promise<AppUser | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw !== 'string' || raw === '') return null;
  const hash = createHash('sha256').update(raw).digest('hex');

  return await one<AppUser>(
    `select u.id,
            u."gatewayUserId",
            u.name,
            u.division,
            u.email,
            u.permissions
       from public.sessions s
       join public.app_users u on u.id = s."userId"
      where s."tokenHash" = $1
        and s."expiresAt" > now()`,
    [hash]
  );
}
