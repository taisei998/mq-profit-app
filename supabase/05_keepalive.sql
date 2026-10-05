-- ============================================================
-- Supabaseを休止させないための「空振り用」関数
--
-- SQL Editor で実行してください。何度実行しても同じ結果になります。
--
-- なぜ必要か:
--   無料プランのSupabaseは、1週間まったく使われないとプロジェクトが自動で停止します。
--   停止するとドメインごと解決できなくなり、アプリを開いた人には
--   「Failed to fetch」としか表示されません（2026-10-05に実際に止まりました）。
--
--   毎日使うツールではないので、GitHub Actions から3日おきにこの関数を呼んで
--   「使われている」状態を保ちます（.github/workflows/keepalive.yml）。
--
-- 安全性:
--   返すのは現在時刻だけです。テーブルには一切触れません。
--   ログインしていない人（anon）からも呼べますが、これ以外は何もできません。
-- ============================================================

create or replace function public.ping()
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  select now();
$$;

revoke all on function public.ping() from public;
-- 未ログインでも呼べるようにする。定期アクセスはログインせずに叩くため。
grant execute on function public.ping() to anon, authenticated;
