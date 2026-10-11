-- Public QR guest ordering: opaque-token public entries, guest orders, the
-- per-entry published catalog, the central-desk -> branch routing conversation,
-- and a phone blocklist. Idempotent.

-- --- Enums ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "PublicEntryKind" AS ENUM ('TABLE', 'HOTEL', 'SHOP', 'CARWASH_BAY', 'SERVICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PublicEntryState" AS ENUM ('LIVE', 'HELD', 'DROPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "GuestOrderStatus" AS ENUM (
    'SUBMITTED', 'REVIEWED', 'ROUTED', 'ACCEPTED', 'IN_PROGRESS',
    'COMPLETED', 'REJECTED', 'CANCELLED', 'DROPPED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- PublicEntry ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PublicEntry" (
  "id"         SERIAL PRIMARY KEY,
  "token"      TEXT NOT NULL,
  "tenantId"   INTEGER NOT NULL,
  "kind"       "PublicEntryKind" NOT NULL,
  "label"      TEXT NOT NULL,
  "tableId"    INTEGER,
  "locationId" INTEGER,
  "state"      "PublicEntryState" NOT NULL DEFAULT 'LIVE',
  "liveFrom"   TIMESTAMP(3),
  "liveUntil"  TIMESTAMP(3),
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PublicEntry_token_key" ON "PublicEntry" ("token");
CREATE INDEX IF NOT EXISTS "PublicEntry_tenantId_kind_idx" ON "PublicEntry" ("tenantId", "kind");
CREATE INDEX IF NOT EXISTS "PublicEntry_tenantId_locationId_idx" ON "PublicEntry" ("tenantId", "locationId");

DO $$ BEGIN
  ALTER TABLE "PublicEntry" ADD CONSTRAINT "PublicEntry_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PublicEntry" ADD CONSTRAINT "PublicEntry_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PublicEntry" ADD CONSTRAINT "PublicEntry_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- PublicEntryItem (published catalog, per entry) -------------------------
CREATE TABLE IF NOT EXISTS "PublicEntryItem" (
  "id"            SERIAL PRIMARY KEY,
  "entryId"       INTEGER NOT NULL,
  "itemKind"      TEXT NOT NULL,
  "itemId"        INTEGER NOT NULL,
  "priceOverride" DOUBLE PRECISION,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "active"        BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS "PublicEntryItem_entryId_itemKind_itemId_key"
  ON "PublicEntryItem" ("entryId", "itemKind", "itemId");
CREATE INDEX IF NOT EXISTS "PublicEntryItem_entryId_idx" ON "PublicEntryItem" ("entryId");
DO $$ BEGIN
  ALTER TABLE "PublicEntryItem" ADD CONSTRAINT "PublicEntryItem_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "PublicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- GuestOrder -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "GuestOrder" (
  "id"            SERIAL PRIMARY KEY,
  "token"         TEXT NOT NULL,
  "entryId"       INTEGER NOT NULL,
  "tenantId"      INTEGER NOT NULL,
  "status"        "GuestOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
  "customerId"    INTEGER,
  "customerName"  TEXT,
  "customerPhone" TEXT,
  "note"          TEXT,
  "orderId"       INTEGER,
  "saleId"        INTEGER,
  "bookingId"     INTEGER,
  "reservationId" INTEGER,
  "totalAmount"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "GuestOrder_token_key" ON "GuestOrder" ("token");
CREATE INDEX IF NOT EXISTS "GuestOrder_tenantId_status_idx" ON "GuestOrder" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "GuestOrder_entryId_createdAt_idx" ON "GuestOrder" ("entryId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "GuestOrder" ADD CONSTRAINT "GuestOrder_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "PublicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "GuestOrder" ADD CONSTRAINT "GuestOrder_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "GuestOrder" ADD CONSTRAINT "GuestOrder_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- GuestOrderItem ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "GuestOrderItem" (
  "id"           SERIAL PRIMARY KEY,
  "guestOrderId" INTEGER NOT NULL,
  "itemKind"     TEXT NOT NULL,
  "itemId"       INTEGER,
  "nameSnapshot" TEXT NOT NULL,
  "quantity"     INTEGER NOT NULL DEFAULT 1,
  "unitPrice"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes"        TEXT
);
CREATE INDEX IF NOT EXISTS "GuestOrderItem_guestOrderId_idx" ON "GuestOrderItem" ("guestOrderId");
DO $$ BEGIN
  ALTER TABLE "GuestOrderItem" ADD CONSTRAINT "GuestOrderItem_guestOrderId_fkey"
    FOREIGN KEY ("guestOrderId") REFERENCES "GuestOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- GuestOrderRoute (central desk -> branch conversation) -------------------
CREATE TABLE IF NOT EXISTS "GuestOrderRoute" (
  "id"            SERIAL PRIMARY KEY,
  "guestOrderId"  INTEGER NOT NULL,
  "locationId"    INTEGER NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'REQUESTED',
  "note"          TEXT,
  "respondedById" INTEGER,
  "respondedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "GuestOrderRoute_guestOrderId_locationId_key"
  ON "GuestOrderRoute" ("guestOrderId", "locationId");
CREATE INDEX IF NOT EXISTS "GuestOrderRoute_locationId_status_idx" ON "GuestOrderRoute" ("locationId", "status");
DO $$ BEGIN
  ALTER TABLE "GuestOrderRoute" ADD CONSTRAINT "GuestOrderRoute_guestOrderId_fkey"
    FOREIGN KEY ("guestOrderId") REFERENCES "GuestOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "GuestOrderRoute" ADD CONSTRAINT "GuestOrderRoute_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- GuestOrderActivity -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "GuestOrderActivity" (
  "id"           SERIAL PRIMARY KEY,
  "guestOrderId" INTEGER NOT NULL,
  "actorId"      INTEGER,
  "action"       TEXT NOT NULL,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "GuestOrderActivity_guestOrderId_createdAt_idx"
  ON "GuestOrderActivity" ("guestOrderId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "GuestOrderActivity" ADD CONSTRAINT "GuestOrderActivity_guestOrderId_fkey"
    FOREIGN KEY ("guestOrderId") REFERENCES "GuestOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- GuestBlocklist ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "GuestBlocklist" (
  "id"        SERIAL PRIMARY KEY,
  "tenantId"  INTEGER NOT NULL,
  "phone"     TEXT NOT NULL,
  "reason"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "GuestBlocklist_tenantId_phone_key"
  ON "GuestBlocklist" ("tenantId", "phone");
DO $$ BEGIN
  ALTER TABLE "GuestBlocklist" ADD CONSTRAINT "GuestBlocklist_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- Permissions ------------------------------------------------------------
INSERT INTO "Permission" ("key", "label", "group") VALUES
  ('guest-orders.view',   'View Guest Orders',   'Guest Orders'),
  ('guest-orders.manage', 'Manage Guest Orders', 'Guest Orders'),
  ('qr.manage',           'Manage QR & Public Links', 'Guest Orders')
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "group" = EXCLUDED."group";

-- Owner roles already hold every key via the seed; grant to Manager by default.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('guest-orders.view', 'guest-orders.manage', 'qr.manage')
WHERE r."systemKey" = 'MANAGER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
