import { useState } from 'react';
import { isConfigured, supabase, toMessage } from '../lib/supabase.js';

// ログイン画面。未ログインのときはこの画面しか表示されず、
// データは1件も読み込まれない（DB側のアクセス制御でも拒否される）。
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      // 「そのメールアドレスは存在しない」と教えると総当たりの手がかりになるため、
      // 原因は区別せず同じ文言にする
      setError(
        error.message.includes('Invalid login')
          ? 'メールアドレスまたはパスワードが違います。'
          : toMessage(error)
      );
    }
    // 成功時は onAuthStateChange が発火して App 側が画面を切り替える
  }

  if (!isConfigured) {
    return (
      <div className="card login-card">
        <h2>設定が未完了です</h2>
        <div className="status err">
          接続先が設定されていません。<code>VITE_SUPABASE_URL</code> と{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> を設定してください。
        </div>
        <p className="hint">
          手元で動かす場合は <code>packages/client/.env.local</code> に記入します。
          公開版はGitHubのシークレットから渡されます。詳しくは <code>docs/deploy.md</code> を参照してください。
        </p>
      </div>
    );
  }

  return (
    <div className="card login-card">
      <div className="kicker">EC MARKETING / PROFIT TOOL</div>
      <h2>MQ率 利益計算アプリ</h2>
      <p className="hint" style={{ marginBottom: 16 }}>
        社内利用向けです。発行されたメールアドレスとパスワードでログインしてください。
      </p>

      <form onSubmit={signIn}>
        <label htmlFor="login-email">メールアドレス</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="login-password" style={{ marginTop: 12 }}>
          パスワード
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <div className="status err">{error}</div>}

        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16, width: '100%' }}>
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>

      <p className="hint" style={{ marginTop: 14 }}>
        アカウントが必要な場合は管理者に発行を依頼してください。
        パスワードを忘れた場合も管理者からリセットできます。
      </p>
    </div>
  );
}
