// prisma/backfill-phantom-inventory.ts
//
// Removes "phantom" inventory rows: rows with `variantId = NULL` that belong to a
// product which HAS variants. Stock for a variant product lives on its variant
// rows, so such a row is never legitimate — the old stock-adjustment endpoint
// created them (it hardcoded `variantId: null`), and each one inflates the
// product's totals and confuses the low-stock checks.
//
//   npx ts-node prisma/backfill-phantom-inventory.ts            # dry run (default)
//   npx ts-node prisma/backfill-phantom-inventory.ts --apply    # delete them
//
// The dry run prints every row it would remove (product, location, quantity,
// average cost) so the real count can be re-entered through
// Products → Adjust Stock (pick the variant).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const rows = await prisma.inventory.findMany({
    where: { variantId: null, product: { hasVariants: true } },
    include: {
      product: { select: { id: true, brand: true, baseName: true } },
      location: { select: { id: true, name: true, type: true } },
    },
    orderBy: { id: 'asc' },
  });

  if (rows.length === 0) {
    console.log('No phantom inventory rows found — nothing to do.');
    return;
  }

  console.log(
    `Found ${rows.length} phantom row(s) (variantId = NULL on a variant product):\n`,
  );
  for (const r of rows) {
    console.log(
      `  id=${r.id} | ${r.product.brand} ${r.product.baseName} (#${r.productId}) | ` +
        `${r.location.name} (${r.location.type}) | qty=${r.quantity} avgCost=${r.avgCost}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing was deleted. Re-run with --apply to remove them.');
    return;
  }

  const deleted = await prisma.inventory.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });
  console.log(`\nDeleted ${deleted.count} phantom row(s).`);
  console.log(
    'Re-enter any real stock per variant via Products → Adjust Stock (choose the variant).',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
