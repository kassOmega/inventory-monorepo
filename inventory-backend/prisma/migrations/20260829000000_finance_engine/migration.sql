-- Finance Engine: auto-posted COGS ledger + hospitality sub-categories.
-- 1) MenuCategory gains an optional parent (Beverages -> Beer / Wine / Spirits).
-- 2) New CogsEntry table records COGS at the exact moment of each sale.
-- 3) Account links to CogsEntry rows.
-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN "parentId" INTEGER;

-- CreateTable
CREATE TABLE "CogsEntry" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "source" TEXT,
    "sourceId" INTEGER,
    "saleId" INTEGER,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,

    CONSTRAINT "CogsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuCategory_parentId_idx" ON "MenuCategory"("parentId");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_idx" ON "CogsEntry"("tenantId");

-- CreateIndex
CREATE INDEX "CogsEntry_source_sourceId_idx" ON "CogsEntry"("source", "sourceId");

-- CreateIndex
CREATE INDEX "CogsEntry_entryDate_idx" ON "CogsEntry"("entryDate");

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MenuCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CogsEntry" ADD CONSTRAINT "CogsEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: for each existing hospitality org create a "Beverages" parent menu
-- category on the Bar station and attach the standard drink categories (Beer /
-- Wine / Alcohol / Hot Drinks / ...) as sub-categories so the Finance & Reports
-- pages can filter deep sub-categories per industry.
DO $$
DECLARE
  org RECORD;
  bar_id INTEGER;
  beverages_id INTEGER;
  child_name TEXT;
BEGIN
  FOR org IN SELECT DISTINCT "tenantId" AS tid
             FROM "RestaurantStation"
             WHERE "tenantId" IS NOT NULL
  LOOP
    SELECT s."id" INTO bar_id
    FROM "RestaurantStation" s
    WHERE s."tenantId" = org.tid AND s."key" = 'bar'
    LIMIT 1;
    IF bar_id IS NULL THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM "MenuCategory"
      WHERE "tenantId" = org.tid AND "name" = 'Beverages' AND "parentId" IS NULL
    ) THEN CONTINUE; END IF;

    INSERT INTO "MenuCategory" ("tenantId", "name", "sortOrder", "stationId", "stationRoute")
    VALUES (
      org.tid, 'Beverages', 50, bar_id,
      jsonb_build_array(jsonb_build_object('id', bar_id, 'name', 'Bar', 'key', 'bar'))
    )
    RETURNING "id" INTO beverages_id;

    FOREACH child_name IN ARRAY ARRAY['Water', 'Beer', 'Wine', 'Alcohol', 'Hot Drinks', 'Latte']
    LOOP
      UPDATE "MenuCategory" SET "parentId" = beverages_id
      WHERE "tenantId" = org.tid AND "name" = child_name AND "parentId" IS NULL;
    END LOOP;
  END LOOP;
END $$;

