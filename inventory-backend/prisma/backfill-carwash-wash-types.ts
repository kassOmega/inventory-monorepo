// prisma/backfill-carwash-wash-types.ts
// Idempotent data backfill: seeds a sensible default set of wash types for
// every CAR_WASH organization that has none, so the wash-type dropdown and the
// price matrix work out of the box. Safe to re-run.
//
// Usage:  npx ts-node prisma/backfill-carwash-wash-types.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_WASH_TYPES = ['Premium', 'Normal', 'Half', 'Full', 'Body'];

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { businessType: 'CAR_WASH' },
    select: { id: true, name: true },
  });

  let created = 0;
  for (const org of orgs) {
    for (const name of DEFAULT_WASH_TYPES) {
      const existing = await prisma.carWashWashType.findFirst({
        where: { tenantId: org.id, name },
        select: { id: true },
      });
      if (!existing) {
        await prisma.carWashWashType.create({
          data: { tenantId: org.id, name },
        });
        created++;
      }
    }
  }

  console.log(
    `Seeded ${created} wash type(s) across ${orgs.length} car-wash org(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
