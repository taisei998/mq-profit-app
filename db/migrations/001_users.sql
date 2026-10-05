-- ============================================================
-- 001 利用者とログインセッション
--
-- ローカルアプリプラットフォーム（動的レーン）向け。
-- ログインは社内認証システム（アクセスゲートウェイ）に任せるため、
-- このアプリはパスワードを一切持ちません。
--
-- Supabase版との違い:
--   Supabase版は auth.users と RLS でアクセス制御していましたが、
--   共有RDSには利用者ごとのDBロールが無いため、RLSは同じようには効きません。
--   **アクセス制御はアプリ側（packages/server）で行います。**
--   DBは「業務の決まり」（ステータスの遷移順など）だけを引き続き守ります。
--
-- 何度実行しても同じ結果になります。
-- ============================================================

-- ------------------------------------------------------------
-- 利用者
--
-- 社内認証システムの userinfo から作られます。自分で登録する画面はありません。
-- ------------------------------------------------------------
create table if not exists public.app_users (
  id              uuid primary key default gen_random_uuid(),
  -- 社内認証システム側の利用者ID（userinfo の id。数値）。これが本人の同一性の拠り所
  "gatewayUserId" bigint not null unique,
  name            text not null default '',
  division        text,
  email           text,
  -- 権限キーはログイン時点のスナップショット。最新化はされない（仕様）
  permissions     text[] not null default '{}',
  "lastLoginAt"   timestamptz,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ログインセッション
--
-- コンテナは使い捨てられ、複数台に分散しうるため、セッションはメモリでもファイルでもなく
-- データベースに置きます（アプリ実装ガイドライン5章）。
--
-- Cookieに入れるのは生のトークンで、ここには**ハッシュだけ**を保存します。
-- 万一この表が漏れても、それだけでは成りすませません。
-- ------------------------------------------------------------
create table if not exists public.sessions (
  -- トークンのSHA-256（16進）。生のトークンは保存しない
  "tokenHash"  text primary key,
  "userId"     uuid not null references public.app_users(id) on delete cascade,
  "expiresAt"  timestamptz not null,
  "createdAt"  timestamptz not null default now()
);

create index if not exists sessions_user_idx    on public.sessions ("userId");
create index if not exists sessions_expires_idx on public.sessions ("expiresAt");

-- ------------------------------------------------------------
-- ログイン手続きの途中経過（PKCE）
--
-- 認可リクエストを送ったコンテナと、コールバックを受けるコンテナが別になることがあるため、
-- サーバーのメモリには置けません（アプリ実装ガイドライン13章）。
-- Cookieに入れる案もありますが、共有WAFのCookie合計8KB制限に近づけたくないのでDBに置きます。
-- ------------------------------------------------------------
create table if not exists public.auth_flows (
  -- 認可リクエストの state。コールバックで突き合わせる
  state           text primary key,
  "codeVerifier"  text not null,
  -- ログイン後に戻したい画面のパス（アプリ内の相対パスのみ。外部への誘導を防ぐ）
  "returnTo"      text not null default '/',
  "expiresAt"     timestamptz not null,
  "createdAt"     timestamptz not null default now()
);

create index if not exists auth_flows_expires_idx on public.auth_flows ("expiresAt");

-- ------------------------------------------------------------
-- 期限切れセッションの掃除
--
-- 定期実行から呼びます。コンテナ起動のたびに自動実行はしません
-- （複数台で同時に走ると事故るため。アプリ実装ガイドライン5章）。
-- ------------------------------------------------------------
create or replace function public.purge_expired_sessions()
returns integer
language plpgsql
as $$
declare
  n integer;
  m integer;
begin
  delete from public.sessions where "expiresAt" < now();
  get diagnostics n = row_count;
  -- ログイン手続きの途中で離脱した分も一緒に掃除する
  delete from public.auth_flows where "expiresAt" < now();
  get diagnostics m = row_count;
  return n + m;
end;
$$;
