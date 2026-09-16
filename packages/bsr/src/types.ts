// Amazon BSR取得バッチの型定義。

// 対応マーケットプレイス。id は Amazon の marketplaceId、host は SP-API のリージョンendpoint。
// 追加する場合は https://developer-docs.amazon.com/sp-api/docs/marketplace-ids を参照。
export const MARKETPLACES = {
  JP: { id: 'A1VC38T7YXB528', host: 'sellingpartnerapi-fe.amazon.com', label: 'Amazon.co.jp', locale: 'ja_JP' },
  US: { id: 'ATVPDKIKX0DER', host: 'sellingpartnerapi-na.amazon.com', label: 'Amazon.com', locale: 'en_US' },
  UK: { id: 'A1F83G8C2ARO7P', host: 'sellingpartnerapi-eu.amazon.com', label: 'Amazon.co.uk', locale: 'en_GB' },
  DE: { id: 'A1PA6795UKMFR9', host: 'sellingpartnerapi-eu.amazon.com', label: 'Amazon.de', locale: 'de_DE' },
} as const;

export type MarketplaceKey = keyof typeof MARKETPLACES;
export const MARKETPLACE_KEYS = Object.keys(MARKETPLACES) as [MarketplaceKey, ...MarketplaceKey[]];

// SP-API の salesRanks から取り出した1件分のランク
export interface BsrRank {
  kind: 'displayGroup' | 'classification'; // 大カテゴリ / サブカテゴリ
  title: string;   // カテゴリ名
  rank: number;
  link?: string;
}

// 1ASIN・1日ぶんの取得結果
export interface BsrResult {
  asin: string;
  itemName: string | null;
  displayGroup: string | null;
  displayGroupRank: number | null;
  subCategory: string | null;
  subCategoryRank: number | null;
  error?: string;
}
