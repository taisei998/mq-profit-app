# アーキテクチャメモ

IT部門からの指摘（「静的アプリになっている」）を受けて、旧・単一HTMLファイル版から
サーバー＋データベース構成に作り直した際の設計判断を記録します。

## なぜこの構成にしたか

| 項目 | 選定 | 理由 |
|---|---|---|
| フロントエンド | React + TypeScript + Vite | 型安全・コンポーネント分割で、複雑な明細入力UIを保守しやすくするため |
| バックエンド | Node.js + Express + TypeScript | フロントと同じ言語（TS）で書け、計算ロジックを`packages/shared`として共有できるため |
| ORM | Prisma | SQLite/PostgreSQL/MySQL(MariaDB)を同じAPIで扱え、DB切り替えのハードルが低いため |
| ローカルDB | SQLite | インストール不要（ファイル1つ）。**Docker Desktopを使わずに**動作確認できる |
| コンテナ化 | 使わない | Docker Desktopのライセンス制約を回避するため、そもそもコンテナに依存しない構成にした |

## データベースの切り替え方（PostgreSQL / MariaDB）

データ量が増えて本番でPostgreSQLやMariaDBに切り替える場合の手順です。

1. `packages/server/prisma/schema.prisma` の `datasource db` ブロックの `provider` を
   `"postgresql"` または `"mysql"`（MariaDBはMySQL互換）に変更する
2. `packages/server/.env` の `DATABASE_URL` を接続先に変更する
3. `npm run db:migrate --workspace=packages/server` を実行してテーブルを作り直す

**注意点（重要）:**

- SQLiteはPrismaの `Json` 型に対応していないため、商品の明細データは
  `String` 列にJSON文字列として保存しています（`packages/server/src/lib/json.ts`で
  シリアライズ/デシリアライズ）。この設計のおかげで3つのDBすべてで同じスキーマが
  そのまま動きますが、PostgreSQL側のネイティブJSON検索機能などは使っていません。
  （現状、商品を検索するときは商品コード・カテゴリ・商品名などの通常カラムで
  絞り込んでいるだけなので、実用上の支障はありません）
- 上記の切り替え手順は「新しい空のDBに切り替える」手順です。既存のSQLiteデータを
  そのまま持っていくには、別途エクスポート/インポート（またはPrismaのデータ移行）が
  必要です。データ量が実際に増えてきたタイミングで改めて計画してください。

## 計算ロジックの共有について

商品の粗利率計算・受注CSVの集計ロジックは `packages/shared/src/calc.ts` と
`orders.ts` に実装し、フロントエンド（入力中のリアルタイム表示）とバックエンド
（保存時・集計時の正式な計算）の両方から同じ関数を呼んでいます。

これは意図的な設計です。金額計算をフロントだけに置くと「保存されたデータは実は
別の計算をしている（不正な値を送られても気づけない）」というセキュリティ上の
問題になりえるため、**保存・集計はサーバー側が必ず再計算する**ようにしています
（クライアントが送ってきた粗利率などの計算済み数値は信用しない設計）。

`packages/shared/src/calc.test.ts` に計算ロジックの単体テストがあります。旧アプリの
挙動と一致することを確認済みです（`npm run test --workspace=packages/shared`）。

## 認証について

現時点では未実装です。`packages/server/src/middleware/auth.ts` に差し込み口だけ
用意してあり、将来IT部門の既存OAuth2認証サーバー（リソースサーバー方式）と
連携する際は、ここでBearerトークンを検証する処理に差し替えてください。

## セキュリティ上の配慮（今回実施したもの）

- 入力値はすべて `zod` でスキーマ検証してから処理（`packages/server/src/lib/validation.ts`）
- Prisma（ORM）経由のみでDBアクセス。生SQLを組み立てていないため、SQLインジェクションのリスクなし
- `helmet` によるセキュリティヘッダ付与、CORSはフロントのオリジンのみ許可
- 書き込み系エンドポイントに簡易レート制限
- エラーハンドラでスタックトレース等の内部情報をクライアントに返さない
- 秘密情報（DB接続文字列など）は `.env` に分離し、`.gitignore` でリポジトリに含めない
