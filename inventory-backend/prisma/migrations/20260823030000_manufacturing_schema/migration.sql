-- MANUFACTURING vertical schema. Purely additive CREATE TABLEs.

CREATE TYPE "MaterialKind" AS ENUM ('RAW', 'WIP', 'FINISHED');
CREATE TYPE "BomStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ProductionRunStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Material" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "kind" "MaterialKind" NOT NULL DEFAULT 'RAW',
    "costPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Material_tenantId_kind_idx" ON "Material"("tenantId", "kind");

CREATE TABLE "BillOfMaterial" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "outputMaterialId" INTEGER,
    "outputName" TEXT NOT NULL,
    "outputUnit" TEXT NOT NULL DEFAULT 'piece',
    "outputQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "BomStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillOfMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BillOfMaterial_tenantId_idx" ON "BillOfMaterial"("tenantId");
ALTER TABLE "BillOfMaterial" ADD CONSTRAINT "BillOfMaterial_outputMaterialId_fkey" FOREIGN KEY ("outputMaterialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BomLine" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "bomId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "quantityPerOutput" DOUBLE PRECISION NOT NULL DEFAULT 1,
    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BomLine_bomId_materialId_key" ON "BomLine"("bomId", "materialId");
CREATE INDEX "BomLine_tenantId_idx" ON "BomLine"("tenantId");
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductionRun" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "bomId" INTEGER NOT NULL,
    "plannedQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "ProductionRunStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionRun_tenantId_status_idx" ON "ProductionRun"("tenantId", "status");
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BillOfMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductionRunItem" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "runId" INTEGER NOT NULL,
    "materialId" INTEGER NOT NULL,
    "kind" "MaterialKind" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "ProductionRunItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionRunItem_runId_idx" ON "ProductionRunItem"("runId");
CREATE INDEX "ProductionRunItem_tenantId_idx" ON "ProductionRunItem"("tenantId");
ALTER TABLE "ProductionRunItem" ADD CONSTRAINT "ProductionRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionRunItem" ADD CONSTRAINT "ProductionRunItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
