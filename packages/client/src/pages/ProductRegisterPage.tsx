import {
  CATEGORIES,
  Category,
  FieldKey,
  GroupData,
  GroupKey,
  ProductRecord,
  ProductStatus,
  applyDirectPriceInput,
  cloneGroup,
  computeGroupFromLines,
  emptyFieldLines,
  groupHasInput,
  linesTotal,
  toNum,
} from '@ec-ai/shared';
import { useEffect, useMemo, useState } from 'react';
import { LineItemOverlay, OverlayTarget } from '../components/LineItemOverlay.js';
import { PriceTable } from '../components/PriceTable.js';
import { useMalls, useMaterials, useProducts, useSaveProduct, useShipping, useShops, useSites } from '../lib/queries.js';

export interface LoadRequest {
  // 商品コードは店舗をまたぐと重複しうるため（#11）、レコードIDで指定する
  id: string;
  mode: 'edit' | 'duplicate';
}

interface Props {
  loadRequest: LoadRequest | null;
  onConsumedLoadRequest: () => void;
}

type FormState = Record<GroupKey, ReturnType<typeof emptyFieldLines>>;

function freshFormData(): FormState {
  return { normal: emptyFieldLines(), sale: emptyFieldLines(), coupon: emptyFieldLines() };
}

export function ProductRegisterPage({ loadRequest, onConsumedLoadRequest }: Props) {
  const { data: products } = useProducts();
  const { data: sites = [] } = useSites();
  const { data: ships = [] } = useShipping();
  const { data: materials = [] } = useMaterials();
  const { data: malls = [] } = useMalls();
  const { data: shops = [] } = useShops();
  const saveProduct = useSaveProduct();

  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [mallId, setMallId] = useState('');
  const [shopId, setShopId] = useState('');
  const [mgmtNo, setMgmtNo] = useState('');
  // 登録時のステータス。稟議そのものはジョブカンで回すので、ここでは「下書き」か「稟議申請」だけ選ぶ
  const [regStatus, setRegStatus] = useState<ProductStatus>('draft');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [spec, setSpec] = useState('');
  const [note, setNote] = useState('');
  const [priceTaxRate, setPriceTaxRate] = useState(10);
  const [setCount, setSetCount] = useState(5);
  const [mode, setMode] = useState<GroupKey>('normal');
  const [form, setForm] = useState<FormState>(freshFormData());
  const [overlayTarget, setOverlayTarget] = useState<OverlayTarget | null>(null);
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm' | 'done'>('input');

  const computed = useMemo<Record<GroupKey, GroupData>>(
    () => ({
      normal: computeGroupFromLines(form.normal, priceTaxRate),
      sale: computeGroupFromLines(form.sale, priceTaxRate),
      coupon: computeGroupFromLines(form.coupon, priceTaxRate),
    }),
    [form, priceTaxRate]
  );

  // 編集・複製リクエストの読み込み
  useEffect(() => {
    if (!loadRequest || !products) return;
    const p = products.find((x) => x.id === loadRequest.id);
    if (!p) {
      onConsumedLoadRequest();
      return;
    }
    loadIntoForm(p);
    if (loadRequest.mode === 'edit') {
      setCode(p.code);
      setEditingExisting(true);
      setStatus({
        text: `「${p.productId} / ${p.mallName} ＞ ${p.shopName} / ${p.code}」を編集中です。修正して「この商品を登録」で上書きされます。`,
        type: 'ok',
      });
    } else {
      setCode(p.code + '_copy');
      setEditingExisting(false);
      setStatus({
        text: `「${p.mallName} ＞ ${p.shopName} / ${p.code}」を複製しました。商品コードを変えるか、別の店舗を選んで「この商品を登録」を押すと新規登録されます。`,
        type: 'ok',
      });
    }
    onConsumedLoadRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRequest, products]);

  function loadIntoForm(p: ProductRecord) {
    setForm({
      normal: p.normal.lines,
      sale: p.sale.lines,
      coupon: p.coupon.lines,
    });
    setCategory((p.category as Category) || CATEGORIES[CATEGORIES.length - 1]);
    setPriceTaxRate(p.priceTaxRate ?? 10);
    setSetCount(p.setCount ?? 5);
    setName(p.name || '');
    setSpec(p.spec || '');
    setNote(p.note || '');
    setMallId(p.mallId || '');
    setShopId(p.shopId || '');
    setMgmtNo(p.mgmtNo || '');
    setRegStatus(p.status || 'draft');
    setMode('normal');
  }

  function resetForm() {
    setCode('');
    setMgmtNo('');
    setRegStatus('draft');
    setName('');
    setSpec('');
    setNote('');
    setCategory(CATEGORIES[0]);
    setPriceTaxRate(10);
    setSetCount(5);
    setForm(freshFormData());
    setMode('normal');
    setEditingExisting(false);
  }

  // 商品名サジェスト（UIデザイン案 2/5）。過去に登録した商品名から前方・部分一致で候補を出す。
  const nameSuggestions = useMemo(() => {
    const q = name.trim();
    if (!q || !products) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of products) {
      const n = (p.name || '').trim();
      if (!n || n === q || seen.has(n)) continue;
      if (!n.includes(q)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= 6) break;
    }
    return out;
  }, [name, products]);

  function updateGroupLines(groupKey: GroupKey, fieldKey: FieldKey, setIndex: number, newLines: any) {
    setForm((f) => ({
      ...f,
      [groupKey]: {
        ...f[groupKey],
        [fieldKey]: f[groupKey][fieldKey].map((ls: any, i: number) => (i === setIndex ? newLines : ls)),
      },
    }));
  }

  function handleDirectInput(groupKey: GroupKey, fieldKey: FieldKey, setIndex: number, value: string) {
    const v = toNum(value);
    setForm((f) => {
      const groupLines = { ...f[groupKey], [fieldKey]: f[groupKey][fieldKey].map((ls: any) => ls) };
      if (fieldKey === 'price') {
        groupLines.price = applyDirectPriceInput(groupLines.price, setIndex, value);
      } else {
        groupLines[fieldKey][setIndex] = v === null ? [] : [{ unit: String(v), qty: '1', incl: true }];
      }
      return { ...f, [groupKey]: groupLines };
    });
  }

  function openOverlay(fieldKey: FieldKey, setIndex: number) {
    setOverlayTarget({ groupKey: mode, fieldKey, setIndex });
  }

  function closeOverlay() {
    setOverlayTarget(null);
  }

  function confirmOverlay(lines: any) {
    if (!overlayTarget) return;
    updateGroupLines(overlayTarget.groupKey, overlayTarget.fieldKey, overlayTarget.setIndex, lines);
    setOverlayTarget(null);
  }

  function copyFromNormal(target: 'sale' | 'coupon') {
    if (!groupHasInput(form.normal)) {
      setStatus({ text: '先に「通常時」を入力してください。', type: 'err' });
      setMode('normal');
      return;
    }
    setForm((f) => ({ ...f, [target]: JSON.parse(JSON.stringify(f.normal)) }));
    setStatus({ text: `✅ 通常時の入力を${target === 'sale' ? 'SALE時' : 'SALE＋クーポン時'}にコピーしました。必要な箇所だけ修正してください。`, type: 'ok' });
  }

  async function handleSubmit() {
    setStep('confirm');
    if (!shopId) {
      setStatus({ text: 'モールと店舗を選んでください。', type: 'err' });
      return;
    }
    if (!code.trim()) {
      setStatus({ text: '商品コードを入力してください。', type: 'err' });
      return;
    }
    if (!groupHasInput(form.normal)) {
      setStatus({ text: '「通常時」1セットの販売金額を入力してください（マスをタップして明細入力）。', type: 'err' });
      setMode('normal');
      return;
    }
    try {
      const saleHasInput = groupHasInput(form.sale);
      const couponHasInput = groupHasInput(form.coupon);
      const saved = await saveProduct.mutateAsync({
        shopId,
        mgmtNo: mgmtNo.trim(),
        status: regStatus,
        code: code.trim(),
        name: name.trim(),
        spec: spec.trim(),
        note: note.trim(),
        category,
        priceTaxRate,
        setCount,
        normalLines: form.normal,
        saleLines: saleHasInput ? form.sale : undefined,
        couponLines: couponHasInput ? form.coupon : undefined,
      });
      setStatus({
        text: `✅ ${saved.productId} / ${saved.mallName} ＞ ${saved.shopName} / ${saved.code}${saved.name ? `（${saved.name}）` : ''} を登録しました。「商品一覧」で確認できます。`,
        type: 'ok',
      });
      setStep('done');
      resetForm();
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : '登録に失敗しました。', type: 'err' });
    }
  }

  // モールを選ぶと、その配下の店舗だけが選べるようになる（設計書§5.4のモール→店舗の流れに合わせた）
  const shopsOfMall = shops.filter((sh) => sh.mallId === mallId);

  function changeMall(id: string) {
    setMallId(id);
    // モールを変えたら店舗は選び直し。ただし1件しか無ければ自動で選ぶ
    const candidates = shops.filter((sh) => sh.mallId === id);
    setShopId(candidates.length === 1 ? candidates[0].id : '');
  }

  const activeLines = form[mode];
  const activeComputed = computed[mode];
  const overlayContext = overlayTarget
    ? {
        priceTotal: linesTotal(form[overlayTarget.groupKey].price[overlayTarget.setIndex]),
        netSales:
          linesTotal(form[overlayTarget.groupKey].price[overlayTarget.setIndex]) -
          linesTotal(form[overlayTarget.groupKey].coupon[overlayTarget.setIndex]),
        initialLines: form[overlayTarget.groupKey][overlayTarget.fieldKey][overlayTarget.setIndex] || [],
        firstSetLines: form[overlayTarget.groupKey][overlayTarget.fieldKey][0] || [],
      }
    : null;

  return (
    <div className="card" id="pane2">
      <h2>粗利作成（＋商品登録）</h2>
      {/* UIデザイン案 2/5 のステップ表示。登録が終わると「登録完了」まで進む */}
      <div className="steps">
        <span className={`step ${step === 'input' ? 'on' : 'done'}`}>新規登録</span>
        <span className="step-sep">›</span>
        <span className={`step ${step === 'confirm' ? 'on' : step === 'done' ? 'done' : ''}`}>内容確認</span>
        <span className="step-sep">›</span>
        <span className={`step ${step === 'done' ? 'on' : ''}`}>登録完了</span>
      </div>
      {shops.length === 0 && (
        <div className="status err" style={{ marginBottom: 14 }}>
          店舗が登録されていないため商品を登録できません。先に「マスタ ＞ 店舗マスタ」で店舗を登録してください。
          （商品コードはモール・店舗ごとに異なるため、どの店舗の商品かを指定する必要があります）
        </div>
      )}
      <div className="reg-head">
        <div className="reg-grid">
          <div>
            <label>モール</label>
            <select value={mallId} onChange={(e) => changeMall(e.target.value)}>
              <option value="">（選択してください）</option>
              {malls.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>店舗</label>
            <select value={shopId} onChange={(e) => setShopId(e.target.value)} disabled={!mallId}>
              <option value="">{mallId && shopsOfMall.length === 0 ? '（このモールに店舗がありません）' : '（選択してください）'}</option>
              {shopsOfMall.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>管理番号</label>
            <input value={mgmtNo} onChange={(e) => setMgmtNo(e.target.value)} placeholder="例: MZ0001" />
          </div>
          <div>
            <label>カテゴリ</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c, i) => (
                <option key={c} value={c}>
                  {i + 1}. {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>商品コード</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="例: A-001" />
          </div>
          <div className="suggest-wrap">
            <label>商品名</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setStep('input');
              }}
              placeholder="例: プレミアムサプリ"
            />
            {nameSuggestions.length > 0 && (
              <div className="suggest-box">
                {nameSuggestions.map((n) => (
                  <button key={n} type="button" className="suggest-item" onClick={() => setName(n)}>
                    🔍 {n}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label>規格</label>
            <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="例: 5kg" />
          </div>
        </div>
        <div className="reg-note">
          <label>備考</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="おまけなどがあった場合はこちらに記入(2+1,3+2など)" />
        </div>
      </div>

      <p className="hint" style={{ marginBottom: 10 }}>
        各金額のマスをタップすると、税抜単価・税率・数量を明細で入力できます（複数行の積み上げ可）。
        入力すると税込の合算値がマスに表示され、粗利率が自動計算されます。
        複数セットを空欄にした場合は、その区分の1セット時の値が使われます。
      </p>

      <div className="seg">
        <button className={mode === 'normal' ? 'on-normal' : ''} onClick={() => setMode('normal')}>
          通常時
        </button>
        <button className={mode === 'sale' ? 'on-sale' : ''} onClick={() => setMode('sale')}>
          SALE時
        </button>
        <button className={mode === 'coupon' ? 'on-coupon' : ''} onClick={() => setMode('coupon')}>
          SALE＋クーポン時
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ maxWidth: 200 }}>
          <label>販売金額の税率（全セット共通）</label>
          <select value={priceTaxRate} onChange={(e) => setPriceTaxRate(Number(e.target.value))}>
            <option value={10}>10%</option>
            <option value={8}>8%（軽減税率）</option>
            <option value={0}>0%（非課税）</option>
          </select>
        </div>
        <div style={{ maxWidth: 160 }}>
          <label>セット数</label>
          <select value={setCount} onChange={(e) => setSetCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}セット
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={mode === 'sale' ? 'pane-sale' : mode === 'coupon' ? 'pane-coupon' : ''}>
        <div className={`grp-title grp-${mode}`}>
          <span className="legend" style={{ background: mode === 'normal' ? 'var(--accent)' : mode === 'sale' ? 'var(--sale)' : 'var(--coupon)' }}></span>
          {mode === 'normal' ? '通常時' : mode === 'sale' ? 'SALE時' : 'SALE＋クーポン時'}の価格・粗利率
        </div>
        {mode !== 'normal' && (
          <button type="button" className="btn-ghost" style={{ width: '100%', marginBottom: 12 }} onClick={() => copyFromNormal(mode)}>
            📋 通常時の入力を全部コピー
          </button>
        )}
        <div className="scroll">
          <PriceTable
            lines={activeLines}
            computed={activeComputed}
            setCount={setCount}
            onDirectInput={(fieldKey, i, value) => handleDirectInput(mode, fieldKey, i, value)}
            onOpenOverlay={openOverlay}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 14, maxWidth: 460 }}>
        <div>
          <label>登録時のステータス</label>
          <select value={regStatus} onChange={(e) => setRegStatus(e.target.value as ProductStatus)}>
            <option value="draft">下書き（まだ申請しない）</option>
            <option value="pending">稟議申請（ジョブカンで稟議を出したもの）</option>
          </select>
        </div>
      </div>
      <p className="hint">
        稟議そのものはジョブカンで回します。ここでは「今どの段階か」を記録するだけです。
        承認・却下の反映は「商品一覧」から行えます。
      </p>

      <div className="csv-row" style={{ marginTop: 6 }}>
        <button className="btn" onClick={handleSubmit} disabled={saveProduct.isPending}>
          {editingExisting ? 'この商品を上書き登録' : 'この商品を登録'}
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            resetForm();
            setStep('input');
            setStatus(null);
          }}
        >
          入力内容をクリア
        </button>
      </div>
      {status && <div className={`status ${status.type}`}>{status.text}</div>}

      {overlayTarget && overlayContext && (
        <LineItemOverlay
          target={overlayTarget}
          initialLines={overlayContext.initialLines}
          firstSetLines={overlayContext.firstSetLines}
          priceTotal={overlayContext.priceTotal}
          netSales={overlayContext.netSales}
          sites={sites}
          ships={ships}
          materials={materials}
          onCancel={closeOverlay}
          onConfirm={confirmOverlay}
        />
      )}
    </div>
  );
}
