-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL,
    "unmatchedCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "importedBy" TEXT,
    "unmatchedDetail" TEXT NOT NULL DEFAULT '{}',
    "errorDetail" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "ImportBatch_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ImportBatch" ("errorCount", "excludedCount", "fileName", "id", "importedAt", "importedBy", "shopId", "status", "successCount", "totalCount", "unmatchedCount") SELECT "errorCount", "excludedCount", "fileName", "id", "importedAt", "importedBy", "shopId", "status", "successCount", "totalCount", "unmatchedCount" FROM "ImportBatch";
DROP TABLE "ImportBatch";
ALTER TABLE "new_ImportBatch" RENAME TO "ImportBatch";
CREATE INDEX "ImportBatch_shopId_idx" ON "ImportBatch"("shopId");
CREATE INDEX "ImportBatch_importedAt_idx" ON "ImportBatch"("importedAt");
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
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "normalData" TEXT NOT NULL,
    "saleData" TEXT NOT NULL,
    "couponData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("category", "code", "couponData", "createdAt", "id", "mgmtNo", "name", "normalData", "note", "priceTaxRate", "productId", "saleData", "setCount", "shopId", "spec", "updatedAt") SELECT "category", "code", "couponData", "createdAt", "id", "mgmtNo", "name", "normalData", "note", "priceTaxRate", "productId", "saleData", "setCount", "shopId", "spec", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_productId_key" ON "Product"("productId");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE INDEX "Product_shopId_idx" ON "Product"("shopId");
CREATE UNIQUE INDEX "Product_shopId_code_key" ON "Product"("shopId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
