// 旧版（Supabase）から書き出したデータを、新しいデータベースへ流し込めるSQLに変換する。
//
//   node db/legacy/convert.mjs <書き出したファイル(.csv か .json)> [出力先.sql]
//
// 出力されたSQLは、マイグレーション（db/migrations）を流し終えた新しいデータベースに
// そのまま1回流せば入る。途中で失敗したら全部取り消される（1トランザクション）。
// もう一度流しても、同じものが二重に入ることはない（既にあるIDは飛ばす）。
//
// 【そのまま入れると壊れるので、ここで吸収していること】
//   1. 登録者・更新者・取込者（createdBy / updatedBy / importedBy）は空にする。
//      旧版のログインIDは Supabase のもので、新しい社内認証の利用者とは別物のため。
//      新しい方で最初にログインした時点から記録が始まる
//   2. モールは名前で突き合わせる。新しいデータベースはマイグレーションで
//      5つのモールを自前のIDで作るので、旧版のIDのままでは店舗との紐づけが切れる
//   3. 商品の固有ID（A0001…）の続き番号を、取り込んだ最大値の次に合わせる。
//      合わせないと、次に登録した商品が既存の番号とぶつかって登録できない
//
// 出力されたSQLには業務データ（原価・受注）が入る。公開リポジトリに置かないこと。

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// ------------------------------------------------------------
// 移す列（新しいデータベースの列と同じ。db/migrations/002・004 から）
// ここに無い列は捨てる。旧版にしか無い列があっても壊れないように
// ------------------------------------------------------------
const COLUMNS = {
  shops: ['id', 'mallId', 'name', 'sortOrder', 'createdAt', 'updatedAt'],
  site_fees: ['id', 'name', 'fee', 'couponFee', 'consultFee', 'otherFees', 'note', 'createdAt', 'updatedAt'],
  shipping_rates: ['id', 'carrier', 'temp', 'size', 'unitPrice', 'taxRate', 'createdAt', 'updatedAt'],
  materials: ['id', 'name', 'unitPrice', 'taxRate', 'createdAt', 'updatedAt'],
  mall_csv_mappings: ['id', 'mallId', 'config', 'updatedAt'],
  products: [
    'id', 'productId', 'mgmtNo', 'code', 'shopId', 'name', 'spec', 'note', 'category',
    'priceTaxRate', 'setCount', 'status', 'createdBy', 'updatedBy',
    'normalData', 'saleData', 'couponData', 'createdAt', 'updatedAt',
    'jobcanRequestId', 'jobcanStatus', 'jobcanTitle', 'jobcanAppliedAt', 'jobcanApprovedAt', 'jobcanSyncedAt',
  ],
  import_batches: [
    'id', 'shopId', 'fileName', 'importedAt', 'totalCount', 'successCount', 'unmatchedCount',
    'errorCount', 'excludedCount', 'status', 'importedBy', 'unmatchedDetail', 'errorDetail',
  ],
  orders: [
    'id', 'batchId', 'shopId', 'orderNo', 'orderDate', 'productCode', 'productId',
    'unitPrice', 'quantity', 'amount', 'kind', 'profit', 'profitRate',
  ],
};

// jsonb の列。オブジェクトを文字列にして ::jsonb で渡す
const JSONB = new Set(['otherFees', 'config', 'normalData', 'saleData', 'couponData', 'unmatchedDetail', 'errorDetail']);

// 旧版の利用者を指す列。新しい方では空にする（理由は冒頭の1）
const USER_REFS = new Set(['createdBy', 'updatedBy', 'importedBy']);

// 1つの insert 文に入れる行数。受注は件数が多いので分ける
const ROWS_PER_INSERT = 1000;

// ------------------------------------------------------------
// 入力の読み込み
// ------------------------------------------------------------

function readExport(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  if (text.trimStart().startsWith('{')) return JSON.parse(text);

  // Supabase の「CSVでダウンロード」の形: 1行目が見出し(data)、2行目以降が値（"で囲まれ、" は "" になる）
  const body = text.slice(text.indexOf('\n') + 1).trim();
  if (!body.startsWith('"') || !body.endsWith('"')) {
    throw new Error('ファイルの形式が想定と違います。export_from_supabase.sql の結果を、そのままCSVで保存したものを指定してください。');
  }
  return JSON.parse(body.slice(1, -1).replace(/""/g, '"'));
}

// ------------------------------------------------------------
// SQLの値の書き方
// ------------------------------------------------------------

function lit(value, column) {
  if (value === null || value === undefined) return 'null';
  if (JSONB.has(column)) return `${quote(JSON.stringify(value))}::jsonb`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`列 ${column} に数値として扱えない値があります: ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return `${quote(JSON.stringify(value))}::jsonb`;
  return quote(String(value));
}

/** 文字列をSQLの文字列リテラルにする。' を重ねるだけでよい（standard_conforming_strings=on 前提） */
function quote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

const ident = (c) => `"${c}"`;

// ------------------------------------------------------------
// 変換
// ------------------------------------------------------------

function convert(data) {
  const out = [];
  const counts = {};
  const w = (s) => out.push(s);

  // 旧モールID → モール名（店舗と列設定をモール名で付け替えるため）
  const mallNameById = new Map((data.malls ?? []).map((m) => [m.id, m.name]));
  const mallRef = (oldId, where) => {
    const name = mallNameById.get(oldId);
    if (name == null) throw new Error(`${where} が、書き出しに含まれないモール(${oldId})を指しています。`);
    return `(select id from public.malls where name = ${quote(name)})`;
  };

  w(`-- 旧版（Supabase）からの引継ぎデータ`);
  w(`-- 書き出し日時: ${data.exportedAt ?? '不明'} ／ 変換: ${new Date().toISOString()}`);
  w(`-- db/legacy/convert.mjs で生成。手で編集しないこと`);
  w(`--`);
  w(`-- 前提: db/migrations を流し終えたデータベースに対して実行する`);
  w(`-- 1トランザクション。途中で失敗したら全部取り消される。再実行しても二重には入らない`);
  w('');
  w(`set standard_conforming_strings = on;`);
  w(`begin;`);
  w('');

  // --- モール（名前で突き合わせ。新しい方に無い名前だけ足す） ---
  const malls = data.malls ?? [];
  counts.malls = malls.length;
  if (malls.length) {
    w(`-- モール ${malls.length}件（名前で突き合わせ。既にある名前は並び順だけ旧版に合わせる）`);
    w(`insert into public.malls (name, "sortOrder") values`);
    w(malls.map((m) => `  (${quote(m.name)}, ${lit(m.sortOrder ?? 0, 'sortOrder')})`).join(',\n'));
    w(`on conflict (name) do update set "sortOrder" = excluded."sortOrder";`);
    w('');
  }

  const emit = (table, rows, conflict = '(id)') => {
    const cols = COLUMNS[table];
    counts[table] = rows.length;
    if (!rows.length) return;
    w(`-- ${table} ${rows.length}件`);
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const chunk = rows.slice(i, i + ROWS_PER_INSERT);
      w(`insert into public.${table} (${cols.map(ident).join(', ')}) values`);
      w(
        chunk
          .map((row) => {
            const vals = cols.map((c) => {
              if (USER_REFS.has(c)) return 'null';
              if (c === 'mallId') return mallRef(row.mallId, `${table} ${row.id}`);
              return lit(row[c], c);
            });
            return `  (${vals.join(', ')})`;
          })
          .join(',\n')
      );
      w(`on conflict ${conflict} do nothing;`);
    }
    w('');
  };

  // 参照される側から順に入れる
  emit('shops', data.shops ?? []);
  emit('site_fees', data.site_fees ?? []);
  emit('shipping_rates', data.shipping_rates ?? []);
  emit('materials', data.materials ?? []);
  emit('mall_csv_mappings', data.mall_csv_mappings ?? [], '("mallId")');
  emit('products', data.products ?? []);
  emit('import_batches', data.import_batches ?? []);
  emit('orders', data.orders ?? []);

  // --- 商品の固有IDの続き番号（理由は冒頭の3） ---
  w(`-- 商品の固有ID（A0001…）の続き番号を、取り込んだ最大値の次に合わせる`);
  w(`select setval('public.product_number_seq',`);
  w(`  coalesce((select max(substring("productId" from 2)::int) from public.products where "productId" ~ '^A[0-9]+$'), 0) + 1,`);
  w(`  false);`);
  w('');
  w(`commit;`);
  w('');
  w(`-- 入った件数の確認（書き出し時の件数と一致すれば成功）`);
  w(`select 'malls' as "表", count(*) as "件数" from public.malls`);
  for (const t of ['shops', 'site_fees', 'shipping_rates', 'materials', 'mall_csv_mappings', 'products', 'import_batches', 'orders']) {
    w(`union all select ${quote(t)}, count(*) from public.${t}`);
  }
  w(`;`);

  return { sql: out.join('\n') + '\n', counts };
}

// ------------------------------------------------------------
// 実行
// ------------------------------------------------------------

const [, , input, outputArg] = process.argv;
if (!input) {
  console.error('使い方: node db/legacy/convert.mjs <書き出したファイル(.csv か .json)> [出力先.sql]');
  process.exit(1);
}

const data = readExport(resolve(input));
const { sql, counts } = convert(data);
const output = outputArg
  ? resolve(outputArg)
  : join(dirname(resolve(input)), `${basename(input).replace(/\.(csv|json)$/i, '')}_import.sql`);
writeFileSync(output, sql, 'utf8');

console.log('変換しました:', output);
console.log('件数:', JSON.stringify(counts));
