-- ============================================================
-- 新規登録を「会社のメールアドレスだけ」に制限する
--
-- 01_schema.sql / 02_functions.sql のあとに、SQL Editor で実行してください。
-- 何度実行しても同じ結果になります。
--
-- なぜDB側でやるのか:
--   このアプリは公開URLにあり、画面のJSは誰でも読めます。画面側のチェックだけでは
--   APIを直接叩かれれば素通りしてしまうので、最後の砦をDBに置きます。
--   画面側にも同じチェックを入れていますが、あちらは「分かりやすいエラーを出すため」で、
--   本当に守っているのはこのトリガーです。
-- ============================================================

-- 許可するドメイン。増やすときはこの配列に足してください。
create or replace function public.enforce_signup_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array['lo-cal-g.com', 'lo-cal.co.jp'];
  domain  text;
begin
  -- メール以外の方法（電話番号など）は使っていないので、その場合は素通しする
  if new.email is null or new.email = '' then
    return new;
  end if;

  domain := lower(split_part(new.email, '@', 2));

  if not (domain = any(allowed)) then
    raise exception '会社のメールアドレス（@% ）でのみ登録できます。', array_to_string(allowed, ' / @')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_signup_domain_trigger on auth.users;
create trigger enforce_signup_domain_trigger
  before insert on auth.users
  for each row execute function public.enforce_signup_domain();

-- 注意:
--   このトリガーは「Supabaseの管理画面から手動でユーザーを作る場合」にも効きます。
--   別ドメインのアカウントをどうしても作りたいときは、上の配列に一時的に足すか、
--   トリガーを外して作成し、すぐ戻してください。
