// 簡易CSVパーサ（ダブルクォート対応）。BOM除去・空行除去つき。
const BOM = '﻿';

export function splitLines(text: string): string[] {
  const stripped = text.startsWith(BOM) ? text.slice(1) : text;
  return stripped.split(/\r?\n/).filter((l) => l.trim() !== '');
}

export type Delimiter = ',' | '\t';

// 区切り文字の自動判定。Amazonの注文レポートは拡張子が .txt のタブ区切りで、
// 楽天・Yahoo!・au PAY はカンマ区切り。見出し行に多く出てくる方を採用する。
export function detectDelimiter(headerLine: string): Delimiter {
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

export function parseCSVLine(line: string, delimiter: Delimiter = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function toCSVText(rows: Array<Array<string | number>>): string {
  return rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
