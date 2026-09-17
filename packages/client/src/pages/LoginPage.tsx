import { useState } from 'react';
import { isConfigured, supabase, toMessage } from '../lib/supabase.js';

// 登録できる会社のメールアドレス。
// ここでの確認は「分かりやすいエラーを出すため」で、本当に守っているのはDB側のトリガー
// （supabase/03_signup_domain.sql）です。この画面のコードは公開されていて誰でも読めるので、
// 画面のチェックだけを頼りにはしていません。
const ALLOWED_DOMAINS = ['lo-cal-g.com', 'lo-cal.co.jp'];

function isCompanyEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1];
  return ALLOWED_DOMAINS.includes(domain ?? '');
}

type Mode = 'login' | 'signup';

// ログイン画面。未ログインのときはこの画面しか表示されず、
// データは1件も読み込まれない（DB側のアクセス制御でも拒否される）。
export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword('');
  }

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

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!isCompanyEmail(email)) {
      setError(`会社のメールアドレス（@${ALLOWED_DOMAINS.join(' / @')}）でのみ登録できます。`);
      return;
    }
    if (password.length < 12) {
      setError('パスワードは12文字以上にしてください。');
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);

    if (error) {
      // DB側のトリガーで弾かれた場合、Supabaseは中身を伏せた定型文を返すことがある
      setError(
        error.message.includes('Database error')
          ? `登録できませんでした。会社のメールアドレス（@${ALLOWED_DOMAINS.join(' / @')}）か確認してください。`
          : toMessage(error)
      );
      return;
    }

    // 確認メールが有効な場合、この時点ではまだログインできない
    if (data.session) {
      return; // すぐ使える設定になっている場合はApp側が切り替える
    }
    setNotice(
      `${email.trim()} に確認メールを送りました。メール内のリンクを開くとログインできるようになります。` +
        '（数分待っても届かない場合は迷惑メールフォルダも確認してください）'
    );
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

  const isSignup = mode === 'signup';

  return (
    <div className="card login-card">
      <div className="kicker">EC MARKETING / PROFIT TOOL</div>
      <h2>MQ率 利益計算アプリ</h2>

      <div className="seg" style={{ marginTop: 14, marginBottom: 14 }}>
        <button className={!isSignup ? 'on-normal' : ''} onClick={() => switchMode('login')}>
          ログイン
        </button>
        <button className={isSignup ? 'on-normal' : ''} onClick={() => switchMode('signup')}>
          新規登録
        </button>
      </div>

      <p className="hint" style={{ marginBottom: 16 }}>
        {isSignup
          ? `社内向けのツールです。会社のメールアドレス（@${ALLOWED_DOMAINS.join(' / @')}）でのみ登録できます。`
          : '登録済みのメールアドレスとパスワードでログインしてください。'}
      </p>

      <form onSubmit={isSignup ? signUp : signIn}>
        <label htmlFor="login-email">メールアドレス</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={isSignup ? `例: yamada@${ALLOWED_DOMAINS[0]}` : undefined}
          required
        />

        <label htmlFor="login-password" style={{ marginTop: 12 }}>
          パスワード{isSignup ? '（12文字以上）' : ''}
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={isSignup ? 12 : undefined}
          required
        />

        {error && <div className="status err">{error}</div>}
        {notice && <div className="status ok">{notice}</div>}

        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16, width: '100%' }}>
          {busy ? '処理中…' : isSignup ? 'このメールアドレスで登録' : 'ログイン'}
        </button>
      </form>

      <p className="hint" style={{ marginTop: 14 }}>
        {isSignup
          ? '登録後、確認メールのリンクを開くと使えるようになります。'
          : 'パスワードを忘れた場合は管理者にリセットを依頼してください。'}
      </p>
    </div>
  );
}
