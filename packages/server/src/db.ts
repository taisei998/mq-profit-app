import { PrismaClient } from '@prisma/client';

// Prisma Client はプロセス内で1つを使い回す（開発時のホットリロードで
// 接続が増殖しないよう globalThis にキャッシュする定番パターン）
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
