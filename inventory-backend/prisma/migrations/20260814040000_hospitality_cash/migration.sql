-- Hospitality stations + cash management (payments, floats, collections).
CREATE TYPE "Station" AS ENUM ('KITCHEN', 'BAR', 'BARISTA');

ALTER TABLE "MenuCategory" ADD COLUMN "station" "Station" NOT NULL DEFAULT 'KITCHEN';
ALTER TABLE "OrderItem" ADD COLUMN "station" "Station" NOT NULL DEFAULT 'KITCHEN';

CREATE TABLE "OrderPayment" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "orderId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" INTEGER,
    "transactionReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "collectedById" INTEGER,
    "confirmedById" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashFloat" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "recipientId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashFloat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashCollection" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "fromUserId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" INTEGER,
    "notes" TEXT,
    "collectedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashCollection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderPayment_tenantId_idx" ON "OrderPayment"("tenantId");
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");
CREATE INDEX "OrderPayment_status_idx" ON "OrderPayment"("status");

CREATE INDEX "CashFloat_tenantId_idx" ON "CashFloat"("tenantId");
CREATE INDEX "CashFloat_recipientId_idx" ON "CashFloat"("recipientId");

CREATE INDEX "CashCollection_tenantId_idx" ON "CashCollection"("tenantId");
CREATE INDEX "CashCollection_fromUserId_idx" ON "CashCollection"("fromUserId");

ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashCollection" ADD CONSTRAINT "CashCollection_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

