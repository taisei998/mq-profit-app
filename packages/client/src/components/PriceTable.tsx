import { FIELDS, FieldKey, FieldLines, GroupData, isDirectField, linesTotal, toNum } from '@ec-ai/shared';
import { useEffect, useRef } from 'react';
import { yen, pct } from '../lib/format.js';

interface Props {
  lines: FieldLines;
  computed: GroupData;
  setCount: number;
  onDirectInput: (fieldKey: FieldKey, setIndex: number, value: string) => void;
  onOpenOverlay: (fieldKey: FieldKey, setIndex: number) => void;
}

const SET_LABELS = ['1セット', '2セット', '3セット', '4セット', '5セット'];

export function PriceTable({ lines, computed, setCount, onDirectInput, onOpenOverlay }: Props) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // 直接入力セル(価格・クーポン)の表示値を、フォーカス中でない限り同期する
  useEffect(() => {
    FIELDS.forEach((f) => {
      if (!isDirectField(f.key)) return;
      for (let i = 0; i < 5; i++) {
        const key = `${f.key}_${i}`;
        const el = inputRefs.current[key];
        if (!el || document.activeElement === el) continue;
        const ls = lines[f.key][i] || [];
        if (f.key === 'price') {
          el.value = ls.length ? String(Math.round(linesTotal(ls))) : '';
        } else {
          const unit = ls.length ? toNum(ls[0].unit) : null;
          el.value = unit === null ? '' : String(Math.round(unit));
        }
      }
    });
  }, [lines]);

  return (
    <table className="price-table">
      <thead>
        <tr>
          <th></th>
          {SET_LABELS.map((label, i) => (
            <th key={i} className={`col-${i + 1}`} style={{ display: i < setCount ? '' : 'none' }}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {FIELDS.map((f) => (
          <tr key={f.key}>
            <td className="lbl">
              {f.label}(円)
              {'tip' in f && f.tip && (
                <span className="tip" tabIndex={0} data-tip={f.tip}>
                  ?
                </span>
              )}
            </td>
            {Array.from({ length: 5 }).map((_, i) => (
              <td key={i} className={`col-${i + 1}`} style={{ display: i < setCount ? '' : 'none' }}>
                {isDirectField(f.key) ? (
                  <input
                    ref={(el) => (inputRefs.current[`${f.key}_${i}`] = el)}
                    type="number"
                    className="cell-input"
                    placeholder="¥0"
                    defaultValue=""
                    onChange={(e) => onDirectInput(f.key, i, e.target.value)}
                  />
                ) : (
                  <button
                    type="button"
                    className={`cell-btn ${(computed.fields[f.key][i] ?? 0) === 0 ? 'zero' : ''}`}
                    onClick={() => onOpenOverlay(f.key, i)}
                  >
                    {yen(computed.fields[f.key][i] ?? 0)}
                  </button>
                )}
              </td>
            ))}
          </tr>
        ))}
        <tr className="rate-row">
          <td className="lbl">粗利率(税込)</td>
          {Array.from({ length: 5 }).map((_, i) => (
            <td key={i} className={`rate-cell col-${i + 1}`} style={{ display: i < setCount ? '' : 'none' }}>
              {pct(computed.rates[i])}
            </td>
          ))}
        </tr>
        <tr className="sub-row">
          <td className="lbl">粗利率(税抜)</td>
          {Array.from({ length: 5 }).map((_, i) => (
            <td key={i} className={`sub-cell col-${i + 1}`} style={{ display: i < setCount ? '' : 'none' }}>
              {pct(computed.ratesEx[i])}
            </td>
          ))}
        </tr>
        <tr className="sub-row">
          <td className="lbl">粗利額(税込)</td>
          {Array.from({ length: 5 }).map((_, i) => (
            <td key={i} className={`sub-cell col-${i + 1}`} style={{ display: i < setCount ? '' : 'none' }}>
              {yen(computed.profits[i])}
            </td>
          ))}
        </tr>
        <tr className="sub-row">
          <td className="lbl">粗利額(税抜)</td>
          {Array.from({ length: 5 }).map((_, i) => (
            <td key={i} className={`sub-cell col-${i + 1}`} style={{ display: i < setCount ? '' : 'none' }}>
              {yen(computed.profitsEx[i])}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
