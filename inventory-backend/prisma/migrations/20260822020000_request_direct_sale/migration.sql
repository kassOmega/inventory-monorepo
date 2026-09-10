-- AlterEnum
ALTER TYPE "RequestItemStatus" ADD VALUE 'SOLD';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "requestId" INTEGER;

-- CreateIndex
CREATE INDEX "Sale_requestId_idx" ON "Sale"("requestId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
