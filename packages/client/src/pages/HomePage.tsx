import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { yen } from '../lib/format.js';
import { PRODUCT_STATUSES, ProductStatus, STATUS_LABEL } from '@ec-ai/shared';
import { useDashboard, useMalls, useShops } from '../lib/queries.js';

// ローカル時刻のままYYYY-MM-DDにする。
// toISOString()はUTCに変換してしまうため、日本時間の「9月1日 00:00」が「8月31日」になってしまう。
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 既定の集計期間は「今月の1日〜今日」。
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDate(now) };
}

// 前期間比。前期間が0のときは「比較できない」ので null を返す（∞%と出すと誤解を招くため）
function diffPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function Delta({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="hint">前期間のデータなし</span>;
  const up = value >= 0;
  return (
    <span style={{ color: up ? 'var(--accent)' : 'var(--coupon)', fontWeight: 700 }}>
      前期間比 {up ? '+' : ''}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

export function HomePage({ onGoToImport }: { onGoToImport: () => void }) {
  const [range, setRange] = useState(defaultRange);
  const [mallId, setMallId] = useState('');
  const [shopId, setShopId] = useState('');
  const [status, setStatus] = useState<ProductStatus | ''>('');
  const { data: malls = [] } = useMalls();
  const { data: shops = [] } = useShops();

  const params = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      mallId: mallId || undefined,
      shopId: shopId || undefined,
      status: status || undefined,
    }),
    [range, mallId, shopId, status]
  );
  const { data, isLoading, error } = useDashboard(params);

  const shopOptions = mallId ? shops.filter((s) => s.mallId === mallId) : shops;
  const hasData = !!data && data.kpi.count > 0;

  return (
    <div className="card" id="pane0">
      <h2>HOME（売上ダッシュボード）</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        「データアップ」で取り込んだ受注データを集計して表示します。取り込むまでは何も表示されません。
      </p>

      <div className="row">
        <div>
          <label>開始日</label>
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div>
          <label>終了日</label>
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <div>
          <label>モール</label>
          <select
            value={mallId}
            onChange={(e) => {
              setMallId(e.target.value);
              setShopId('');
            }}
          >
            <option value="">すべて</option>
            {malls.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>店舗</label>
          <select value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">すべて</option>
            {shopOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>ステータス</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProductStatus | '')}>
            <option value="">すべて</option>
            {PRODUCT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="hint" style={{ marginTop: -4 }}>
        ステータスは受注が紐づいた商品の状態で絞り込みます。
      </p>

      {error && <div className="status err">{error instanceof Error ? error.message : '集計に失敗しました。'}</div>}
      {isLoading && <p className="hint">集計中…</p>}

      {data && (
        <>
          {/* アラート */}
          {(data.alerts.unmatched > 0 || data.alerts.errors > 0 || data.alerts.mallsWithoutImport.length > 0) && (
            <div className="alert-panel">
              <button className="alert-head" onClick={onGoToImport}>
                <span>❗ 未紐付け受注・取込アラート</span>
                <span className="alert-go">取込履歴を見る ›</span>
              </button>
              <div className="alert-row">
                <span>⚠ 未紐付け受注（商品が未登録）</span>
                <strong>{data.alerts.unmatched} 件</strong>
              </div>
              <div className="alert-row">
                <span>⚠ 取込エラー（売価が商品登録と不一致）</span>
                <strong>{data.alerts.errors} 件</strong>
              </div>
              <div className="alert-row">
                <span>⚠ モール取込未対応（一度も取り込んでいない）</span>
                <strong>{data.alerts.mallsWithoutImport.length} 件</strong>
              </div>
              {data.alerts.mallsWithoutImport.length > 0 && (
                <p className="hint" style={{ margin: '2px 14px 10px' }}>
                  未取込のモール: {data.alerts.mallsWithoutImport.join('、')}
                </p>
              )}
            </div>
          )}

          {!hasData ? (
            <div className="status err" style={{ marginTop: 14 }}>
              この期間の受注データがありません。「データアップ」から受注CSVを取り込むと、ここに集計が表示されます。
            </div>
          ) : (
            <>
              {/* KPIカード */}
              <div className="row" style={{ marginTop: 16 }}>
                <div className="kpi">
                  <div className="kpi-head">
                    <span className="kpi-icon sales" aria-hidden="true">📊</span>
                    <span className="kpi-label">売上</span>
                  </div>
                  <div className="kpi-value">{yen(Math.round(data.kpi.sales))}</div>
                  <Delta value={diffPct(data.kpi.sales, data.kpi.prevSales)} />
                </div>
                <div className="kpi">
                  <div className="kpi-head">
                    <span className="kpi-icon profit" aria-hidden="true">🗄</span>
                    <span className="kpi-label">粗利</span>
                  </div>
                  <div className="kpi-value">{yen(Math.round(data.kpi.profit))}</div>
                  <Delta value={diffPct(data.kpi.profit, data.kpi.prevProfit)} />
                </div>
                <div className="kpi">
                  <div className="kpi-head">
                    <span className="kpi-icon rate" aria-hidden="true">％</span>
                    <span className="kpi-label">粗利率</span>
                  </div>
                  <div className="kpi-value">{data.kpi.rate === null ? '—' : `${data.kpi.rate.toFixed(1)}%`}</div>
                  {data.kpi.rate !== null && data.kpi.prevRate !== null ? (
                    <Delta value={data.kpi.rate - data.kpi.prevRate} suffix="pt" />
                  ) : (
                    <span className="hint">前期間のデータなし</span>
                  )}
                </div>
                <div className="kpi">
                  <div className="kpi-head">
                    <span className="kpi-icon count" aria-hidden="true">🛒</span>
                    <span className="kpi-label">注文件数</span>
                  </div>
                  <div className="kpi-value">{data.kpi.count.toLocaleString('ja-JP')} 件</div>
                  <Delta value={diffPct(data.kpi.count, data.kpi.prevCount)} />
                </div>
              </div>
              <p className="hint">
                前期間 = {data.previousRange.from} 〜 {data.previousRange.to}（同じ日数ぶん手前）
              </p>

              {/* 売上推移 */}
              <div className="table-title" style={{ marginTop: 18 }}>
                売上推移（月別）
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={data.monthly} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} width={72} tickFormatter={(v) => yen(Number(v))} />
                    <Tooltip formatter={(v) => yen(Math.round(Number(v)))} />
                    <Legend />
                    <Line type="monotone" dataKey="sales" name="売上" stroke="var(--accent)" strokeWidth={2} />
                    <Line type="monotone" dataKey="profit" name="粗利" stroke="var(--sale)" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* モール別 */}
              <div className="table-title" style={{ marginTop: 18 }}>
                モール別の売上・粗利
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={data.byMall} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mallName" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} width={72} tickFormatter={(v) => yen(Number(v))} />
                    <Tooltip formatter={(v) => yen(Math.round(Number(v)))} />
                    <Legend />
                    <Bar dataKey="sales" name="売上" fill="var(--accent)" />
                    <Bar dataKey="profit" name="粗利" fill="var(--sale)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* ランキング */}
              <div className="table-title" style={{ marginTop: 18 }}>
                商品別売上ランキング（上位5件）
              </div>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>順位</th>
                      <th>商品名</th>
                      <th>商品コード</th>
                      <th>売上</th>
                      <th>粗利</th>
                      <th>注文件数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p) => (
                      <tr key={p.productId}>
                        <td>{p.rank}</td>
                        <td style={{ textAlign: 'left', fontWeight: 700 }}>{p.name}</td>
                        <td className="code">{p.code}</td>
                        <td>{yen(Math.round(p.sales))}</td>
                        <td>{yen(Math.round(p.profit))}</td>
                        <td>{p.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
