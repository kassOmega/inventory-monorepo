-- Multi-service hospitality schema introduced by feature/multi-service on top of
-- main: 3 enums, 11 tables, 9 columns on shared tables (Customer/Order/OrderItem/
-- OtherIncome), 30 indexes and the matching foreign keys. Additive only - no
-- drops, so every main-branch query keeps working unchanged.

-- CreateEnum
CREATE TYPE "HospitalityServiceType" AS ENUM ('FOOD_AND_BEVERAGE', 'ROOM_MANAGEMENT', 'GYM_AND_FITNESS', 'SWIMMING_POOL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FacilityVisitType" AS ENUM ('MEMBER', 'WALK_IN');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billingType" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "guestTag" TEXT,
ADD COLUMN     "packageDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "packageGuestId" TEXT,
ADD COLUMN     "packageId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "netCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "packageDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OtherIncome" ADD COLUMN     "sourceRef" TEXT;

-- CreateTable
CREATE TABLE "HospitalityService" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "serviceType" "HospitalityServiceType" NOT NULL,
    "customKey" TEXT,
    "customName" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalityService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipType" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "hospitalityServiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMembership" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "membershipTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityVisit" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "hospitalityServiceId" TEXT NOT NULL,
    "type" "FacilityVisitType" NOT NULL,
    "customerId" INTEGER,
    "customerMembershipId" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),

    CONSTRAINT "FacilityVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityPayment" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "facilityVisitId" TEXT,
    "hospitalityServiceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "collectedById" INTEGER,
    "confirmedById" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalityPackage" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "hospitalityServiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalityPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageEntitlement" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "stationId" INTEGER,
    "menuCategoryId" INTEGER,
    "menuItemId" INTEGER,
    "allowanceValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageGuest" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "packageId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "roomNumber" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'CHECKED_IN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestFolio" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "packageGuestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "settledAt" TIMESTAMP(3),
    "settledById" INTEGER,
    "packageValuePaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPackageDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAddOns" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPayments" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestFolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestFolioEntry" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "orderId" INTEGER,
    "orderItemId" INTEGER,
    "stationName" TEXT,
    "servedByName" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "grossPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packageDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestFolioEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageGuestEntitlementUsage" (
    "id" TEXT NOT NULL,
    "packageGuestId" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "usageDate" TEXT NOT NULL,
    "quantityUsed" INTEGER NOT NULL DEFAULT 0,
    "valueUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageGuestEntitlementUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HospitalityService_organizationId_idx" ON "HospitalityService"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalityService_organizationId_serviceType_customKey_key" ON "HospitalityService"("organizationId", "serviceType", "customKey");

-- CreateIndex
CREATE INDEX "MembershipType_organizationId_idx" ON "MembershipType"("organizationId");

-- CreateIndex
CREATE INDEX "MembershipType_hospitalityServiceId_idx" ON "MembershipType"("hospitalityServiceId");

-- CreateIndex
CREATE INDEX "CustomerMembership_organizationId_idx" ON "CustomerMembership"("organizationId");

-- CreateIndex
CREATE INDEX "CustomerMembership_customerId_idx" ON "CustomerMembership"("customerId");

-- CreateIndex
CREATE INDEX "CustomerMembership_membershipTypeId_idx" ON "CustomerMembership"("membershipTypeId");

-- CreateIndex
CREATE INDEX "FacilityVisit_organizationId_idx" ON "FacilityVisit"("organizationId");

-- CreateIndex
CREATE INDEX "FacilityVisit_hospitalityServiceId_idx" ON "FacilityVisit"("hospitalityServiceId");

-- CreateIndex
CREATE INDEX "FacilityVisit_customerMembershipId_idx" ON "FacilityVisit"("customerMembershipId");

-- CreateIndex
CREATE INDEX "FacilityVisit_checkOutAt_idx" ON "FacilityVisit"("checkOutAt");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityPayment_facilityVisitId_key" ON "FacilityPayment"("facilityVisitId");

-- CreateIndex
CREATE INDEX "FacilityPayment_tenantId_idx" ON "FacilityPayment"("tenantId");

-- CreateIndex
CREATE INDEX "FacilityPayment_status_idx" ON "FacilityPayment"("status");

-- CreateIndex
CREATE INDEX "HospitalityPackage_organizationId_idx" ON "HospitalityPackage"("organizationId");

-- CreateIndex
CREATE INDEX "HospitalityPackage_hospitalityServiceId_idx" ON "HospitalityPackage"("hospitalityServiceId");

-- CreateIndex
CREATE INDEX "PackageEntitlement_packageId_idx" ON "PackageEntitlement"("packageId");

-- CreateIndex
CREATE INDEX "PackageEntitlement_stationId_idx" ON "PackageEntitlement"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageEntitlement_packageId_stationId_menuCategoryId_menuI_key" ON "PackageEntitlement"("packageId", "stationId", "menuCategoryId", "menuItemId");

-- CreateIndex
CREATE INDEX "PackageGuest_organizationId_idx" ON "PackageGuest"("organizationId");

-- CreateIndex
CREATE INDEX "PackageGuest_packageId_idx" ON "PackageGuest"("packageId");

-- CreateIndex
CREATE INDEX "PackageGuest_roomNumber_idx" ON "PackageGuest"("roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GuestFolio_packageGuestId_key" ON "GuestFolio"("packageGuestId");

-- CreateIndex
CREATE INDEX "GuestFolio_organizationId_idx" ON "GuestFolio"("organizationId");

-- CreateIndex
CREATE INDEX "GuestFolio_status_idx" ON "GuestFolio"("status");

-- CreateIndex
CREATE INDEX "GuestFolioEntry_folioId_idx" ON "GuestFolioEntry"("folioId");

-- CreateIndex
CREATE INDEX "GuestFolioEntry_orderId_idx" ON "GuestFolioEntry"("orderId");

-- CreateIndex
CREATE INDEX "PackageGuestEntitlementUsage_entitlementId_idx" ON "PackageGuestEntitlementUsage"("entitlementId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageGuestEntitlementUsage_packageGuestId_entitlementId_u_key" ON "PackageGuestEntitlementUsage"("packageGuestId", "entitlementId", "usageDate");

-- CreateIndex
CREATE INDEX "Order_packageGuestId_idx" ON "Order"("packageGuestId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_packageGuestId_fkey" FOREIGN KEY ("packageGuestId") REFERENCES "PackageGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "HospitalityPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalityService" ADD CONSTRAINT "HospitalityService_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipType" ADD CONSTRAINT "MembershipType_hospitalityServiceId_fkey" FOREIGN KEY ("hospitalityServiceId") REFERENCES "HospitalityService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_membershipTypeId_fkey" FOREIGN KEY ("membershipTypeId") REFERENCES "MembershipType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_hospitalityServiceId_fkey" FOREIGN KEY ("hospitalityServiceId") REFERENCES "HospitalityService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_customerMembershipId_fkey" FOREIGN KEY ("customerMembershipId") REFERENCES "CustomerMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityPayment" ADD CONSTRAINT "FacilityPayment_facilityVisitId_fkey" FOREIGN KEY ("facilityVisitId") REFERENCES "FacilityVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityPayment" ADD CONSTRAINT "FacilityPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalityPackage" ADD CONSTRAINT "HospitalityPackage_hospitalityServiceId_fkey" FOREIGN KEY ("hospitalityServiceId") REFERENCES "HospitalityService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEntitlement" ADD CONSTRAINT "PackageEntitlement_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "HospitalityPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEntitlement" ADD CONSTRAINT "PackageEntitlement_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "RestaurantStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEntitlement" ADD CONSTRAINT "PackageEntitlement_menuCategoryId_fkey" FOREIGN KEY ("menuCategoryId") REFERENCES "MenuCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEntitlement" ADD CONSTRAINT "PackageEntitlement_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageGuest" ADD CONSTRAINT "PackageGuest_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "HospitalityPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestFolio" ADD CONSTRAINT "GuestFolio_packageGuestId_fkey" FOREIGN KEY ("packageGuestId") REFERENCES "PackageGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestFolioEntry" ADD CONSTRAINT "GuestFolioEntry_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "GuestFolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageGuestEntitlementUsage" ADD CONSTRAINT "PackageGuestEntitlementUsage_packageGuestId_fkey" FOREIGN KEY ("packageGuestId") REFERENCES "PackageGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageGuestEntitlementUsage" ADD CONSTRAINT "PackageGuestEntitlementUsage_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "PackageEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

