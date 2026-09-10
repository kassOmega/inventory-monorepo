-- Fiscal batch consolidation + tenant hardware/MoR settings.

-- CreateTable
CREATE TABLE "TenantFiscalConfig" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "tin" TEXT NOT NULL,
    "taxName" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "agentUrl" TEXT NOT NULL DEFAULT 'http://localhost:5000',
    "agentApiKey" TEXT,
    "printerVendor" TEXT NOT NULL DEFAULT 'GENERIC',
    "comPort" TEXT DEFAULT 'COM1',
    "baudRate" INTEGER DEFAULT 9600,
    "enableFiscal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantFiscalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalBatch" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "batchRef" TEXT NOT NULL,
    "fsNumber" TEXT NOT NULL,
    "ejNumber" TEXT NOT NULL,
    "machineSerial" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "serviceCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FiscalBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "FiscalReceipt" ADD COLUMN "batchId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "TenantFiscalConfig_tenantId_key" ON "TenantFiscalConfig"("tenantId");
CREATE INDEX "FiscalBatch_tenantId_idx" ON "FiscalBatch"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantFiscalConfig" ADD CONSTRAINT "TenantFiscalConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalReceipt" ADD CONSTRAINT "FiscalReceipt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FiscalBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
