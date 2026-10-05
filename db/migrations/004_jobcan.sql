-- ============================================================
-- 004 ジョブカンワークフロー連携
--
-- 中身は Supabase版（supabase/04_jobcan.sql）と同一です。
-- RLSとGRANTだけ削除しました（アクセス制御はアプリ側で行うため）。
--
-- ★Supabase版の Edge Function（supabase/functions/jobcan-sync）は、
--   この構成では使えません。定期取り込みはサーバー側のバッチに移します。
--   （アプリ実装ガイドライン10章：コンテナ内でcronを動かさないこと）
--
-- 何度実行しても同じ結果になります。
-- ============================================================

--   このSQLは「その結果を受け取る場所」を用意するだけです。
--
--   ジョブカンのAPIは参照専用（GETのみ）なので、申請そのものはジョブカンで行います。
--   このアプリは「今どの段階か」を写し取るだけ、という関係は変わりません。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 商品に、対応するジョブカンの稟議を記録する列を足す
--
-- 商品とジョブカンの稟議は「稟議のタイトルに商品ID（A0001）を含める」運用で突き合わせます。
-- （2026-09-18決定。詳細は docs/design-gap.md）
-- ------------------------------------------------------------

alter table public.products
  -- ジョブカン側の申請書ID。ジョブカンの画面を開くリンクにも使う
  add column if not exists "jobcanRequestId"  bigint,
  -- ジョブカン側のステータスをそのまま保存する。
  -- in_progress / completed / rejected / returned / canceled_after_completion
  -- アプリのstatusに写せない状態（差戻しなど）もここには残るので、画面で理由を説明できる
  add column if not exists "jobcanStatus"     text,
  -- 突き合わせた稟議のタイトル。取り違えに気づけるように原文を残す
  add column if not exists "jobcanTitle"      text,
  add column if not exists "jobcanAppliedAt"  timestamptz,
  add column if not exists "jobcanApprovedAt" timestamptz,
  -- 最後にジョブカンと突き合わせた時刻。古いままなら連携が止まっていると分かる
  add column if not exists "jobcanSyncedAt"   timestamptz;

create index if not exists products_jobcan_request_idx
  on public.products ("jobcanRequestId");

-- ------------------------------------------------------------
-- 2. 同期の実行記録
--
-- 「いつ・何件取れて・何件反映したか」を残します。
-- 次回どこから取り直すか（applied_after）の起点にもなるので、消さないでください。
-- ------------------------------------------------------------

create table if not exists public.jobcan_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  "startedAt"  timestamptz not null default now(),
  "finishedAt" timestamptz,
  -- ジョブカンから取得した申請書の件数
  fetched      int not null default 0,
  -- 商品に反映できた件数
  updated      int not null default 0,
  -- タイトルから商品IDが読み取れなかった／該当商品が無かった件数
  unmatched    int not null default 0,
  -- 失敗したときの内容。成功時はnull
  error        text
);

create index if not exists jobcan_sync_runs_started_idx
  on public.jobcan_sync_runs ("startedAt" desc);

-- ------------------------------------------------------------
-- 3. アクセス制御（RLS）
--
-- ★新しいテーブルには必ずRLSを付けること（CLAUDE.md の「絶対に守ること」2）。
--   付け忘れると、ログインさえすれば誰でも読める状態になります。
--
-- この表は「ログインした人は見られる・書けるのは同期処理だけ」にします。
-- 同期処理はEdge Functionがservice_roleで動くため、RLSを通らずに書き込めます。
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 5. 直近の同期状況を1行で返す
--
-- 画面の「連携が生きているか」表示に使います。
-- ------------------------------------------------------------

create or replace function public.jobcan_sync_status()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'startedAt',  r."startedAt",
        'finishedAt', r."finishedAt",
        'fetched',    r.fetched,
        'updated',    r.updated,
        'unmatched',  r.unmatched,
        'error',      r.error
      )
      from public.jobcan_sync_runs r
      order by r."startedAt" desc
      limit 1
    ),
    -- 一度も動いていない場合
    'null'::jsonb
  );
$$;

