export function yen(n: number | null | undefined): string {
  if (n == null) return '—';
  return '¥' + Math.round(n).toLocaleString();
}

export function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toFixed(1) + '%';
}
