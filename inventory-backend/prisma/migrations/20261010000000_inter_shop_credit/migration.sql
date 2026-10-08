-- CreateEnum
CREATE TYPE "CreditPurchaseStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateTable
CREATE TABLE "CreditPurchase" (
    "id" SERIAL NOT NULL,
    "publicId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "shopId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "status" "CreditPurchaseStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "clientRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPurchasePayment" (
    "id" SERIAL NOT NULL,
    "publicId" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "creditPurchaseId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" INTEGER,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "clientRef" TEXT,

    CONSTRAINT "CreditPurchasePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchase_publicId_key" ON "CreditPurchase"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchase_tenantId_clientRef_key" ON "CreditPurchase"("tenantId", "clientRef");

-- CreateIndex
CREATE INDEX "CreditPurchase_tenantId_idx" ON "CreditPurchase"("tenantId");

-- CreateIndex
CREATE INDEX "CreditPurchase_tenantId_customerId_idx" ON "CreditPurchase"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchasePayment_publicId_key" ON "CreditPurchasePayment"("publicId");

-- CreateIndex
CREATE INDEX "CreditPurchasePayment_tenantId_idx" ON "CreditPurchasePayment"("tenantId");

-- CreateIndex
CREATE INDEX "CreditPurchasePayment_tenantId_customerId_idx" ON "CreditPurchasePayment"("tenantId", "customerId");

-- AddForeignKey
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchasePayment" ADD CONSTRAINT "CreditPurchasePayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchasePayment" ADD CONSTRAINT "CreditPurchasePayment_creditPurchaseId_fkey" FOREIGN KEY ("creditPurchaseId") REFERENCES "CreditPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchasePayment" ADD CONSTRAINT "CreditPurchasePayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
