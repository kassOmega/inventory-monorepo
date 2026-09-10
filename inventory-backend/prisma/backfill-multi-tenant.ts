// prisma/backfill-multi-tenant.ts
// Idempotent data migration for the multi-tenancy foundation.
//
// Run once after applying the schema changes (either via `prisma migrate deploy`
// with the bundled migration, or `prisma migrate dev` which generates its own
// DDL). This script:
//   1. Ensures the default Organization exists (the current electrical business).
//   2. Scopes every existing role and business row to that organization.
//   3. Creates a Membership for each existing user.
//
// Usage:  npx ts-node prisma/backfill-multi-tenant.ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PERMISSIONS } from '../src/common/permissions';
import { getDefaultAccounts } from '../src/common/verticals';

const prisma = new PrismaClient();
const DEFAULT_SLUG = 'nejat-electrical';

async function main() {
  console.log('🏢 Ensuring default organization exists…');
  let org = await prisma.organization.findUnique({ where: { slug: DEFAULT_SLUG } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Nejat Electrical', slug: DEFAULT_SLUG, businessType: 'RETAIL' },
    });
    console.log(`  Created default organization #${org.id}`);
  } else {
    console.log(`  Default organization already exists #${org.id}`);
  }

  console.log('🔐 Scoping existing roles…');
  const orphanRoles = await prisma.role.findMany({ where: { organizationId: null } });
  for (const role of orphanRoles) {
    const existing = await prisma.role.findFirst({
      where: { organizationId: org.id, name: role.name },
    });
    if (existing) {
      // The org already has a role with this name — re-point any references to it
      // and drop the orphan (avoids the (organizationId, name) unique clash).
      await prisma.membership.updateMany({ where: { roleId: role.id }, data: { roleId: existing.id } });
      await prisma.user.updateMany({ where: { roleId: role.id }, data: { roleId: existing.id } });
      await prisma.role.delete({ where: { id: role.id } });
      console.log(`  Merged orphan role "${role.name}" into #${existing.id}`);
    } else {
      await prisma.role.update({ where: { id: role.id }, data: { organizationId: org.id } });
      console.log(`  Scoped role "${role.name}" to organization #${org.id}`);
    }
  }

  console.log('📦 Scoping business rows…');
  const tables: Array<{ name: string; model: any }> = [
    { name: 'LocationCategory', model: prisma.locationCategory },
    { name: 'Location', model: prisma.location },
    { name: 'Category', model: prisma.category },
    { name: 'Product', model: prisma.product },
    { name: 'Unit', model: prisma.unit },
    { name: 'PriceHistory', model: prisma.priceHistory },
    { name: 'Inventory', model: prisma.inventory },
    { name: 'StockRequest', model: prisma.stockRequest },
    { name: 'RequestItem', model: prisma.requestItem },
    { name: 'Sale', model: prisma.sale },
    { name: 'SaleItem', model: prisma.saleItem },
    { name: 'Return', model: prisma.return },
    { name: 'ReturnItem', model: prisma.returnItem },
    { name: 'PaymentMethod', model: prisma.paymentMethod },
    { name: 'Customer', model: prisma.customer },
    { name: 'CreditSale', model: prisma.creditSale },
    { name: 'CreditSaleItem', model: prisma.creditSaleItem },
    { name: 'CreditPayment', model: prisma.creditPayment },
    { name: 'Purchase', model: prisma.purchase },
    { name: 'Notification', model: prisma.notification },
    { name: 'AuditLog', model: prisma.auditLog },
  ];

  for (const { name, model } of tables) {
    const res = await model.updateMany({
      where: { tenantId: null },
      data: { tenantId: org.id },
    });
    if (res.count) console.log(`  Scoped ${res.count} rows in ${name}`);
  }

  console.log('👥 Creating memberships for existing users…');
  const users = await prisma.user.findMany({
    where: { roleId: { not: null }, memberships: { none: { organizationId: org.id } } },
    select: { id: true, roleId: true },
  });
  for (const u of users) {
    await prisma.membership.create({
      data: { userId: u.id, organizationId: org.id, roleId: u.roleId, status: 'ACTIVE' },
    });
  }
  console.log(`  Created ${users.length} memberships`);

  console.log('🔑 Upserting permission catalog…');
  const permissionIdByKey: Record<string, number> = {};
  for (const p of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label, group: p.group },
      create: { key: p.key, label: p.label, group: p.group },
    });
    permissionIdByKey[p.key] = perm.id;
  }

  // Grant the full catalog to every system Owner role (one per organization) so
  // owners of every business see all modules. (Previously only the first system
  // role was targeted, leaving per-org Owner roles with zero permissions.)
  const ownerRoles = await prisma.role.findMany({ where: { isSystem: true } });
  for (const ownerRole of ownerRoles) {
    for (const p of PERMISSIONS) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: ownerRole.id, permissionId: permissionIdByKey[p.key] } },
        update: {},
        create: { roleId: ownerRole.id, permissionId: permissionIdByKey[p.key] },
      });
    }
  }
  console.log(`  Granted full catalog to ${ownerRoles.length} Owner role(s)`);

  console.log('📊 Seeding default chart of accounts…');
  const accounts = getDefaultAccounts(org.businessType);
  await prisma.account.createMany({
    data: accounts.map((a) => ({
      tenantId: org.id,
      name: a.name,
      code: a.code,
      type: a.type,
      isSystem: a.isSystem ?? false,
    })),
    skipDuplicates: true,
  });
  console.log(`  Seeded ${accounts.length} accounts`);

  console.log('👤 Ensuring platform admin account…');
  const adminEmail = 'admin@inventory.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const adminPassword = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: { name: 'System Admin', email: adminEmail, password: adminPassword, isPlatformAdmin: true },
    });
    console.log('  Created admin account (admin@inventory.com / admin123)');
  } else {
    console.log('  Admin account already exists');
  }

  console.log('👑 Marking existing business owners…');
  const ownerMemberships = await prisma.membership.findMany({
    where: { role: { isSystem: true } },
    select: { userId: true },
  });
  const ownerUserIds = [...new Set(ownerMemberships.map((m) => m.userId))];
  if (ownerUserIds.length) {
    await prisma.user.updateMany({ where: { id: { in: ownerUserIds } }, data: { isOwnerAccount: true } });
    console.log(`  Marked ${ownerUserIds.length} user(s) as owner accounts`);
  }

  console.log('✅ Backfill complete.');
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
