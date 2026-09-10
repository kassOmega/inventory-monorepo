// prisma/backfill-beverage-categories.ts
// Idempotent data backfill for the finance-engine sub-category feature.
//
// `prisma db push` (used by `npm run build`) does NOT run the bundled migration,
// so existing hospitality organizations won't get the "Beverages" parent menu
// category with Beer / Wine / Alcohol / Hot Drinks as children. Run this once
// after the schema is pushed so the Finance & Reports pages can filter deep
// sub-categories per industry.
//
// Usage:  npx ts-node prisma/backfill-beverage-categories.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BEVERAGE_CHILDREN = [
  'Water',
  'Beer',
  'Wine',
  'Alcohol',
  'Hot Drinks',
  'Latte',
];

async function main() {
  const orgs = await prisma.restaurantStation.groupBy({
    by: ['tenantId'],
    _count: { _all: true },
  });

  let orgsSeeded = 0;
  for (const row of orgs) {
    const tenantId = row.tenantId;
    if (tenantId == null) continue;

    const existing = await prisma.menuCategory.findFirst({
      where: { tenantId, name: 'Beverages', parentId: null },
      select: { id: true },
    });
    if (existing) continue;

    const bar = await prisma.restaurantStation.findFirst({
      where: { tenantId, key: 'bar' },
      select: { id: true, name: true },
    });
    if (!bar) continue;

    const parent = await prisma.menuCategory.create({
      data: {
        tenantId,
        name: 'Beverages',
        sortOrder: 50,
        stationId: bar.id,
        stationRoute: [{ id: bar.id, name: bar.name, key: 'bar' }],
      },
      select: { id: true },
    });

    await prisma.menuCategory.updateMany({
      where: { tenantId, name: { in: BEVERAGE_CHILDREN }, parentId: null },
      data: { parentId: parent.id },
    });
    orgsSeeded += 1;
  }

  console.log(
    `✅ Seeded Beverages sub-category hierarchy for ${orgsSeeded} hospitality organization(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
