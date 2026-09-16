-- CreateTable
CREATE TABLE "TrackedAsin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asin" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'JP',
    "label" TEXT,
    "productCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BsrSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackedAsinId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemName" TEXT,
    "displayGroup" TEXT,
    "displayGroupRank" INTEGER,
    "subCategory" TEXT,
    "subCategoryRank" INTEGER,
    "ranksJson" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BsrSnapshot_trackedAsinId_fkey" FOREIGN KEY ("trackedAsinId") REFERENCES "TrackedAsin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedAsin_asin_marketplace_key" ON "TrackedAsin"("asin", "marketplace");

-- CreateIndex
CREATE INDEX "BsrSnapshot_date_idx" ON "BsrSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BsrSnapshot_trackedAsinId_date_key" ON "BsrSnapshot"("trackedAsinId", "date");
