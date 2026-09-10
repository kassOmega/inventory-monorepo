// prisma/seed-prod.ts
// Production seed (IDEMPOTENT): safe to run on EVERY deploy without wiping
// live data. It always:
//   1. upserts the permission catalog (PERMISSIONS),
//   2. creates default roles per vertical — global templates plus roles cloned
//      into each production organization. Existing non-system roles are left
//      untouched (owners can edit/delete them); the system Owner role stays
//      permission-synced.
//   3. creates the primary owner account only if it does not exist,
//   4. seeds default per-organization data (chart of accounts, hospitality
//      menu/tables/rooms, retail categories/units/location) — created only if
//      missing, so owner edits/deletions are never resurrected.
import {
  BusinessType,
  LocationType,
  PrismaClient,
  RoomStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
} from '../src/common/permissions';
import {
  DEFAULT_MENU_CATEGORIES,
  VERTICALS,
  getDefaultAccounts,
} from '../src/common/verticals';
import { SeedShop, SHOPS } from './seed-shop-catalog';

const prisma = new PrismaClient();

const OWNER = {
  name: 'test user',
  email: 'test@gmail.com',
  password: 'TEST@1234',
  phone: '0910153504',
};

// Platform admin (super user) account.
const ADMIN = {
  name: 'Kassahun Takele',
  email: 'kass3me@gmail.com',
  password: 'KASS@3ko',
  phone: '+251924232022',
};

// Extra role cloned into retail organizations (a single-shop operator).
const STANDALONE_ROLE = {
  name: 'Standalone Shop',
  description:
    'Independent shop: restocks its own inventory (owner approves) and registers sales directly',
  isSystem: false,
  permissionKey: 'STANDALONE_SHOPKEEPER',
} as const;

// Default hospitality menu items (seeded once; owners can edit/delete later).
const DEFAULT_MENU_ITEMS: {
  name: string;
  description: string;
  price: number;
  cost: number;
  sortOrder: number;
  category: string; // must match a DEFAULT_MENU_CATEGORIES name
}[] = [
  {
    name: 'Sambusa',
    description: 'Crispy pastry with spiced lentils',
    price: 80,
    cost: 30,
    sortOrder: 1,
    category: 'Appetizers',
  },
  {
    name: 'Doro Wat',
    description: 'Chicken stew with injera',
    price: 420,
    cost: 180,
    sortOrder: 1,
    category: 'Main Courses',
  },
  {
    name: 'Beef Tibs',
    description: 'Sautéed beef with vegetables',
    price: 380,
    cost: 160,
    sortOrder: 2,
    category: 'Main Courses',
  },
  {
    name: 'Firfir',
    description: 'Injera strips with spiced stew',
    price: 160,
    cost: 70,
    sortOrder: 3,
    category: 'Main Courses',
  },
  {
    name: 'Black Forest Cake',
    description: 'Slice with cream',
    price: 110,
    cost: 45,
    sortOrder: 1,
    category: 'Dessert',
  },
  {
    name: 'Mineral Water',
    description: 'Chilled bottle 1L',
    price: 40,
    cost: 15,
    sortOrder: 1,
    category: 'Water',
  },
  {
    name: 'St. George Beer',
    description: 'Local lager, chilled',
    price: 70,
    cost: 40,
    sortOrder: 1,
    category: 'Beer',
  },
  {
    name: 'Red Wine Glass',
    description: 'House red, 150ml',
    price: 120,
    cost: 60,
    sortOrder: 1,
    category: 'Wine',
  },
  {
    name: 'Tej',
    description: 'Traditional honey wine',
    price: 90,
    cost: 45,
    sortOrder: 1,
    category: 'Alcohol',
  },
  {
    name: 'Macchiato',
    description: 'Espresso with steamed milk',
    price: 60,
    cost: 20,
    sortOrder: 1,
    category: 'Hot Drinks',
  },
  {
    name: 'Black Tea',
    description: 'Spiced black tea',
    price: 20,
    cost: 5,
    sortOrder: 2,
    category: 'Hot Drinks',
  },
  {
    name: 'Caffè Latte',
    description: 'Double espresso with silky milk',
    price: 80,
    cost: 30,
    sortOrder: 1,
    category: 'Latte',
  },
];

const DEFAULT_TABLES: { name: string; zone: string; capacity: number }[] = [
  { name: 'T1', zone: 'Main Hall', capacity: 4 },
  { name: 'T2', zone: 'Main Hall', capacity: 6 },
  { name: 'T3', zone: 'Terrace', capacity: 4 },
];

const DEFAULT_ROOM_TYPES: {
  name: string;
  description: string;
  basePrice: number;
}[] = [
  { name: 'Standard', description: 'Single/double room', basePrice: 1500 },
  {
    name: 'Deluxe',
    description: 'Spacious room with city view',
    basePrice: 2500,
  },
  { name: 'Suite', description: 'Living room + bedroom', basePrice: 4500 },
  { name: 'Family', description: 'Two-bedroom family unit', basePrice: 3500 },
];

const DEFAULT_ROOM_NUMBERS: Record<string, string[]> = {
  Standard: ['101', '102', '103', '104'],
  Deluxe: ['201', '202', '203'],
  Suite: ['301', '302'],
  Family: ['401', '402'],
};

async function syncPermissionCatalog(): Promise<Record<string, number>> {
  const permissionIdByKey: Record<string, number> = {};
  for (const p of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, label: p.label, group: p.group },
      update: { label: p.label, group: p.group },
    });
    permissionIdByKey[p.key] = perm.id;
  }
  console.log(
    `✅ Permission catalog synced (${PERMISSIONS.length} permissions).`,
  );
  return permissionIdByKey;
}

async function linkRolePermissions(
  roleId: number,
  permissionKeys: string[],
  permissionIdByKey: Record<string, number>,
) {
  const ids = permissionKeys
    .map((key) => permissionIdByKey[key])
    .filter((id): id is number => typeof id === 'number');
  await prisma.rolePermission.deleteMany({ where: { roleId } });
  if (ids.length > 0) {
    await prisma.rolePermission.createMany({
      data: ids.map((permissionId) => ({ roleId, permissionId })),
    });
  }
}

/**
 * Clone the vertical's default roles into an organization. The system Owner
 * role stays permission-synced (it is the locked account role); existing
 * non-system roles are left untouched so the owner can edit/delete them.
 * Missing default roles are created with their default permissions.
 */
async function syncOrgRoles(
  org: { id: number; businessType: BusinessType },
  permissionIdByKey: Record<string, number>,
) {
  const vertical = VERTICALS[org.businessType];
  const roleDefs = [
    ...vertical.defaultRoles,
    ...(org.businessType === BusinessType.RETAIL ? [STANDALONE_ROLE] : []),
  ];
  for (const roleDef of roleDefs) {
    const keys = DEFAULT_ROLE_PERMISSIONS[roleDef.permissionKey] ?? [];
    const existing = await prisma.role.findFirst({
      where: { organizationId: org.id, name: roleDef.name },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!existing) {
      const role = await prisma.role.create({
        data: {
          name: roleDef.name,
          description: roleDef.description,
          isSystem: roleDef.isSystem ?? false,
          organizationId: org.id,
        },
      });
      await linkRolePermissions(role.id, keys, permissionIdByKey);
      console.log(`  role "${roleDef.name}" created in org ${org.id}`);
    } else if (roleDef.isSystem) {
      await prisma.role.update({
        where: { id: existing.id },
        data: { description: roleDef.description, isSystem: true },
      });
      await linkRolePermissions(existing.id, keys, permissionIdByKey);
    } else {
      // Default non-system roles (Storekeeper/Shopkeeper/Standalone Shop/…):
      // top up permissions that were ADDED to the default set after the role
      // was first cloned (e.g. requests.create for STANDALONE_SHOPKEEPER),
      // without removing anything the owner may have granted. Roles the owner
      // has extended with extra permissions are left completely untouched so
      // customizations are never overwritten.
      const currentKeys = existing.permissions.map((p) => p.permission.key);
      const hasExtras = currentKeys.some((k) => !keys.includes(k));
      if (!hasExtras) {
        const missing = keys.filter((k) => !currentKeys.includes(k));
        if (missing.length > 0) {
          await prisma.rolePermission.createMany({
            data: missing.map((key) => ({
              roleId: existing.id,
              permissionId: permissionIdByKey[key],
            })),
            skipDuplicates: true,
          });
          console.log(
            `  role "${roleDef.name}" permissions topped up in org ${org.id} (+${missing.length})`,
          );
        }
      }
    }
    // Existing roles the owner customized are intentionally left untouched.
  }
}

async function seedAccounts(org: { id: number; businessType: BusinessType }) {
  const accounts = getDefaultAccounts(org.businessType);
  let created = 0;
  for (const a of accounts) {
    const existing = await prisma.account.findFirst({
      where: { tenantId: org.id, name: a.name, type: a.type },
    });
    if (!existing) {
      await prisma.account.create({
        data: {
          tenantId: org.id,
          name: a.name,
          code: a.code ?? null,
          type: a.type,
          isSystem: a.isSystem ?? false,
        },
      });
      created++;
    }
  }
  console.log(
    `  chart of accounts: ${created} created (${accounts.length} defaults)`,
  );
}

async function seedHospitalityData(org: { id: number }) {
  const tenantId = org.id;

  // Default stations (Kitchen / Bar / Barista).
  const stationDefs = [
    { name: 'Kitchen', key: 'kitchen', roleName: 'Chef', sortOrder: 0 },
    { name: 'Bar', key: 'bar', roleName: 'Barman', sortOrder: 1 },
    { name: 'Barista', key: 'barista', roleName: 'Barista', sortOrder: 2 },
  ];
  const stationByKey: Record<
    string,
    { id: number; name: string; key: string }
  > = {};
  for (const s of stationDefs) {
    const row = await prisma.restaurantStation.upsert({
      where: { tenantId_key: { tenantId, key: s.key } },
      update: {},
      create: { tenantId, ...s },
    });
    stationByKey[s.key] = { id: row.id, name: row.name, key: row.key };
  }

  // Cash payment method.
  await prisma.paymentMethod.upsert({
    where: { tenantId_name: { tenantId, name: 'Cash' } },
    update: {},
    create: { tenantId, name: 'Cash' },
  });

  // Menu categories (create-if-missing; routed to the matching station).
  const categoryByName = new Map<string, { id: number }>();
  for (const c of DEFAULT_MENU_CATEGORIES) {
    const existing = await prisma.menuCategory.findFirst({
      where: { tenantId, name: c.name },
    });
    if (!existing) {
      const station = stationByKey[c.stationKey];
      await prisma.menuCategory.create({
        data: {
          tenantId,
          name: c.name,
          sortOrder: categoryByName.size + 1,
          stationId: station?.id ?? null,
          stationRoute: station
            ? [{ id: station.id, name: station.name, key: station.key }]
            : [],
        },
      });
    }
    const cat = await prisma.menuCategory.findFirst({
      where: { tenantId, name: c.name },
      select: { id: true },
    });
    if (cat) categoryByName.set(c.name, { id: cat.id });
  }

  // Menu items (create-if-missing by name within the category).
  for (const item of DEFAULT_MENU_ITEMS) {
    const cat = categoryByName.get(item.category);
    if (!cat) continue;
    const existing = await prisma.menuItem.findFirst({
      where: { tenantId, menuCategoryId: cat.id, name: item.name },
    });
    if (existing) continue;
    await prisma.menuItem.create({
      data: {
        tenantId,
        menuCategoryId: cat.id,
        name: item.name,
        description: item.description,
        price: item.price,
        cost: item.cost,
        sortOrder: item.sortOrder,
      },
    });
  }

  // Dining tables.
  for (const t of DEFAULT_TABLES) {
    await prisma.diningTable.upsert({
      where: { tenantId_name: { tenantId, name: t.name } },
      update: {},
      create: { tenantId, ...t, status: 'FREE' },
    });
  }

  // Room types + rooms.
  for (const rt of DEFAULT_ROOM_TYPES) {
    let roomType = await prisma.roomType.findFirst({
      where: { tenantId, name: rt.name },
    });
    if (!roomType) {
      roomType = await prisma.roomType.create({
        data: {
          tenantId,
          name: rt.name,
          description: rt.description,
          basePrice: rt.basePrice,
        },
      });
    }
    for (const num of DEFAULT_ROOM_NUMBERS[rt.name] ?? []) {
      await prisma.room.upsert({
        where: { tenantId_number: { tenantId, number: num } },
        update: {},
        create: {
          tenantId,
          roomTypeId: roomType.id,
          number: num,
          status: RoomStatus.AVAILABLE,
        },
      });
    }
  }
  console.log('  hospitality data synced (menu, tables, rooms).');
}

async function seedRetailData(org: { id: number }) {
  const tenantId = org.id;
  const defaults = VERTICALS[BusinessType.RETAIL];

  for (const name of defaults.defaultCategories) {
    await prisma.category.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name },
    });
  }
  for (const name of defaults.defaultUnits) {
    await prisma.unit.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name },
    });
  }

  // A default SHOP location so a single-shop retailer is immediately operable
  // and the "one shop" autofill kicks in. Owners can rename/delete it.
  const existingLoc = await prisma.location.findFirst({
    where: { tenantId, name: 'Main Shop' },
  });
  if (!existingLoc) {
    await prisma.location.create({
      data: { tenantId, name: 'Main Shop', type: LocationType.SHOP },
    });
  }
  console.log(
    '  retail data synced (categories, units, default shop location).',
  );
}

// Creates the owner account if it does not exist yet (idempotent).
async function ensureOwnerAccount(a: {
  email: string;
  name: string;
  password: string;
  phone: string;
}) {
  let user = await prisma.user.findUnique({ where: { email: a.email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: a.email,
        password: await bcrypt.hash(a.password, 10),
        name: a.name,
        phone: a.phone,
        isOwnerAccount: true,
        verificationStatus: 'APPROVED',
      },
    });
    console.log('  Owner account created: ' + a.email);
  }
  return user;
}

// Seeds a standalone shop's catalog (categories, units, single SHOP location,
// products with variants + stock). Everything is upserted / skipped-if-present
// so re-running the seed never duplicates data.
async function seedStandaloneShopData(
  org: { id: number },
  shop: SeedShop,
  ownerUserId: number,
  setLocationId: boolean,
) {
  const tenantId = org.id;

  for (const name of shop.categories) {
    await prisma.category.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name },
    });
  }
  for (const name of shop.units) {
    await prisma.unit.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: { tenantId, name },
    });
  }

  // Single SHOP location for the standalone business.
  let location = await prisma.location.findFirst({
    where: { tenantId, type: LocationType.SHOP },
  });
  if (!location) {
    location = await prisma.location.create({
      data: { tenantId, name: shop.shopName, type: LocationType.SHOP },
    });
  }

  // Point the owner at the shop so the single-location autofill works. Owners
  // with more than one shop keep locationId null so per-org single-location
  // resolution picks the right shop when they switch businesses.
  if (setLocationId) {
    await prisma.user.update({
      where: { id: ownerUserId },
      data: { locationId: location.id },
    });
  }

  const categoryIds = new Map<string, number>();
  for (const c of await prisma.category.findMany({ where: { tenantId } })) {
    categoryIds.set(c.name, c.id);
  }
  const unitIds = new Map<string, number>();
  for (const u of await prisma.unit.findMany({ where: { tenantId } })) {
    unitIds.set(u.name, u.id);
  }

  for (const p of shop.products) {
    let product = await prisma.product.findFirst({
      where: { tenantId, sku: p.sku },
    });
    if (!product) {
      product = await prisma.product.create({
        data: {
          tenantId,
          sku: p.sku,
          brand: p.brand,
          baseName: p.baseName,
          categoryId: categoryIds.get(p.category) ?? 0,
          unitId: unitIds.get(p.unit) ?? null,
          hasVariants: true,
          currentBuyPrice: p.buyPrice,
          currentSellPrice: p.sellPrice,
          attributes: { source: 'standalone-demo' },
        },
      });
    }
    for (const v of p.variants) {
      let variant = await prisma.productVariant.findFirst({
        where: { tenantId, sku: v.sku },
      });
      if (!variant) {
        variant = await prisma.productVariant.create({
          data: {
            tenantId,
            productId: product.id,
            sku: v.sku,
            barcode: v.barcode,
            attributes: v.attributes,
            buyPrice: v.buyPrice,
            sellPrice: v.sellPrice,
          },
        });
      }
      const existingInv = await prisma.inventory.findFirst({
        where: {
          productId: product.id,
          variantId: variant.id,
          locationId: location.id,
        },
      });
      if (!existingInv) {
        await prisma.inventory.create({
          data: {
            tenantId,
            productId: product.id,
            variantId: variant.id,
            locationId: location.id,
            quantity: v.qty,
          },
        });
      }
    }
  }
  console.log(`  ${shop.orgName} — shop data synced.`);
}

async function main() {
  // --- 1. Permission catalog ---
  const permissionIdByKey = await syncPermissionCatalog();

  // --- 2. Global default-role templates (create-if-missing) ---
  const allRoleDefs = [
    ...Object.values(VERTICALS).flatMap((v) => v.defaultRoles),
    STANDALONE_ROLE,
  ];
  for (const roleDef of allRoleDefs) {
    const existing = await prisma.role.findFirst({
      where: { name: roleDef.name, organizationId: null },
    });
    if (existing) continue;
    await prisma.role.create({
      data: {
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem ?? false,
      },
    });
  }

  // --- 3. Primary owner account (only if missing) ---
  let owner = await prisma.user.findUnique({
    where: { email: OWNER.email },
  });
  if (!owner) {
    const hashedPassword = await bcrypt.hash(OWNER.password, 10);
    owner = await prisma.user.create({
      data: {
        email: OWNER.email,
        password: hashedPassword,
        name: OWNER.name,
        phone: OWNER.phone,
        isOwnerAccount: true,
        verificationStatus: 'APPROVED',
      },
    });
    console.log('Owner created: ' + owner.email);
  }

  // --- Platform admin account (only if missing) ---
  let admin = await prisma.user.findUnique({
    where: { email: ADMIN.email },
  });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: ADMIN.email,
        password: await bcrypt.hash(ADMIN.password, 10),
        name: ADMIN.name,
        phone: ADMIN.phone,
        isPlatformAdmin: true,
      },
    });
    console.log('Platform admin created: ' + admin.email);
  }

  // --- 4. Production organizations (idempotent by slug) ---
  const orgDefs: {
    name: string;
    slug: string;
    businessType: BusinessType;
    standalone?: boolean;
    shop?: SeedShop;
  }[] = [
    {
      name: 'Nejat Electrical',
      slug: 'nejat-electrical',
      businessType: BusinessType.RETAIL,
    },
    {
      name: 'Nejat Hospitality',
      slug: 'nejat-hospitality',
      businessType: BusinessType.HOSPITALITY,
    },
    ...SHOPS.map((shop) => ({
      name: shop.orgName,
      slug: shop.slug,
      businessType: BusinessType.RETAIL,
      standalone: true,
      shop,
    })),
  ];

  for (const def of orgDefs) {
    let org = await prisma.organization.findUnique({
      where: { slug: def.slug },
    });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: def.name,
          slug: def.slug,
          businessType: def.businessType,
          standalone: def.standalone ?? false,
          status: 'ACTIVE',
          verificationStatus: 'APPROVED',
          aiEnabled: true,
          aiTrialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        },
      });
      console.log(`Organization created: ${def.name}`);
    }

    // Default vertical roles cloned into the org (Owner stays synced).
    await syncOrgRoles(org, permissionIdByKey);

    // Ensure the owner is an ACTIVE member. Standalone shops have their own
    // owner accounts; the platform demo orgs share the primary owner.
    const orgOwner = def.shop
      ? await ensureOwnerAccount(def.shop.owner)
      : owner;
    const ownerRole = await prisma.role.findFirst({
      where: { organizationId: org.id, name: 'Owner' },
    });
    const membership = await prisma.membership.findFirst({
      where: { userId: orgOwner.id, organizationId: org.id },
    });
    if (!membership && ownerRole) {
      await prisma.membership.create({
        data: {
          userId: orgOwner.id,
          organizationId: org.id,
          roleId: ownerRole.id,
          status: 'ACTIVE',
        },
      });
      console.log(`Owner linked to ${def.name}`);
    }

    // Default chart of accounts.
    await seedAccounts(org);

    // Vertical-specific defaults.
    if (def.businessType === BusinessType.HOSPITALITY) {
      await seedHospitalityData(org);
    } else if (def.businessType === BusinessType.RETAIL && !def.shop) {
      await seedRetailData(org);
    }

    // Standalone shops get their own catalog + single SHOP location.
    if (def.shop) {
      const shopsForOwner = SHOPS.filter(
        (s) => s.owner.email === def.shop?.owner.email,
      ).length;
      await seedStandaloneShopData(org, def.shop, orgOwner.id, shopsForOwner === 1);
    }
  }

  console.log('Production organizations synced.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
