// 開発用のデータベース（手元で動かすときだけ使う）。
//
// 本番の共有RDSの代わりに、PostgreSQL互換のデータベースを**このPCの中だけ**で動かします。
// ソフトのインストールは不要です（npmのライブラリだけで動きます）。
//
// 【これは何者か】
//   PGlite ＝ PostgreSQL本体をWebAssemblyにしたもの。
//   PostgreSQLの通信規約（ワイヤープロトコル）をそのまま喋るので、
//   アプリ側は本番と**まったく同じコード**（pgドライバ）で繋がります。
//   「開発のときだけ別の仕組みで動く」という危ない状態になりません。
//
// 【本番では絶対に使いません】
//   このファイルは devDependencies にしか無いライブラリを使っており、
//   本番用イメージには入りません（Dockerfile.production は本番用の依存だけを入れます）。
//
// 【データの置き場所】
//   既定では `.devdb` フォルダに保存します。消せば初期状態に戻ります。
//   Gitの管理対象外です。

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.DEV_DB_PORT ?? 54399);
const DATA_DIR = process.env.DEV_DB_DIR ?? join(process.cwd(), '.devdb');

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'db', 'migrations');
}

const db = await PGlite.create(DATA_DIR);

// 起動のたびにマイグレーションを流す。
// すべて「何度実行してもデータが消えない」書き方になっているので安全です。
// （本番ではこれをやりません。複数台で同時に走ると事故るため）
const dir = migrationsDir();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(dir, f), 'utf8'));
  console.log(`[devdb] 適用: ${f}`);
}

const server = new PGLiteSocketServer({
  db,
  port: PORT,
  host: '127.0.0.1',
  // 既定は1接続まで。アプリ側の接続プール（最大5）が繋ぎに行くと
  // 2本目以降が切断されるため、余裕をみて広げておく
  maxConnections: 20,
});
await server.start();

console.log(`
[devdb] 開発用データベースを起動しました
         接続先: 127.0.0.1:${PORT}
         保存先: ${DATA_DIR}

  このウィンドウは開いたままにしてください。閉じるとデータベースが止まります。
  止めるときは Ctrl+C です。
`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
