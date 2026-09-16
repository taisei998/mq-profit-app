import { useEffect, useState } from 'react';
import { ProductListPage } from './pages/ProductListPage.js';
import { ProductRegisterPage, LoadRequest } from './pages/ProductRegisterPage.js';
import { OrderAggregationPage } from './pages/OrderAggregationPage.js';
import { MasterPage } from './pages/MasterPage.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { supabase } from './lib/supabase.js';
import type { Session } from '@supabase/supabase-js';

type Pane = 0 | 1 | 2 | 3 | 4; // 0=HOME 1=商品一覧 2=粗利作成 3=データアップ 4=マスタ

const NAV: Array<{ pane: Pane; label: string; icon: string }> = [
  { pane: 0, label: 'HOME', icon: '🏠' },
  { pane: 2, label: '粗利作成', icon: '📈' },
  { pane: 1, label: '商品一覧', icon: '📦' },
  { pane: 3, label: 'データアップ', icon: '☁' },
  { pane: 4, label: 'マスタ', icon: '🗄' },
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

export default function App() {
  const [pane, setPane] = useState<Pane>(0);
  const [loadRequest, setLoadRequest] = useState<LoadRequest | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  // ログイン状態を監視する。ログアウトやセッション切れも自動で反映される。
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  function openEdit(id: string) {
    setLoadRequest({ id, mode: 'edit' });
    setPane(2);
  }
  function openDuplicate(id: string) {
    setLoadRequest({ id, mode: 'duplicate' });
    setPane(2);
  }

  if (checking) {
    return (
      <div className="wrap">
        <p className="hint" style={{ textAlign: 'center', padding: 40 }}>読み込み中…</p>
      </div>
    );
  }

  // 未ログインならログイン画面だけを出す（データは一切読み込まない）
  if (!session) {
    return (
      <div className="wrap">
        <LoginPage />
      </div>
    );
  }

  const userLabel = session.user.email ?? 'ログイン中';

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <div className="kicker">EC MARKETING / PROFIT TOOL</div>
          <h1>MQ率 利益計算アプリ</h1>
        </div>
        <div className="topbar-right">
          <span className="topbar-date">{today()}</span>
          <span className="user-chip" title={userLabel}>
            <span className="user-avatar">{userLabel.slice(0, 1).toUpperCase()}</span>
            {userLabel}
          </span>
          <button className="mini" onClick={() => supabase.auth.signOut()}>
            ログアウト
          </button>
        </div>
      </div>

      <div className="layout">
        <div className="main">
          {pane === 0 && <HomePage onGoToImport={() => setPane(3)} />}
          {pane === 1 && <ProductListPage onEdit={openEdit} onDuplicate={openDuplicate} />}
          {pane === 2 && (
            <ProductRegisterPage loadRequest={loadRequest} onConsumedLoadRequest={() => setLoadRequest(null)} />
          )}
          {pane === 3 && <OrderAggregationPage />}
          {pane === 4 && <MasterPage />}
        </div>
        <aside className="sidetabs">
          {/* メニュー名はUIデザイン案に合わせている */}
          {NAV.map((n) => (
            <button key={n.pane} className={`tab ${pane === n.pane ? 'active' : ''}`} onClick={() => setPane(n.pane)}>
              <span className="tab-icon" aria-hidden="true">
                {n.icon}
              </span>
              {n.label}
            </button>
          ))}
        </aside>
      </div>

      <div className="footer">社内利用向け · データはサーバー上のデータベースに保存されます</div>
    </div>
  );
}
