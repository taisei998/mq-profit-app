// データベース接続。
//
// 【方針】アプリ実装ガイドライン6章
//   - 接続情報は環境変数から読む（DB_HOST など）
//   - **接続プールは小さく明示的に**。共有RDSに他のアプリも同居しているため、
//     既定値のままだと他アプリの接続まで失敗させることがある
//   - 本番はTLS必須。CA証明書はイメージに同梱する（コンテナ化規約4章）

import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Config } from './config.js';

// RDSのCA証明書バンドルの置き場所。Dockerfile.production がここへ配置する
const RDS_CA_PATH = process.env.RDS_CA_BUNDLE_PATH ?? '/etc/ssl/rds/global-bundle.pem';

let pool: pg.Pool | null = null;

export function initDb(config: Config): pg.Pool {
  if (pool) return pool;

  let ssl: pg.PoolConfig['ssl'] = false;
  if (config.db.ssl) {
    // 証明書が読めないまま検証を切って繋ぐと「TLSで繋がっているつもりの平文同然」になるため、
    // 読めなければ起動を失敗させる
    const ca = readFileSync(RDS_CA_PATH, 'utf8');
    ssl = { ca, rejectUnauthorized: true };
  }

  pool = new pg.Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl,
    // 共有インスタンスを圧迫しないよう小さく固定する（規約の目安は5〜10）。
    // 実際の消費は「同時に動いているコンテナ数 × この値」になる
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // 待機中の接続が落ちたときにプロセスごと落とさない
  pool.on('error', (err) => {
    console.error('[db] アイドル接続でエラーが発生しました', err);
  });

  return pool;
}

export function db(): pg.Pool {
  if (!pool) throw new Error('initDb() より先に db() が呼ばれました。');
  return pool;
}

/** 1行だけ取る。無ければ null */
export async function one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db().query(sql, params);
  return (r.rows[0] as T) ?? null;
}

/** 全行取る */
export async function many<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db().query(sql, params);
  return r.rows as T[];
}

/**
 * 複数の文をまとめて1つのトランザクションで実行する。
 * 途中で失敗したら全部取り消す。
 */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** ヘルスチェック用の軽い生存確認。重いクエリにしないこと（30秒ごとに呼ばれ続ける） */
export async function ping(): Promise<void> {
  await db().query('select 1');
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
