-- Per-vertical profile/settings tables (1:1 with Organization). Purely additive.
-- Each vertical has its own typed settings table; only the row matching the
-- org's businessType is created/used (lazily on read).

CREATE TABLE "RetailProfile" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "allowBarcodes" BOOLEAN NOT NULL DEFAULT true,
    "enableLayaway" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RetailProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetailProfile_organizationId_key" ON "RetailProfile"("organizationId");

CREATE TABLE "HospitalityProfile" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "kitchenPrint" BOOLEAN NOT NULL DEFAULT true,
    "autoServiceTax" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "enableTableMap" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HospitalityProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HospitalityProfile_organizationId_key" ON "HospitalityProfile"("organizationId");

CREATE TABLE "ManufacturingProfile" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "trackBOM" BOOLEAN NOT NULL DEFAULT true,
    "trackWorkOrders" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManufacturingProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManufacturingProfile_organizationId_key" ON "ManufacturingProfile"("organizationId");

CREATE TABLE "ServiceProfile" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "hourlyBilling" BOOLEAN NOT NULL DEFAULT false,
    "appointmentSlot" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceProfile_organizationId_key" ON "ServiceProfile"("organizationId");

ALTER TABLE "RetailProfile" ADD CONSTRAINT "RetailProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HospitalityProfile" ADD CONSTRAINT "HospitalityProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManufacturingProfile" ADD CONSTRAINT "ManufacturingProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceProfile" ADD CONSTRAINT "ServiceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
