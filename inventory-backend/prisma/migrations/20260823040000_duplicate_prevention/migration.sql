-- Duplicate-entry prevention: idempotency keys + per-tenant name uniqueness.
-- Purely additive (nullable columns + unique indexes).

-- Idempotency keys (clientRef) for double-submit protection.
ALTER TABLE "Sale" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "Sale_tenantId_clientRef_key" ON "Sale"("tenantId", "clientRef");

ALTER TABLE "Purchase" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "Purchase_tenantId_clientRef_key" ON "Purchase"("tenantId", "clientRef");

ALTER TABLE "Order" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "Order_tenantId_clientRef_key" ON "Order"("tenantId", "clientRef");

ALTER TABLE "ServicePayment" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "ServicePayment_tenantId_clientRef_key" ON "ServicePayment"("tenantId", "clientRef");

-- Unique names per tenant for the new verticals.
CREATE UNIQUE INDEX "ServiceItem_tenantId_name_key" ON "ServiceItem"("tenantId", "name");
CREATE UNIQUE INDEX "Material_tenantId_name_key" ON "Material"("tenantId", "name");
