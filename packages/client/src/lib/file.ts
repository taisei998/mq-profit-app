import { toCSVText } from '@ec-ai/shared';

// UTF-8(BOMなし/あり)・Shift_JIS を自動判別してデコードする
function decodeBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let utf8 = '';
  try {
    utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    utf8 = '';
  }
  if (utf8.indexOf('�') !== -1) {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(decodeBuffer(ev.target!.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function downloadCSV(rows: Array<Array<string | number>>, filename: string): void {
  const csv = toCSVText(rows);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
