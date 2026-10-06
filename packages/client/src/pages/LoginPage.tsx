import { goToLogin } from '../lib/http.js';

// ログイン画面。
//
// パスワードの入力欄はありません。**社内アカウントでそのまま入れます。**
// ボタンを押すと社内認証システムへ移動し、確認が済むとこの画面に戻ってきます。
//
// このアプリはパスワードを一切持ちません（持たない方が安全なので、そうしています）。
interface Props {
  /** 社内認証システムの準備ができているか。公開前は未設定のことがある */
  ready: boolean;
}

export function LoginPage({ ready }: Props) {
  return (
    <div className="card login-card">
      <div className="kicker">EC MARKETING / PROFIT TOOL</div>
      <h2>MQ率 利益計算アプリ</h2>

      {ready ? (
        <>
          <p className="hint" style={{ marginTop: 14, marginBottom: 20 }}>
            社内アカウントでログインしてください。
            <br />
            このアプリの利用を許可されている方だけが入れます。
          </p>

          <button className="btn" onClick={goToLogin} style={{ width: '100%' }}>
            社内アカウントでログイン
          </button>

          <p className="hint" style={{ marginTop: 14 }}>
            「利用を許可されていません」と出る場合は、管理者に利用権限の付与を依頼してください。
          </p>
        </>
      ) : (
        <>
          <div className="status err" style={{ marginTop: 14 }}>
            ログインの準備がまだ整っていません。
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            社内認証システムの接続先が設定されていないため、まだログインできません。
            公開の手続きが終わると使えるようになります。
          </p>
        </>
      )}
    </div>
  );
}
