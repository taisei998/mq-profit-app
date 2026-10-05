// 設定値の読み込みと検証。
//
// 【方針】アプリ実装ガイドライン1章
//   - 設定はすべて環境変数から読む。Secrets Managerを自分で読みに行かない
//     （基盤が起動時に環境変数へ入れてくれる）
//   - 必須の値が無いときは、既定値に黙ってフォールバックせず**起動を失敗させる**
//   - ただし「公開してからでないと決まらない値」は必須にしない。
//     欠けていてもアプリは起動し、その機能だけ使えない状態にする

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

export function loadConfig(): Config {
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
      // 公開申請が通るまで発行されないため、欠けていても起動できるようにしておく。
      // 未設定のときはログイン画面に「準備中」と出す（アプリ実装ガイドライン1章の但し書き）
      url: optional('ACCESS_GATEWAY_URL')?.replace(/\/+$/, '') ?? null,
      clientId: optional('ACCESS_GATEWAY_CLIENT_ID'),
    },
    sessionHours: intOf('SESSION_HOURS', 8),
  };
}

/** 社内認証システムが使える状態か */
export function gatewayReady(c: Config): boolean {
  return c.gateway.url != null && c.gateway.clientId != null;
}
