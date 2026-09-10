// prisma/backfill-verification.ts
// Idempotent data backfill for the account-verification feature.
//
// `prisma db push` (used by `npm run build`) does NOT run the bundled migration,
// so existing owner accounts / organizations would keep the new default status
// PENDING and get locked out. Run this once after the schema is pushed to mark
// pre-existing accounts as APPROVED (new accounts go through verification).
//
// Usage:  npx ts-node prisma/backfill-verification.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const owners = await prisma.user.updateMany({
    where: { isOwnerAccount: true },
    data: { verificationStatus: 'APPROVED', verificationNote: null },
  });
  console.log(`✅ Marked ${owners.count} existing owner account(s) as APPROVED.`);

  const orgs = await prisma.organization.updateMany({
    data: { verificationStatus: 'APPROVED', verificationNote: null },
  });
  console.log(`✅ Marked ${orgs.count} existing organization(s) as APPROVED.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
