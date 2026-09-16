import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { dashboardQuerySchema } from '../lib/validation.js';

export const dashboardRouter = Router();

// 期間の長さぶんだけ手前にずらした「前期間」を返す。KPIカードの前期間比に使う。
function previousRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1);
  const prevTo = new Date(f.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

interface Totals {
  sales: number;
  profit: number;
  count: number;
}
const zero = (): Totals => ({ sales: 0, profit: 0, count: 0 });

dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const q = dashboardQuerySchema.parse(req.query);

    // 店舗→モールの対応は毎回引く（件数が少ないので十分速い）
    const shops = await prisma.shop.findMany({ include: { mall: true } });
    const shopById = new Map(shops.map((s) => [s.id, s]));

    // 絞り込み対象の店舗を決める（モール指定 → そのモールの店舗すべて）
    let shopIds: string[] | null = null;
    if (q.shopId) shopIds = [q.shopId];
    else if (q.mallId) shopIds = shops.filter((s) => s.mallId === q.mallId).map((s) => s.id);

    // ステータス絞り込みは、受注に紐づいた商品の状態で行う（未紐付けの受注は保存していない）
    const baseWhere = {
      orderDate: { gte: q.from, lte: q.to },
      ...(shopIds ? { shopId: { in: shopIds } } : {}),
      ...(q.status ? { product: { status: q.status } } : {}),
    };

    const sumOf = async (where: object): Promise<Totals> => {
      const r = await prisma.order.aggregate({
        where,
        _sum: { amount: true, profit: true },
        _count: { _all: true },
      });
      return { sales: r._sum.amount ?? 0, profit: r._sum.profit ?? 0, count: r._count._all };
    };

    const current = await sumOf(baseWhere);
    const prev = previousRange(q.from, q.to);
    const previous = await sumOf({ ...baseWhere, orderDate: { gte: prev.from, lte: prev.to } });

    // 日別 → 月別にまとめ直す（売上推移グラフ用）
    const byDate = await prisma.order.groupBy({
      by: ['orderDate'],
      where: baseWhere,
      _sum: { amount: true, profit: true },
      _count: { _all: true },
    });
    const monthMap = new Map<string, Totals>();
    for (const d of byDate) {
      const month = d.orderDate.slice(0, 7);
      const t = monthMap.get(month) ?? zero();
      t.sales += d._sum.amount ?? 0;
      t.profit += d._sum.profit ?? 0;
      t.count += d._count._all;
      monthMap.set(month, t);
    }
    const monthly = [...monthMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, t]) => ({ month, ...t }));

    const daily = byDate
      .map((d) => ({
        date: d.orderDate,
        sales: d._sum.amount ?? 0,
        profit: d._sum.profit ?? 0,
        count: d._count._all,
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    // モール別（店舗別の集計をモールに畳む）
    const byShop = await prisma.order.groupBy({
      by: ['shopId'],
      where: baseWhere,
      _sum: { amount: true, profit: true },
      _count: { _all: true },
    });
    const mallMap = new Map<string, Totals & { mallName: string }>();
    for (const s of byShop) {
      const shop = shopById.get(s.shopId);
      if (!shop) continue;
      const key = shop.mallId;
      const t = mallMap.get(key) ?? { ...zero(), mallName: shop.mall.name };
      t.sales += s._sum.amount ?? 0;
      t.profit += s._sum.profit ?? 0;
      t.count += s._count._all;
      mallMap.set(key, t);
    }
    const byMall = [...mallMap.entries()]
      .map(([mallId, t]) => ({ mallId, ...t }))
      .sort((a, b) => b.sales - a.sales);

    // 商品別ランキング（上位5件）
    const byProduct = await prisma.order.groupBy({
      by: ['productId'],
      where: baseWhere,
      _sum: { amount: true, profit: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    });
    const productIds = byProduct.map((p) => p.productId).filter((x): x is string => !!x);
    const products = productIds.length
      ? await prisma.product.findMany({ where: { id: { in: productIds } } })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const topProducts = byProduct
      .filter((p) => p.productId)
      .map((p, i) => {
        const prod = productById.get(p.productId!);
        return {
          rank: i + 1,
          productId: p.productId!,
          name: prod?.name || '(削除された商品)',
          code: prod?.code || '',
          sales: p._sum.amount ?? 0,
          profit: p._sum.profit ?? 0,
          count: p._count._all,
        };
      });

    // アラート。未紐付け・エラーは取込履歴の集計値から出す
    const batches = await prisma.importBatch.findMany({
      where: shopIds ? { shopId: { in: shopIds } } : {},
      select: { shopId: true, unmatchedCount: true, errorCount: true },
    });
    const unmatched = batches.reduce((a, b) => a + b.unmatchedCount, 0);
    const errors = batches.reduce((a, b) => a + b.errorCount, 0);

    // 一度も取り込んでいないモール（＝取込漏れの可能性）
    const importedShopIds = new Set(batches.map((b) => b.shopId));
    const malls = await prisma.mall.findMany({ orderBy: { sortOrder: 'asc' } });
    const mallsWithoutImport = malls
      .filter((m) => {
        const own = shops.filter((s) => s.mallId === m.id);
        if (own.length === 0) return false; // 店舗が無いモールは対象外
        return !own.some((s) => importedShopIds.has(s.id));
      })
      .map((m) => m.name);

    res.json({
      range: { from: q.from, to: q.to },
      previousRange: prev,
      kpi: {
        sales: current.sales,
        profit: current.profit,
        rate: current.sales > 0 ? (current.profit / current.sales) * 100 : null,
        count: current.count,
        prevSales: previous.sales,
        prevProfit: previous.profit,
        prevRate: previous.sales > 0 ? (previous.profit / previous.sales) * 100 : null,
        prevCount: previous.count,
      },
      monthly,
      daily,
      byMall,
      topProducts,
      alerts: { unmatched, errors, mallsWithoutImport },
    });
  })
);
