import { MallRecord, MaterialRecord, ShippingRateRecord, ShopRecord, SiteFeeOther, SiteFeeRecord } from '@ec-ai/shared';
import { useState } from 'react';
import { yen } from '../lib/format.js';
import {
  useDeleteMall,
  useDeleteMaterial,
  useDeleteShipping,
  useDeleteShop,
  useDeleteSite,
  useMalls,
  useMaterials,
  useSaveMall,
  useSaveMaterial,
  useSaveShipping,
  useSaveShop,
  useSaveSite,
  useShipping,
  useShops,
  useSites,
} from '../lib/queries.js';

type SubTab = 'site' | 'ship' | 'mat' | 'mall' | 'shop';

export function MasterPage() {
  const [sub, setSub] = useState<SubTab>('ship');
  return (
    <div className="card" id="pane4">
      <h2>マスタ管理</h2>
      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
        これらのマスタは「粗利作成」画面から参照され、入力の手間を最小化します。
      </p>
      {/* タブの並び順・名称はUIデザイン案 5/5 に合わせている（手数料マスタ＝旧サイトマスタ） */}
      <div className="seg" style={{ marginBottom: 18 }}>
        <button className={sub === 'ship' ? 'on-normal' : ''} onClick={() => setSub('ship')}>
          送料マスタ
        </button>
        <button className={sub === 'mat' ? 'on-normal' : ''} onClick={() => setSub('mat')}>
          資材マスタ
        </button>
        <button className={sub === 'site' ? 'on-normal' : ''} onClick={() => setSub('site')}>
          手数料マスタ
        </button>
        <button className={sub === 'mall' ? 'on-normal' : ''} onClick={() => setSub('mall')}>
          モールマスタ
        </button>
        <button className={sub === 'shop' ? 'on-normal' : ''} onClick={() => setSub('shop')}>
          店舗マスタ
        </button>
      </div>
      {sub === 'site' && <SiteMaster />}
      {sub === 'ship' && <ShipMaster />}
      {sub === 'mat' && <MatMaster />}
      {sub === 'mall' && <MallMaster />}
      {sub === 'shop' && <ShopMaster />}
    </div>
  );
}

function statusBox(status: { text: string; type: 'ok' | 'err' } | null) {
  return status ? <div className={`status ${status.type}`}>{status.text}</div> : null;
}

function SiteMaster() {
  const { data: sites = [] } = useSites();
  const saveSite = useSaveSite();
  const deleteSite = useDeleteSite();
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [couponFee, setCouponFee] = useState('');
  const [consultFee, setConsultFee] = useState('');
  const [note, setNote] = useState('');
  const [others, setOthers] = useState<SiteFeeOther[]>([]);
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  function reset() {
    setName('');
    setFee('');
    setCouponFee('');
    setConsultFee('');
    setNote('');
    setOthers([]);
  }

  function edit(s: SiteFeeRecord) {
    setName(s.name);
    setFee(s.fee != null ? String(s.fee) : '');
    setCouponFee(s.couponFee != null ? String(s.couponFee) : '');
    setConsultFee(s.consultFee != null ? String(s.consultFee) : '');
    setNote(s.note || '');
    setOthers(s.otherFees || []);
    setStatus({ text: `「${s.name}」を編集中です。内容を直して「このサイトを登録」で上書きされます。`, type: 'ok' });
  }

  async function save() {
    if (!name.trim()) {
      setStatus({ text: 'サイト名を入力してください。', type: 'err' });
      return;
    }
    await saveSite.mutateAsync({
      name: name.trim(),
      fee: fee.trim() === '' ? null : Number(fee),
      couponFee: couponFee.trim() === '' ? null : Number(couponFee),
      consultFee: consultFee.trim() === '' ? null : Number(consultFee),
      otherFees: others.filter((o) => o.desc.trim() !== '' || o.pct != null),
      note: note.trim(),
    });
    setStatus({ text: `✅ サイト「${name.trim()}」を登録しました。`, type: 'ok' });
    reset();
  }

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        モール（サイト）ごとの手数料率を登録しておけます。「粗利作成」の「手数料」明細でこのサイトを選ぶと、登録した手数料がまとめて明細に追加されます。
      </p>
      <div className="row">
        <div>
          <label>サイト名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 楽天市場" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>サイト手数料（%）</label>
          <input type="number" step="0.01" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="例: 3.5" />
        </div>
        <div>
          <label>クーポン手数料（%）</label>
          <input type="number" step="0.01" min={0} value={couponFee} onChange={(e) => setCouponFee(e.target.value)} placeholder="例: 1.0" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>コンサル手数料（%）</label>
          <input type="number" step="0.01" min={0} value={consultFee} onChange={(e) => setConsultFee(e.target.value)} placeholder="例: 2.0" />
        </div>
      </div>
      <div>
        <label>その他手数料（項目を追加できます）</label>
        {others.length === 0 ? (
          <p className="hint">まだ項目がありません。「＋ その他手数料の項目を追加」で追加してください。</p>
        ) : (
          others.map((o, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input
                type="text"
                value={o.desc}
                onChange={(e) => setOthers((arr) => arr.map((x, i) => (i === idx ? { ...x, desc: e.target.value } : x)))}
                placeholder="内容（例: 支援金）"
                style={{ flex: 2 }}
              />
              <input
                type="number"
                step="0.01"
                value={o.pct ?? ''}
                onChange={(e) => setOthers((arr) => arr.map((x, i) => (i === idx ? { ...x, pct: e.target.value === '' ? null : Number(e.target.value) } : x)))}
                placeholder="%"
                style={{ flex: 1 }}
              />
              <button type="button" className="row-del" onClick={() => setOthers((arr) => arr.filter((_, i) => i !== idx))}>
                ×
              </button>
            </div>
          ))
        )}
        <button type="button" className="btn-ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setOthers((arr) => [...arr, { desc: '', pct: null }])}>
          ＋ その他手数料の項目を追加
        </button>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <div style={{ flex: '1 1 100%' }}>
          <label>備考</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ・注意事項など自由に記入" />
        </div>
      </div>
      <button className="btn" onClick={save} disabled={saveSite.isPending}>
        このサイトを登録
      </button>
      {statusBox(status)}

      {sites.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="table-title">登録済み {sites.length} 件</div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>サイト名</th>
                  <th>サイト手数料</th>
                  <th>クーポン手数料</th>
                  <th>コンサル手数料</th>
                  <th>その他</th>
                  <th>備考</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>{s.name}</td>
                    <td>{s.fee != null ? `${s.fee}%` : '—'}</td>
                    <td>{s.couponFee != null ? `${s.couponFee}%` : '—'}</td>
                    <td>{s.consultFee != null ? `${s.consultFee}%` : '—'}</td>
                    <td style={{ textAlign: 'left' }}>
                      {(s.otherFees || []).length
                        ? s.otherFees.map((f, i) => (
                            <div key={i}>
                              {f.desc} {f.pct != null ? `${f.pct}%` : ''}
                            </div>
                          ))
                        : '—'}
                    </td>
                    <td style={{ textAlign: 'left' }}>{s.note || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="mini" onClick={() => edit(s)}>
                        編集
                      </button>{' '}
                      <button className="del" onClick={() => deleteSite.mutate(s.id)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ShipMaster() {
  const { data: ships = [] } = useShipping();
  const saveShip = useSaveShipping();
  const deleteShip = useDeleteShipping();
  const [carrier, setCarrier] = useState('');
  const [temp, setTemp] = useState('常温便');
  const [size, setSize] = useState('');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('10');
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  async function save() {
    if (!carrier.trim() && !temp.trim() && !size.trim()) {
      setStatus({ text: '配送会社・温度帯・箱サイズのいずれかを入力してください。', type: 'err' });
      return;
    }
    if (amount.trim() === '') {
      setStatus({ text: '金額（税抜）を入力してください。', type: 'err' });
      return;
    }
    const label = [carrier, temp, size].filter((x) => x.trim() !== '').join('・') || '(無題)';
    await saveShip.mutateAsync({ carrier, temp, size, unitPrice: Number(amount), taxRate: tax.trim() === '' ? 10 : Number(tax) });
    setStatus({ text: `✅ 送料「${label}」を登録しました。`, type: 'ok' });
    setCarrier('');
    setSize('');
    setAmount('');
    setTemp('常温便');
    setTax('10');
  }

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        送料を登録しておくと、「粗利作成」の「発送運賃」明細で選んで金額を入れられます。税込は税抜単価×(1+税率%)で自動計算します。
      </p>
      <div className="row">
        <div>
          <label>配送会社</label>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="例: ヤマト運輸" />
        </div>
        <div>
          <label>温度帯</label>
          <select value={temp} onChange={(e) => setTemp(e.target.value)}>
            <option value="常温便">常温便</option>
            <option value="クール便">クール便</option>
            <option value="その他">その他</option>
          </select>
        </div>
        <div>
          <label>箱サイズ</label>
          <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="例: 60サイズ" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>金額（税抜・円）</label>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例: 800" />
        </div>
        <div>
          <label>税率%</label>
          <input type="number" min={0} value={tax} onChange={(e) => setTax(e.target.value)} placeholder="例: 10" />
        </div>
      </div>
      <button className="btn" onClick={save} disabled={saveShip.isPending}>
        この送料を登録
      </button>
      {statusBox(status)}

      {ships.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="table-title">登録済み {ships.length} 件</div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>配送会社</th>
                  <th>温度帯</th>
                  <th>箱サイズ</th>
                  <th>税抜単価</th>
                  <th>税率%</th>
                  <th>税込</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {ships.map((s: ShippingRateRecord) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: 'left' }}>{s.carrier || '—'}</td>
                    <td style={{ textAlign: 'left' }}>{s.temp || '—'}</td>
                    <td style={{ textAlign: 'left' }}>{s.size || '—'}</td>
                    <td>{yen(s.unitPrice)}</td>
                    <td>{s.taxRate}%</td>
                    <td>{yen(Math.round(s.unitPrice * (1 + s.taxRate / 100)))}</td>
                    <td>
                      <button className="del" onClick={() => deleteShip.mutate(s.id)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MatMaster() {
  const { data: materials = [] } = useMaterials();
  const saveMat = useSaveMaterial();
  const deleteMat = useDeleteMaterial();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [tax, setTax] = useState('10');
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  async function save() {
    if (!name.trim()) {
      setStatus({ text: '資材名を入力してください。', type: 'err' });
      return;
    }
    if (unit.trim() === '') {
      setStatus({ text: '税抜単価を入力してください。', type: 'err' });
      return;
    }
    await saveMat.mutateAsync({ name: name.trim(), unitPrice: Number(unit), taxRate: tax.trim() === '' ? 10 : Number(tax) });
    setStatus({ text: `✅ 資材「${name.trim()}」を登録しました。`, type: 'ok' });
    setName('');
    setUnit('');
    setTax('10');
  }

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        資材を登録できます（税込は税抜単価×(1+税率%)で自動計算）。
      </p>
      <div className="row">
        <div>
          <label>資材名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 宅配袋A4" />
        </div>
        <div>
          <label>税抜単価（円）</label>
          <input type="number" min={0} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="例: 30" />
        </div>
        <div>
          <label>税率%</label>
          <input type="number" min={0} value={tax} onChange={(e) => setTax(e.target.value)} placeholder="例: 10" />
        </div>
      </div>
      <button className="btn" onClick={save} disabled={saveMat.isPending}>
        この資材を登録
      </button>
      {statusBox(status)}

      {materials.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="table-title">登録済み {materials.length} 件</div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>資材名</th>
                  <th>税抜単価</th>
                  <th>税率%</th>
                  <th>税込</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m: MaterialRecord) => (
                  <tr key={m.id}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>{m.name}</td>
                    <td>{yen(m.unitPrice)}</td>
                    <td>{m.taxRate}%</td>
                    <td>{yen(Math.round(m.unitPrice * (1 + m.taxRate / 100)))}</td>
                    <td>
                      <button className="del" onClick={() => deleteMat.mutate(m.id)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ④モールマスタ。楽天市場・Yahoo!ショッピング・au PAY マーケット・Amazon・自社EC など。
// 店舗マスタの親であり、商品や受注の集計軸にもなる。
function MallMaster() {
  const { data: malls = [] } = useMalls();
  const saveMall = useSaveMall();
  const deleteMall = useDeleteMall();
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('');
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  async function save() {
    const n = name.trim();
    if (!n) {
      setStatus({ text: 'モール名を入力してください。', type: 'err' });
      return;
    }
    try {
      await saveMall.mutateAsync({ name: n, sortOrder: sortOrder.trim() === '' ? 0 : Number(sortOrder) });
      setStatus({ text: `✅ モール「${n}」を登録しました。`, type: 'ok' });
      setName('');
      setSortOrder('');
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '登録に失敗しました。', type: 'err' });
    }
  }

  async function remove(m: MallRecord) {
    try {
      await deleteMall.mutateAsync(m.id);
      setStatus({ text: `モール「${m.name}」を削除しました。`, type: 'ok' });
    } catch (err) {
      // 店舗がぶら下がっているモールはサーバー側で弾かれる
      setStatus({ text: err instanceof Error ? err.message : '削除に失敗しました。', type: 'err' });
    }
  }

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        出店しているモールを登録します。ここで登録したモールが、店舗マスタの選択肢になります。
        同じ名前で登録すると上書きされます。表示順は小さいほど先に出ます。
      </p>
      <div className="row">
        <div>
          <label>モール名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 楽天市場" />
        </div>
        <div>
          <label>表示順</label>
          <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="例: 1" />
        </div>
      </div>
      <button className="btn" onClick={save} disabled={saveMall.isPending}>
        このモールを登録
      </button>
      {statusBox(status)}

      {malls.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="table-title">登録済み {malls.length} 件</div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>表示順</th>
                  <th>モール名</th>
                  <th>店舗数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {malls.map((m: MallRecord) => (
                  <tr key={m.id}>
                    <td>{m.sortOrder}</td>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>{m.name}</td>
                    <td>{m.shopCount}</td>
                    <td>
                      <button className="del" onClick={() => remove(m)} disabled={deleteMall.isPending}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            店舗が登録されているモールは削除できません。先に⑤店舗マスタから店舗を削除してください。
          </p>
        </div>
      )}
    </div>
  );
}

// ⑤店舗マスタ。1つのモールに複数店舗がぶら下がる（例: 楽天市場に「くまもと風土」「ご当地風土」…）。
function ShopMaster() {
  const { data: malls = [] } = useMalls();
  const { data: shops = [] } = useShops();
  const saveShop = useSaveShop();
  const deleteShop = useDeleteShop();
  const [mallId, setMallId] = useState('');
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('');
  const [status, setStatus] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  async function save() {
    const n = name.trim();
    if (!mallId) {
      setStatus({ text: 'モールを選んでください。', type: 'err' });
      return;
    }
    if (!n) {
      setStatus({ text: '店舗名を入力してください。', type: 'err' });
      return;
    }
    try {
      await saveShop.mutateAsync({ mallId, name: n, sortOrder: sortOrder.trim() === '' ? 0 : Number(sortOrder) });
      setStatus({ text: `✅ 店舗「${n}」を登録しました。`, type: 'ok' });
      setName('');
      setSortOrder('');
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '登録に失敗しました。', type: 'err' });
    }
  }

  async function remove(s: ShopRecord) {
    try {
      await deleteShop.mutateAsync(s.id);
      setStatus({ text: `店舗「${s.name}」を削除しました。`, type: 'ok' });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : '削除に失敗しました。', type: 'err' });
    }
  }

  if (malls.length === 0) {
    return (
      <div>
        <p className="hint">
          先に④モールマスタでモールを登録してください。店舗はモールにぶら下がる形で登録します。
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        モールごとの出店店舗を登録します（例: 楽天市場 ＞ くまもと風土）。
        同じモール内で同じ名前を登録すると上書きされます。
      </p>
      <div className="row">
        <div>
          <label>モール</label>
          <select value={mallId} onChange={(e) => setMallId(e.target.value)}>
            <option value="">（選択してください）</option>
            {malls.map((m: MallRecord) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>店舗名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: くまもと風土" />
        </div>
        <div>
          <label>表示順</label>
          <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="例: 1" />
        </div>
      </div>
      <button className="btn" onClick={save} disabled={saveShop.isPending}>
        この店舗を登録
      </button>
      {statusBox(status)}

      {shops.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="table-title">登録済み {shops.length} 件</div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>モール</th>
                  <th>表示順</th>
                  <th>店舗名</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((s: ShopRecord) => (
                  <tr key={s.id}>
                    <td>{s.mallName}</td>
                    <td>{s.sortOrder}</td>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>{s.name}</td>
                    <td>
                      <button className="del" onClick={() => remove(s)} disabled={deleteShop.isPending}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
