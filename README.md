# MQ率 利益計算アプリ

EC商品の粗利率・MQ率を計算する社内ツールです。旧バージョンは1枚のHTMLファイルにすべてが
入った「静的アプリ」でしたが、サーバー＋データベースを持つ構成に作り直しました
（元のHTMLは [`legacy/`](legacy/) に保存してあります。参考用で、もう更新はしません）。

## これは何が変わったのか

- データの保存先が「このブラウザだけ」から「サーバー上のデータベース」に変わりました。
  別のPCからでも同じデータを見られますし、ブラウザのキャッシュを消しても消えません。
- 見た目・操作方法・計算のしかたは、できるだけ元のアプリと同じになるようにしています。

## 動作確認のしかた（社内の誰かが手元で試す場合）

前提: このリポジトリを開いているPCに Node.js が入っていること（`node --version` で確認）。
入っていなければ [nodejs.org](https://nodejs.org/) からLTS版をインストールしてください。
**Dockerは不要です。**

```bash
# 1. 初回だけ：依存ライブラリのインストール
npm install

# 2. 初回だけ：ローカルDB（SQLiteファイル1つ）を作成
npm run db:migrate --workspace=packages/server

# 3. 初回だけ：モールマスタの初期データ（楽天市場・Yahoo!・au PAY・Amazon・自社EC）を投入
npm run db:seed

# 4. サーバーと画面を両方起動（このターミナルは開いたままにする）
npm run dev
```

起動したら http://localhost:5173 をブラウザで開いてください。止めるときはターミナルで `Ctrl+C`。

データは `packages/server/prisma/dev.db` というファイル1つに保存されます（`.gitignore`
でリポジトリには含めていません）。中身を画面で見たいときは以下でDB専用の管理画面が開きます。

```bash
npm run db:studio
```

## 構成

npmワークスペースによるモノレポです。

```
packages/
  shared/   … 計算ロジック・型定義（フロント・サーバー共通、テストもここ）
  server/   … API サーバー（Node.js + Express + Prisma）
  client/   … 画面（React + TypeScript + Vite）
  bsr/      … Amazon BSR・検索順位の自動記録バッチ（画面なし。Googleスプレッドシートに書き込む）
legacy/     … 旧・静的HTML版（参考用、更新なし）
docs/       … 設計メモ・今後の課題
```

技術選定の理由や、PostgreSQL/MariaDBへの切り替え手順は [docs/architecture.md](docs/architecture.md)
を参照してください。

## 同梱のバッチ: Amazon BSR自動記録

同じリポジトリに、MQ率アプリとは無関係に動く小さなバッチ `packages/bsr` が入っています。
**Googleスプレッドシートの1行目に並べたASINを読んで、その日のAmazon売れ筋ランキング（BSR）を
同じシートに書き込む**だけのプログラムです。画面はありません。

```bash
npm run bsr:check     # 設定とシートの読み取り確認（書き込みなし）
npm run bsr:collect   # 実行。通常はタスクスケジューラから毎日呼び出す
```

セットアップ（SP-APIの開発者登録、Googleサービスアカウント、シートの形、毎日の自動実行）は
[docs/bsr-tracking.md](docs/bsr-tracking.md) を参照してください。

## 同梱のバッチ: Amazon検索順位（SEO順位）自動記録

同じ `packages/bsr` に、もう1つバッチが同居しています。**「このキーワードで検索したとき
自社商品が何番目に出るか」を測って、スプレッドシートに書き込む**プログラムです。
BSRバッチと同じで、**追跡リストはシートそのもの**です（`SEO順位` タブのA列にキーワード、
E列にASINを書き足すだけで対象が増えます）。順位の推移は `SEO順位履歴` タブに貯まります。

```bash
npm run rank:init      # 順位表のタブと見出しをシートに用意する（最初に1回）
npm run rank:check     # 順位を取得して表示するだけ（書き込みなし）
npm run rank:collect   # 実行。通常はタスクスケジューラから毎朝呼び出す
```

BSRバッチとはGoogleの設定（サービスアカウント）を共有します。セットアップと、
この数字をどう読むべきかは [docs/rank-tracking.md](docs/rank-tracking.md) を参照してください。

## 画面

| 画面 | 内容 |
|---|---|
| HOME | 売上ダッシュボード。期間・モール・店舗・ステータスで絞り込み（KPI・グラフ・ランキング・アラート） |
| 粗利作成 | モール・店舗を選んで商品と原価を登録。粗利率を自動計算。下書き／稟議申請を選べる |
| 商品一覧 | ステータス別の件数カード、モール・店舗での絞り込み、詳細・編集・複製・削除、20件ごとのページング |
| データアップ | 受注CSVの取込。店舗を選ぶ → 読み込む → 列を選ぶ → 内容確認 → 取込実行。取込履歴つき |
| マスタ管理 | 送料／資材／手数料／モール／店舗 |

画面構成と名称はいただいたUIデザイン案に合わせています。

受注CSVはカンマ区切り（楽天・Yahoo!・au PAY）とタブ区切り（Amazonの注文レポート `.txt`）の
どちらも読めます。文字コード（UTF-8 / Shift_JIS）も自動判定します。
モールごとに列設定を保存でき、次回からは自動で適用されます。

## 他の人が改修するとき

1. リポジトリをクローンする（公開リポジトリなので誰でも取得できる）
2. **リポジトリへのpush権限**が必要 … オーナーに Settings → Collaborators から招待してもらう
3. **Supabaseの接続先**が必要 … `packages/client/.env.example` を `.env.local` にコピーし、
   SupabaseダッシュボードのSettings → APIから `Project URL` と `anon public` キーを記入する
   （anonキーは公開前提の鍵なので秘密ではありません。公開版のJSにも埋め込まれています）
4. **Supabaseのダッシュボードを触る必要がある場合**は、オーナーからプロジェクトに招待してもらう

```bash
npm install
cp packages/client/.env.example packages/client/.env.local   # 接続先を記入
npm run build --workspace=packages/shared
npm run dev --workspace=packages/client                       # http://localhost:5173
```

**手元の開発も公開版と同じデータベースに繋がります。** 試したデータは本番に入るので注意してください。

`main` に push すると自動で公開版が更新されます。

> Claude Code で改修する場合は、リポジトリ直下の [CLAUDE.md](CLAUDE.md) が自動で読み込まれます。
> 守るべきルール（計算ロジックを変えない・新テーブルには必ずRLSを付ける等）と、
> 過去に踏んだ落とし穴をまとめてあるので、人が読む場合も目を通してください。

## 今後やるべきこと

- 認証（ログイン）は未実装です。社内OAuth2認証サーバーとの連携は方針待ちですが、
  差し込み口（`packages/server/src/middleware/auth.ts`）と、登録者・更新者を記録する列は
  用意してあります。連携できれば値が入り始めます。
- 設計書（`MQ率計算アプリ_設計書.md`）との対応、決定事項、実装済みの内容は
  [docs/design-gap.md](docs/design-gap.md) にまとめています。**新機能の検討はここから読んでください。**
- 移植時点で挙げた運用上の論点は [docs/requirements-todo.md](docs/requirements-todo.md) に残しています。
