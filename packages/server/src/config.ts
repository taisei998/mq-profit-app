// 設定値の読み込みと検証。
//
// 【方針】アプリ実装ガイドライン1章
//   - 設定はすべて環境変数から読む。Secrets Managerを自分で読みに行かない
//     （基盤が起動時に環境変数へ入れてくれる）
//   - 必須の値が無いときは、既定値に黙ってフォールバックせず**起動を失敗させる**
//
// 【社内認証の接続先（ACCESS_GATEWAY_URL / ACCESS_GATEWAY_CLIENT_ID）】
//   **本番では必須**（2026-10 DXの点検で指摘）。
//   当初は「公開してからでないと決まらない値」（ガイドライン1章の例外）と考えて任意にしていたが、
//   本番用の値はDXが公開作業の中で、アプリを初めて起動する**前**に用意して設定するので例外に当たらない。
//   任意のままだと、設定し忘れてもヘルスチェックは通るのに、ログインだけが黙って使えない状態で
//   公開されてしまう。起動を中止すれば公開作業の時点で気付ける。
//   手元の開発（NODE_ENV が production でない）では、値が無くても起動できるようにしてある。
//   「本番かどうか」は Dockerfile.production が焼き込む NODE_ENV=production で判定する

export interface Config {
  /** アプリ自身の公開URL。基盤が注入する */
  appUrl: string;
  /** 基盤側のアプリ識別子。権限キーの接頭辞に使う */
  appName: string;
  /** リッスンするポート。基盤からは渡らないので固定値（規約の既定は8080） */
  port: number;
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    /** 本番の共有RDSは非TLS接続を拒否する。ローカル開発では不要 */
    ssl: boolean;
  };
  /** 社内認証システム。公開前は未設定のことがあるので必須にしない */
  gateway: {
    url: string | null;
    clientId: string | null;
  };
  /** ログインセッションの有効期間（時間）。権限変更の反映を早めたいなら短くする */
  sessionHours: number;
}

/** 設定の不備。起動時にこれが投げられたら、原因を1行で出して終了する */
export class ConfigError extends Error {}

function required(name: string): string {
  const v = process.env[name];
  if (v == null || v.trim() === '') {
    throw new ConfigError(
      `環境変数 ${name} が設定されていません。この値が無いとアプリは動けないため起動を中止します。`
    );
  }
  return v.trim();
}

function optional(name: string): string | null {
  const v = process.env[name];
  return v == null || v.trim() === '' ? null : v.trim();
}

function intOf(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`環境変数 ${name} は正の整数で指定してください（現在: ${raw}）。`);
  }
  return n;
}

/** 本番用イメージで動いているか（Dockerfile.production が NODE_ENV=production を焼き込む） */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * @param requireGateway 社内認証の接続先を必須にするか。既定は「本番なら必須」。
 *   マイグレーションはDBしか触らないので false で呼ぶ
 */
export function loadConfig({ requireGateway = isProduction() }: { requireGateway?: boolean } = {}): Config {
  const gatewayUrl = requireGateway ? required('ACCESS_GATEWAY_URL') : optional('ACCESS_GATEWAY_URL');
  const gatewayClientId = requireGateway ? required('ACCESS_GATEWAY_CLIENT_ID') : optional('ACCESS_GATEWAY_CLIENT_ID');

  return {
    appUrl: required('APP_URL').replace(/\/+$/, ''),
    appName: required('PLATFORM_APP_NAME'),
    // 基盤は PORT を注入しない。固定値でよい（アプリ実装ガイドライン2章）
    port: intOf('PORT', 8080),
    db: {
      host: required('DB_HOST'),
      port: intOf('DB_PORT', 5432),
      database: required('DB_DATABASE'),
      user: required('DB_USERNAME'),
      password: required('DB_PASSWORD'),
      // 本番はTLS必須。ローカルのDBに繋ぐときだけ DB_SSL=false にする
      ssl: (optional('DB_SSL') ?? 'true').toLowerCase() !== 'false',
    },
    gateway: {
      // 本番では上で必須チェック済み。手元で未設定のときは、ログイン画面に「準備中」と出す
      url: gatewayUrl?.replace(/\/+$/, '') ?? null,
      clientId: gatewayClientId,
    },
    sessionHours: intOf('SESSION_HOURS', 8),
  };
}

/** 社内認証システムが使える状態か */
export function gatewayReady(c: Config): boolean {
  return c.gateway.url != null && c.gateway.clientId != null;
}
