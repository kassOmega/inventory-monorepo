// prisma/backfill-customer-permissions.ts
// Idempotent data backfill that brings existing roles up to the current CRM
// (`customers.*`) permission baseline.
//
// Default roles are cloned into an organization only once (at creation), so an
// org created before a permission was introduced keeps the old set forever. The
// Customers group (`customers.view` / `customers.manage`) was added with the CRM
// module, so without this backfill every Cashier/Storekeeper/Manager in an
// existing organization is missing the keys the customer directory, the customer
// picker on credits/sales and the timeline endpoints are gated on.
//
// This script grants the missing CRM keys (see
// src/common/customer-role-permissions.ts) to roles matched by their immutable
// `systemKey`. It is additive only — permissions are never removed — and skips
// roles the owner created by hand (no systemKey). Cross-vertical grants
// (credits, sales, finance, reports, …) are never touched.
//
// Safe to re-run: existing (roleId, permissionId) pairs are skipped.
//
// Usage:  npx ts-node prisma/backfill-customer-permissions.ts [--dry-run]
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../src/common/permissions';
import {
  CUSTOMER_ROLE_GRANTS,
  missingRoleGrants,
} from '../src/common/customer-role-permissions';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(
    DRY_RUN
      ? 'Customer (CRM) permission backfill — DRY RUN (nothing is written)\n'
      : 'Customer (CRM) permission backfill — applying\n',
  );

  // 1. Make sure every catalog key exists (including the newly added ones) so we
  //    have an id to link. Mirrors RolesService.findPermissions.
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

  // 2. Walk every default role that is linked to an organization.
  const roles = await prisma.role.findMany({
    where: { systemKey: { in: Object.keys(CUSTOMER_ROLE_GRANTS) } },
    include: {
      permissions: { include: { permission: { select: { key: true } } } },
      organization: { select: { id: true, name: true, businessType: true } },
    },
    orderBy: [{ organizationId: 'asc' }, { id: 'asc' }],
  });

  let touched = 0;
  let granted = 0;
  let clean = 0;
  const perOrg = new Map<number, number>();

  for (const role of roles) {
    const target = CUSTOMER_ROLE_GRANTS[role.systemKey!] ?? [];
    const existing = role.permissions.map((p) => p.permission.key);
    const missing = missingRoleGrants(existing, target);
    if (missing.length === 0) {
      clean += 1;
      continue;
    }

    const orgName = role.organization?.name ?? '(no organization)';
    const orgId = role.organization?.id ?? 0;
    console.log(
      `${DRY_RUN ? '→' : '✅'} ${orgName} (#${orgId}) ${role.name} [${role.systemKey}]`,
    );
    console.log(`     + ${missing.join(', ')}`);

    if (!DRY_RUN) {
      await prisma.rolePermission.createMany({
        data: missing.map((key) => ({
          roleId: role.id,
          permissionId: permissionIdByKey[key],
        })),
        skipDuplicates: true,
      });
    }
    touched += 1;
    granted += missing.length;
    perOrg.set(orgId, (perOrg.get(orgId) ?? 0) + missing.length);
  }

  const manual = await prisma.role.count({ where: { systemKey: null } });
  console.log(
    `\nDone. ${touched} role(s) updated, ${granted} permission grant(s) ${DRY_RUN ? 'pending' : 'written'}, ${clean} already current.`,
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
