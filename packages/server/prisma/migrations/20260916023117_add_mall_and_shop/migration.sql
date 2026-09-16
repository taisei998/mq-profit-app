-- CreateTable
CREATE TABLE "Mall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mallId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shop_mallId_fkey" FOREIGN KEY ("mallId") REFERENCES "Mall" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Mall_name_key" ON "Mall"("name");

-- CreateIndex
CREATE INDEX "Shop_mallId_idx" ON "Shop"("mallId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_mallId_name_key" ON "Shop"("mallId", "name");
