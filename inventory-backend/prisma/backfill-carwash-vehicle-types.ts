// prisma/backfill-carwash-vehicle-types.ts
// Idempotent data backfill: seeds a sensible default set of vehicle types for
// every CAR_WASH organization that has none. Safe to re-run.
//
// Usage:  npx ts-node prisma/backfill-carwash-vehicle-types.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_VEHICLE_TYPES = [
  'Car',
  'SUV',
  'Pickup',
  'Van',
  'Truck',
  'Bus',
  'Motorcycle',
  'Tricycle',
  'Other',
];

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { businessType: 'CAR_WASH' },
    select: { id: true },
  });

  let created = 0;
  for (const org of orgs) {
    for (const name of DEFAULT_VEHICLE_TYPES) {
      const existing = await prisma.carWashVehicleType.findFirst({
        where: { tenantId: org.id, name },
        select: { id: true },
      });
      if (!existing) {
        await prisma.carWashVehicleType.create({
          data: { tenantId: org.id, name },
        });
        created++;
      }
    }
  }

  console.log(
    `Seeded ${created} vehicle type(s) across ${orgs.length} car-wash org(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
