-- SERVICE vertical schema. Purely additive CREATE TABLEs.

CREATE TYPE "ServiceBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "ServiceTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'PAID', 'CANCELLED');

CREATE TABLE "ServiceCategory" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceCategory_tenantId_idx" ON "ServiceCategory"("tenantId");

CREATE TABLE "ServiceItem" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "categoryId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceItem_tenantId_active_idx" ON "ServiceItem"("tenantId", "active");
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ServiceBooking" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "clientId" INTEGER,
    "serviceItemId" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "ServiceBookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceBooking_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceBooking_tenantId_startsAt_idx" ON "ServiceBooking"("tenantId", "startsAt");
CREATE INDEX "ServiceBooking_tenantId_status_idx" ON "ServiceBooking"("tenantId", "status");
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ServiceTicket" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "clientId" INTEGER,
    "bookingId" INTEGER,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ServiceTicketStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceTicket_bookingId_key" ON "ServiceTicket"("bookingId");
CREATE INDEX "ServiceTicket_tenantId_status_idx" ON "ServiceTicket"("tenantId", "status");
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ServiceBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ServiceTicketItem" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "ticketId" INTEGER NOT NULL,
    "serviceItemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "ServiceTicketItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceTicketItem_tenantId_idx" ON "ServiceTicketItem"("tenantId");
ALTER TABLE "ServiceTicketItem" ADD CONSTRAINT "ServiceTicketItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ServiceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceTicketItem" ADD CONSTRAINT "ServiceTicketItem_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ServicePayment" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "ticketId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" INTEGER,
    "paidById" INTEGER,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServicePayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServicePayment_tenantId_idx" ON "ServicePayment"("tenantId");
ALTER TABLE "ServicePayment" ADD CONSTRAINT "ServicePayment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ServiceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServicePayment" ADD CONSTRAINT "ServicePayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServicePayment" ADD CONSTRAINT "ServicePayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
