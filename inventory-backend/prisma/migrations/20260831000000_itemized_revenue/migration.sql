-- Itemized Revenue & COGS tagging.
-- Every auto-posted income (OtherIncome) and cost (CogsEntry) row now carries
-- the exact Product / Variant / MenuItem it was posted for, so the ledger is a
-- true line-item snapshot (Revenue: 8,000 ETB tagged to ProductVariant X).
-- All columns are nullable + ON DELETE SET NULL so financial history survives
-- item deletion; existing rows backfill to NULL without any data movement.

-- AlterTable
ALTER TABLE "OtherIncome" ADD COLUMN "productId" INTEGER;
ALTER TABLE "OtherIncome" ADD COLUMN "variantId" INTEGER;
ALTER TABLE "OtherIncome" ADD COLUMN "menuItemId" INTEGER;

-- AlterTable
ALTER TABLE "CogsEntry" ADD COLUMN "productId" INTEGER;
ALTER TABLE "CogsEntry" ADD COLUMN "variantId" INTEGER;
ALTER TABLE "CogsEntry" ADD COLUMN "menuItemId" INTEGER;

-- CreateIndex
CREATE INDEX "OtherIncome_productId_idx" ON "OtherIncome"("productId");

-- CreateIndex
CREATE INDEX "OtherIncome_variantId_idx" ON "OtherIncome"("variantId");

-- CreateIndex
CREATE INDEX "OtherIncome_menuItemId_idx" ON "OtherIncome"("menuItemId");

-- CreateIndex
CREATE INDEX "CogsEntry_productId_idx" ON "CogsEntry"("productId");

-- CreateIndex
CREATE INDEX "CogsEntry_variantId_idx" ON "CogsEntry"("variantId");

-- CreateIndex
CREATE INDEX "CogsEntry_menuItemId_idx" ON "CogsEntry"("menuItemId");

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CogsEntry" ADD CONSTRAINT "CogsEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CogsEntry" ADD CONSTRAINT "CogsEntry_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CogsEntry" ADD CONSTRAINT "CogsEntry_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
