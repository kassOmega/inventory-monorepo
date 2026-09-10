-- CreateEnum
CREATE TYPE "CashEntryType" AS ENUM ('INFLOW', 'OUTFLOW');

-- AlterTable Purchase: payment method + default APPROVED
ALTER TABLE "Purchase" ADD COLUMN "paymentMethodId" INTEGER;
ALTER TABLE "Purchase" ALTER COLUMN "status" SET DEFAULT 'APPROVED';

-- CreateTable CashEntry
CREATE TABLE "CashEntry" (
    "id" SERIAL NOT NULL,
    "shopId" INTEGER NOT NULL,
    "type" "CashEntryType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "refId" INTEGER,
    "description" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id")
);

-- AlterTable Sale: link to purchase
ALTER TABLE "Sale" ADD COLUMN "purchaseId" INTEGER;
CREATE UNIQUE INDEX "Sale_purchaseId_key" ON "Sale"("purchaseId");

-- AlterTable Return: refund method
ALTER TABLE "Return" ADD COLUMN "refundMethodId" INTEGER;

-- AlterTable ReturnItem: capture cost at return time
ALTER TABLE "ReturnItem" ADD COLUMN "unitBuyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AddForeignKeys
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Return" ADD CONSTRAINT "Return_refundMethodId_fkey" FOREIGN KEY ("refundMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
