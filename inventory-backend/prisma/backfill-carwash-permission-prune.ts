// prisma/backfill-carwash-permission-prune.ts
// Idempotent data backfill that removes foreign-vertical permission grants from
// CAR_WASH organizations.
//
// The permission catalog is filtered per business type by
// `PERMISSION_GROUPS_BY_BUSINESS_TYPE` (see src/common/permissions.ts), but
// roles created before that filter existed (or during the shared-role-template
// era) can still hold keys from other verticals — e.g. `products.*`,
// `reports.*`, `finance.*` on a car-wash role. Those stale grants make the
// Roles & Permissions editor show other businesses' groups and let the role
// reach routes the car-wash vertical does not own.
//
// This script deletes every (role, permission) pair whose permission group is
// not in the CAR_WASH allow-list, for both system roles (OWNER/MANAGER/…, keyed
// by `systemKey`) and hand-made roles inside CAR_WASH organizations.
//
// Safe to re-run: only out-of-catalog pairs are removed.
//
// Usage:  npx ts-node prisma/backfill-carwash-permission-prune.ts [--dry-run]
import { PrismaClient } from '@prisma/client';
import { PERMISSION_GROUPS_BY_BUSINESS_TYPE } from '../src/common/permissions';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const CAR_WASH_GROUPS = new Set(
  PERMISSION_GROUPS_BY_BUSINESS_TYPE.CAR_WASH ?? [],
);

async function main() {
  console.log(
    DRY_RUN
      ? 'Car Wash permission prune — DRY RUN (nothing is written)\n'
      : 'Car Wash permission prune — applying\n',
  );

  const roles = await prisma.role.findMany({
    where: { organization: { businessType: 'CAR_WASH' } },
    include: {
      permissions: {
        include: { permission: { select: { id: true, key: true, group: true } } },
      },
      organization: { select: { id: true, name: true } },
    },
    orderBy: [{ organizationId: 'asc' }, { id: 'asc' }],
  });

  let rolesTouched = 0;
  let removed = 0;
  let clean = 0;
  const perOrg = new Map<number, number>();

  for (const role of roles) {
    const foreign = role.permissions.filter(
      (rp) => !CAR_WASH_GROUPS.has(rp.permission.group),
    );
    if (foreign.length === 0) {
      clean += 1;
      continue;
    }

    const orgName = role.organization?.name ?? '(no organization)';
    const orgId = role.organization?.id ?? 0;
    console.log(
      `${DRY_RUN ? '→' : '✅'} ${orgName} (#${orgId}) ${role.name}${role.systemKey ? ` [${role.systemKey}]` : ''}`,
    );
    console.log(
      `     - ${foreign.map((f) => `${f.permission.key} (${f.permission.group})`).join(', ')}`,
    );

    if (!DRY_RUN) {
      await prisma.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: { in: foreign.map((f) => f.permissionId) },
        },
      });
    }
    rolesTouched += 1;
    removed += foreign.length;
    perOrg.set(orgId, (perOrg.get(orgId) ?? 0) + foreign.length);
  }

  console.log(
    `\nDone. ${rolesTouched} role(s) pruned, ${removed} foreign grant(s) ${DRY_RUN ? 'pending' : 'removed'}, ${clean} already clean.`,
  );
  console.log(`     ${perOrg.size} organization(s) affected.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
