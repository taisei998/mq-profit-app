import { OrderAggregationResult, OrderColumnMapping, SaleMode, detectDelimiter, parseCSVLine, splitLines } from '@ec-ai/shared';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  useCsvMappings,
  useDeleteBatch,
  useImportBatches,
  useMalls,
  useSaveCsvMapping,
  useShops,
} from '../lib/queries.js';
import { downloadCSV } from '../lib/file.js';
import { readFileAsText } from '../lib/file.js';
import { yen, pct } from '../lib/format.js';

const CATEGORY_ORDER = ['青果', '精肉・肉加工品', '魚介・水産加工品', '雑穀米', '米', '惣菜・調味料', '水・ソフトドリンク', 'お菓子・パン', 'その他'];

function guessColumn(header: string[], keys: string[]): number {
  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase().replace(/\s/g, '');
    for (const k of keys) {
      if (h.indexOf(k.toLowerCase()) !== -1) return i;
    }
  }
  return 0;
}

export function OrderAggregationPage() {
  const { data: malls = [] } = useMalls();
  const { data: shops = [] } = useShops();
  // 受注ファイルは店舗単位でダウンロードするため、先にモール→店舗を選んでもらう（2026-09-16決定 #17）
  const [mallId, setMallId] = useState('');
  const [shopId, setShopId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const [mapping, setMapping] = useState<OrderColumnMapping>({
    dateCol: 0,
    codeCol: 0,
    amountCol: 0,
    qtyCol: 0,
    saleMode: 'by_column',
    saleCol: 0,
    unitCol: 0,
  });
  const [result, setResult] = useState<OrderAggregationResult | null>(null);
  const [aggregating, setAggregating] = useState(false);
  const [fileName, setFileName] = useState('');
  const [imported, setImported] = useState(false); // 同じプレビューを二重に取り込まないためのフラグ
  const [importing, setImporting] = useState(false);
  const { data: batches = [] } = useImportBatches();
  const { data: mappings = [] } = useCsvMappings();
  const saveMapping = useSaveCsvMapping();
  const deleteBatch = useDeleteBatch();
  const queryClient = useQueryClient();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await readFileAsText(file);
    const lines = splitLines(text);
    if (lines.length < 2) {
      setStatus({ text: 'データ行が見つかりません。', type: 'err' });
      return;
    }
    // Amazonの注文レポートはタブ区切り(.txt)なので、見出し行から区切り文字を判定する。
    // ※ .map(parseCSVLine) と書くと第2引数に配列の添字が渡ってしまうため、必ず明示的に呼ぶこと。
    const delimiter = detectDelimiter(lines[0]);
    const h = parseCSVLine(lines[0], delimiter).map((x) => x.trim());
    const r = lines
      .slice(1)
      .map((line) => parseCSVLine(line, delimiter))
      .filter((row) => row.some((c) => c.trim() !== ''));
    setHeader(h);
    setRows(r);
    setResult(null);
    setFileName(file.name);
    setImported(false);

    let next: OrderColumnMapping = {
      dateCol: guessColumn(h, ['受注日', '注文日', '日付', 'date', 'order']),
      codeCol: guessColumn(h, ['商品コード', 'コード', 'sku', 'code']),
      amountCol: guessColumn(h, ['支払い金額', '支払金額', '支払', '金額', '売上', 'amount', 'price', 'total']),
      qtyCol: guessColumn(h, ['数量', '個数', '点数', 'セット', 'qty', 'quantity', 'count']),
      saleCol: guessColumn(h, ['クーポン', 'coupon', 'sale', 'セール', '割引', '区分', 'キャンペーン']),
      unitCol: guessColumn(h, ['単価', 'unit price', 'unitprice']),
      saleMode: 'by_column',
    };
    // Amazonの注文レポートは列名が英語で固定なので、見出しから直接あてる。
    // 単価の列が無いので「支払い金額 ÷ 数量」で単価を出し、キャンセル分は除外する。
    const at = (name: string) => h.indexOf(name);
    if (at('amazon-order-id') >= 0 && at('sku') >= 0) {
      next = {
        dateCol: at('purchase-date'),
        codeCol: at('sku'),
        amountCol: at('item-price'),
        qtyCol: at('quantity'),
        saleCol: 0,
        unitCol: at('item-price'),
        saleMode: 'by_price',
        unitMode: 'divide',
        statusCol: at('order-status'),
        excludeStatuses: ['Cancelled'],
      };
    } else if (h.length >= 13) {
      // 全モール共通フォーマット：受注日時=5列目・商品コード=10列目・単価=12列目・数量=13列目
      next = { ...next, dateCol: 4, codeCol: 9, unitCol: 11, qtyCol: 12, saleMode: 'by_price' };
    }
    // モールごとに保存した設定があれば、自動判定よりそちらを優先する
    const saved = mappings.find((m) => m.mallId === mallId)?.config;
    if (saved) next = { ...next, ...saved };

    setMapping(next);
    setStatus({
      text: saved
        ? `読み込みました（${r.length}行）。このモールに保存された列設定を適用しました。`
        : `読み込みました（${r.length}行）。列を選んで集計してください。`,
      type: 'ok',
    });
  }

  async function runAggregate() {
    if (!shopId) {
      setStatus({ text: 'モールと店舗を選んでください。', type: 'err' });
      return;
    }
    setAggregating(true);
    try {
      const res = await api.orders.aggregate(shopId, rows, mapping);
      setResult(res);
      const missCount = Object.keys(res.missing).length;
      let msg = `✅ ${res.matched}件を集計しました。下に結果を表示しています。`;
      if (res.excluded > 0) {
        const why = Object.keys(res.excludedDetail).join('・');
        msg += ` （注文ステータス「${why}」の${res.excluded}件は対象外として除外）`;
      }
      if (missCount > 0) msg += ` （未登録の商品コードが${missCount}種類あり除外）`;
      if (res.priceMismatch > 0) msg += ` （売価が商品登録の価格と一致せず判定できなかった行が${res.priceMismatch}件あり除外）`;
      setStatus({ text: msg, type: missCount > 0 || res.priceMismatch > 0 ? 'err' : 'ok' });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '集計に失敗しました。', type: 'err' });
    } finally {
      setAggregating(false);
    }
  }

  async function runImport() {
    if (!shopId || !result) return;
    if (!confirm(`「${fileName}」の${result.matched}件を取り込みます。よろしいですか？`)) return;
    setImporting(true);
    try {
      const res = await api.orders.import(shopId, rows, mapping, fileName);
      setImported(true);
      // 取込履歴とHOMEの集計は取り込んだ内容で変わるので、キャッシュを捨てて取り直す
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setStatus({ text: `✅ ${res.matched}件を取り込みました。HOMEの集計に反映されます。`, type: 'ok' });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '取込に失敗しました。', type: 'err' });
    } finally {
      setImporting(false);
    }
  }

  async function persistMapping() {
    if (!mallId) return;
    try {
      await saveMapping.mutateAsync({ mallId, config: mapping });
      const mall = malls.find((m) => m.id === mallId);
      setStatus({ text: `✅ 「${mall?.name}」の列設定を保存しました。次回から自動で適用されます。`, type: 'ok' });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '設定の保存に失敗しました。', type: 'err' });
    }
  }

  async function removeBatch(b: { id: string; fileName: string; successCount: number }) {
    if (!confirm(`「${b.fileName}」の取込（${b.successCount}件）を取り消します。受注データも一緒に削除されます。よろしいですか？`)) return;
    try {
      await deleteBatch.mutateAsync(b.id);
      setStatus({ text: `取込「${b.fileName}」を取り消しました。`, type: 'ok' });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '取消に失敗しました。', type: 'err' });
    }
  }

  function exportResult() {
    if (!result) return;
    const rowsOut: Array<Array<string | number>> = [['区分', 'キー', 'カテゴリ／商品名', '件数', '売上計', '粗利計', '粗利率(%)']];
    Object.keys(result.daily)
      .sort()
      .forEach((d) => {
        const x = result.daily[d];
        const rate = x.sales > 0 ? (x.profit / x.sales) * 100 : 0;
        rowsOut.push(['単日', d, '', x.count, Math.round(x.sales), Math.round(x.profit), rate.toFixed(1)]);
      });
    Object.keys(result.category).forEach((k) => {
      const x = result.category[k];
      const rate = x.sales > 0 ? (x.profit / x.sales) * 100 : 0;
      rowsOut.push(['カテゴリ', k, '', x.count, Math.round(x.sales), Math.round(x.profit), rate.toFixed(1)]);
    });
    Object.keys(result.product).forEach((c) => {
      const x = result.product[c];
      const rate = x.sales > 0 ? (x.profit / x.sales) * 100 : 0;
      rowsOut.push(['商品', c, `${x.category || ''} / ${x.name || ''}`, x.count, Math.round(x.sales), Math.round(x.profit), rate.toFixed(1)]);
    });
    const tRate = result.totalSales > 0 ? (result.totalProfit / result.totalSales) * 100 : 0;
    rowsOut.push(['合計', '全期間', '', result.matched, Math.round(result.totalSales), Math.round(result.totalProfit), tRate.toFixed(1)]);
    const kindLabel: Record<string, string> = { normal: '通常時', sale: 'SALE時', coupon: 'SALE＋クーポン時' };
    (['normal', 'sale', 'coupon'] as const).forEach((k) => {
      const x = result.byKind[k];
      const rate = x.sales > 0 ? (x.profit / x.sales) * 100 : 0;
      rowsOut.push(['区分別', kindLabel[k], '', x.count, Math.round(x.sales), Math.round(x.profit), rate.toFixed(1)]);
    });
    downloadCSV(rowsOut, 'MQ率_集計結果.csv');
  }

  const columnOptions = header.map((h, i) => {
    const sample = rows[0]?.[i];
    const ex = sample && sample.trim() !== '' ? ` 例:${sample.slice(0, 12)}` : '';
    return (
      <option key={i} value={i}>
        列{i + 1}：{h || '(無題)'}
        {ex}
      </option>
    );
  });

  const totalRate = result && result.totalSales > 0 ? (result.totalProfit / result.totalSales) * 100 : null;
  const missKeys = result ? Object.keys(result.missing) : [];
  const mismatchKeys = result ? Object.keys(result.priceMismatchDetail) : [];
  const dates = result ? Object.keys(result.daily).sort() : [];
  const catKeys = result ? CATEGORY_ORDER.filter((k) => result.category[k]) : [];
  const productKeys = result
    ? Object.keys(result.product).sort((a, b) => result.product[b].profit - result.product[a].profit)
    : [];

  const shopsOfMall = shops.filter((sh) => sh.mallId === mallId);
  const selectedShop = shops.find((sh) => sh.id === shopId);
  const currentStep = imported ? 4 : result ? 3 : header.length > 0 ? 2 : 1;

  function changeMall(id: string) {
    setMallId(id);
    const candidates = shops.filter((sh) => sh.mallId === id);
    setShopId(candidates.length === 1 ? candidates[0].id : '');
    setHeader([]);
    setRows([]);
    setResult(null);
    setStatus(null);
  }

  function changeShop(id: string) {
    setShopId(id);
    setHeader([]);
    setRows([]);
    setResult(null);
    setStatus(null);
  }

  return (
    <div className="card" id="pane3">
      <h2>データアップ（受注CSV取込）</h2>
      {/* UIデザイン案 4/5 のステップインジケータ */}
      <div className="wizard">
        {[
          { n: 1, label: 'ファイル選択', done: rows.length > 0 },
          { n: 2, label: '取込設定', done: header.length > 0 && !!result },
          { n: 3, label: '内容確認', done: !!result },
          { n: 4, label: '取込実行', done: imported },
        ].map((st, i) => (
          <div key={st.n} className={`wizard-step ${st.done ? 'done' : ''} ${currentStep === st.n ? 'on' : ''}`}>
            <span className="wizard-num">{st.n}</span>
            <span className="wizard-label">{st.label}</span>
            {i < 3 && <span className="wizard-bar" />}
          </div>
        ))}
      </div>

      <div className="table-title">① どの店舗の受注ファイルかを選ぶ</div>
      {shops.length === 0 ? (
        <div className="status err">
          店舗が登録されていません。先に「マスタ ＞ 店舗マスタ」で店舗を登録してください。
          商品コードは店舗ごとに異なるため、どの店舗の受注かが分からないと商品を引き当てられません。
        </div>
      ) : (
        <>
          <div className="seg" style={{ marginBottom: 10 }}>
            {malls.map((m) => (
              <button key={m.id} className={mallId === m.id ? 'on-normal' : ''} onClick={() => changeMall(m.id)}>
                {m.name}
              </button>
            ))}
          </div>
          {mallId && (
            <div className="seg" style={{ marginBottom: 10 }}>
              {shopsOfMall.length === 0 ? (
                <span className="hint">このモールには店舗が登録されていません。</span>
              ) : (
                shopsOfMall.map((sh) => (
                  <button key={sh.id} className={shopId === sh.id ? 'on-sale' : ''} onClick={() => changeShop(sh.id)}>
                    {sh.name}
                  </button>
                ))
              )}
            </div>
          )}
          {selectedShop && (
            <p className="hint" style={{ marginBottom: 12 }}>
              取込先: <strong>{selectedShop.mallName} ＞ {selectedShop.name}</strong>
              　この店舗に登録されている商品だけを引き当てます。
            </p>
          )}
        </>
      )}

      <div className="table-title">② 受注CSVを読み込む</div>
      <button
        className="btn-ghost"
        style={{ width: '100%' }}
        onClick={() => fileInputRef.current?.click()}
        disabled={!shopId}
      >
        📄 受注CSVファイルを選択
      </button>
      {/* Amazonの注文レポートは拡張子が .txt のタブ区切りなので許可しておく */}
      <input ref={fileInputRef} type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }} onChange={handleFile} />
      <p className="hint">
        カンマ区切りのCSVでも、タブ区切りのファイル（Amazonの注文レポート .txt）でも読めます。文字コードも自動判定します。
        そのモールの列設定を保存してあればそれを適用し、無ければ見出しから推測します。どちらの場合も下で選び直せます。
      </p>

      {header.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="table-title">③ どの列を使うか選択してください</div>
          <div className="row">
            <div>
              <label>受注日の列</label>
              <select value={mapping.dateCol} onChange={(e) => setMapping((m) => ({ ...m, dateCol: Number(e.target.value) }))}>
                {columnOptions}
              </select>
            </div>
            <div>
              <label>商品コードの列</label>
              <select value={mapping.codeCol} onChange={(e) => setMapping((m) => ({ ...m, codeCol: Number(e.target.value) }))}>
                {columnOptions}
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <label>支払い金額の列</label>
              <select value={mapping.amountCol} onChange={(e) => setMapping((m) => ({ ...m, amountCol: Number(e.target.value) }))}>
                {columnOptions}
              </select>
            </div>
            <div>
              <label>数量の列</label>
              <select value={mapping.qtyCol} onChange={(e) => setMapping((m) => ({ ...m, qtyCol: Number(e.target.value) }))}>
                {columnOptions}
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <label>通常／SALE／クーポンの判定</label>
              <select value={mapping.saleMode} onChange={(e) => setMapping((m) => ({ ...m, saleMode: e.target.value as SaleMode }))}>
                <option value="all_normal">すべて通常時として計算</option>
                <option value="all_sale">すべてSALE時として計算</option>
                <option value="all_coupon">すべてSALE＋クーポン時として計算</option>
                <option value="by_column">CSVの列で判定する</option>
                <option value="by_price">単価と商品登録の価格を照合して自動判定</option>
              </select>
            </div>
            {mapping.saleMode === 'by_column' && (
              <div>
                <label>区分の判定に使う列</label>
                <select value={mapping.saleCol} onChange={(e) => setMapping((m) => ({ ...m, saleCol: Number(e.target.value) }))}>
                  {columnOptions}
                </select>
              </div>
            )}
            {mapping.saleMode === 'by_price' && (
              <div>
                <label>単価（1個あたりの価格）の取り方</label>
                <select
                  value={mapping.unitMode ?? 'column'}
                  onChange={(e) => setMapping((m) => ({ ...m, unitMode: e.target.value as 'column' | 'divide' }))}
                >
                  <option value="column">単価の列を使う</option>
                  <option value="divide">支払い金額 ÷ 数量 で計算する（単価の列が無いモール向け）</option>
                </select>
              </div>
            )}
          </div>
          {mapping.saleMode === 'by_price' && (mapping.unitMode ?? 'column') === 'column' && (
            <div className="row">
              <div>
                <label>単価の列</label>
                <select value={mapping.unitCol} onChange={(e) => setMapping((m) => ({ ...m, unitCol: Number(e.target.value) }))}>
                  {columnOptions}
                </select>
              </div>
            </div>
          )}
          <div className="row">
            <div>
              <label>注文ステータスの列（キャンセル除外に使う）</label>
              <select
                value={mapping.statusCol ?? -1}
                onChange={(e) => setMapping((m) => ({ ...m, statusCol: Number(e.target.value) }))}
              >
                <option value={-1}>（使わない）</option>
                {columnOptions}
              </select>
            </div>
            {(mapping.statusCol ?? -1) >= 0 && (
              <div>
                <label>除外する値（カンマ区切り）</label>
                <input
                  type="text"
                  value={(mapping.excludeStatuses ?? []).join(', ')}
                  placeholder="例: Cancelled, キャンセル"
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      excludeStatuses: e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter((x) => x !== ''),
                    }))
                  }
                />
              </div>
            )}
          </div>
          <p className="hint">
            「列で判定」の場合、その列の値で振り分けます。
            <br />
            ・「クーポン」「coupon」を含む → SALE＋クーポン時
            <br />
            ・「SALE」「セール」「割引」を含む → SALE時
            <br />
            ・空欄や「通常」「0」 → 通常時
            <br />
            「単価と照合」の場合、その行の単価を商品登録の各区分（通常／SALE／SALE＋クーポン）の1セット価格と照合して区分を決めます（支払い金額は単価×数量で計算）。
            どの区分の価格とも一致しない行は、近い区分に寄せずに未紐付けとして集計から除外し、下に件数を表示します。
            <br />
            Amazonの注文レポートのように単価の列が無いファイルは「支払い金額 ÷ 数量」を選んでください（ファイルを読み込むと自動で選ばれます）。
          </p>
          <div className="csv-row" style={{ marginTop: 4 }}>
            <button className="btn" onClick={runAggregate} disabled={aggregating}>
              ④ この設定で内容を確認する
            </button>
            <button className="btn-ghost" onClick={persistMapping} disabled={saveMapping.isPending || !mallId}>
              この列設定をモールに保存
            </button>
          </div>
          {status && <div className={`status ${status.type}`}>{status.text}</div>}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 18 }}>
          <div className="table-title">⑤ 取込を実行する</div>
          <p className="hint">
            ここまでは画面上で計算しているだけで、まだ保存されていません。
            内容を確認して問題なければ取り込んでください。取り込むとHOMEの集計に反映されます。
          </p>
          {/* 最新の取込結果（UIデザイン案 4/5） */}
          <div className="result-cards">
            <div className="result-card ok">
              <div className="result-card-label">成功件数</div>
              <div className="result-card-count">{result.matched.toLocaleString('ja-JP')} 件</div>
            </div>
            <div className="result-card err">
              <div className="result-card-label">エラー件数（売価不一致）</div>
              <div className="result-card-count">{result.priceMismatch.toLocaleString('ja-JP')} 件</div>
            </div>
            <div className="result-card warn">
              <div className="result-card-label">未紐付け件数</div>
              <div className="result-card-count">
                {Object.values(result.missing).reduce((a, b) => a + b, 0).toLocaleString('ja-JP')} 件
              </div>
            </div>
            <div className="result-card">
              <div className="result-card-label">除外件数（キャンセル等）</div>
              <div className="result-card-count">{result.excluded.toLocaleString('ja-JP')} 件</div>
            </div>
          </div>
          <button className="btn" onClick={runImport} disabled={importing || imported || result.matched === 0}>
            {imported ? '✅ 取込済み' : `この内容で取り込む（${result.matched}件）`}
          </button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 22 }}>
          <div className="table-title">全期間の合計</div>
          <div className="day-block">
            <div className="day-head">
              <div className="day-date">全体の粗利率（売上加重平均）</div>
              <div className="day-rate">{pct(totalRate)}</div>
            </div>
            <div className="day-detail">
              売上計 {yen(result.totalSales)} ／ 粗利計 {yen(result.totalProfit)} ／ {result.matched}件
              <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.8 }}>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>通常時粗利</span> {yen(result.byKind.normal.profit)}（{result.byKind.normal.count}件）
                <br />
                <span style={{ color: 'var(--sale)', fontWeight: 700 }}>SALE時粗利</span> {yen(result.byKind.sale.profit)}（{result.byKind.sale.count}件）
                <br />
                <span style={{ color: 'var(--coupon)', fontWeight: 700 }}>SALE＋クーポン時粗利</span> {yen(result.byKind.coupon.profit)}（{result.byKind.coupon.count}件）
              </div>
            </div>
            {missKeys.length > 0 && (
              <div className="warn">
                ⚠ 商品が未登録のため除外（商品コード）: {missKeys.slice(0, 10).join(', ')}
                {missKeys.length > 10 ? ' ほか' : ''}
              </div>
            )}
            {mismatchKeys.length > 0 && (
              <div className="warn">
                ⚠ 売価が商品登録の価格と一致しないため除外（商品コード @売価）:{' '}
                {mismatchKeys.slice(0, 10).map((k) => `${k}（${result.priceMismatchDetail[k]}件）`).join(', ')}
                {mismatchKeys.length > 10 ? ' ほか' : ''}
                <br />
                モール側で価格を変えた場合は、商品登録の価格も更新してください。
              </div>
            )}
            {result.excluded > 0 && (
              <div className="warn">
                ⚠ 注文ステータスにより除外:{' '}
                {Object.keys(result.excludedDetail).map((k) => `${k}（${result.excludedDetail[k]}件）`).join(', ')}
              </div>
            )}
          </div>
          <div className="csv-row">
            <button className="btn-ghost" onClick={exportResult}>
              ⬇ 集計結果をCSV保存
            </button>
          </div>

          <div className="table-title" style={{ marginTop: 18 }}>
            単日ごとの粗利率
          </div>
          {dates.map((d) => {
            const x = result.daily[d];
            const rate = x.sales > 0 ? (x.profit / x.sales) * 100 : 0;
            return (
              <div className="day-block" key={d}>
                <div className="day-head">
                  <div className="day-date">{d || '(日付なし)'}</div>
                  <div className="day-rate">{rate.toFixed(1)}%</div>
                </div>
                <div className="day-detail">
                  売上 {yen(x.sales)} ／ 粗利 {yen(x.profit)} ／ {x.count}件
                </div>
              </div>
            );
          })}

          <div className="table-title" style={{ marginTop: 18 }}>
            カテゴリ別の集計（全期間）
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>カテゴリ</th>
                  <th>件数</th>
                  <th>売上計</th>
                  <th>粗利計</th>
                  <th>粗利率</th>
                </tr>
              </thead>
              <tbody>
                {catKeys.map((k) => {
                  const x = result.category[k];
                  const rate = x.sales > 0 ? (x.profit / x.sales) * 100 : 0;
                  return (
                    <tr key={k}>
                      <td className="code">{k}</td>
                      <td>{x.count}</td>
                      <td>{yen(x.sales)}</td>
                      <td>{yen(x.profit)}</td>
                      <td>{rate.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="table-title" style={{ marginTop: 18 }}>
            商品別の集計（全期間）
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>カテゴリ</th>
                  <th>コード</th>
                  <th>商品名</th>
                  <th>件数</th>
                  <th>売上計</th>
                  <th>粗利計</th>
                  <th>粗利率</th>
                </tr>
              </thead>
              <tbody>
                {productKeys.map((c) => {
                  const x = result.product[c];
                  const rate = x.sales > 0 ? (x.profit / x.sales) * 100 : 0;
                  return (
                    <tr key={c}>
                      <td style={{ textAlign: 'left' }}>{x.category || '—'}</td>
                      <td className="code">{c}</td>
                      <td style={{ textAlign: 'left' }}>{x.name || '—'}</td>
                      <td>{x.count}</td>
                      <td>{yen(x.sales)}</td>
                      <td>{yen(x.profit)}</td>
                      <td>{rate.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {batches.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="table-title">取込履歴（新しい順・最大100件）</div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>取込日時</th>
                  <th>モール</th>
                  <th>店舗</th>
                  <th>ファイル名</th>
                  <th>取込</th>
                  <th>未登録</th>
                  <th>売価不一致</th>
                  <th>除外</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(b.importedAt).toLocaleString('ja-JP')}</td>
                    <td>{b.mallName}</td>
                    <td>{b.shopName}</td>
                    <td style={{ textAlign: 'left' }}>{b.fileName}</td>
                    <td>{b.successCount}</td>
                    <td>{b.unmatchedCount}</td>
                    <td>{b.errorCount}</td>
                    <td>{b.excludedCount}</td>
                    <td>
                      <button className="del" onClick={() => removeBatch(b)} disabled={deleteBatch.isPending}>
                        取消
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            「取消」はその取込ぶんの受注データをまとめて削除します（間違えて取り込んだときのやり直し用）。
          </p>
        </div>
      )}

    </div>
  );
}
