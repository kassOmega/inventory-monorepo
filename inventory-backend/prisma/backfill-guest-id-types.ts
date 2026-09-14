// prisma/backfill-guest-id-types.ts
// Idempotent data backfill for the guest ID-type registry.
//
// The `20260914040000_hotel_pms_refactor` migration creates the GuestIdType
// table, but `prisma db push` (used by `npm run build` / `npm run db:push`) does
// NOT run bundled migrations, so existing hospitality organizations would have
// an empty registry and no ID type to pick at check-in. This seeds the standard
// defaults for every HOSPITALITY org that has none.
//
// Safe to re-run: orgs that already have at least one type are skipped, and the
// unique (tenantId, code) index makes a duplicate insert impossible.
//
// Usage:  npx ts-node prisma/backfill-guest-id-types.ts
import { BusinessType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Mirrors DEFAULT_GUEST_ID_TYPES in src/common/hospitality-settings.ts (kept
// inline so the script has no source-tree import dependency).
const DEFAULT_GUEST_ID_TYPES = [
  {
    code: 'NATIONAL_ID',
    name: 'National ID',
    nameI18n: { en: 'National ID', am: 'ብሔራዊ መታወቂያ' },
    requiresExpiry: false,
    sortOrder: 0,
  },
  {
    code: 'PASSPORT',
    name: 'Passport',
    nameI18n: { en: 'Passport', am: 'ፓስፖርት' },
    requiresExpiry: true,
    sortOrder: 1,
  },
  {
    code: 'DRIVERS_LICENSE',
    name: "Driver's License",
    nameI18n: { en: "Driver's License", am: 'የመንጃ ፈቃድ' },
    requiresExpiry: true,
    sortOrder: 2,
  },
  {
    code: 'OTHER',
    name: 'Other',
    nameI18n: { en: 'Other', am: 'ሌላ' },
    requiresExpiry: false,
    sortOrder: 3,
  },
];

async function main() {
  const orgs = await prisma.organization.findMany({
    where: { businessType: BusinessType.HOSPITALITY },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });

  let seeded = 0;
  let skipped = 0;
  for (const org of orgs) {
    const existing = await prisma.guestIdType.count({
      where: { tenantId: org.id },
    });
    if (existing > 0) {
      skipped += 1;
      console.log(
        `• ${org.name} (#${org.id}) already has ${existing} ID type(s) — skipped.`,
      );
      continue;
    }

    await prisma.guestIdType.createMany({
      data: DEFAULT_GUEST_ID_TYPES.map((t) => ({ tenantId: org.id, ...t })),
      skipDuplicates: true,
    });
    seeded += 1;
    console.log(
      `✅ ${org.name} (#${org.id}) seeded with ${DEFAULT_GUEST_ID_TYPES.length} ID types.`,
    );
  }

  console.log(
    `\nDone. ${seeded} organization(s) seeded, ${skipped} already configured.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
