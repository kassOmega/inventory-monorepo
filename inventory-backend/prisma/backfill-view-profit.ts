import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const perm = await prisma.permission.upsert({
    where: { key: 'sales.view-profit' },
    update: { label: 'View Profit & Revenue', group: 'Sales' },
    create: { key: 'sales.view-profit', label: 'View Profit & Revenue', group: 'Sales' },
  });

  // Grant to the system (OWNER) role so owners keep seeing profit by default
  const ownerRole = await prisma.role.findFirst({ where: { isSystem: true } });
  if (ownerRole) {
    const existing = await prisma.rolePermission.findUnique({
      where: {
        roleId_permissionId: { roleId: ownerRole.id, permissionId: perm.id },
      },
    });
    if (!existing) {
      await prisma.rolePermission.create({
        data: { roleId: ownerRole.id, permissionId: perm.id },
      });
    }
  }

  console.log('Backfilled sales.view-profit:', perm.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
