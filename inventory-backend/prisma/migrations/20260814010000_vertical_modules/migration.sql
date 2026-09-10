-- Vertical modules: Finance (chart of accounts, journal, expenses, income),
-- Restaurant (menu, tables, orders, reservations) and Hotel (rooms, reservations,
-- folio billing). All new tables are additive; tenantId is nullable and backfilled
-- by the application's tenant-scoping middleware.

-- 1) Enums
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED', 'PAID', 'CANCELLED');
CREATE TYPE "OrderItemStatus" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'SERVED');
CREATE TYPE "TableStatus" AS ENUM ('FREE', 'OCCUPIED', 'RESERVED', 'CLEANING');
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'DIRTY', 'MAINTENANCE');
CREATE TYPE "HotelReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

-- 2) Finance tables
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "AccountType" NOT NULL,
    "parentId" INTEGER,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalEntry" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "reference" TEXT,
    "description" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "journalEntryId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "category" TEXT,
    "vendor" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" INTEGER,
    "notes" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OtherIncome" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "incomeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtherIncome_pkey" PRIMARY KEY ("id")
);

-- 3) Restaurant tables
CREATE TABLE "MenuCategory" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MenuItem" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "menuCategoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MenuItemOption" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "menuItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "extraPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "MenuItemOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiningTable" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "status" "TableStatus" NOT NULL DEFAULT 'FREE',
    CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "orderNumber" TEXT NOT NULL,
    "tableId" INTEGER,
    "customerName" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "serviceCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMethodId" INTEGER,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "orderId" INTEGER NOT NULL,
    "menuItemId" INTEGER,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'QUEUED',
    "notes" TEXT,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reservation" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "tableId" INTEGER,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "reservedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- 4) Hotel tables
CREATE TABLE "RoomType" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "basePrice" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "RoomType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Room" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "roomTypeId" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "floor" TEXT,
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HotelReservation" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "roomId" INTEGER NOT NULL,
    "guestName" TEXT NOT NULL,
    "phone" TEXT,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "status" "HotelReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HotelReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Folio" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "reservationId" INTEGER NOT NULL,
    "guestName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Folio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FolioEntry" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "folioId" INTEGER NOT NULL,
    "accountId" INTEGER,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CHARGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    CONSTRAINT "FolioEntry_pkey" PRIMARY KEY ("id")
);

-- 5) Indexes
CREATE UNIQUE INDEX "Account_tenantId_name_type_key" ON "Account"("tenantId", "name", "type");
CREATE INDEX "Account_tenantId_idx" ON "Account"("tenantId");
CREATE INDEX "Account_type_idx" ON "Account"("type");

CREATE INDEX "JournalEntry_tenantId_idx" ON "JournalEntry"("tenantId");
CREATE INDEX "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");

CREATE INDEX "JournalLine_tenantId_idx" ON "JournalLine"("tenantId");
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

CREATE INDEX "Expense_tenantId_idx" ON "Expense"("tenantId");
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

CREATE INDEX "OtherIncome_tenantId_idx" ON "OtherIncome"("tenantId");
CREATE INDEX "OtherIncome_incomeDate_idx" ON "OtherIncome"("incomeDate");

CREATE INDEX "MenuCategory_tenantId_idx" ON "MenuCategory"("tenantId");

CREATE INDEX "MenuItem_tenantId_idx" ON "MenuItem"("tenantId");
CREATE INDEX "MenuItem_menuCategoryId_idx" ON "MenuItem"("menuCategoryId");

CREATE INDEX "MenuItemOption_tenantId_idx" ON "MenuItemOption"("tenantId");
CREATE INDEX "MenuItemOption_menuItemId_idx" ON "MenuItemOption"("menuItemId");

CREATE UNIQUE INDEX "DiningTable_tenantId_name_key" ON "DiningTable"("tenantId", "name");
CREATE INDEX "DiningTable_tenantId_idx" ON "DiningTable"("tenantId");

CREATE UNIQUE INDEX "Order_tenantId_orderNumber_key" ON "Order"("tenantId", "orderNumber");
CREATE INDEX "Order_tenantId_idx" ON "Order"("tenantId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

CREATE INDEX "OrderItem_tenantId_idx" ON "OrderItem"("tenantId");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

CREATE INDEX "Reservation_tenantId_idx" ON "Reservation"("tenantId");
CREATE INDEX "Reservation_reservedAt_idx" ON "Reservation"("reservedAt");

CREATE INDEX "RoomType_tenantId_idx" ON "RoomType"("tenantId");

CREATE UNIQUE INDEX "Room_tenantId_number_key" ON "Room"("tenantId", "number");
CREATE INDEX "Room_tenantId_idx" ON "Room"("tenantId");
CREATE INDEX "Room_roomTypeId_idx" ON "Room"("roomTypeId");

CREATE INDEX "HotelReservation_tenantId_idx" ON "HotelReservation"("tenantId");
CREATE INDEX "HotelReservation_checkIn_idx" ON "HotelReservation"("checkIn");
CREATE INDEX "HotelReservation_checkOut_idx" ON "HotelReservation"("checkOut");
CREATE INDEX "HotelReservation_roomId_idx" ON "HotelReservation"("roomId");

CREATE INDEX "Folio_tenantId_idx" ON "Folio"("tenantId");
CREATE INDEX "Folio_reservationId_idx" ON "Folio"("reservationId");

CREATE INDEX "FolioEntry_tenantId_idx" ON "FolioEntry"("tenantId");
CREATE INDEX "FolioEntry_folioId_idx" ON "FolioEntry"("folioId");

-- 6) Foreign keys
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_menuCategoryId_fkey" FOREIGN KEY ("menuCategoryId") REFERENCES "MenuCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItemOption" ADD CONSTRAINT "MenuItemOption_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Room" ADD CONSTRAINT "Room_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HotelReservation" ADD CONSTRAINT "HotelReservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Folio" ADD CONSTRAINT "Folio_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "HotelReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FolioEntry" ADD CONSTRAINT "FolioEntry_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolioEntry" ADD CONSTRAINT "FolioEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;


