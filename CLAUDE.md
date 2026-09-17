# MQ率 利益計算アプリ

EC（楽天・Yahoo!・au PAY・Amazon・自社EC・TikTok・メルカリほか、計18モール）で売る商品の**粗利率を計算し、受注CSVを取り込んで集計する社内ツール**。
経営判断に使う数字なので、**計算が1円でもずれると業務に影響する**。

## 最初に読むもの

| ファイル | 内容 |
|---|---|
| `docs/design-gap.md` | **何をなぜそう決めたかの記録。改修前に必ず読む。** 決定事項に番号が振ってある（#1〜#17） |
| `docs/deploy.md` | 公開の手順とセキュリティ上の禁止事項 |
| `MQ率計算アプリ_設計書.md`（リポジトリ外） | 発注元の設計書。計算ロジックの原典 |

## 絶対に守ること

1. **`packages/shared/src/calc.ts` の計算式を変えない。**
   設計書§3の式そのもので、`calc.test.ts` の「設計書§6.1 必須テストケース」で固定してある。
   テストが赤くなったらそれは仕様変更。**テストの方を書き換えて通すのは禁止。**

2. **新しいテーブルを作ったら必ずRLSを設定する。**
   このアプリはGitHub Pagesから直接Supabaseに繋ぐ。画面に埋め込まれるanonキーは公開されているので、
   **RLSが唯一のアクセス制御**。付け忘れたテーブルはログインすれば誰でも読める。
   `supabase/01_schema.sql` の「7. アクセス制御（RLS）」と「8. GRANT」の両方に追記すること。

3. **`service_role` キーをコードにもリポジトリにも入れない。** RLSを無視できてしまう。

4. **一括削除機能を作らない。** 事故防止のため旧アプリでも撤去済み（設計書§5.3・§9）。
   取込単位の取消（`import_batches` の削除）だけ許可している。

5. **このリポジトリは公開されている。** ソースもdocsも誰でも読める。社外秘の値を書かない。

## 構成

```
画面（GitHub Pages）  →  Supabase（PostgreSQL + 認証）
```

自前のサーバーは無い。費用ゼロで「リンク1つ」で使えるようにするための構成（#経緯は design-gap.md §1）。

```
packages/
  shared/   計算ロジックと型。フロントとサーバー双方から使う。テストもここ
  client/   画面（React + TypeScript + Vite）。これが本体
  server/   旧構成（Express + Prisma + SQLite）。★公開版では未使用。参考用に残置
  bsr/      Amazon BSR・検索順位の記録バッチ。このアプリとは無関係に動く
supabase/   DBスキーマ・RLS・DB側の関数（SQL Editorに貼って実行する）
docs/       設計メモ
legacy/     旧・単一HTML版（参考用）
```

**`packages/server` は触らなくてよい。** 変更しても公開版には反映されない。

## 開発の流れ

```bash
npm install
cp packages/client/.env.example packages/client/.env.local   # 接続先を記入（下記）
npm run build --workspace=packages/shared                     # 先にsharedをビルド
npm run dev --workspace=packages/client                       # http://localhost:5173
```

`.env.local` に入れる `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` は、
Supabaseダッシュボードの Settings → API から取得する（anonキーは公開前提の鍵なので秘密ではない）。

**手元の開発も公開版と同じSupabaseに繋がる。** 試したデータは本番に入るので注意。

### テスト

```bash
npm run test --workspace=packages/shared   # 計算ロジック（46件）
```

計算まわりを触ったら必ず走らせる。

### 公開

`main` に push すると GitHub Actions が自動でビルドして公開する。
公開先: https://taisei998.github.io/mq-profit-app/

### DBを変更するとき

`supabase/*.sql` を編集し、**Supabaseの SQL Editor に貼って実行する**（自動反映はされない）。
すべて `create or replace` / `if not exists` で書いてあり、**何度実行してもデータは消えない**。
この性質は維持すること。

## 過去に踏んだ落とし穴

改修時に同じ罠を踏まないよう記録しておく。

- **Supabaseは WHERE句の無い `DELETE` を拒否する**（`DELETE requires a WHERE clause`）。
  DB関数の中でも効く。一時テーブルの初期化で踏んだ。
- **接続プール環境では一時テーブルを使わない。** 状態が読みにくい。関数に切り出すこと。
- **`toISOString()` はUTCに変換する。** 日本時間の「9月1日 00:00」が「8月31日」になる。
  日付を文字列にするときは `localDate()`（`HomePage.tsx`）のようにローカル値から組む。
- **`orders.orderDate` は `YYYY-MM-DD` の文字列**。日付型にするとタイムゾーンで前日にずれる。
  辞書順＝日付順なので範囲検索はできる。
- **`.map(parseCSVLine)` と書かない。** 第2引数に配列の添字が渡って区切り文字が壊れる。
- **`packages/shared` は先にビルドする。** client/server の型チェックが `dist` を見るため。
- **Supabaseの埋め込みリレーションは配列型として推論される。** `as unknown as` でキャストが要る。
- **受注CSVはモールごとに全く違う。** Amazonはタブ区切りの `.txt`、単価の列が無い、
  キャンセル行が混ざる。楽天は注文日と時間が別列。詳細は design-gap.md §6。

## 書き方の約束

- **コメントと画面の文言は日本語。** 使うのは非エンジニアの社内メンバー。
  エラーメッセージも「何をすればいいか」が分かる文言にする。
- **DBの列名はキャメルケース**（`"shopId"` のように二重引用符で囲う）。
  画面側の型とそのまま対応させて変換コードを不要にするため。SQLを書くときは引用符を忘れない。
- 決定事項を変えたら **`docs/design-gap.md` に追記する**（なぜ変えたかも書く）。

## 用語

| 語 | 意味 |
|---|---|
| MQ率 | 粗利率のこと |
| 区分 | 通常時 / SALE時 / SALE+クーポン時 の3つ |
| セット | 1〜5セット。同じ商品を複数買ったときの価格帯 |
| モール / 店舗 | 楽天市場（モール）に「くまもと風土」など複数の店舗が入る2階層 |
| 稟議 | 商品登録の承認フロー。実体はジョブカンで回し、このアプリは状態を記録するだけ |
