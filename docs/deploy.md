# 公開の手順（Supabase ＋ GitHub Pages）

社内の人が在宅・出先からでもログインして使えるようにするための手順です。
**サーバーを自前で持たない構成**なので、費用はかかりません（Supabase無料枠＋GitHub Pages）。

```
ブラウザ（GitHub Pagesが配信）  →  Supabase（データベース＋ログイン）
```

新商品開発ナビと同じく「リンク1つ」で開けますが、**開いた直後はログイン画面**が出ます。
ログインしないとデータは1件も読めません（あとで説明するRLSで保証しています）。

---

## 1. Supabaseのプロジェクトを作る（人の作業）

パスワードを扱うので、この章はご自身で操作してください。

1. https://supabase.com にアクセスし、**GitHubアカウントでサインアップ**
2. **New project**
   - Name: `mq-profit-app`
   - Database Password: 自動生成されたものを控えておく
   - Region: **Northeast Asia (Tokyo)**
   - Plan: **Free**
3. できあがったら **Settings → API** から次の2つを控える
   - **Project URL**（`https://xxxxx.supabase.co`）
   - **anon public** キー（`eyJ...`）

> `service_role` キーは使いません。あれはアクセス制御をすべて無視できる鍵なので、
> ブラウザにもリポジトリにも絶対に入れないでください。

## 2. テーブルとアクセス制御を作る

1. Supabaseの左メニューから **SQL Editor** を開く
2. `supabase/01_schema.sql` の中身を全部貼り付けて **Run**
3. 続けて `supabase/02_functions.sql` も同様に **Run**

どちらも**何度実行しても同じ結果**になります（作り直しはしません）。

これで以下が作られます。

- テーブル一式（モール・店舗・商品・受注・各マスタ）
- **アクセス制御（RLS）** … ログインしていない人は読み書き一切不可
- 稟議ステータスの遷移制限（承認・却下は承認権限を持つ人だけ）
- モールの初期データ（楽天市場 / Yahoo!ショッピング / au PAY マーケット / Amazon / 自社EC）

## 3. 使う人のアカウントを作る（人の作業）

1. Supabaseの **Authentication → Users → Add user**
2. メールアドレスとパスワードを入れて作成（**Auto Confirm User** をオンに）
3. 使う人に、そのメールアドレスとパスワードを伝える

> 誰でも勝手に登録できると困るので、**Authentication → Providers → Email** の
> **Enable sign ups** は**オフ**にしてください。管理者が作ったアカウントだけが使えます。

### 承認できる人を指定する

稟議の「承認」「却下」は、権限を持つ人だけができます。既定は全員 `editor`（登録・編集のみ）です。

**Table Editor → profiles** を開き、承認できる1〜2名の `role` を `approver` に変更してください
（`admin` でも承認できます）。

## 4. GitHubに接続先を登録する

1. リポジトリの **Settings → Secrets and variables → Actions → New repository secret**
2. 2つ登録する
   - `SUPABASE_URL` … 手順1で控えたProject URL
   - `SUPABASE_ANON_KEY` … 手順1で控えたanon publicキー

## 5. GitHub Pagesを有効にする

1. リポジトリの **Settings → Pages**
2. **Source** を **GitHub Actions** に変更

以降は `main` に push するたびに自動で公開されます。公開先はこちらです。

```
https://taisei998.github.io/mq-profit-app/
```

---

## 手元で動かすとき

```bash
cp packages/client/.env.example packages/client/.env.local
# .env.local に Project URL と anon キーを記入する

npm install
npm run build --workspace=packages/shared
npm run dev --workspace=packages/client
```

`http://localhost:5173` が開きます。接続先は公開版と同じSupabaseなので、
**手元で触ったデータも本番に反映されます**。試すだけのときは注意してください。

---

## セキュリティについて

**このリポジトリは公開されています。** ソースコードと設計書は誰でも読めます。

それでもデータが守られるのは、**anonキーが「誰でも持てる鍵」である前提で、
DB側のアクセス制御（RLS）が「ログインした人だけ」に絞っている**からです。
`supabase/01_schema.sql` の「7. アクセス制御（RLS）」がその設定です。

やってはいけないこと:

- `service_role` キーをリポジトリや画面のコードに入れる（RLSを無視できてしまいます）
- RLSを無効にする、または `using (true)` を `to authenticated` 無しで書く
- Supabaseの **Enable sign ups** をオンのままにする（誰でもアカウントを作れてしまいます）

新しいテーブルを足すときは、**必ずRLSを有効にしてポリシーを付けてください。**
付け忘れたテーブルは、ログインさえすれば誰でも読める状態になります。

---

## 以前のサーバー構成（packages/server）について

Express + Prisma + SQLite の構成は `packages/server` に残してありますが、
公開版では**使っていません**。Supabaseに移行する前の実装で、
ローカルでの動作確認や、将来自前サーバーへ戻す必要が出たときの参考用です。
