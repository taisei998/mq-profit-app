// 集計日の扱い。サーバーのロケール設定に左右されないよう、
// タイムゾーンを明示して "YYYY-MM-DD" を組み立てる。
// 既定は日本時間（.env の BSR_TIMEZONE で変更可）。

export function timeZone(): string {
  return process.env.BSR_TIMEZONE || 'Asia/Tokyo';
}

// sv-SE ロケールは "2026-09-10" 形式を返すので、そのまま日付キーに使える
export function dateKey(at: Date = new Date(), tz: string = timeZone()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(at);
}

// 指定タイムゾーンでの現在時刻を "HH:MM" で返す
export function clockHHMM(at: Date = new Date(), tz: string = timeZone()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

// n日前の日付キー
export function dateKeyDaysAgo(days: number, at: Date = new Date()): string {
  return dateKey(new Date(at.getTime() - days * 86_400_000));
}
