import { useEffect, useState } from 'react';
import { ProductListPage } from './pages/ProductListPage.js';
import { ProductRegisterPage, LoadRequest } from './pages/ProductRegisterPage.js';
import { OrderAggregationPage } from './pages/OrderAggregationPage.js';
import { MasterPage } from './pages/MasterPage.js';
import { HomePage } from './pages/HomePage.js';

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
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [loadRequest, setLoadRequest] = useState<LoadRequest | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setApiOk(r.ok))
      .catch(() => setApiOk(false));
  }, []);

  function openEdit(id: string) {
    setLoadRequest({ id, mode: 'edit' });
    setPane(2);
  }
  function openDuplicate(id: string) {
    setLoadRequest({ id, mode: 'duplicate' });
    setPane(2);
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <div className="kicker">EC MARKETING / PROFIT TOOL</div>
          <h1>MQ率 利益計算アプリ</h1>
        </div>
        <div className="topbar-right">
          <span className="topbar-date">{today()}</span>
          {/* 認証が未実装のため、ログインユーザーは表示できない（デザイン案の「山田 太郎」相当） */}
          <span className="user-chip" title="認証（ログイン）は未実装です">
            <span className="user-avatar">–</span>未ログイン
          </span>
          {apiOk !== null && (
            <span className={`topbar-badge ${apiOk ? 'ok' : 'err'}`}>
              {apiOk ? '● サーバー接続OK' : '● サーバーに接続できません'}
            </span>
          )}
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
