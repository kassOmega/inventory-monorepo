// prisma/backfill-carwash-washer-accounts.ts
// One-time repair: give every car-wash washer that has no linked login account a
// User + ACTIVE membership (WASHER role) and link it, so the washer can sign in
// with their phone (or email). Idempotent — already-linked washers are skipped.
//
// New washers are provisioned automatically by createWasher/updateWasher; this
// only fixes rows created before that existed. A phone-only washer gets a
// placeholder email `washer+<digits>@carwash.local` and the default password.
//
// Usage:  npx ts-node prisma/backfill-carwash-washer-accounts.ts [--dry-run]
import { PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_PASSWORD = '123456';

function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const plus = t.startsWith('+');
  const digits = t.replace(/\D/g, '');
  if (!digits) return null;
  return (plus ? '+' : '') + digits;
}

async function main() {
  console.log(
    DRY_RUN
      ? 'Car-wash washer account backfill — DRY RUN\n'
      : 'Car-wash washer account backfill — applying\n',
  );

  const washers = await prisma.carWashWasher.findMany({
    where: { userId: null },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  });

  const hashed = DRY_RUN ? '' : await bcrypt.hash(DEFAULT_PASSWORD, 10);
  let created = 0;
  let skipped = 0;

  for (const w of washers) {
    const phone = normPhone(w.phone);
    if (!phone) {
      skipped++;
      console.log(`- skip #${w.id} ${w.name} (no phone)`);
      continue;
    }
    const email = `washer+${phone.replace(/\D/g, '')}@carwash.local`;
    console.log(
      `${DRY_RUN ? '→' : '✅'} org#${w.tenantId} ${w.organization?.name ?? ''} washer #${w.id} ${w.name} -> ${email}`,
    );
    if (!DRY_RUN) {
      await prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: { email } });
        if (!user) {
          user = await tx.user.create({
            data: { email, password: hashed, name: w.name, phone },
          });
        } else if (!user.phone) {
          user = await tx.user.update({
            where: { id: user.id },
            data: { phone },
          });
        }
        const role = await tx.role.findFirst({
          where: { organizationId: w.tenantId, systemKey: 'WASHER' },
        });
        if (role) {
          const existing = await tx.membership.findFirst({
            where: { userId: user.id, organizationId: w.tenantId },
          });
          if (!existing) {
            await tx.membership.create({
              data: {
                userId: user.id,
                organizationId: w.tenantId,
                roleId: role.id,
                status: UserStatus.ACTIVE,
              },
            });
          }
        }
        await tx.carWashWasher.update({
          where: { id: w.id },
          data: { userId: user.id },
        });
      });
      created++;
    }
  }

  console.log(
    `\nDone. ${DRY_RUN ? 'would link' : 'linked'} ${DRY_RUN ? washers.length - skipped : created} washer(s), skipped ${skipped} (no phone).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
