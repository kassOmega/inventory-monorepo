// prisma/backfill-standalone.ts
// Fixes the pre-multi-tenant "Standalone Shop" account (standalone@inventory.com):
// it was created with a role + shop location but NO organization membership, so
// it could log in but had no tenant context (broken dashboard) and was invisible
// to the platform admin. This gives it a real business + owner membership.
//
// Idempotent: skips if the user already has a membership.
// Usage:  npx ts-node prisma/backfill-standalone.ts
import { PrismaClient } from '@prisma/client';
import { BusinessType } from '@prisma/client';

const prisma = new PrismaClient();
const EMAIL = 'standalone@inventory.com';
const ORG_SLUG = 'meron-standalone';

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { memberships: { select: { organizationId: true } } },
  });
  if (!user) {
    console.log(`⚠️  ${EMAIL} not found — nothing to do.`);
    return;
  }

  if (user.memberships.length > 0) {
    console.log(
      `✅ ${EMAIL} already has ${user.memberships.length} membership(s) — nothing to do.`,
    );
    await ensureOwnerFlags(user.id);
    return;
  }

  // 1) The standalone business.
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { businessType: BusinessType.RETAIL, verificationStatus: 'APPROVED' },
    create: {
      name: 'Meron Standalone Shop',
      slug: ORG_SLUG,
      businessType: BusinessType.RETAIL,
      verificationStatus: 'APPROVED',
    },
  });

  // 2) The Owner (system) role for that org.
  const role = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Owner' } },
    update: { isSystem: true },
    create: { name: 'Owner', description: 'Full access to everything', isSystem: true, organizationId: org.id },
  });
  const ownerPerms = await prisma.permission.findMany({ select: { id: true } });
  await prisma.rolePermission.createMany({
    data: ownerPerms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  // 3) Membership so the account gets a tenant context.
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { roleId: role.id, status: 'ACTIVE' },
    create: { userId: user.id, organizationId: org.id, roleId: role.id, status: 'ACTIVE' },
  });

  // 4) Re-point the standalone shop location to this business.
  const loc = await prisma.location.findFirst({ where: { name: 'Standalone Shop' } });
  if (loc) {
    await prisma.location.update({ where: { id: loc.id }, data: { tenantId: org.id } });
    console.log(`📍 Re-pointed "${loc.name}" location (#${loc.id}) to org #${org.id}.`);
  }

  // 5) Make the user a visible, functional owner account.
  await ensureOwnerFlags(user.id);

  console.log(
    `✅ Fixed ${EMAIL}: org #${org.id} (${org.name}) + Owner membership created.`,
  );
}

async function ensureOwnerFlags(userId: number) {
  await prisma.user.update({
    where: { id: userId },
    data: { isOwnerAccount: true, verificationStatus: 'APPROVED' },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
