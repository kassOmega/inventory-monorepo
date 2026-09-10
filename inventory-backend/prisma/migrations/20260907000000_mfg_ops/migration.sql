-- CreateEnum
CREATE TYPE "MfgIssueStatus" AS ENUM ('OPEN', 'PARTIAL', 'RETURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('OPERATIONAL', 'IDLE', 'FAULTY', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "MachineComponentStatus" AS ENUM ('OK', 'WORN', 'FAULTY', 'REPLACED');

-- CreateEnum
CREATE TYPE "ShiftSessionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "MaterialIssue" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "workOrderId" INTEGER,
    "jobId" INTEGER,
    "productId" INTEGER NOT NULL,
    "batchId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "issuedToId" INTEGER,
    "issuedById" INTEGER,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "MfgIssueStatus" NOT NULL DEFAULT 'OPEN',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReturn" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "issueId" INTEGER,
    "productId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "returnedById" INTEGER,
    "note" TEXT,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumableIssue" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "shiftSessionId" INTEGER,
    "productId" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "groupLabel" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumableIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumableUsageLog" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "shiftSessionId" INTEGER,
    "productId" INTEGER NOT NULL,
    "usedQty" DOUBLE PRECISION NOT NULL,
    "leftQty" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ConsumableUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "locationId" INTEGER,
    "status" "MachineStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineComponent" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "machineId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "MachineComponentStatus" NOT NULL DEFAULT 'OK',
    "partProductId" INTEGER,
    "lastReplacedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineStatusLog" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "machineId" INTEGER NOT NULL,
    "fromStatus" "MachineStatus",
    "toStatus" "MachineStatus" NOT NULL,
    "note" TEXT,
    "changedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentStatusLog" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "componentId" INTEGER NOT NULL,
    "fromStatus" "MachineComponentStatus",
    "toStatus" "MachineComponentStatus" NOT NULL,
    "note" TEXT,
    "changedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComponentStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "repeatDays" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSession" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "ShiftSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "handoverClean" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftTemplateId" INTEGER,

    CONSTRAINT "ShiftSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "workerId" INTEGER,
    "roleLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialIssue_organizationId_issuedToId_idx" ON "MaterialIssue"("organizationId", "issuedToId");

-- CreateIndex
CREATE INDEX "MaterialIssue_workOrderId_idx" ON "MaterialIssue"("workOrderId");

-- CreateIndex
CREATE INDEX "MaterialIssue_jobId_idx" ON "MaterialIssue"("jobId");

-- CreateIndex
CREATE INDEX "MaterialReturn_organizationId_idx" ON "MaterialReturn"("organizationId");

-- CreateIndex
CREATE INDEX "MaterialReturn_issueId_idx" ON "MaterialReturn"("issueId");

-- CreateIndex
CREATE INDEX "ConsumableIssue_organizationId_idx" ON "ConsumableIssue"("organizationId");

-- CreateIndex
CREATE INDEX "ConsumableUsageLog_organizationId_idx" ON "ConsumableUsageLog"("organizationId");

-- CreateIndex
CREATE INDEX "Machine_organizationId_idx" ON "Machine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_organizationId_code_key" ON "Machine"("organizationId", "code");

-- CreateIndex
CREATE INDEX "MachineComponent_organizationId_idx" ON "MachineComponent"("organizationId");

-- CreateIndex
CREATE INDEX "MachineComponent_machineId_idx" ON "MachineComponent"("machineId");

-- CreateIndex
CREATE INDEX "MachineStatusLog_organizationId_idx" ON "MachineStatusLog"("organizationId");

-- CreateIndex
CREATE INDEX "MachineStatusLog_machineId_idx" ON "MachineStatusLog"("machineId");

-- CreateIndex
CREATE INDEX "ComponentStatusLog_organizationId_idx" ON "ComponentStatusLog"("organizationId");

-- CreateIndex
CREATE INDEX "ComponentStatusLog_componentId_idx" ON "ComponentStatusLog"("componentId");

-- CreateIndex
CREATE INDEX "ShiftTemplate_organizationId_idx" ON "ShiftTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftTemplate_organizationId_name_key" ON "ShiftTemplate"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ShiftSession_organizationId_date_idx" ON "ShiftSession"("organizationId", "date");

-- CreateIndex
CREATE INDEX "ShiftSession_status_idx" ON "ShiftSession"("status");

-- CreateIndex
CREATE INDEX "ShiftAssignment_organizationId_idx" ON "ShiftAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "ShiftAssignment_sessionId_idx" ON "ShiftAssignment"("sessionId");

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MaterialIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumableIssue" ADD CONSTRAINT "ConsumableIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumableUsageLog" ADD CONSTRAINT "ConsumableUsageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineComponent" ADD CONSTRAINT "MachineComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineComponent" ADD CONSTRAINT "MachineComponent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineStatusLog" ADD CONSTRAINT "MachineStatusLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineStatusLog" ADD CONSTRAINT "MachineStatusLog_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentStatusLog" ADD CONSTRAINT "ComponentStatusLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentStatusLog" ADD CONSTRAINT "ComponentStatusLog_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "MachineComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSession" ADD CONSTRAINT "ShiftSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSession" ADD CONSTRAINT "ShiftSession_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ShiftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

