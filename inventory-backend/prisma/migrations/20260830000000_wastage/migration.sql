-- Inventory Spoilage & Wastage: physical-stock write-offs that post a
-- "Spoilage & Wastage" expense to the ledger (not COGS).

-- Widen stock quantities to support fractional ingredient amounts (kg/L).
ALTER TABLE "Inventory" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;
ALTER TABLE "ProductBatch" ALTER COLUMN "quantity" SET DATA TYPE DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "WastageEntry" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "productId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WastageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WastageEntry_tenantId_idx" ON "WastageEntry"("tenantId");

-- CreateIndex
CREATE INDEX "WastageEntry_productId_idx" ON "WastageEntry"("productId");

-- CreateIndex
CREATE INDEX "WastageEntry_locationId_idx" ON "WastageEntry"("locationId");

-- CreateIndex
CREATE INDEX "WastageEntry_createdAt_idx" ON "WastageEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "WastageEntry" ADD CONSTRAINT "WastageEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WastageEntry" ADD CONSTRAINT "WastageEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
