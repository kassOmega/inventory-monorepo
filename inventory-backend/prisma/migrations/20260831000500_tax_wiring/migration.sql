-- Tax wiring: snapshot columns so VAT amounts are locked at transaction time.
-- Revenue-side rows keep the gross the customer pays in totalAmount and store
-- the computed output VAT separately; expenses keep net amount + input VAT.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "taxRateId" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "taxRateId" INTEGER,
ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Folio" ADD COLUMN "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "taxRateId" INTEGER,
ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "taxRateId" INTEGER;
