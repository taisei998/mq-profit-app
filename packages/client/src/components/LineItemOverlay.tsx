import {
  FIELD_LABEL,
  FieldKey,
  GROUP_LABEL,
  GroupKey,
  LineItem,
  MaterialRecord,
  ShippingRateRecord,
  SiteFeeRecord,
  defaultDraftLines,
  feeLineAmount,
  isFeeField,
  isPointField,
  isTaxInclField,
  lineAmount,
  linesTotal,
  newLine,
  toNum,
} from '@ec-ai/shared';
import { useEffect, useMemo, useState } from 'react';
import { yen } from '../lib/format.js';

export interface OverlayTarget {
  groupKey: GroupKey;
  fieldKey: FieldKey;
  setIndex: number;
}

interface Props {
  target: OverlayTarget;
  initialLines: LineItem[];
  firstSetLines: LineItem[];
  priceTotal: number;
  netSales: number;
  sites: SiteFeeRecord[];
  ships: ShippingRateRecord[];
  materials: MaterialRecord[];
  onCancel: () => void;
  onConfirm: (lines: LineItem[]) => void;
}

export function LineItemOverlay({
  target,
  initialLines,
  firstSetLines,
  priceTotal,
  netSales,
  sites,
  ships,
  materials,
  onCancel,
  onConfirm,
}: Props) {
  const { fieldKey, setIndex, groupKey } = target;
  const incl = isTaxInclField(fieldKey);
  const point = isPointField(fieldKey);
  const fee = isFeeField(fieldKey);
  const noDesc = fieldKey === 'coupon' || fieldKey === 'price';
  const isCost = fieldKey === 'cost';

  const [draft, setDraft] = useState<LineItem[]>(() => seedDraft());
  const [shipQuery, setShipQuery] = useState('');
  const [matQuery, setMatQuery] = useState('');
  const [siteQuery, setSiteQuery] = useState('');

  function seedDraft(): LineItem[] {
    let base = initialLines.length
      ? JSON.parse(JSON.stringify(initialLines))
      : defaultDraftLines(fieldKey, setIndex);
    if (!point && !fee) base = base.map((ln: LineItem) => ({ ...ln, incl }));
    if (fee) base = base.map((ln: LineItem) => ({ ...ln, fee: true }));
    return base;
  }

  useEffect(() => {
    setDraft(seedDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.fieldKey, target.setIndex, target.groupKey]);

  function update(idx: number, patch: Partial<LineItem>) {
    setDraft((d) => d.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)));
  }
  function addLine() {
    setDraft((d) => [...d, newLine(fieldKey, setIndex)]);
  }
  function delLine(idx: number) {
    setDraft((d) => {
      const next = d.filter((_, i) => i !== idx);
      return next.length ? next : [newLine(fieldKey, setIndex)];
    });
  }

  function copyFromFirstSet() {
    if (!firstSetLines.length) return;
    if (fieldKey === 'price') {
      const qty = String(setIndex + 1);
      setDraft(firstSetLines.map((ln) => ({ unit: ln.unit, qty, incl: true })));
      return;
    }
    let next: LineItem[] = JSON.parse(JSON.stringify(firstSetLines));
    if (!point && !fee) next = next.map((ln) => ({ ...ln, incl }));
    if (fee) next = next.map((ln) => ({ ...ln, fee: true }));
    if (fieldKey === 'cost') {
      const qty = String(setIndex + 1);
      next = next.map((ln) => ({ ...ln, qty }));
    }
    setDraft(next);
  }

  function addShipLine(name: string) {
    const s = ships.find((x) => shipLabel(x) === name);
    if (!s) return;
    setDraft((d) => {
      const base = d.length === 1 && (!d[0].unit || String(d[0].unit).trim() === '') ? [] : d;
      return [...base, { desc: name, unit: String(s.unitPrice), tax: String(s.taxRate ?? 10), qty: '1' }];
    });
  }
  function addMatLine(m: MaterialRecord) {
    setDraft((d) => {
      const base = d.length === 1 && (!d[0].unit || String(d[0].unit).trim() === '') ? [] : d;
      return [...base, { desc: m.name, unit: String(m.unitPrice), tax: String(m.taxRate ?? 10), qty: '1' }];
    });
  }
  function addSiteFees(s: SiteFeeRecord) {
    setDraft((d) => {
      let base = d;
      if (d.length === 1 && toNum(d[0].pct) === null && (!d[0].desc || d[0].desc === 'サイト手数料')) base = [];
      const add: LineItem[] = [];
      if (s.fee != null) add.push({ desc: 'サイト手数料', pct: String(s.fee), ftax: '10', fee: true });
      if (s.couponFee != null) add.push({ desc: 'クーポン手数料', pct: String(s.couponFee), ftax: '10', fee: true });
      if (s.consultFee != null) add.push({ desc: 'コンサル手数料', pct: String(s.consultFee), ftax: '10', fee: true });
      (s.otherFees || []).forEach((f) => {
        if (f.pct != null) add.push({ desc: f.desc || 'その他手数料', pct: String(f.pct), ftax: '10', fee: true });
      });
      const result = [...base, ...add];
      return result.length ? result : [newLine('fee', setIndex)];
    });
  }

  const total = useMemo(() => {
    if (point) return (priceTotal * pointMultSumLocal(draft)) / 100;
    if (fee) return draft.reduce((s, ln) => s + feeLineAmount(ln, netSales), 0);
    return linesTotal(draft);
  }, [draft, point, fee, priceTotal, netSales]);

  const title = point ? '弊社負担分のポイント費用' : `${FIELD_LABEL[fieldKey]} の明細入力`;
  const ctx = point
    ? `${GROUP_LABEL[groupKey]}時 ／ ${setIndex + 1}セット ／ 販売金額(税込) ${yen(priceTotal)} × 倍率% を負担額として計算します`
    : fee
      ? `${GROUP_LABEL[groupKey]}時 ／ ${setIndex + 1}セット ／ クーポン値引き後の販売金額(税込) ${yen(netSales)} × ％ ×(1+税率%) で税込を自動算出します`
      : incl
        ? `${GROUP_LABEL[groupKey]}時 ／ ${setIndex + 1}セット ／ 税込単価×数量 を行ごとに合算します`
        : `${GROUP_LABEL[groupKey]}時 ／ ${setIndex + 1}セット ／ 税抜単価×(1+税率)×数量 を行ごとに合算します`;

  const totalLabel = point ? 'ポイント負担額 合計' : fee ? '手数料 合計' : '税込 合算';

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="sheet">
        <h3>{title}</h3>
        <div className="ctx">{ctx}</div>

        {setIndex >= 1 &&
          (firstSetLines.length > 0 ? (
            <button type="button" className="btn-ghost" style={{ width: '100%', marginBottom: 14 }} onClick={copyFromFirstSet}>
              📋 1セットの項目をコピー
            </button>
          ) : (
            <button type="button" className="btn-ghost" style={{ width: '100%', marginBottom: 14, opacity: 0.5, cursor: 'not-allowed' }} disabled>
              📋 1セットの項目をコピー（1セットが未入力です）
            </button>
          ))}

        {fieldKey === 'ship' && (
          <div style={{ marginBottom: 14 }}>
            <label>送料マスタから選ぶ</label>
            {ships.length === 0 ? (
              <div className="hint">送料マスタが未登録です。「マスタ → 送料マスタ」で登録できます。</div>
            ) : (
              <>
                <input placeholder="検索（配送会社・温度帯・箱サイズ）" value={shipQuery} onChange={(e) => setShipQuery(e.target.value)} style={{ marginBottom: 8 }} />
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
                  {ships
                    .filter((s) => matchShip(s, shipQuery))
                    .map((s) => (
                      <div key={s.id} className="ship-pick" onClick={() => addShipLine(shipLabel(s))}>
                        <span style={{ fontWeight: 700 }}>{shipLabel(s)}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                          税抜{yen(s.unitPrice)}・税率{s.taxRate}%
                        </span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        )}

        {fieldKey === 'material' && (
          <div style={{ marginBottom: 14 }}>
            <label>資材マスタから選ぶ</label>
            {materials.length === 0 ? (
              <div className="hint">資材マスタが未登録です。「マスタ → 資材マスタ」で登録できます。</div>
            ) : (
              <>
                <input placeholder="検索（資材名）" value={matQuery} onChange={(e) => setMatQuery(e.target.value)} style={{ marginBottom: 8 }} />
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
                  {materials
                    .filter((m) => m.name.toLowerCase().includes(matQuery.trim().toLowerCase()))
                    .map((m) => (
                      <div key={m.id} className="ship-pick" onClick={() => addMatLine(m)}>
                        <span style={{ fontWeight: 700 }}>{m.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                          税抜{yen(m.unitPrice)}・税率{m.taxRate}%
                        </span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        )}

        {fieldKey === 'fee' && (
          <div style={{ marginBottom: 14 }}>
            <label>サイトマスタから手数料を選ぶ</label>
            {sites.length === 0 ? (
              <div className="hint">手数料マスタが未登録です。「マスタ → 手数料マスタ」で登録できます。</div>
            ) : (
              <>
                <input placeholder="検索（サイト名）" value={siteQuery} onChange={(e) => setSiteQuery(e.target.value)} style={{ marginBottom: 8 }} />
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
                  {sites
                    .filter((s) => s.name.toLowerCase().includes(siteQuery.trim().toLowerCase()))
                    .map((s) => (
                      <div key={s.id} className="ship-pick" onClick={() => addSiteFees(s)}>
                        <span style={{ fontWeight: 700 }}>{s.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{siteFeeSummary(s) || '手数料未設定'}</span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="scroll">
          {point ? (
            <PointLinesTable draft={draft} priceTotal={priceTotal} onUpdate={update} onDelete={delLine} />
          ) : fee ? (
            <FeeLinesTable draft={draft} base={netSales} onUpdate={update} onDelete={delLine} />
          ) : (
            <NormalLinesTable draft={draft} incl={incl} noDesc={noDesc} isCost={isCost} onUpdate={update} onDelete={delLine} />
          )}
        </div>

        <button className="btn-ghost" style={{ marginTop: 12, width: '100%' }} onClick={addLine}>
          ＋ 明細行を追加
        </button>

        <div className="sheet-total">
          <div className="t-lbl">{totalLabel}</div>
          <div className="t-val">{yen(total)}</div>
        </div>
        <div className="sheet-actions">
          <button className="btn-ghost" onClick={onCancel}>
            キャンセル
          </button>
          <button className="btn" onClick={() => onConfirm(cleanDraft(draft, point, fee))}>
            この内容で確定
          </button>
        </div>
      </div>
    </div>
  );
}

function pointMultSumLocal(lines: LineItem[]): number {
  let s = 0;
  lines.forEach((ln) => {
    const m = toNum(ln.mult);
    if (m !== null) s += m;
  });
  return s;
}

function cleanDraft(draft: LineItem[], point: boolean, fee: boolean): LineItem[] {
  if (point) return draft.filter((ln) => toNum(ln.mult) !== null);
  if (fee) return draft.filter((ln) => toNum(ln.pct) !== null);
  return draft.filter((ln) => toNum(ln.unit) !== null);
}

function shipLabel(s: ShippingRateRecord): string {
  return [s.carrier, s.temp, s.size].filter((x) => x && x.trim() !== '').join('・') || '(無題)';
}
function matchShip(s: ShippingRateRecord, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const hay = [s.carrier, s.temp, s.size, shipLabel(s)].join(' ').toLowerCase();
  return hay.includes(query);
}
function siteFeeSummary(s: SiteFeeRecord): string {
  const items: string[] = [];
  if (s.fee != null) items.push(`サイト${s.fee}%`);
  if (s.couponFee != null) items.push(`クーポン${s.couponFee}%`);
  if (s.consultFee != null) items.push(`コンサル${s.consultFee}%`);
  (s.otherFees || []).forEach((f) => {
    if (f.pct != null) items.push(`${f.desc || 'その他'}${f.pct}%`);
  });
  return items.join('・');
}

function NormalLinesTable({
  draft,
  incl,
  noDesc,
  isCost,
  onUpdate,
  onDelete,
}: {
  draft: LineItem[];
  incl: boolean;
  noDesc: boolean;
  isCost: boolean;
  onUpdate: (idx: number, patch: Partial<LineItem>) => void;
  onDelete: (idx: number) => void;
}) {
  return (
    <table className="line-table">
      <thead>
        <tr>
          {!noDesc && <th style={{ width: '28%' }}>内容（任意）</th>}
          <th style={{ width: incl ? (noDesc ? '46%' : '24%') : '16%' }}>{incl ? '税込単価' : '税抜単価'}</th>
          {!incl && <th style={{ width: '12%' }}>税率%</th>}
          <th style={{ width: '12%' }}>数量</th>
          {isCost && <th style={{ width: '14%' }}>歩留まり%</th>}
          <th style={{ width: '14%', textAlign: 'right' }}>税込</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {draft.map((ln, idx) => (
          <tr key={idx}>
            {!noDesc && (
              <td>
                <input type="text" value={ln.desc || ''} placeholder="部材A など" onChange={(e) => onUpdate(idx, { desc: e.target.value })} />
              </td>
            )}
            <td>
              <input type="number" className="num" value={ln.unit || ''} placeholder="円" onChange={(e) => onUpdate(idx, { unit: e.target.value })} />
            </td>
            {!incl && (
              <td>
                <input type="number" className="num" value={ln.tax || ''} placeholder="%" onChange={(e) => onUpdate(idx, { tax: e.target.value })} />
              </td>
            )}
            <td>
              <input type="number" className="num" value={ln.qty || ''} placeholder="個" onChange={(e) => onUpdate(idx, { qty: e.target.value })} />
            </td>
            {isCost && (
              <td>
                <input type="number" className="num" value={ln.yld ?? '100'} placeholder="%" onChange={(e) => onUpdate(idx, { yld: e.target.value })} />
              </td>
            )}
            <td className="line-amt">{yen(lineAmount(ln))}</td>
            <td>
              <button type="button" className="row-del" onClick={() => onDelete(idx)}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PointLinesTable({
  draft,
  priceTotal,
  onUpdate,
  onDelete,
}: {
  draft: LineItem[];
  priceTotal: number;
  onUpdate: (idx: number, patch: Partial<LineItem>) => void;
  onDelete: (idx: number) => void;
}) {
  return (
    <table className="line-table">
      <thead>
        <tr>
          <th style={{ width: '55%' }}>倍率</th>
          <th style={{ width: '30%', textAlign: 'right' }}>負担額</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {draft.map((ln, idx) => {
          const amt = (priceTotal * (toNum(ln.mult) || 0)) / 100;
          return (
            <tr key={idx}>
              <td>
                <input type="number" className="num" value={ln.mult || ''} placeholder="倍" style={{ textAlign: 'right' }} onChange={(e) => onUpdate(idx, { mult: e.target.value })} />{' '}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>倍</span>
              </td>
              <td className="line-amt">{yen(amt)}</td>
              <td>
                <button type="button" className="row-del" onClick={() => onDelete(idx)}>
                  ×
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FeeLinesTable({
  draft,
  base,
  onUpdate,
  onDelete,
}: {
  draft: LineItem[];
  base: number;
  onUpdate: (idx: number, patch: Partial<LineItem>) => void;
  onDelete: (idx: number) => void;
}) {
  return (
    <table className="line-table">
      <thead>
        <tr>
          <th style={{ width: '34%' }}>内容</th>
          <th style={{ width: '20%' }}>パーセンテージ</th>
          <th style={{ width: '16%' }}>税率%</th>
          <th style={{ width: '22%', textAlign: 'right' }}>金額(自動)</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {draft.map((ln, idx) => (
          <tr key={idx}>
            <td>
              <input type="text" value={ln.desc || ''} placeholder="例: サイト手数料" onChange={(e) => onUpdate(idx, { desc: e.target.value })} />
            </td>
            <td>
              <input type="number" className="num" value={ln.pct || ''} placeholder="%" style={{ textAlign: 'right' }} onChange={(e) => onUpdate(idx, { pct: e.target.value })} />
            </td>
            <td>
              <input type="number" className="num" value={ln.ftax ?? '10'} placeholder="%" style={{ textAlign: 'right' }} onChange={(e) => onUpdate(idx, { ftax: e.target.value })} />
            </td>
            <td className="line-amt">{yen(feeLineAmount(ln, base))}</td>
            <td>
              <button type="button" className="row-del" onClick={() => onDelete(idx)}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
