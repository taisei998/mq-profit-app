-- ============================================================
-- MQ率 利益計算アプリ / Supabase スキーマ
--
-- 使い方: Supabaseの SQL Editor にこのファイルの中身を貼って実行してください。
--         何度実行しても同じ結果になります（作り直しはしません）。
--
-- 【列名について】
-- Postgresの慣習はスネークケース(snake_case)ですが、このスキーマは
-- 画面側の型(ProductRecord など)とそのまま対応させるため
-- キャメルケース(camelCase)を二重引用符で囲って使っています。
-- 変換用のコードを書かずに済み、取り違えの事故を減らせるためです。
-- SQLを書くときは "shopId" のように必ず引用符が要る点に注意してください。
-- ============================================================

-- ------------------------------------------------------------
-- 1. ユーザー（ログインした人）
-- ------------------------------------------------------------
-- Supabase Authのユーザーに、表示名と権限をぶら下げる。
-- role: admin(管理) / approver(承認できる) / editor(登録・編集できる) / viewer(閲覧のみ)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  "displayName" text not null default '',
  role         text not null default 'editor'
                 check (role in ('admin', 'approver', 'editor', 'viewer')),
  "createdAt"  timestamptz not null default now()
);

-- ユーザーが増えたら自動でプロフィールを作る。
-- 既定は editor（登録・編集はできるが承認はできない）。
-- 承認できる1〜2名だけ、あとから role を 'approver' に変更してください。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, "displayName")
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. マスタ
-- ------------------------------------------------------------
create table if not exists public.malls (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  "sortOrder" int  not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- 1つのモールに複数店舗がぶら下がる。
-- 店舗が残っているモールは消せない（on delete restrict）。
create table if not exists public.shops (
  id          uuid primary key default gen_random_uuid(),
  "mallId"    uuid not null references public.malls(id) on delete restrict,
  name        text not null,
  "sortOrder" int  not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("mallId", name)
);
create index if not exists shops_mall_idx on public.shops ("mallId");

create table if not exists public.site_fees (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  fee          double precision,
  "couponFee"  double precision,
  "consultFee" double precision,
  "otherFees"  jsonb not null default '[]'::jsonb,
  note         text,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);

create table if not exists public.shipping_rates (
  id          uuid primary key default gen_random_uuid(),
  carrier     text,
  temp        text,
  size        text,
  "unitPrice" double precision not null,
  "taxRate"   double precision not null default 10,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  "unitPrice" double precision not null,
  "taxRate"   double precision not null default 10,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. 商品
-- ------------------------------------------------------------
-- 固有ID(A0001...)の採番。シーケンスを使うので同時に登録されても重複しない。
create sequence if not exists public.product_number_seq;

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  -- 固有ID。A0001, A0002, ... と自動で振られる
  "productId"    text not null unique
                   default 'A' || lpad(nextval('public.product_number_seq')::text, 4, '0'),
  -- 管理番号。同じ商品を複数モールに出すとき同じ値を入れると横断できる（一意にはしない）
  "mgmtNo"       text,
  -- 商品コードはモール・店舗ごとにprefixが変わるため「店舗＋コード」で一意とする
  code           text not null,
  "shopId"       uuid not null references public.shops(id) on delete restrict,
  name           text not null default '',
  spec           text,
  note           text,
  category       text not null,
  "priceTaxRate" int  not null default 10,
  "setCount"     int  not null default 5,
  -- 稟議ステータス。遷移の制限は下のトリガーで強制する
  status         text not null default 'draft'
                   check (status in ('draft','pending','approved','rejected','selling','ended')),
  -- 登録者・更新者は画面から送らずDB側で埋める。
  -- upsert（同じ店舗＋コードなら上書き）のとき createdBy を壊さないようにするため。
  "createdBy"    uuid default auth.uid() references auth.users(id) on delete set null,
  "updatedBy"    uuid default auth.uid() references auth.users(id) on delete set null,
  -- 区分ごとの計算結果と明細。項目構成が商品ごとに可変なのでJSONのまま持つ
  "normalData"   jsonb not null,
  "saleData"     jsonb not null,
  "couponData"   jsonb not null,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now(),
  unique ("shopId", code)
);
create index if not exists products_shop_idx on public.products ("shopId");
create index if not exists products_category_idx on public.products (category);
create index if not exists products_status_idx on public.products (status);

-- ------------------------------------------------------------
-- 4. 受注
-- ------------------------------------------------------------
create table if not exists public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  "shopId"         uuid not null references public.shops(id) on delete restrict,
  "fileName"       text not null,
  "importedAt"     timestamptz not null default now(),
  "totalCount"     int not null,
  "successCount"   int not null,
  "unmatchedCount" int not null,
  "errorCount"     int not null,
  "excludedCount"  int not null,
  status           text not null default 'done',
  "importedBy"     uuid references auth.users(id) on delete set null,
  "unmatchedDetail" jsonb not null default '{}'::jsonb,
  "errorDetail"     jsonb not null default '{}'::jsonb
);
create index if not exists batches_shop_idx on public.import_batches ("shopId");
create index if not exists batches_at_idx on public.import_batches ("importedAt" desc);

-- 受注明細。取込1行＝1レコード。
-- orderDate は "YYYY-MM-DD" の文字列。タイムゾーン変換で日付がずれる事故を防ぐため
-- あえて日付型にしていない（辞書順＝日付順なので並べ替え・範囲検索はできる）。
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  "batchId"     uuid not null references public.import_batches(id) on delete cascade,
  "shopId"      uuid not null references public.shops(id) on delete restrict,
  "orderNo"     text,
  "orderDate"   text not null,
  "productCode" text not null,
  "productId"   uuid references public.products(id) on delete set null,
  "unitPrice"   double precision not null,
  quantity      int not null,
  amount        double precision not null,
  kind          text not null,
  profit        double precision not null,
  "profitRate"  double precision not null
);
create index if not exists orders_shop_date_idx on public.orders ("shopId", "orderDate");
create index if not exists orders_product_idx on public.orders ("productId");
create index if not exists orders_batch_idx on public.orders ("batchId");

-- モール別のCSV列マッピング。列構成はモール単位で決まるので店舗別には持たない。
create table if not exists public.mall_csv_mappings (
  id          uuid primary key default gen_random_uuid(),
  "mallId"    uuid not null unique references public.malls(id) on delete cascade,
  config      jsonb not null,
  "updatedAt" timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. updatedAt を自動更新する
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['malls','shops','site_fees','shipping_rates','materials','products','mall_csv_mappings']
  loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end;
$$;

-- 更新した人を自動で記録する
create or replace function public.touch_updated_by()
returns trigger
language plpgsql
as $$
begin
  new."updatedBy" = auth.uid();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_by on public.products;
create trigger products_touch_updated_by
  before update on public.products
  for each row execute function public.touch_updated_by();

-- ------------------------------------------------------------
-- 6. 稟議ステータスの遷移を強制する
-- ------------------------------------------------------------
-- 画面側でも進める先しか出していないが、APIを直接叩かれても守れるようDB側でも検証する。
-- 承認・却下は role が approver / admin の人だけ。
create or replace function public.enforce_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[];
  my_role text;
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'draft'    then array['pending']
    when 'pending'  then array['approved','rejected']
    when 'approved' then array['selling','draft']
    when 'rejected' then array['draft']
    when 'selling'  then array['ended']
    when 'ended'    then array['selling']
    else array[]::text[]
  end;

  if not (new.status = any(allowed)) then
    raise exception '「%」から「%」には変更できません。', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('approved','rejected') then
    select role into my_role from public.profiles where id = auth.uid();
    if my_role is null or my_role not in ('approver','admin') then
      raise exception '承認・却下の権限がありません。管理者に承認権限（approver）の付与を依頼してください。'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists products_status_guard on public.products;
create trigger products_status_guard
  before update of status on public.products
  for each row execute function public.enforce_status_transition();

-- ------------------------------------------------------------
-- 7. アクセス制御（RLS）
--
-- ここが一番重要です。画面に埋め込む anon キーは公開されるため、
-- 「ログインしていない人は何もできない」をDB側で保証する必要があります。
-- 方針: ログイン済み(authenticated)なら業務データを読み書きできる。未ログインは一切不可。
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','malls','shops','site_fees','shipping_rates','materials',
    'products','import_batches','orders','mall_csv_mappings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    -- 作り直せるよう、同名ポリシーがあれば消してから作る
    execute format('drop policy if exists "authenticated_read" on public.%I', t);
    execute format('drop policy if exists "authenticated_write" on public.%I', t);
    execute format(
      'create policy "authenticated_read" on public.%I
         for select to authenticated using (true)', t);
  end loop;
end;
$$;

-- 書き込みは業務テーブルのみ許可（profiles は下で別扱い）
do $$
declare t text;
begin
  foreach t in array array[
    'malls','shops','site_fees','shipping_rates','materials',
    'products','import_batches','orders','mall_csv_mappings'
  ]
  loop
    execute format(
      'create policy "authenticated_write" on public.%I
         for all to authenticated using (true) with check (true)', t);
  end loop;
end;
$$;

-- profiles は「自分の表示名だけ変更できる」。role の変更はここでは許可しない
-- （権限の昇格を防ぐため。承認者の指定はSupabaseの管理画面から行う）。
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- ------------------------------------------------------------
-- 8. モールの初期データ
-- ------------------------------------------------------------
insert into public.malls (name, "sortOrder") values
  ('楽天市場', 1),
  ('Yahoo!ショッピング', 2),
  ('au PAY マーケット', 3),
  ('Amazon', 4),
  ('自社EC', 5)
on conflict (name) do nothing;
