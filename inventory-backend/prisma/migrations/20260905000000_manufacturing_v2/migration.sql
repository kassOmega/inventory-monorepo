-- Manufacturing v2: replace the demo-era Material/BillOfMaterial/ProductionRun
-- vertical with the product-centric BOM/WorkOrder/ScrapLog design and make
-- ProductBatch variant/location/cost aware.

DROP TABLE "ProductionRunItem";
DROP TABLE "ProductionRun";
DROP TABLE "BomLine";
DROP TABLE "BillOfMaterial";
DROP TABLE "Material";

DROP TYPE "ProductionRunStatus";
DROP TYPE "BomStatus";
DROP TYPE "MaterialKind";

CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ScrapKind" AS ENUM ('RAW', 'FINISHED');

ALTER TABLE "ProductBatch" ADD COLUMN "variantId" INTEGER,
ADD COLUMN "locationId" INTEGER,
ADD COLUMN "unitCost" DOUBLE PRECISION;
CREATE INDEX "ProductBatch_productId_locationId_quantity_idx" ON "ProductBatch"("productId", "locationId", "quantity");

CREATE TABLE "BillOfMaterials" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "finishedProductId" INTEGER NOT NULL,
    "quantityProduced" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "scrapPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillOfMaterials_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BillOfMaterials_organizationId_idx" ON "BillOfMaterials"("organizationId");
CREATE INDEX "BillOfMaterials_finishedProductId_idx" ON "BillOfMaterials"("finishedProductId");
ALTER TABLE "BillOfMaterials" ADD CONSTRAINT "BillOfMaterials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillOfMaterials" ADD CONSTRAINT "BillOfMaterials_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BomItem" (
    "id" SERIAL NOT NULL,
    "bomId" INTEGER NOT NULL,
    "rawMaterialProductId" INTEGER NOT NULL,
    "quantityRequired" DOUBLE PRECISION NOT NULL,
    "unitId" INTEGER,
    CONSTRAINT "BomItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BomItem_bomId_rawMaterialProductId_key" ON "BomItem"("bomId", "rawMaterialProductId");
CREATE INDEX "BomItem_rawMaterialProductId_idx" ON "BomItem"("rawMaterialProductId");
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_rawMaterialProductId_fkey" FOREIGN KEY ("rawMaterialProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WorkOrder" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "bomId" INTEGER NOT NULL,
    "finishedProductId" INTEGER NOT NULL,
    "finishedVariantId" INTEGER,
    "targetQuantity" DOUBLE PRECISION NOT NULL,
    "producedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locationId" INTEGER NOT NULL,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "totalCogmCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cogmUnitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkOrder_organizationId_status_idx" ON "WorkOrder"("organizationId", "status");
CREATE INDEX "WorkOrder_locationId_idx" ON "WorkOrder"("locationId");
CREATE INDEX "WorkOrder_finishedProductId_idx" ON "WorkOrder"("finishedProductId");
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductionScrapLog" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "kind" "ScrapKind" NOT NULL DEFAULT 'RAW',
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductionScrapLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionScrapLog_workOrderId_idx" ON "ProductionScrapLog"("workOrderId");
CREATE INDEX "ProductionScrapLog_organizationId_createdAt_idx" ON "ProductionScrapLog"("organizationId", "createdAt");
ALTER TABLE "ProductionScrapLog" ADD CONSTRAINT "ProductionScrapLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionScrapLog" ADD CONSTRAINT "ProductionScrapLog_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionScrapLog" ADD CONSTRAINT "ProductionScrapLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
