-- Product-specific unit ladder.
-- `perBase` = how many of this unit are in ONE base unit. Base row = 1,
-- lower units > 1; the largest perBase is the stock unit.

ALTER TABLE "Product"
  ADD COLUMN "stockUnitId" INTEGER,
  ADD COLUMN "historicalUnitId" INTEGER;

ALTER TABLE "SaleItem"
  ADD COLUMN "unitId" INTEGER,
  ADD COLUMN "unitQuantity" DOUBLE PRECISION,
  ADD COLUMN "unitPrice" DOUBLE PRECISION,
  ADD COLUMN "stockQuantity" DOUBLE PRECISION,
  ADD COLUMN "stockUnitId" INTEGER,
  ADD COLUMN "stockFactor" DOUBLE PRECISION;

ALTER TABLE "ProductVariant"
  ADD COLUMN "unitPrices" JSONB;

ALTER TABLE "ReturnItem"
  ADD COLUMN "unitId" INTEGER,
  ADD COLUMN "unitQuantity" DOUBLE PRECISION,
  ADD COLUMN "stockQuantity" DOUBLE PRECISION,
  ADD COLUMN "stockUnitId" INTEGER,
  ADD COLUMN "stockFactor" DOUBLE PRECISION;

CREATE TABLE "ProductUnit" (
  "id" SERIAL NOT NULL,
  "tenantId" INTEGER,
  "productId" INTEGER NOT NULL,
  "unitId" INTEGER NOT NULL,
  "perBase" INTEGER NOT NULL,
  "isBase" BOOLEAN NOT NULL DEFAULT false,
  "isHistorical" BOOLEAN NOT NULL DEFAULT false,
  "isDefaultSale" BOOLEAN NOT NULL DEFAULT false,
  "buyPrice" DOUBLE PRECISION,
  "sellPrice" DOUBLE PRECISION,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductUnit_productId_idx" ON "ProductUnit"("productId");
CREATE INDEX "ProductUnit_tenantId_idx" ON "ProductUnit"("tenantId");
CREATE INDEX "ProductUnit_unitId_idx" ON "ProductUnit"("unitId");
CREATE UNIQUE INDEX "ProductUnit_productId_unitId_key" ON "ProductUnit"("productId", "unitId");
CREATE INDEX "SaleItem_unitId_idx" ON "SaleItem"("unitId");
CREATE INDEX "SaleItem_stockUnitId_idx" ON "SaleItem"("stockUnitId");
CREATE INDEX "ReturnItem_unitId_idx" ON "ReturnItem"("unitId");
CREATE INDEX "ReturnItem_stockUnitId_idx" ON "ReturnItem"("stockUnitId");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_stockUnitId_fkey"
  FOREIGN KEY ("stockUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_historicalUnitId_fkey"
  FOREIGN KEY ("historicalUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductUnit"
  ADD CONSTRAINT "ProductUnit_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductUnit"
  ADD CONSTRAINT "ProductUnit_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_stockUnitId_fkey"
  FOREIGN KEY ("stockUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReturnItem"
  ADD CONSTRAINT "ReturnItem_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReturnItem"
  ADD CONSTRAINT "ReturnItem_stockUnitId_fkey"
  FOREIGN KEY ("stockUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- Backfill existing products as single-unit products -------------------
-- The product's current unit becomes its base, default sale and historical unit.
INSERT INTO "ProductUnit"
  ("tenantId", "productId", "unitId", "perBase", "isBase", "isHistorical", "isDefaultSale", "sortOrder", "createdAt", "updatedAt")
SELECT
  "tenantId", "id", "unitId", 1, true, true, true, 0, NOW(), NOW()
FROM "Product"
WHERE "unitId" IS NOT NULL
ON CONFLICT ("productId", "unitId") DO NOTHING;

UPDATE "Product"
SET "stockUnitId" = "unitId", "historicalUnitId" = "unitId"
WHERE "unitId" IS NOT NULL;

-- Existing transaction lines are explicitly recorded in the historical unit.
UPDATE "SaleItem" si
SET
  "unitId" = p."historicalUnitId",
  "unitQuantity" = si."quantity",
  "unitPrice" = si."unitSellPrice",
  "stockQuantity" = si."quantity",
  "stockUnitId" = p."historicalUnitId",
  "stockFactor" = 1
FROM "Product" p
WHERE si."productId" = p."id" AND p."historicalUnitId" IS NOT NULL;

UPDATE "ReturnItem" ri
SET
  "unitId" = p."historicalUnitId",
  "unitQuantity" = ri."quantity",
  "stockQuantity" = ri."quantity",
  "stockUnitId" = p."historicalUnitId",
  "stockFactor" = 1
FROM "Product" p
WHERE ri."productId" = p."id" AND p."historicalUnitId" IS NOT NULL;
