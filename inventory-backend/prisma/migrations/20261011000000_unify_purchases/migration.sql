-- Unify "quick purchases" and "credit purchases" into a single Purchase model.
-- `paymentType` is the only difference between them: PAID settles from cash on
-- approval, CREDIT books a payable that is cleared through PurchasePayment rows.

-- CreateEnum
CREATE TYPE "PurchasePaymentType" AS ENUM ('PAID', 'CREDIT');

-- RenameEnum (same values, clearer name now that it describes any purchase)
ALTER TYPE "CreditPurchaseStatus" RENAME TO "PurchasePaymentStatus";

-- AlterTable: Purchase becomes the single home for both payment types
ALTER TABLE "Purchase" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "Purchase" ADD COLUMN "publicId" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "Purchase" ADD COLUMN "paymentType" "PurchasePaymentType" NOT NULL DEFAULT 'PAID';
ALTER TABLE "Purchase" ADD COLUMN "paymentStatus" "PurchasePaymentStatus" NOT NULL DEFAULT 'PAID';
ALTER TABLE "Purchase" ADD COLUMN "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "vendorCustomerId" INTEGER;
ALTER TABLE "Purchase" ALTER COLUMN "sellPrice" SET DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "revenue" SET DEFAULT 0;
ALTER TABLE "Purchase" ALTER COLUMN "profit" SET DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_publicId_key" ON "Purchase"("publicId");
CREATE INDEX "Purchase_tenantId_paymentType_idx" ON "Purchase"("tenantId", "paymentType");
CREATE INDEX "Purchase_tenantId_vendorCustomerId_idx" ON "Purchase"("tenantId", "vendorCustomerId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_vendorCustomerId_fkey" FOREIGN KEY ("vendorCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate existing credit purchases into Purchase, preserving publicId (deep
-- links + payment rows keep resolving) and deriving the settlement snapshot
-- from the payments already recorded. clientRef collisions with an existing
-- quick purchase are skipped rather than aborting the migration.
INSERT INTO "Purchase" (
    "publicId", "tenantId", "shopId", "productName", "quantity", "unitPrice",
    "sellPrice", "totalCost", "revenue", "profit", "status", "paymentType",
    "paymentStatus", "amountPaid", "vendorCustomerId", "createdById",
    "approvedById", "paymentMethodId", "notes", "clientRef", "createdAt", "updatedAt"
)
SELECT
    cp."publicId", cp."tenantId", cp."shopId", cp."productName", cp."quantity", cp."unitPrice",
    0, cp."subtotal", 0, 0, 'APPROVED', 'CREDIT',
    cp."status",
    COALESCE((SELECT SUM(p."amount") FROM "CreditPurchasePayment" p WHERE p."creditPurchaseId" = cp."id"), 0),
    cp."customerId", NULL,
    NULL, NULL, cp."notes", cp."clientRef", cp."createdAt", cp."updatedAt"
FROM "CreditPurchase" cp
WHERE cp."clientRef" IS NULL
   OR NOT EXISTS (
        SELECT 1 FROM "Purchase" p
        WHERE p."clientRef" = cp."clientRef"
          AND p."tenantId" IS NOT DISTINCT FROM cp."tenantId"
   );

-- AlterTable: CreditPurchasePayment becomes PurchasePayment
ALTER TABLE "CreditPurchasePayment" RENAME TO "PurchasePayment";
ALTER TABLE "PurchasePayment" RENAME COLUMN "creditPurchaseId" TO "purchaseId";
ALTER INDEX "CreditPurchasePayment_pkey" RENAME TO "PurchasePayment_pkey";
ALTER INDEX "CreditPurchasePayment_publicId_key" RENAME TO "PurchasePayment_publicId_key";
ALTER INDEX "CreditPurchasePayment_tenantId_idx" RENAME TO "PurchasePayment_tenantId_idx";
ALTER INDEX "CreditPurchasePayment_tenantId_customerId_idx" RENAME TO "PurchasePayment_tenantId_customerId_idx";

-- Historic payment rows had no idempotency guard, so clear duplicated keys
-- before the unique index lands (the earliest row keeps its key).
UPDATE "PurchasePayment" SET "clientRef" = NULL
WHERE "clientRef" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id") FROM "PurchasePayment"
    WHERE "clientRef" IS NOT NULL
    GROUP BY "tenantId", "clientRef"
  );

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePayment_tenantId_clientRef_key" ON "PurchasePayment"("tenantId", "clientRef");

-- DropForeignKey / AddForeignKey: re-point the payment rows at Purchase
ALTER TABLE "PurchasePayment" DROP CONSTRAINT "CreditPurchasePayment_creditPurchaseId_fkey";
ALTER TABLE "PurchasePayment" RENAME CONSTRAINT "CreditPurchasePayment_customerId_fkey" TO "PurchasePayment_customerId_fkey";
ALTER TABLE "PurchasePayment" RENAME CONSTRAINT "CreditPurchasePayment_paymentMethodId_fkey" TO "PurchasePayment_paymentMethodId_fkey";
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable: the credit purchase table is fully absorbed by Purchase
DROP TABLE "CreditPurchase";
