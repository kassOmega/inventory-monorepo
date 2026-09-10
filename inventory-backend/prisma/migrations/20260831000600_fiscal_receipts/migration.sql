-- Fiscal printing: universal 1:1 fiscal receipts for hospitality orders and
-- retail sales, plus per-row fiscal state on the Order / Sale themselves.

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('NOT_PRINTED', 'PRINT_PENDING', 'PRINTED', 'PRINT_FAILED');

-- CreateTable
CREATE TABLE "FiscalReceipt" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "orderId" INTEGER,
    "saleId" INTEGER,
    "fsNumber" TEXT NOT NULL,
    "ejNumber" TEXT NOT NULL,
    "machineSerial" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "serviceCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalReceipt_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "fiscalStatus" "FiscalStatus" NOT NULL DEFAULT 'NOT_PRINTED',
ADD COLUMN "fiscalError" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "fiscalStatus" "FiscalStatus" NOT NULL DEFAULT 'NOT_PRINTED',
ADD COLUMN "fiscalError" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FiscalReceipt_orderId_key" ON "FiscalReceipt"("orderId");
CREATE UNIQUE INDEX "FiscalReceipt_saleId_key" ON "FiscalReceipt"("saleId");
CREATE INDEX "FiscalReceipt_tenantId_idx" ON "FiscalReceipt"("tenantId");

-- AddForeignKey
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
