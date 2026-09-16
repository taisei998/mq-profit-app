// SQLite用にJSON文字列として保存しているカラムのシリアライズ/デシリアライズ。
// PostgreSQL/MySQLに切り替えても文字列カラムのまま動作する（Json型より互換性が高い）。
export function toJsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJsonString<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
