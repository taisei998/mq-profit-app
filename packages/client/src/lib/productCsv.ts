import { FIELDS, FieldLines, GROUPS, GROUP_LABEL, GroupKey, ProductRecord, emptyFieldLines, parseCSVLine, splitLines } from '@ec-ai/shared';
import type { ProductInputPayload } from './api.js';
import { downloadCSV } from './file.js';

export function exportProductsCSV(products: ProductRecord[]): void {
  const head = ['固有ID', '管理番号', 'モール', '店舗', '商品コード', '商品名', '規格', '備考', 'カテゴリ', '販売税率', '区分'];
  FIELDS.forEach((f) => {
    for (let i = 1; i <= 5; i++) head.push(`${f.label}${i}set`);
  });
  for (let i = 1; i <= 5; i++) head.push(`粗利率${i}set`);
  head.push('明細JSON');

  const rows: Array<Array<string | number>> = [head];
  products.forEach((p) => {
    GROUPS.forEach((g) => {
      const grp = p[g];
      const row: Array<string | number> = [
        p.productId || '',
        p.mgmtNo || '',
        p.mallName || '',
        p.shopName || '',
        p.code,
        p.name,
        p.spec || '',
        p.note || '',
        p.category || '',
        p.priceTaxRate ?? 10,
        GROUP_LABEL[g],
      ];
      FIELDS.forEach((f) => {
        grp.fields[f.key].forEach((v) => row.push(v == null ? '' : Math.round(v)));
      });
      grp.rates.forEach((r) => row.push(r == null ? '' : r.toFixed(1)));
      row.push(JSON.stringify(grp.lines || {}));
      rows.push(row);
    });
  });
  downloadCSV(rows, 'MQ率_商品マスター.csv');
}

export interface ImportedProduct {
  mgmtNo: string;
  code: string;
  name: string;
  spec: string;
  note: string;
  category: string;
  priceTaxRate: number;
  setCount: number;
  normalLines?: FieldLines;
  saleLines?: FieldLines;
  couponLines?: FieldLines;
}

function classifyGroupLabel(text: string): GroupKey {
  if (text.indexOf('クーポン') !== -1) return 'coupon';
  if (text.indexOf('SALE') !== -1 || text.indexOf('セール') !== -1) return 'sale';
  return 'normal';
}

// 本アプリが出力したCSV（明細JSON列つき）を取り込む。
// 商品コードは「店舗＋コード」で一意なので、どの店舗に取り込むかは呼び出し側（画面）で選んでもらう。
// CSVのモール／店舗列は参考情報として出力しているだけで、取込先の決定には使わない。
export function parseProductsCSV(text: string, shopId: string): ProductInputPayload[] {
  const lines = splitLines(text);
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.trim());
  const idIdx = header.indexOf('固有ID');
  const mgmtIdx = header.indexOf('管理番号');
  const codeIdx = header.indexOf('商品コード');
  const nameIdx = header.indexOf('商品名');
  const specIdx = header.indexOf('規格');
  const noteIdx = header.indexOf('備考');
  const catIdx = header.indexOf('カテゴリ');
  const ptaxIdx = header.indexOf('販売税率');
  const kindIdx = header.indexOf('区分');
  const jsonIdx = header.indexOf('明細JSON');
  if (codeIdx === -1 || kindIdx === -1 || jsonIdx === -1) {
    throw new Error('このCSVの形式を認識できません。「商品一覧」からエクスポートしたCSVを使用してください。');
  }

  const byCode = new Map<string, ImportedProduct>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const code = (cols[codeIdx] || '').trim();
    if (!code) continue;
    let entry = byCode.get(code);
    if (!entry) {
      entry = {
        mgmtNo: mgmtIdx !== -1 ? (cols[mgmtIdx] || '').trim() : '',
        code,
        name: (cols[nameIdx] || '').trim(),
        spec: specIdx !== -1 ? (cols[specIdx] || '').trim() : '',
        note: noteIdx !== -1 ? (cols[noteIdx] || '').trim() : '',
        category: catIdx !== -1 ? (cols[catIdx] || '').trim() || 'その他' : 'その他',
        priceTaxRate: ptaxIdx !== -1 ? Number(cols[ptaxIdx] || 10) : 10,
        setCount: 5,
      };
      byCode.set(code, entry);
    }
    const kind = classifyGroupLabel(cols[kindIdx] || '');
    let parsedLines: FieldLines = emptyFieldLines();
    try {
      const raw = JSON.parse(cols[jsonIdx] || '{}');
      parsedLines = { ...emptyFieldLines(), ...raw };
    } catch {
      // 壊れたJSONは空明細として扱う
    }
    if (kind === 'normal') entry.normalLines = parsedLines;
    else if (kind === 'sale') entry.saleLines = parsedLines;
    else entry.couponLines = parsedLines;
  }
  return Array.from(byCode.values()).map((e) => ({
    ...e,
    shopId,
    normalLines: e.normalLines ?? emptyFieldLines(),
  })) as ProductInputPayload[];
}
