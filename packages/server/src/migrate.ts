// マイグレーション。
//
// 【方針】アプリ実装ガイドライン6章
//   - **単発で実行できる1つのコマンド**として用意する
//   - コンテナ起動のたびに自動実行しない（複数台で同時に走ると事故る）
//   - entrypoint が `migrate` 引数を受け取ったときだけ、これを実行する
//
// db/migrations/*.sql をファイル名順に流します。
// すべて `create or replace` / `if not exists` で書いてあり、
// **何度実行してもデータは消えません**。この性質は必ず維持してください。
//
// 後方互換（expand-contract）について:
//   列の追加は問題ありませんが、リネーム・削除・型変更・NOT NULL化は
//   1回のマイグレーションで直接やらないでください。デプロイ中は新旧のコンテナが
//   短時間混在します。

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { closeDb, db, initDb } from './db.js';

// dist から見てリポジトリルートの db/migrations を指す
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromEnv = process.env.MIGRATIONS_DIR;
  if (fromEnv) return fromEnv;
  // packages/server/dist/migrate.js → リポジトリルート
  return join(here, '..', '..', '..', 'db', 'migrations');
}

export async function runMigrations(): Promise<string[]> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`マイグレーションのファイルが1つもありません: ${dir}`);
  }

  const applied: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    // ファイル単位でまとめて流す。1ファイル1トランザクションなので、
    // 途中で失敗したそのファイルの分は取り消される
    await db().query(sql);
    console.log(`[migrate] 適用しました: ${file}`);
    applied.push(file);
  }
  return applied;
}

// 単体で実行されたときだけ動く（import されただけでは動かない）
const isMain = process.argv[1] != null && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.env.RUN_MIGRATIONS === '1') {
  const config = loadConfig();
  initDb(config);
  try {
    const applied = await runMigrations();
    console.log(`[migrate] 完了（${applied.length}ファイル）`);
    await closeDb();
    process.exit(0);
  } catch (e) {
    console.error('[migrate] 失敗しました:', e instanceof Error ? e.message : e);
    await closeDb();
    process.exit(1);
  }
}
