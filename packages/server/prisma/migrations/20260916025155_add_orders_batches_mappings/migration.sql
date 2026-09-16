-- CreateTable
CREATE TABLE "ImportBatch" (
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
    CONSTRAINT "ImportBatch_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderNo" TEXT,
    "orderDate" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productId" TEXT,
    "unitPrice" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "kind" TEXT NOT NULL,
    "profit" REAL NOT NULL,
    "profitRate" REAL NOT NULL,
    CONSTRAINT "Order_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MallCsvMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mallId" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MallCsvMapping_mallId_fkey" FOREIGN KEY ("mallId") REFERENCES "Mall" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImportBatch_shopId_idx" ON "ImportBatch"("shopId");

-- CreateIndex
CREATE INDEX "ImportBatch_importedAt_idx" ON "ImportBatch"("importedAt");

-- CreateIndex
CREATE INDEX "Order_shopId_orderDate_idx" ON "Order"("shopId", "orderDate");

-- CreateIndex
CREATE INDEX "Order_productId_idx" ON "Order"("productId");

-- CreateIndex
CREATE INDEX "Order_batchId_idx" ON "Order"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "MallCsvMapping_mallId_key" ON "MallCsvMapping"("mallId");
