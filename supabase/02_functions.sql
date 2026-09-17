-- ============================================================
-- MQ率 利益計算アプリ / DB側の処理（RPC）
--
-- 01_schema.sql のあとに、SQL Editor でこのファイルを実行してください。
--
-- なぜ画面側でやらずDBに置くのか:
--   * 受注取込 … 「履歴」と「明細」は必ずセットで保存したい。関数の中は1つの
--                 トランザクションなので、途中で失敗しても中途半端に残らない。
--   * 集計     … 受注は月に数千〜数万件貯まる。全部ブラウザに落として計算するのは
--                 現実的でないので、DB側で集計して結果だけ返す。
-- ============================================================

-- ------------------------------------------------------------
-- 受注の取込（取込履歴＋受注明細をまとめて保存）
-- ------------------------------------------------------------
create or replace function public.import_orders(
  p_shop_id          uuid,
  p_file_name        text,
  p_total            int,
  p_success          int,
  p_unmatched        int,
  p_error            int,
  p_excluded         int,
  p_unmatched_detail jsonb,
  p_error_detail     jsonb,
  p_orders           jsonb
)
returns uuid
language plpgsql
security invoker            -- 呼び出した人の権限で動く（RLSがそのまま効く）
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  insert into public.import_batches (
    "shopId", "fileName", "totalCount", "successCount",
    "unmatchedCount", "errorCount", "excludedCount",
    "unmatchedDetail", "errorDetail", "importedBy"
  ) values (
    p_shop_id, p_file_name, p_total, p_success,
    p_unmatched, p_error, p_excluded,
    coalesce(p_unmatched_detail, '{}'::jsonb), coalesce(p_error_detail, '{}'::jsonb), auth.uid()
  )
  returning id into v_batch_id;

  if p_orders is not null and jsonb_array_length(p_orders) > 0 then
    insert into public.orders (
      "batchId", "shopId", "orderNo", "orderDate", "productCode",
      "productId", "unitPrice", quantity, amount, kind, profit, "profitRate"
    )
    select
      v_batch_id,
      p_shop_id,
      d."orderNo",
      d."orderDate",
      d."productCode",
      d."productId",
      d."unitPrice",
      d.quantity,
      d.amount,
      d.kind,
      d.profit,
      d."profitRate"
    from jsonb_to_recordset(p_orders) as d(
      "orderNo"     text,
      "orderDate"   text,
      "productCode" text,
      "productId"   uuid,
      "unitPrice"   double precision,
      quantity      int,
      amount        double precision,
      kind          text,
      profit        double precision,
      "profitRate"  double precision
    );
  end if;

  return v_batch_id;
end;
$$;

-- ------------------------------------------------------------
-- HOMEダッシュボードの集計
-- ------------------------------------------------------------
-- 期間・モール・店舗・ステータスで絞り込んだうえで、
-- KPI / 月別 / 日別 / モール別 / 商品ランキング / アラート をまとめて返す。
create or replace function public.dashboard_summary(
  p_from    text,
  p_to      text,
  p_mall_id uuid default null,
  p_shop_id uuid default null,
  p_status  text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shop_ids  uuid[];
  v_days      int;
  v_prev_from text;
  v_prev_to   text;
  v_cur       record;
  v_prev      record;
  v_monthly   jsonb;
  v_daily     jsonb;
  v_by_mall   jsonb;
  v_top       jsonb;
  v_unmatched int;
  v_errors    int;
  v_no_import jsonb;
begin
  -- 対象店舗を決める（店舗指定 > モール指定 > 全部）
  if p_shop_id is not null then
    v_shop_ids := array[p_shop_id];
  elsif p_mall_id is not null then
    select array_agg(id) into v_shop_ids from public.shops where "mallId" = p_mall_id;
    v_shop_ids := coalesce(v_shop_ids, array[]::uuid[]);
  else
    v_shop_ids := null;  -- null = 絞り込みなし
  end if;

  -- 前期間（同じ日数ぶん手前）
  v_days      := (p_to::date - p_from::date) + 1;
  v_prev_to   := (p_from::date - 1)::text;
  v_prev_from := ((p_from::date - 1) - (v_days - 1))::text;

  -- 絞り込み済みの受注を一時的にまとめる
  create temporary table if not exists _dash_scope (
    "orderDate" text, "shopId" uuid, "productId" uuid,
    amount double precision, profit double precision
  ) on commit drop;
  delete from _dash_scope;

  insert into _dash_scope
  select o."orderDate", o."shopId", o."productId", o.amount, o.profit
  from public.orders o
  left join public.products pr on pr.id = o."productId"
  where o."orderDate" >= v_prev_from
    and o."orderDate" <= p_to
    and (v_shop_ids is null or o."shopId" = any(v_shop_ids))
    and (p_status is null or pr.status = p_status);

  select coalesce(sum(amount),0) as sales, coalesce(sum(profit),0) as profit, count(*) as cnt
    into v_cur
    from _dash_scope where "orderDate" >= p_from and "orderDate" <= p_to;

  select coalesce(sum(amount),0) as sales, coalesce(sum(profit),0) as profit, count(*) as cnt
    into v_prev
    from _dash_scope where "orderDate" >= v_prev_from and "orderDate" <= v_prev_to;

  -- 月別（売上推移グラフ用）
  select coalesce(jsonb_agg(x order by x.month), '[]'::jsonb) into v_monthly from (
    select substring("orderDate" from 1 for 7) as month,
           sum(amount) as sales, sum(profit) as profit, count(*) as count
    from _dash_scope where "orderDate" >= p_from and "orderDate" <= p_to
    group by 1
  ) x;

  -- 日別
  select coalesce(jsonb_agg(x order by x.date), '[]'::jsonb) into v_daily from (
    select "orderDate" as date, sum(amount) as sales, sum(profit) as profit, count(*) as count
    from _dash_scope where "orderDate" >= p_from and "orderDate" <= p_to
    group by 1
  ) x;

  -- モール別
  select coalesce(jsonb_agg(x order by x.sales desc), '[]'::jsonb) into v_by_mall from (
    select m.id as "mallId", m.name as "mallName",
           sum(d.amount) as sales, sum(d.profit) as profit, count(*) as count
    from _dash_scope d
    join public.shops s on s.id = d."shopId"
    join public.malls m on m.id = s."mallId"
    where d."orderDate" >= p_from and d."orderDate" <= p_to
    group by m.id, m.name
  ) x;

  -- 商品別ランキング（上位5件）
  select coalesce(jsonb_agg(x order by x.rank), '[]'::jsonb) into v_top from (
    select row_number() over (order by sum(d.amount) desc) as rank,
           d."productId" as "productId",
           coalesce(pr.name, '(削除された商品)') as name,
           coalesce(pr.code, '') as code,
           sum(d.amount) as sales, sum(d.profit) as profit, count(*) as count
    from _dash_scope d
    left join public.products pr on pr.id = d."productId"
    where d."orderDate" >= p_from and d."orderDate" <= p_to
      and d."productId" is not null
    group by d."productId", pr.name, pr.code
    order by sum(d.amount) desc
    limit 5
  ) x;

  -- アラート（取込履歴の件数から出す）
  select coalesce(sum("unmatchedCount"),0), coalesce(sum("errorCount"),0)
    into v_unmatched, v_errors
    from public.import_batches
   where v_shop_ids is null or "shopId" = any(v_shop_ids);

  -- 一度も取り込んでいないモール（店舗が登録されているモールだけが対象）
  select coalesce(jsonb_agg(name order by "sortOrder"), '[]'::jsonb) into v_no_import
  from public.malls m
  where exists (select 1 from public.shops s where s."mallId" = m.id)
    and not exists (
      select 1 from public.import_batches b
      join public.shops s2 on s2.id = b."shopId"
      where s2."mallId" = m.id
    );

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'previousRange', jsonb_build_object('from', v_prev_from, 'to', v_prev_to),
    'kpi', jsonb_build_object(
      'sales', v_cur.sales,
      'profit', v_cur.profit,
      'rate', case when v_cur.sales > 0 then (v_cur.profit / v_cur.sales) * 100 else null end,
      'count', v_cur.cnt,
      'prevSales', v_prev.sales,
      'prevProfit', v_prev.profit,
      'prevRate', case when v_prev.sales > 0 then (v_prev.profit / v_prev.sales) * 100 else null end,
      'prevCount', v_prev.cnt
    ),
    'monthly', v_monthly,
    'daily', v_daily,
    'byMall', v_by_mall,
    'topProducts', v_top,
    'alerts', jsonb_build_object(
      'unmatched', v_unmatched,
      'errors', v_errors,
      'mallsWithoutImport', v_no_import
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 実行権限
-- ------------------------------------------------------------
-- ログイン済みの人だけが呼べるようにする。未ログイン(anon)には与えない。
revoke all on function public.import_orders(uuid, text, int, int, int, int, int, jsonb, jsonb, jsonb) from public;
revoke all on function public.dashboard_summary(text, text, uuid, uuid, text) from public;

grant execute on function public.import_orders(uuid, text, int, int, int, int, int, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.dashboard_summary(text, text, uuid, uuid, text) to authenticated;
