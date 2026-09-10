-- DropIndex
DROP INDEX "Inventory_productId_locationId_key";

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN     "variantId" INTEGER;

-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN     "batchId" INTEGER,
ADD COLUMN     "variantId" INTEGER;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "batchId" INTEGER,
ADD COLUMN     "variantId" INTEGER;

-- CreateIndex
CREATE INDEX "Inventory_variantId_idx" ON "Inventory"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_productId_variantId_locationId_key" ON "Inventory"("productId", "variantId", "locationId");

-- CreateIndex
CREATE INDEX "RequestItem_variantId_idx" ON "RequestItem"("variantId");

-- CreateIndex
CREATE INDEX "RequestItem_batchId_idx" ON "RequestItem"("batchId");

-- CreateIndex
CREATE INDEX "SaleItem_variantId_idx" ON "SaleItem"("variantId");

-- CreateIndex
CREATE INDEX "SaleItem_batchId_idx" ON "SaleItem"("batchId");

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

