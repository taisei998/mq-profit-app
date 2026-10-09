// アプリ本体（Express）。
//
// 1つのコンテナで、画面（Viteでビルドした静的ファイル）とAPIの両方を返します。
// ALBから見える口は1つだけなので、この構成にしています。
//
// 【規約との対応】
//   - ポートは固定8080（基盤は PORT を注入しない）…… アプリ実装ガイドライン2章
//   - ヘルスチェックは /healthz。DBまで見る ………………… 3章
//   - ログは標準出力のみ。ヘルスチェックはアクセスログから除外 … 4章
//   - X-Forwarded-* を信頼する ……………………………………… 12章
//   - ログインは社内認証システム ………………………………… 13章

import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, gatewayReady, loadConfig, type Config } from './config.js';
import { closeDb, initDb, ping } from './db.js';
import { currentUser, handleCallback, logout, redirectUri, startLogin } from './auth.js';
import { apiRouter } from './routes/index.js';

// 画面のビルド成果物。Dockerfile.production がこの場所へ配置する
function clientDir(): string {
  if (process.env.CLIENT_DIST) return process.env.CLIENT_DIST;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'client', 'dist');
}

export function createApp(config: Config) {
  const app = express();

  // ALBの後ろにいる。これを設定しないと、生成するURLがhttpになったり
  // 利用者の実IPが取れなかったりする。ALB以外から直接届くことは無い構成
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // 画面はSPA。インラインの style が必要なので既定のCSPはそのままだと壊れる
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' })); // 受注CSVの取込で大きめのJSONが来る

  // --- アクセスログ（標準出力のみ） ---
  // 基盤のヘルスチェックは30秒ごとに来る。1日約2,900行のノイズになるので除外する。
  // ただし**エラーは除外しない**（ヘルスチェックが失敗したとき気付けなくなる）
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const isHealthCheck = req.get('user-agent') === 'ELB-HealthChecker/2.0';
      if (isHealthCheck && res.statusCode < 400) return;
      // 個人情報が混ざりうるので、ボディやヘッダーの中身は出さない
      console.log(
        JSON.stringify({
          level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - started,
        })
      );
    });
    next();
  });

  // --- ヘルスチェック ---
  // フレームワーク標準の「200を返すだけ」にしないこと。
  // DBまで見て、繋がらなければ200以外を返す。
  app.get('/healthz', async (_req, res) => {
    try {
      await ping(); // select 1 だけ。重いクエリにしない
      res.json({ ok: true });
    } catch (e) {
      console.error('[healthz] データベースに接続できません', e);
      res.status(503).json({ ok: false, error: 'database unreachable' });
    }
  });

  // --- ログイン ---
  app.get('/auth/login', (req, res, next) => {
    startLogin(req, res, config).catch(next);
  });
  app.get('/auth/callback', (req, res, next) => {
    handleCallback(req, res, config).catch(next);
  });
  app.get('/auth/logout', (req, res, next) => {
    logout(req, res, config).catch(next);
  });
  // ログアウト後の着地点。認証不要
  app.get('/logged-out', (_req, res) => {
    res.type('text/html; charset=utf-8').send(
      `<!doctype html><meta charset="utf-8"><title>ログアウトしました</title>
       <div style="font-family:system-ui;margin:4rem auto;max-width:28rem;text-align:center">
         <h1 style="font-size:1.2rem">ログアウトしました</h1>
         <p><a href="/">もう一度ログインする</a></p>
       </div>`
    );
  });

  // --- 自分の情報（画面がログイン状態を知るために使う） ---
  app.get('/api/me', async (req, res, next) => {
    try {
      const user = await currentUser(req);
      if (!user) {
        res.status(401).json({ error: 'ログインしてください。', gatewayReady: gatewayReady(config) });
        return;
      }
      res.json({ id: user.id, name: user.name, division: user.division, email: user.email });
    } catch (e) {
      next(e);
    }
  });

  // --- 業務API（ここから先はログイン必須） ---
  app.use('/api', apiRouter());

  // --- 画面（SPA） ---
  const dist = clientDir();
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: '該当するAPIがありません。' });
      return;
    }
    res.sendFile(join(dist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  // --- エラー処理 ---
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    // 送られてきたデータが大きすぎる。「時間をおいて」では直らないので、そうは書かない
    const type = (err as { type?: string })?.type;
    if (type === 'entity.too.large') {
      res.status(413).json({ error: '送信するデータが大きすぎます。ファイルを期間で分けて取り込んでください。' });
      return;
    }
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: '送られてきたデータを読み取れませんでした。画面を再読み込みしてやり直してください。' });
      return;
    }
    console.error('[error]', err);
    res.status(500).json({ error: '処理に失敗しました。時間をおいて試してください。' });
  });

  return app;
}

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------

async function main() {
  let config: Config;
  try {
    // 設定の検証はここで行う。足りなければ**起動そのものを失敗させる**。
    // 既定値に黙ってフォールバックしない（アプリ実装ガイドライン1章）
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`[起動中止] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  initDb(config);

  const app = createApp(config);
  const server = app.listen(config.port, () => {
    console.log(
      JSON.stringify({
        level: 'info',
        message: '起動しました',
        port: config.port,
        appUrl: config.appUrl,
        appName: config.appName,
        // 公開前は未設定でも起動できる。その場合ログインだけ使えない
        gateway: gatewayReady(config) ? 'ready' : '未設定（ログインは使えません）',
        redirectUri: gatewayReady(config) ? redirectUri(config) : null,
      })
    );
  });

  const shutdown = () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// テストから import されたときは起動しない
if (process.env.NODE_ENV !== 'test') {
  await main();
}
