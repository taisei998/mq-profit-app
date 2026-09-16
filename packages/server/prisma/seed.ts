// 初期データ投入用。何度実行しても同じ結果になる（既にあるものは上書きしない）。
//   npm run db:seed --workspace=packages/server
import { prisma } from '../src/db.js';

// モールは運用上ほぼ固定なので初期データとして用意する。
// 店舗（くまもと風土・ご当地風土 など）はモールごとに増減するため、画面から登録してもらう。
const MALLS = [
  '楽天市場',
  'Yahoo!ショッピング',
  'au PAY マーケット',
  'Amazon',
  '自社EC',
];

async function main() {
  let created = 0;
  for (let i = 0; i < MALLS.length; i++) {
    const name = MALLS[i];
    const existing = await prisma.mall.findUnique({ where: { name } });
    if (existing) continue;
    await prisma.mall.create({ data: { name, sortOrder: i + 1 } });
    created++;
  }
  const total = await prisma.mall.count();
  console.log(`モールマスタ: ${created}件を追加しました（現在${total}件）。`);
  console.log('店舗マスタは「マスタ ＞ 店舗マスタ」から登録してください。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
