import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCSVLine, splitLines } from './csv.js';

describe('detectDelimiter', () => {
  it('カンマ区切りの見出しは "," と判定する（楽天・Yahoo!・au PAY）', () => {
    expect(detectDelimiter('注文番号,注文日,注文時間,商品管理番号,個数')).toBe(',');
  });

  it('タブ区切りの見出しは "\t" と判定する（Amazonの注文レポート）', () => {
    expect(detectDelimiter('amazon-order-id\tpurchase-date\tsku\tquantity\titem-price')).toBe('\t');
  });

  it('列が1つしかない行はカンマ扱い（既定に倒す）', () => {
    expect(detectDelimiter('単一列')).toBe(',');
  });
});

describe('parseCSVLine', () => {
  it('タブ区切りを指定すると分割できる', () => {
    const line = '503-7335002-4104607\t2026-09-14T23:57:59+09:00\tgam_okacoky_r_26_3980_700gx2\t1\t3980.0';
    expect(parseCSVLine(line, '\t')).toEqual([
      '503-7335002-4104607',
      '2026-09-14T23:57:59+09:00',
      'gam_okacoky_r_26_3980_700gx2',
      '1',
      '3980.0',
    ]);
  });

  it('タブ区切り指定時はカンマで分割しない（商品名にカンマが入っていても壊れない）', () => {
    expect(parseCSVLine('商品A, お徳用\t2', '\t')).toEqual(['商品A, お徳用', '2']);
  });

  it('既定はカンマ区切りのまま（既存CSVの挙動を変えない）', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(parseCSVLine('"a,1",b')).toEqual(['a,1', 'b']);
  });

  it('Amazonレポートの空欄が連続する行も列数が保たれる', () => {
    const row = parseCSVLine('249-1520694-6875836\t\t\t\tJPY\t950.0', '\t');
    expect(row).toHaveLength(6);
    expect(row[4]).toBe('JPY');
  });
});

describe('splitLines', () => {
  it('BOMを除去し空行を落とす', () => {
    expect(splitLines('\ufeffa,b\r\n\r\nc,d\n')).toEqual(['a,b', 'c,d']);
  });
});
