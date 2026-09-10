-- Manufacturing add-on services income + customer-facing job pipeline.

CREATE TYPE "MfgOrderStage" AS ENUM ('DESIGN', 'PURCHASING_MATERIALS', 'MATERIAL_READY', 'QUEUED', 'PRODUCTION', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MfgPricingModel" AS ENUM ('ONE_TIME', 'PER_UNIT', 'PER_PERIOD');

CREATE TABLE "MfgService" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricingModel" "MfgPricingModel" NOT NULL DEFAULT 'ONE_TIME',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "periodUnit" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MfgService_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MfgService_organizationId_name_key" ON "MfgService"("organizationId", "name");
CREATE INDEX "MfgService_organizationId_idx" ON "MfgService"("organizationId");
ALTER TABLE "MfgService" ADD CONSTRAINT "MfgService_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MfgServiceIncome" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "amount" DOUBLE PRECISION NOT NULL,
    "incomeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "recordedById" INTEGER,
    "otherIncomeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfgServiceIncome_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MfgServiceIncome_organizationId_idx" ON "MfgServiceIncome"("organizationId");
CREATE INDEX "MfgServiceIncome_serviceId_idx" ON "MfgServiceIncome"("serviceId");
CREATE INDEX "MfgServiceIncome_incomeDate_idx" ON "MfgServiceIncome"("incomeDate");
ALTER TABLE "MfgServiceIncome" ADD CONSTRAINT "MfgServiceIncome_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfgServiceIncome" ADD CONSTRAINT "MfgServiceIncome_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "MfgService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ManufacturingOrder" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "bomId" INTEGER,
    "targetQuantity" DOUBLE PRECISION,
    "dueDate" TIMESTAMP(3),
    "stage" "MfgOrderStage" NOT NULL DEFAULT 'DESIGN',
    "workOrderId" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManufacturingOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManufacturingOrder_organizationId_jobNumber_key" ON "ManufacturingOrder"("organizationId", "jobNumber");
CREATE INDEX "ManufacturingOrder_organizationId_stage_idx" ON "ManufacturingOrder"("organizationId", "stage");
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManufacturingOrder" ADD CONSTRAINT "ManufacturingOrder_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ManufacturingOrderHistory" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "fromStage" "MfgOrderStage",
    "toStage" "MfgOrderStage" NOT NULL,
    "note" TEXT,
    "changedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManufacturingOrderHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManufacturingOrderHistory_orderId_idx" ON "ManufacturingOrderHistory"("orderId");
ALTER TABLE "ManufacturingOrderHistory" ADD CONSTRAINT "ManufacturingOrderHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturingOrderHistory" ADD CONSTRAINT "ManufacturingOrderHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ManufacturingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
