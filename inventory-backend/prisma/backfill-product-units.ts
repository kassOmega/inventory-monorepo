// prisma/backfill-product-units.ts
//
// Idempotent data backfill for the multi-unit rollout. Safe to run on every
// deploy after the schema has been applied by either:
//   - `prisma db push` (the default production entrypoint), or
//   - `prisma migrate deploy`.
//
// It only fills missing data and never overwrites a product that already has a
// multi-unit ladder:
//   1. one ProductUnit row for legacy single-unit products,
//   2. Product.stockUnitId / historicalUnitId for those single-unit products,
//   3. SaleItem / ReturnItem unit snapshots for historical lines.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const productUnits = await prisma.$executeRawUnsafe(`
    INSERT INTO "ProductUnit"
      ("tenantId", "productId", "unitId", "perBase", "isBase", "isHistorical", "isDefaultSale", "sortOrder", "createdAt", "updatedAt")
    SELECT p."tenantId", p."id", p."unitId", 1, true, true, true, 0, NOW(), NOW()
    FROM "Product" p
    WHERE p."unitId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ProductUnit" pu WHERE pu."productId" = p."id"
      )
    ON CONFLICT ("productId", "unitId") DO NOTHING
  `);

  const products = await prisma.$executeRawUnsafe(`
    UPDATE "Product" p
    SET "stockUnitId" = COALESCE(p."stockUnitId", p."unitId"),
        "historicalUnitId" = COALESCE(p."historicalUnitId", p."unitId")
    WHERE p."unitId" IS NOT NULL
      AND (p."stockUnitId" IS NULL OR p."historicalUnitId" IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM "ProductUnit" pu
        WHERE pu."productId" = p."id" AND pu."isBase" = false
      )
  `);

  const saleItems = await prisma.$executeRawUnsafe(`
    UPDATE "SaleItem" si
    SET "unitId" = COALESCE(p."historicalUnitId", p."unitId"),
        "unitQuantity" = si."quantity",
        "unitPrice" = si."unitSellPrice",
        "stockQuantity" = si."quantity",
        "stockUnitId" = COALESCE(p."historicalUnitId", p."unitId"),
        "stockFactor" = 1
    FROM "Product" p
    WHERE si."productId" = p."id"
      AND si."unitId" IS NULL
      AND COALESCE(p."historicalUnitId", p."unitId") IS NOT NULL
  `);

  const returnItems = await prisma.$executeRawUnsafe(`
    UPDATE "ReturnItem" ri
    SET "unitId" = COALESCE(p."historicalUnitId", p."unitId"),
        "unitQuantity" = ri."quantity",
        "stockQuantity" = ri."quantity",
        "stockUnitId" = COALESCE(p."historicalUnitId", p."unitId"),
        "stockFactor" = 1
    FROM "Product" p
    WHERE ri."productId" = p."id"
      AND ri."unitId" IS NULL
      AND COALESCE(p."historicalUnitId", p."unitId") IS NOT NULL
  `);

  console.log(
    `[backfill-product-units] productUnits=${productUnits} products=${products} saleItems=${saleItems} returnItems=${returnItems}`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill-product-units] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
