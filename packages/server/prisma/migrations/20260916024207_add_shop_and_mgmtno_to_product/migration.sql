/*
  Warnings:

  - Added the required column `shopId` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "mgmtNo" TEXT,
    "code" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "note" TEXT,
    "category" TEXT NOT NULL,
    "priceTaxRate" INTEGER NOT NULL DEFAULT 10,
    "setCount" INTEGER NOT NULL DEFAULT 5,
    "normalData" TEXT NOT NULL,
    "saleData" TEXT NOT NULL,
    "couponData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("category", "code", "couponData", "createdAt", "id", "name", "normalData", "note", "priceTaxRate", "productId", "saleData", "setCount", "spec", "updatedAt") SELECT "category", "code", "couponData", "createdAt", "id", "name", "normalData", "note", "priceTaxRate", "productId", "saleData", "setCount", "spec", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_productId_key" ON "Product"("productId");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE INDEX "Product_shopId_idx" ON "Product"("shopId");
CREATE UNIQUE INDEX "Product_shopId_code_key" ON "Product"("shopId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
