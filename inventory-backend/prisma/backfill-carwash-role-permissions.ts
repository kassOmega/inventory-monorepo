// prisma/backfill-carwash-role-permissions.ts
// Idempotent data backfill that brings existing car-wash roles up to the
// `carwash.*` permission baseline (mirrors backfill-customer-permissions.ts).
//
// Unlike the CRM backfill (which is cross-vertical), car-wash keys must only be
// granted inside CAR_WASH organizations, so the walk is filtered by the org's
// businessType. Roles are matched by their immutable `systemKey` (OWNER, MANAGER,
// WASHER, CASHIER); hand-made roles (no systemKey) are left untouched.
//
// Safe to re-run: existing (roleId, permissionId) pairs are skipped.
//
// Usage:  npx ts-node prisma/backfill-carwash-role-permissions.ts [--dry-run]
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../src/common/permissions';
import {
  CAR_WASH_ROLE_GRANTS,
  missingRoleGrants,
} from '../src/common/carwash-role-permissions';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(
    DRY_RUN
      ? 'Car Wash permission backfill — DRY RUN (nothing is written)\n'
      : 'Car Wash permission backfill — applying\n',
  );

  // 1. Make sure every catalog key exists (including the newly added ones).
  const permissionIdByKey: Record<string, number> = {};
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label, group: p.group },
      create: { key: p.key, label: p.label, group: p.group },
    });
    permissionIdByKey[p.key] = row.id;
  }
  console.log(`• catalogue synced: ${PERMISSIONS.length} permission keys\n`);

  // 2. Walk default roles inside car-wash organizations only.
  const roles = await prisma.role.findMany({
    where: {
      systemKey: { in: Object.keys(CAR_WASH_ROLE_GRANTS) },
      organization: { businessType: 'CAR_WASH' },
    },
    include: {
      permissions: {
        include: { permission: { select: { id: true, key: true } } },
      },
      organization: { select: { id: true, name: true, businessType: true } },
    },
    orderBy: [{ organizationId: 'asc' }, { id: 'asc' }],
  });

  let touched = 0;
  let granted = 0;
  let revoked = 0;
  let clean = 0;
  const perOrg = new Map<number, number>();

  for (const role of roles) {
    const target = CAR_WASH_ROLE_GRANTS[role.systemKey!] ?? [];
    const existing = role.permissions.map((p) => p.permission.key);
    const missing = missingRoleGrants(existing, target);
    // System roles are reconciled EXACTLY to the target: the Washer baseline was
    // intentionally narrowed, so grants beyond it must be removed too. Owners can
    // re-grant extras per role afterwards.
    const targetSet = new Set(target);
    const extra = role.permissions.filter((p) => !targetSet.has(p.permission.key));
    if (missing.length === 0 && extra.length === 0) {
      clean += 1;
      continue;
    }

    const orgName = role.organization?.name ?? '(no organization)';
    const orgId = role.organization?.id ?? 0;
    console.log(
      `${DRY_RUN ? '→' : '✅'} ${orgName} (#${orgId}) ${role.name} [${role.systemKey}]`,
    );
    if (missing.length) console.log(`     + ${missing.join(', ')}`);
    if (extra.length) console.log(`     - ${extra.map((e) => e.permission.key).join(', ')}`);

    if (!DRY_RUN) {
      if (missing.length) {
        await prisma.rolePermission.createMany({
          data: missing.map((key) => ({
            roleId: role.id,
            permissionId: permissionIdByKey[key],
          })),
          skipDuplicates: true,
        });
      }
      if (extra.length) {
        await prisma.rolePermission.deleteMany({
          where: {
            roleId: role.id,
            permissionId: { in: extra.map((e) => e.permissionId) },
          },
        });
      }
    }
    touched += 1;
    granted += missing.length;
    revoked += extra.length;
    perOrg.set(orgId, (perOrg.get(orgId) ?? 0) + missing.length + extra.length);
  }

  const manual = await prisma.role.count({ where: { systemKey: null } });
  console.log(
    `\nDone. ${touched} role(s) updated, ${granted} grant(s), ${revoked} revoke(s) ${DRY_RUN ? 'pending' : 'written'}, ${clean} already current.`,
  );
  console.log(
    `     ${manual} hand-made role(s) left untouched (no systemKey), ${perOrg.size} organization(s) affected.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
