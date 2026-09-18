import { GROUPS, GROUP_COLOR, GROUP_LABEL, JOBCAN_STATUS_LABEL, PRODUCT_STATUSES, ProductRecord, ProductStatus, STATUS_LABEL } from '@ec-ai/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { yen } from '../lib/format.js';
import { readFileAsText } from '../lib/file.js';
import { exportProductsCSV, parseProductsCSV } from '../lib/productCsv.js';
import { useDeleteProduct, useMalls, useProducts, useSaveProduct, useSetProductStatus, useShops } from '../lib/queries.js';

type Metric = 'rates' | 'ratesEx' | 'profits' | 'profitsEx';

// ステータスの遷移先。サーバー側(routes/products.ts)と同じ定義を持つ
const NEXT_STATUSES: Record<string, ProductStatus[]> = {
  draft: ['pending'],
  pending: ['approved', 'rejected'],
  approved: ['selling', 'draft'],
  rejected: ['draft'],
  selling: ['ended'],
  ended: ['selling'],
};

interface Props {
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function ProductListPage({ onEdit, onDuplicate }: Props) {
  const { data: products = [], isLoading } = useProducts();
  const { data: malls = [] } = useMalls();
  const { data: shops = [] } = useShops();
  const deleteProduct = useDeleteProduct();
  const saveProduct = useSaveProduct();
  const setProductStatus = useSetProductStatus();
  const [search, setSearch] = useState('');
  const [mallFilter, setMallFilter] = useState('');
  const [shopFilter, setShopFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProductStatus | ''>('');
  const [page, setPage] = useState(1);
  const PER_PAGE = 20; // デザイン案の「1ページ20件」に合わせる
  const [importShopId, setImportShopId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('rates');
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const sorted = useMemo(
    () => [...products].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)),
    [products]
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((m) => {
      if (mallFilter && m.mallId !== mallFilter) return false;
      if (shopFilter && m.shopId !== shopFilter) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      if (!q) return true;
      return [m.productId, m.mgmtNo, m.category, m.code, m.name, m.spec, m.mallName, m.shopName]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [sorted, search, mallFilter, shopFilter, statusFilter]);

  // 絞り込みを変えたら1ページ目に戻す（そうしないと空ページが表示されてしまう）
  useEffect(() => {
    setPage(1);
  }, [search, mallFilter, shopFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const pageItems = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ステータス別の件数（タブに出す）。モール・店舗の絞り込みは反映する
  const scoped = useMemo(
    () =>
      sorted.filter(
        (m) => (!mallFilter || m.mallId === mallFilter) && (!shopFilter || m.shopId === shopFilter)
      ),
    [sorted, mallFilter, shopFilter]
  );
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    scoped.forEach((m) => {
      c[m.status] = (c[m.status] || 0) + 1;
    });
    return c;
  }, [scoped]);

  async function changeStatus(p: ProductRecord, status: ProductStatus) {
    try {
      await setProductStatus.mutateAsync({ id: p.id, status });
      setStatus({ text: `「${p.code}」を${STATUS_LABEL[status]}にしました。`, type: 'ok' });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '変更に失敗しました。', type: 'err' });
    }
  }

  // モールで絞り込んでいる間は、その配下の店舗だけを選択肢に出す
  const shopOptions = mallFilter ? shops.filter((sh) => sh.mallId === mallFilter) : shops;

  async function handleDelete(p: ProductRecord) {
    if (!confirm(`「${p.productId} / ${p.mallName} ＞ ${p.shopName} / ${p.code}」を削除します。よろしいですか？`)) return;
    await deleteProduct.mutateAsync(p.id);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!importShopId) {
      setStatus({ text: '先に「CSVの取込先の店舗」を選んでください。', type: 'err' });
      return;
    }
    setImporting(true);
    try {
      const text = await readFileAsText(file);
      // 商品コードは店舗ごとに一意なので、取込先の店舗を明示して読み込む
      const items = parseProductsCSV(text, importShopId);
      for (const item of items) {
        await saveProduct.mutateAsync(item);
      }
      const shop = shops.find((sh) => sh.id === importShopId);
      setStatus({
        text: `✅ 商品マスターCSVから ${items.length} 件を「${shop?.mallName} ＞ ${shop?.name}」に読み込みました。`,
        type: 'ok',
      });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '読み込みに失敗しました。', type: 'err' });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card" id="pane1">
      <h2>② 商品一覧</h2>
      <p className="hint" style={{ marginBottom: 8 }}>
        登録済みの商品を一覧で確認できます。商品の追加は「粗利作成」から行ってください。データはサーバーのデータベースに保存されます。
      </p>
      <div className="csv-row" style={{ marginTop: 4 }}>
        <button className="btn-ghost" onClick={() => exportProductsCSV(products)} disabled={products.length === 0}>
          ⬇ 商品マスターをCSV保存
        </button>
        <button className="btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={importing || !importShopId}>
          ⬆ 商品マスターCSVを読込
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" style={{ display: 'none' }} onChange={handleImportFile} />
      </div>
      <div style={{ marginTop: 8, maxWidth: 420 }}>
        <label>CSVの取込先の店舗</label>
        <select value={importShopId} onChange={(e) => setImportShopId(e.target.value)}>
          <option value="">（選択してください）</option>
          {shops.map((sh) => (
            <option key={sh.id} value={sh.id}>
              {sh.mallName} ＞ {sh.name}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        バックアップや別PCへの移行には「CSV保存」を使ってください。
        商品コードはモール・店舗ごとに異なるため、読み込むときはどの店舗の商品として登録するかを選んでください
        （CSVのモール・店舗列は参考情報で、取込先には使いません）。
      </p>
      {status && <div className={`status ${status.type}`}>{status.text}</div>}

      {isLoading ? (
        <p className="hint" style={{ marginTop: 14 }}>
          読み込み中…
        </p>
      ) : products.length === 0 ? (
        <div className="status err" style={{ marginTop: 14 }}>
          まだ商品が登録されていません。「粗利作成」から追加してください。
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label>検索（固有ID・管理番号・カテゴリ・商品コード・商品名・規格・モール・店舗）</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="キーワードを入力（例: A0001 / MZ0001 / 青果 / A-001 / 5kg）" />
          </div>
          <div className="status-cards">
            <button className={`status-card ${statusFilter === '' ? 'active' : ''}`} onClick={() => setStatusFilter('')}>
              <span className="status-card-label">すべて</span>
              <span className="status-card-count">{scoped.length} 件</span>
            </button>
            {PRODUCT_STATUSES.map((st) => (
              <button
                key={st}
                className={`status-card st-${st} ${statusFilter === st ? 'active' : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                <span className="status-card-label">{STATUS_LABEL[st]}</span>
                <span className="status-card-count">{statusCounts[st] || 0} 件</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <div>
              <label>モールで絞り込み</label>
              <select
                value={mallFilter}
                onChange={(e) => {
                  setMallFilter(e.target.value);
                  setShopFilter('');
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
              <label>店舗で絞り込み</label>
              <select value={shopFilter} onChange={(e) => setShopFilter(e.target.value)}>
                <option value="">すべて</option>
                {shopOptions.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="table-title">
            登録済み {products.length} 件
            {search || mallFilter || shopFilter ? `（表示 ${shown.length} 件）` : ''}
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>管理番号</th>
                  <th>商品コード</th>
                  <th>商品名</th>
                  <th>規格</th>
                  <th>モール</th>
                  <th>店舗</th>
                  <th>ステータス</th>
                  <th>粗利率</th>
                  <th>更新日</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    open={openId === p.id}
                    metric={metric}
                    onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                    onMetricChange={setMetric}
                    onEdit={() => onEdit(p.id)}
                    onDuplicate={() => onDuplicate(p.id)}
                    onDelete={() => handleDelete(p)}
                    onStatusChange={(st) => changeStatus(p, st)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="pager-info">
              {shown.length === 0
                ? '0件'
                : `${(page - 1) * PER_PAGE + 1}-${Math.min(page * PER_PAGE, shown.length)} / ${shown.length}件`}
            </span>
            <div className="pager-btns">
              <button className="mini" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1}>
                ‹
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  className={`mini ${page === i + 1 ? 'on' : ''}`}
                  onClick={() => setPage(i + 1)}
                >
                  {i + 1}
                </button>
              ))}
              <button
                className="mini"
                onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                disabled={page >= totalPages}
              >
                ›
              </button>
            </div>
          </div>
          <p className="hint">「詳細」で通常・SALE・SALE＋クーポンの粗利率を表示します。「編集」で①に内容を読み込み、「複製」で同じ内容をコピーして新規登録できます。</p>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product: p,
  open,
  metric,
  onToggle,
  onMetricChange,
  onEdit,
  onDuplicate,
  onStatusChange,
  onDelete,
}: {
  product: ProductRecord;
  open: boolean;
  metric: Metric;
  onToggle: () => void;
  onMetricChange: (m: Metric) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onStatusChange: (status: ProductStatus) => void;
}) {
  const isRate = metric === 'rates' || metric === 'ratesEx';
  const n = p.setCount ?? 5;
  return (
    <>
      <tr>
        <td className="code">{p.mgmtNo || '—'}</td>
        <td className="code">{p.code}</td>
        <td style={{ textAlign: 'left' }}>{p.name || '—'}</td>
        <td style={{ textAlign: 'left' }}>{p.spec || '—'}</td>
        <td style={{ textAlign: 'left' }}>{p.mallName || '—'}</td>
        <td style={{ textAlign: 'left' }}>{p.shopName || '—'}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {/* 現在のステータスはバッジで表示し、変更は下の小さなプルダウンで行う。
              選択肢にはそこから進める状態だけを出す（不正な遷移はサーバー側でも弾く）。 */}
          <span className={`badge st-${p.status}`}>{STATUS_LABEL[p.status]}</span>
          {(NEXT_STATUSES[p.status] ?? []).length > 0 && (
            <select
              className="status-select"
              value=""
              onChange={(e) => {
                if (e.target.value) onStatusChange(e.target.value as ProductStatus);
              }}
              aria-label="ステータスを変更"
            >
              <option value="">変更…</option>
              {(NEXT_STATUSES[p.status] ?? []).map((st) => (
                <option key={st} value={st}>
                  → {STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          )}
        </td>
        {/* 粗利率は「通常時・1セット」の税込粗利率を代表値として出す */}
        <td>{p.normal.rates[0] == null ? '—' : `${p.normal.rates[0].toFixed(1)}%`}</td>
        <td style={{ whiteSpace: 'nowrap' }}>{p.updatedAt ? p.updatedAt.slice(0, 10) : '—'}</td>
        <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
          <button className="mini" onClick={onToggle}>
            {open ? '閉じる' : '詳細'}
          </button>{' '}
          <button className="mini" onClick={onEdit}>
            編集
          </button>{' '}
          <button className="mini" onClick={onDuplicate}>
            複製
          </button>{' '}
          <button className="del" onClick={onDelete}>
            削除
          </button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={10}>
            <div className="detail-ctrl">
              表示する数値：
              <select value={metric} onChange={(e) => onMetricChange(e.target.value as Metric)}>
                <option value="rates">粗利率(税込)</option>
                <option value="ratesEx">粗利率(税抜)</option>
                <option value="profits">粗利額(税込)</option>
                <option value="profitsEx">粗利額(税抜)</option>
              </select>
            </div>
            <table className="detail-table">
              <thead>
                <tr>
                  <th>区分</th>
                  <th>販売金額</th>
                  {Array.from({ length: n }).map((_, k) => (
                    <th key={k}>{k + 1}set</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => {
                  const grp = p[g];
                  const arr = grp[metric] || [];
                  const p1 = grp.prices?.[0];
                  return (
                    <tr key={g}>
                      <td style={{ textAlign: 'left', color: GROUP_COLOR[g], fontWeight: 700 }}>{GROUP_LABEL[g]}</td>
                      <td>{p1 == null ? '—' : yen(p1)}</td>
                      {Array.from({ length: n }).map((_, k) => {
                        const v = arr[k];
                        return <td key={k}>{v == null ? '—' : isRate ? `${v.toFixed(1)}%` : yen(v)}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {p.note && <div className="detail-note">備考：{p.note}</div>}
            {p.jobcanStatus && (
              // ジョブカンから取り込んだ稟議の情報。連携していない商品には出ない。
              // アプリのステータスに写していない状態（差戻しなど）もここで分かるようにしている。
              <div className="detail-note">
                ジョブカン：{JOBCAN_STATUS_LABEL[p.jobcanStatus]}
                {p.jobcanRequestId != null && `（申請書ID ${p.jobcanRequestId}）`}
                {p.jobcanTitle && ` ／ ${p.jobcanTitle}`}
                {p.jobcanStatus === 'returned' && (
                  <span className="hint">
                    　差戻しです。内容を直して申請し直す場合は、このアプリのステータスも手で戻してください。
                  </span>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
