-- ============================================================
-- 旧版（Supabase）のデータを書き出すクエリ
--
-- Supabase の SQL Editor に貼り付けて Run し、結果を「CSVでダウンロード」してください。
-- 読み取るだけです。旧版のデータは一切変わりません。
--
-- 書き出したファイルには商品の原価や受注などの業務データが入ります。
-- **このリポジトリ（公開されている）に置かないでください。**
-- 変換の手順は db/legacy/README.md を参照。
-- ============================================================
select jsonb_build_object(
  'exportedAt',        now(),
  'malls',             (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.malls t),
  'shops',             (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.shops t),
  'site_fees',         (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.site_fees t),
  'shipping_rates',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.shipping_rates t),
  'materials',         (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.materials t),
  'mall_csv_mappings', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.mall_csv_mappings t),
  'products',          (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.products t),
  'import_batches',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.import_batches t),
  'orders',            (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.orders t)
)::text as data;
