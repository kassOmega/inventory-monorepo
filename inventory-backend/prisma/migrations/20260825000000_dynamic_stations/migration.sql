-- Dynamic hospitality stations + multi-hop routing.
-- Replaces the hardcoded Station enum with an owner-managed per-org table.

-- 1) Stations table
CREATE TABLE "RestaurantStation" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" INTEGER,
  "name" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "roleName" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RestaurantStation_tenantId_key_key" ON "RestaurantStation"("tenantId", "key");
CREATE INDEX "RestaurantStation_tenantId_idx" ON "RestaurantStation"("tenantId");

-- 2) Backfill the default stations for every tenant that has used them
INSERT INTO "RestaurantStation" ("tenantId", "name", "key", "roleName", "sortOrder")
SELECT DISTINCT "tenantId", 'Kitchen', 'kitchen', 'Chef', 0 FROM "MenuCategory" WHERE "tenantId" IS NOT NULL AND "station" = 'KITCHEN'
UNION
SELECT DISTINCT "tenantId", 'Bar', 'bar', 'Barman', 1 FROM "MenuCategory" WHERE "tenantId" IS NOT NULL AND "station" = 'BAR'
UNION
SELECT DISTINCT "tenantId", 'Barista', 'barista', 'Barista', 2 FROM "MenuCategory" WHERE "tenantId" IS NOT NULL AND "station" = 'BARISTA';

-- 3) New columns
ALTER TABLE "MenuCategory" ADD COLUMN "stationId" INTEGER;
ALTER TABLE "MenuCategory" ADD COLUMN "stationRoute" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MenuItem" ADD COLUMN "stationRoute" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "stationRoute" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "OrderItem" ADD COLUMN "stationIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "stationKey" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "stationName" TEXT;

-- 4) Map existing menu-category enum values -> station + route
UPDATE "MenuCategory" mc
SET "stationId" = rs."id",
    "stationRoute" = jsonb_build_array(jsonb_build_object('id', rs."id", 'name', rs."name", 'key', rs."key"))
FROM "RestaurantStation" rs
WHERE rs."tenantId" = mc."tenantId"
  AND rs."key" = lower(mc."station"::text);

-- 5) Map existing order-item enum values -> current-hop snapshot + route
UPDATE "OrderItem" oi
SET "stationKey" = lower(oi."station"::text),
    "stationName" = initcap(lower(oi."station"::text)),
    "stationRoute" = jsonb_build_array(jsonb_build_object('id', NULL, 'name', initcap(lower(oi."station"::text)), 'key', lower(oi."station"::text)))
WHERE oi."station" IS NOT NULL;

-- 6) FK + drop the old column(s) and the enum type
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "RestaurantStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MenuCategory_stationId_idx" ON "MenuCategory"("stationId");

ALTER TABLE "MenuCategory" DROP COLUMN "station";
ALTER TABLE "OrderItem" DROP COLUMN "station";
DROP TYPE "Station";

-- 7) OrderStatus: SENT_TO_KITCHEN -> DISPATCHED (stations are dynamic now)
ALTER TYPE "OrderStatus" RENAME VALUE 'SENT_TO_KITCHEN' TO 'DISPATCHED';
