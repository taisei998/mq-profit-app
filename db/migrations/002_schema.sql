-- ============================================================
-- 002 業務テーブル（マスタ・商品・受注）
--
-- 中身は Supabase版（supabase/01_schema.sql）の業務部分と**同一**です。
-- 計算や制約がずれると業務に影響するため、手で書き写さず機械的に抜き出しています。
--
-- Supabase版から変えたのは次の3箇所だけです:
--   - createdBy / updatedBy / importedBy の参照先を auth.users → app_users に変更
--   - 既定値 auth.uid() を削除（アプリ側で明示的に入れる。下の注記参照）
--   - RLS・GRANT・profiles は削除（アクセス制御はアプリ側で行う）
--
-- 【登録者・更新者の入れ方】
--   Supabase版はDBの既定値 auth.uid() で自動的に入れていましたが、
--   共有RDSには「今ログインしているのは誰か」をDBが知る仕組みがありません。
--   そのため **アプリ側（packages/server）が必ず明示的に渡します**。
--   upsert のときに createdBy を壊さないよう、on conflict 側では更新しないこと。
--
-- 何度実行しても同じ結果になります。
-- ============================================================

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
  "createdBy"    uuid references public.app_users(id) on delete set null,
  "updatedBy"    uuid references public.app_users(id) on delete set null,
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
  "importedBy"     uuid references public.app_users(id) on delete set null,
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

-- 元: 198〜222行目（updatedAt の自動更新）
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

-- 元: 243〜288行目（稟議ステータスの遷移制限）
-- ------------------------------------------------------------
-- 6. 稟議ステータスの遷移を強制する
-- ------------------------------------------------------------
-- 画面側でも進める先しか出していないが、APIを直接叩かれても守れるようDB側でも検証する。
--
-- 【誰が変更できるか】
-- 2026-09-17決定: ステータスの変更は「ログインしている人なら誰でも」可能。
-- 稟議そのものはジョブカンで回しており、このアプリは「今どの段階か」を記録するだけなので、
-- ここで承認者を絞る意味が薄いという判断（設計書§2.2-#1の当初案からの変更）。
-- ※ 遷移の順序（販売終了から稟議中には戻せない等）はそのまま維持する。
create or replace function public.enforce_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[];
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

  return new;
end;
$$;

drop trigger if exists products_status_guard on public.products;
create trigger products_status_guard
  before update of status on public.products
  for each row execute function public.enforce_status_transition();

-- 元: 362〜371行目（モールの初期データ）
-- ------------------------------------------------------------
-- 9. モールの初期データ
-- ------------------------------------------------------------
insert into public.malls (name, "sortOrder") values
  ('楽天市場', 1),
  ('Yahoo!ショッピング', 2),
  ('au PAY マーケット', 3),
  ('Amazon', 4),
  ('自社EC', 5)
on conflict (name) do nothing;
