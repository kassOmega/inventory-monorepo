-- AlterTable
ALTER TABLE "TenantFiscalConfig" ADD COLUMN "branchCode" TEXT,
ADD COLUMN "morCertificate" TEXT,
ADD COLUMN "morClientId" TEXT,
ADD COLUMN "morClientSecret" TEXT,
ADD COLUMN "morLiveUrl" TEXT,
ADD COLUMN "terminalId" TEXT;
