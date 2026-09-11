// prisma/seed.ts
import {
  AgentMode,
  BusinessType,
  LocationType,
  MfgOrderStage,
  MfgPricingModel,
  OrderStatus,
  PrismaClient,
  ProductKind,
  RequestItemStatus,
  RequestStatus,
  TableStatus,
  WorkOrderStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
} from '../src/common/permissions';
import { getDefaultAccounts } from '../src/common/verticals';
import { SHOPS } from './seed-shop-catalog';

if (process.env.NODE_ENV === 'production') {
  console.error(
    'Refusing to run the development seed in production. Use "npm run seed:prod" (seed-prod.ts) instead.',
  );
  process.exit(1);
}

const prisma = new PrismaClient();

/** Seed the vertical's default chart of accounts for an organization. */
async function seedOrgAccounts(org: { id: number; businessType: BusinessType }) {
  const accounts = getDefaultAccounts(org.businessType);
  const existing = await prisma.account.findMany({
    where: { tenantId: org.id },
    select: { name: true, type: true },
  });
  const missing = accounts.filter(
    (a) => !existing.some((e) => e.name === a.name && e.type === a.type),
  );
  if (missing.length > 0) {
    await prisma.account.createMany({
      data: missing.map((a) => ({
        tenantId: org.id,
        name: a.name,
        code: a.code ?? null,
        type: a.type,
        isSystem: a.isSystem ?? false,
      })),
      skipDuplicates: true,
    });
    console.log(`  chart of accounts: seeded ${missing.length} defaults for org ${org.id} (${org.businessType})`);
  }
}

async function main() {
  console.log('🌱 Starting comprehensive database seed...');

  // 1. Clean existing records in reverse dependency order
  await prisma.aiChatMessage.deleteMany({});
  await prisma.aiChatSession.deleteMany({});
  await prisma.businessInsight.deleteMany({});
  await prisma.cashFloat.deleteMany({});
  await prisma.cashCollection.deleteMany({});
  await prisma.orderPayment.deleteMany({});
  await prisma.folioEntry.deleteMany({});
  await prisma.folio.deleteMany({});
  await prisma.hotelReservation.deleteMany({});
  await prisma.room.deleteMany({});
  await prisma.roomType.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.diningTable.deleteMany({});
  await prisma.menuItemOption.deleteMany({});
  await prisma.menuItem.deleteMany({});
  await prisma.menuCategory.deleteMany({});
  await prisma.otherIncome.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.cogsEntry.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.purchase.deleteMany({});
  await prisma.pushSubscription.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.creditPayment.deleteMany({});
  await prisma.creditSaleItem.deleteMany({});
  await prisma.creditSale.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.paymentMethod.deleteMany({});
  await prisma.returnItem.deleteMany({});
  await prisma.return.deleteMany({});
  await prisma.saleItem.deleteMany({});
  await prisma.sale.deleteMany({});
  await prisma.requestItem.deleteMany({});
  await prisma.stockRequest.deleteMany({});
await prisma.productionScrapLog.deleteMany({});
  await prisma.workOrder.deleteMany({});
  await prisma.bomItem.deleteMany({});
  await prisma.billOfMaterials.deleteMany({});
  await prisma.inventory.deleteMany({});
  await prisma.priceHistory.deleteMany({});
  await prisma.unit.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.cashEntry.deleteMany({});
  await prisma.purchaseOrderDraft.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.locationCategory.deleteMany({});
  await prisma.rolePermission.deleteMany({});
  await prisma.permission.deleteMany({});
  await prisma.role.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  console.log('🧹 Cleared existing data.');

  // 2. Hash default passwords
  const hashedPassword = await bcrypt.hash('password123', 10);
  // 15-day AI free trial for every seeded owner/org.
  const aiTrialEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

  // 2.5 Create Permissions & Roles
  const permissionIdByKey: Record<string, number> = {};
  for (const p of PERMISSIONS) {
    const created = await prisma.permission.create({
      data: { key: p.key, label: p.label, group: p.group },
    });
    permissionIdByKey[p.key] = created.id;
  }

  const ownerRole = await prisma.role.create({
    data: {
      name: 'Owner',
      description: 'Full access to everything',
      isSystem: true,
    },
  });
  const storekeeperRole = await prisma.role.create({
    data: {
      name: 'Storekeeper',
      description: 'Manages store stock and dispatches',
    },
  });
  const shopkeeperRole = await prisma.role.create({
    data: {
      name: 'Shopkeeper',
      description: 'Runs a shop: sales, purchases, returns',
    },
  });
  const standaloneRole = await prisma.role.create({
    data: {
      name: 'Standalone Shop',
      description:
        'Independent shop: restocks its own inventory (owner approves) and registers sales directly',
    },
  });

  const linkRolePermissions = async (roleId: number, keys: string[]) => {
    await prisma.rolePermission.createMany({
      data: keys.map((key) => ({
        roleId,
        permissionId: permissionIdByKey[key],
      })),
    });
  };

  await linkRolePermissions(ownerRole.id, DEFAULT_ROLE_PERMISSIONS.OWNER);
  await linkRolePermissions(
    storekeeperRole.id,
    DEFAULT_ROLE_PERMISSIONS.STOREKEEPER,
  );
  await linkRolePermissions(
    shopkeeperRole.id,
    DEFAULT_ROLE_PERMISSIONS.SHOPKEEPER,
  );
  await linkRolePermissions(
    standaloneRole.id,
    DEFAULT_ROLE_PERMISSIONS.STANDALONE_SHOPKEEPER,
  );

  console.log('🔐 Roles & permissions created.');

  // 3. Create Location Categories
  const locCatGeneral = await prisma.locationCategory.create({
    data: { name: 'General' },
  });
  const locCatCables = await prisma.locationCategory.create({
    data: { name: 'Cables' },
  });

  // 4. Create Locations
  const nejatStore = await prisma.location.create({
    data: {
      name: 'Nejat Store',
      type: LocationType.STORE,
      categoryId: locCatGeneral.id,
    },
  });
  const sosaStore = await prisma.location.create({
    data: {
      name: 'Sosa Store',
      type: LocationType.STORE,
      categoryId: locCatCables.id,
    },
  });
  const ummiStore = await prisma.location.create({
    data: {
      name: 'Ummi Store',
      type: LocationType.STORE,
      categoryId: locCatGeneral.id,
    },
  });

  const shop1 = await prisma.location.create({
    data: { name: 'Nejat Branch', type: LocationType.SHOP },
  });
  const shop2 = await prisma.location.create({
    data: { name: 'Sosa Branch', type: LocationType.SHOP },
  });
  const shop3 = await prisma.location.create({
    data: { name: 'Ummi Branch', type: LocationType.SHOP },
  });
  // A shop operated independently of the stores — restocks via owner approval.
  const standaloneShop = await prisma.location.create({
    data: { name: 'Standalone Shop', type: LocationType.SHOP },
  });

  console.log('📍 Locations created.');

  // 4. Create Users
  const owner = await prisma.user.create({
    data: {
      email: 'owner@inventory.com',
      password: hashedPassword,
      name: 'Abebe Bikila',
      roleId: ownerRole.id,
      isOwnerAccount: true,
      aiTrialEndsAt: aiTrialEnd,
      verificationStatus: 'APPROVED',
    },
  });

  // Link Abebe Bikila to the existing inventory business.
  let inventoryOrg = await prisma.organization.findUnique({
    where: { slug: 'nejat-electrical' },
  });
  if (!inventoryOrg) {
    inventoryOrg = await prisma.organization.create({
      data: {
        name: 'Nejat Electrical',
        slug: 'nejat-electrical',
        businessType: 'RETAIL',
        aiEnabled: true,
        aiTrialEndsAt: aiTrialEnd,
        verificationStatus: 'APPROVED',
      },
    });
  }
  await seedOrgAccounts(inventoryOrg);

  // Scope the seeded roles to this organization.
  await prisma.role.updateMany({
    where: { organizationId: null },
    data: { organizationId: inventoryOrg.id },
  });

  // Make Abebe Bikila the Owner of this organization.
  await prisma.membership.create({
    data: {
      userId: owner.id,
      organizationId: inventoryOrg.id,
      roleId: ownerRole.id,
      status: 'ACTIVE',
    },
  });

  const storekeeper1 = await prisma.user.create({
    data: {
      email: 'storekeeper@inventory.com',
      password: hashedPassword,
      name: 'Chala Gemechu',
      roleId: storekeeperRole.id,
      locationId: nejatStore.id,
    },
  });

  const storekeeper2 = await prisma.user.create({
    data: {
      email: 'cablestore@inventory.com',
      password: hashedPassword,
      name: 'Taye Desta',
      roleId: storekeeperRole.id,
      locationId: sosaStore.id,
    },
  });

  const shopkeeper1 = await prisma.user.create({
    data: {
      email: 'shopkeeper1@inventory.com',
      password: hashedPassword,
      name: 'Selam Tesfaye',
      roleId: shopkeeperRole.id,
      locationId: shop1.id,
    },
  });

  const shopkeeper2 = await prisma.user.create({
    data: {
      email: 'shopkeeper2@inventory.com',
      password: hashedPassword,
      name: 'Kebede Alemu',
      roleId: shopkeeperRole.id,
      locationId: shop2.id,
    },
  });

  const shopkeeper3 = await prisma.user.create({
    data: {
      email: 'shopkeeper3@inventory.com',
      password: hashedPassword,
      name: 'Tigist Haile',
      roleId: shopkeeperRole.id,
      locationId: shop3.id,
    },
  });

  // Link every staff member to the Nejat Electrical organization.
  await prisma.membership.createMany({
    data: [
      {
        userId: storekeeper1.id,
        organizationId: inventoryOrg.id,
        roleId: storekeeperRole.id,
        status: 'ACTIVE',
      },
      {
        userId: storekeeper2.id,
        organizationId: inventoryOrg.id,
        roleId: storekeeperRole.id,
        status: 'ACTIVE',
      },
      {
        userId: shopkeeper1.id,
        organizationId: inventoryOrg.id,
        roleId: shopkeeperRole.id,
        status: 'ACTIVE',
      },
      {
        userId: shopkeeper2.id,
        organizationId: inventoryOrg.id,
        roleId: shopkeeperRole.id,
        status: 'ACTIVE',
      },
      {
        userId: shopkeeper3.id,
        organizationId: inventoryOrg.id,
        roleId: shopkeeperRole.id,
        status: 'ACTIVE',
      },
    ],
  });

  // Platform admin (super user) account
  const admin = await prisma.user.create({
    data: {
      email: 'kass3me@gmail.com',
      password: await bcrypt.hash('KASS@3ko', 10),
      name: 'Kassahun Takele',
      phone: '+251924232022',
      isPlatformAdmin: true,
    },
  });

  const standaloneKeeper = await prisma.user.create({
    data: {
      email: 'standalone@inventory.com',
      password: hashedPassword,
      name: 'Meron Girma (Standalone Shop)',
      roleId: standaloneRole.id,
      locationId: standaloneShop.id,
      isOwnerAccount: true,
      verificationStatus: 'APPROVED',
    },
  });

  // The standalone shop is its own business: a single-shop operator who owns
  // their organization (approves their own restocks). Without a membership the
  // account has no tenant context and cannot function.
  const standaloneOrg = await prisma.organization.create({
    data: {
      name: 'Meron Standalone Shop',
      slug: 'meron-standalone',
      businessType: BusinessType.RETAIL,
      standalone: true,
      aiEnabled: true,
      aiTrialEndsAt: aiTrialEnd,
      verificationStatus: 'APPROVED',
    },
  });
  await seedOrgAccounts(standaloneOrg);
  const standaloneOwnerRole = await prisma.role.create({
    data: {
      name: 'Owner',
      description: 'Full access to everything',
      isSystem: true,
      organizationId: standaloneOrg.id,
    },
  });
  await linkRolePermissions(
    standaloneOwnerRole.id,
    DEFAULT_ROLE_PERMISSIONS.OWNER,
  );
  await prisma.membership.create({
    data: {
      userId: standaloneKeeper.id,
      organizationId: standaloneOrg.id,
      roleId: standaloneOwnerRole.id,
      status: 'ACTIVE',
    },
  });
  await prisma.location.update({
    where: { id: standaloneShop.id },
    data: { tenantId: standaloneOrg.id },
  });

  console.log('👥 Users created.');

  // =========================================================================
  // Additional business owners — each owning one or more businesses.
  // =========================================================================
  const createOrg = async (name: string, slug: string, businessType: BusinessType) => {
    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        businessType,
        aiEnabled: true,
        aiTrialEndsAt: aiTrialEnd,
        verificationStatus: 'APPROVED',
      },
    });
    await seedOrgAccounts(org);
    return org;
  };

  const createOrgRole = async (
    orgId: number,
    name: string,
    description: string,
    isSystem: boolean,
    permissionsKey: keyof typeof DEFAULT_ROLE_PERMISSIONS,
  ) => {
    const role = await prisma.role.create({
      data: { name, description, isSystem, organizationId: orgId },
    });
    await linkRolePermissions(
      role.id,
      DEFAULT_ROLE_PERMISSIONS[permissionsKey],
    );
    return role;
  };

  // -------------------------------------------------------------------------
  // Owner 1 — Abebe Bikila (owner@inventory.com)
  //   Business 1: Nejat Electrical (RETAIL) — heavy demo data below.
  //   Business 2: Nejat Hospitality (HOSPITALITY) — café/restaurant.
  // -------------------------------------------------------------------------
  const nejatHotelOrg = await createOrg(
    'Nejat Hospitality',
    'nejat-hospitality',
    BusinessType.HOSPITALITY,
  );
  const nejatHotelOwnerRole = await createOrgRole(
    nejatHotelOrg.id,
    'Owner',
    'Full access to everything',
    true,
    'OWNER',
  );
  const hotelManagerRole = await createOrgRole(
    nejatHotelOrg.id,
    'Manager',
    'Oversees operations and cash collection',
    false,
    'MANAGER',
  );
  const hotelWaiterRole = await createOrgRole(
    nejatHotelOrg.id,
    'Waiter',
    'Takes orders and serves customers',
    false,
    'WAITER',
  );
  const hotelChefRole = await createOrgRole(
    nejatHotelOrg.id,
    'Chef',
    'Prepares meals from the kitchen board',
    false,
    'CHEF',
  );
  const hotelBarmanRole = await createOrgRole(
    nejatHotelOrg.id,
    'Barman',
    'Prepares beverages from the bar board',
    false,
    'BARMAN',
  );
  const hotelBaristaRole = await createOrgRole(
    nejatHotelOrg.id,
    'Barista',
    'Prepares hot drinks from the barista board',
    false,
    'BARISTA',
  );
  const hotelCashierRole = await createOrgRole(
    nejatHotelOrg.id,
    'Cashier',
    'Collects and confirms payments',
    false,
    'CASHIER',
  );
  // Roles targeted by workflow notifications. Without a matching role row,
  // notifyRole() finds nothing and silently skips the notification entirely.
  await createOrgRole(
    nejatHotelOrg.id,
    'Receptionist',
    'Manages reservations and front desk',
    false,
    'RECEPTIONIST',
  );
  await createOrgRole(
    nejatHotelOrg.id,
    'Housekeeping',
    'Updates room cleanliness status',
    false,
    'HOUSEKEEPING',
  );

  await prisma.membership.create({
    data: {
      userId: owner.id,
      organizationId: nejatHotelOrg.id,
      roleId: nejatHotelOwnerRole.id,
      status: 'ACTIVE',
    },
  });

  const hotelManager = await prisma.user.create({
    data: {
      email: 'manager@inventory.com',
      password: hashedPassword,
      name: 'Sara Mohammed',
      roleId: hotelManagerRole.id,
    },
  });
  const hotelWaiter = await prisma.user.create({
    data: {
      email: 'waiter@inventory.com',
      password: hashedPassword,
      name: 'Daniel Girma',
      roleId: hotelWaiterRole.id,
    },
  });
  const hotelChef = await prisma.user.create({
    data: {
      email: 'chef@inventory.com',
      password: hashedPassword,
      name: 'Fikru Tadesse',
      roleId: hotelChefRole.id,
    },
  });

  await prisma.membership.createMany({
    data: [
      {
        userId: hotelManager.id,
        organizationId: nejatHotelOrg.id,
        roleId: hotelManagerRole.id,
        status: 'ACTIVE',
      },
      {
        userId: hotelWaiter.id,
        organizationId: nejatHotelOrg.id,
        roleId: hotelWaiterRole.id,
        status: 'ACTIVE',
      },
      {
        userId: hotelChef.id,
        organizationId: nejatHotelOrg.id,
        roleId: hotelChefRole.id,
        status: 'ACTIVE',
      },
    ],
  });

  // --- Nejat Hospitality seed data (menu, tables, sample paid orders) ---
  const hotelPm = await prisma.paymentMethod.create({
    data: { name: 'Cash', tenantId: nejatHotelOrg.id },
  });

  // Default stations for the hospitality org (owner can add/remove more later).
  const stationDefs = [
    { name: 'Kitchen', key: 'kitchen', roleName: 'Chef', sortOrder: 0 },
    { name: 'Bar', key: 'bar', roleName: 'Barman', sortOrder: 1 },
    { name: 'Barista', key: 'barista', roleName: 'Barista', sortOrder: 2 },
  ];
  const stations: Record<string, { id: number; name: string; key: string }> = {};
  for (const s of stationDefs) {
    const row = await prisma.restaurantStation.upsert({
      where: { tenantId_key: { tenantId: nejatHotelOrg.id, key: s.key } },
      update: {},
      create: { ...s, tenantId: nejatHotelOrg.id },
    });
    stations[s.key] = { id: row.id, name: row.name, key: row.key };
  }
  const catRoute = (key: string) => {
    const s = stations[key];
    return { stationId: s.id, stationRoute: [{ id: s.id, name: s.name, key: s.key }] };
  };
  const itemStation = (key: string) => {
    const s = stations[key];
    return {
      stationKey: s.key,
      stationName: s.name,
      stationRoute: [{ id: s.id, name: s.name, key: s.key }],
      stationIndex: 0,
    };
  };

  const mcAppetizers = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Appetizers', sortOrder: 1, ...catRoute('kitchen') },
  });
  const mcMain = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Main Courses', sortOrder: 2, ...catRoute('kitchen') },
  });
  const mcDessert = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Dessert', sortOrder: 3, ...catRoute('kitchen') },
  });
  const mcWater = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Water', sortOrder: 4, ...catRoute('bar') },
  });
  const mcBeer = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Beer', sortOrder: 5, ...catRoute('bar') },
  });
  const mcWine = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Wine', sortOrder: 6, ...catRoute('bar') },
  });
  const mcAlcohol = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Alcohol', sortOrder: 7, ...catRoute('bar') },
  });
  const mcHotDrinks = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Hot Drinks', sortOrder: 8, ...catRoute('barista') },
  });
  const mcLatte = await prisma.menuCategory.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Latte', sortOrder: 9, ...catRoute('barista') },
  });

  const menuSambusa = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcAppetizers.id,
      name: 'Sambusa',
      description: 'Crispy pastry with spiced lentils',
      price: 80,
      cost: 30,
      sortOrder: 1,
    },
  });
  const menuFirfir = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcMain.id,
      name: 'Firfir',
      description: 'Injera strips with spiced stew',
      price: 160,
      cost: 70,
      sortOrder: 3,
    },
  });
  const menuDoro = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcMain.id,
      name: 'Doro Wat',
      description: 'Chicken stew with injera',
      price: 420,
      cost: 180,
      sortOrder: 1,
    },
  });
  const menuTibs = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcMain.id,
      name: 'Beef Tibs',
      description: 'Sautéed beef with vegetables',
      price: 380,
      cost: 160,
      sortOrder: 2,
    },
  });
  const menuCake = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcDessert.id,
      name: 'Black Forest Cake',
      description: 'Slice with cream',
      price: 110,
      cost: 45,
      sortOrder: 1,
    },
  });
  const menuWater = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcWater.id,
      name: 'Mineral Water',
      description: 'Chilled bottle 1L',
      price: 40,
      cost: 15,
      sortOrder: 1,
    },
  });
  const menuBeer = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcBeer.id,
      name: 'St. George Beer',
      description: 'Local lager, chilled',
      price: 70,
      cost: 40,
      sortOrder: 1,
    },
  });
  const menuWine = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcWine.id,
      name: 'Red Wine Glass',
      description: 'House red, 150ml',
      price: 120,
      cost: 60,
      sortOrder: 1,
    },
  });
  const menuAlcohol = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcAlcohol.id,
      name: 'Tej',
      description: 'Traditional honey wine',
      price: 90,
      cost: 45,
      sortOrder: 1,
    },
  });
  const menuCoffee = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcHotDrinks.id,
      name: 'Macchiato',
      description: 'Espresso with steamed milk',
      price: 60,
      cost: 20,
      sortOrder: 1,
    },
  });
  const menuTea = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcHotDrinks.id,
      name: 'Black Tea',
      description: 'Spiced black tea',
      price: 20,
      cost: 5,
      sortOrder: 2,
    },
  });
  const menuLatte = await prisma.menuItem.create({
    data: {
      tenantId: nejatHotelOrg.id,
      menuCategoryId: mcLatte.id,
      name: 'Caffè Latte',
      description: 'Double espresso with silky milk',
      price: 80,
      cost: 30,
      sortOrder: 1,
    },
  });

  const hotelTable1 = await prisma.diningTable.create({
    data: {
      tenantId: nejatHotelOrg.id,
      name: 'T1',
      zone: 'Main Hall',
      capacity: 4,
      status: TableStatus.FREE,
    },
  });
  const hotelTable2 = await prisma.diningTable.create({
    data: {
      tenantId: nejatHotelOrg.id,
      name: 'T2',
      zone: 'Main Hall',
      capacity: 6,
      status: TableStatus.FREE,
    },
  });

  const order1 = await prisma.order.create({
    data: {
      tenantId: nejatHotelOrg.id,
      orderNumber: 'NH-1001',
      tableId: hotelTable1.id,
      customerName: 'Walk-in',
      status: OrderStatus.PAID,
      totalAmount: 490,
      discount: 0,
      serviceCharge: 0,
      tax: 0,
      paidAmount: 490,
      paymentMethodId: hotelPm.id,
      createdById: hotelWaiter.id,
      items: {
        create: [
          {
            tenantId: nejatHotelOrg.id,
            menuItemId: menuDoro.id,
            name: menuDoro.name,
            quantity: 1,
            unitPrice: menuDoro.price,
            cost: menuDoro.cost,
            ...itemStation('kitchen'),
          },
          {
            tenantId: nejatHotelOrg.id,
            menuItemId: menuBeer.id,
            name: menuBeer.name,
            quantity: 1,
            unitPrice: menuBeer.price,
            cost: menuBeer.cost,
            ...itemStation('bar'),
          },
        ],
      },
    },
  });
  await prisma.orderPayment.create({
    data: {
      tenantId: nejatHotelOrg.id,
      orderId: order1.id,
      amount: 490,
      paymentMethodId: hotelPm.id,
      status: 'CONFIRMED',
      collectedById: hotelWaiter.id,
    },
  });

  const order2 = await prisma.order.create({
    data: {
      tenantId: nejatHotelOrg.id,
      orderNumber: 'NH-1002',
      tableId: hotelTable2.id,
      customerName: 'Family booking',
      status: OrderStatus.PAID,
      totalAmount: 760,
      discount: 0,
      serviceCharge: 0,
      tax: 0,
      paidAmount: 760,
      paymentMethodId: hotelPm.id,
      createdById: hotelWaiter.id,
      items: {
        create: [
          {
            tenantId: nejatHotelOrg.id,
            menuItemId: menuFirfir.id,
            name: menuFirfir.name,
            quantity: 2,
            unitPrice: menuFirfir.price,
            cost: menuFirfir.cost,
            ...itemStation('kitchen'),
          },
          {
            tenantId: nejatHotelOrg.id,
            menuItemId: menuTibs.id,
            name: menuTibs.name,
            quantity: 1,
            unitPrice: menuTibs.price,
            cost: menuTibs.cost,
            ...itemStation('kitchen'),
          },
          {
            tenantId: nejatHotelOrg.id,
            menuItemId: menuCoffee.id,
            name: menuCoffee.name,
            quantity: 2,
            unitPrice: menuCoffee.price,
            cost: menuCoffee.cost,
            ...itemStation('bar'),
          },
          {
            tenantId: nejatHotelOrg.id,
            menuItemId: menuCake.id,
            name: menuCake.name,
            quantity: 2,
            unitPrice: menuCake.price,
            cost: menuCake.cost,
            ...itemStation('kitchen'),
          },
        ],
      },
    },
  });
  await prisma.orderPayment.create({
    data: {
      tenantId: nejatHotelOrg.id,
      orderId: order2.id,
      amount: 760,
      paymentMethodId: hotelPm.id,
      status: 'CONFIRMED',
      collectedById: hotelWaiter.id,
    },
  });

  // --- Recipe / BOM: shared ingredients for the barista items ---
  // Item costs are derived from these recipes (ingredient qty × buy price),
  // so shared ingredients (sugar → every hot drink) are allocated by usage.
  const ingredientsCategory = await prisma.category.create({
    data: { tenantId: nejatHotelOrg.id, name: 'Ingredients' },
  });
  const ingCoffee = await prisma.product.create({
    data: {
      tenantId: nejatHotelOrg.id,
      sku: 'NH-ING-COFFEE',
      brand: 'Yirgacheffe',
      baseName: 'Coffee Beans',
      attributes: {},
      currentBuyPrice: 800,
      currentSellPrice: 0,
      categoryId: ingredientsCategory.id,
      kind: ProductKind.INGREDIENT,
    },
  });
  const ingMilk = await prisma.product.create({
    data: {
      tenantId: nejatHotelOrg.id,
      sku: 'NH-ING-MILK',
      brand: 'Local Dairy',
      baseName: 'Milk',
      attributes: {},
      currentBuyPrice: 120,
      currentSellPrice: 0,
      categoryId: ingredientsCategory.id,
      kind: ProductKind.INGREDIENT,
    },
  });
  const ingSugar = await prisma.product.create({
    data: {
      tenantId: nejatHotelOrg.id,
      sku: 'NH-ING-SUGAR',
      brand: 'Finchaa',
      baseName: 'Sugar',
      attributes: {},
      currentBuyPrice: 70,
      currentSellPrice: 0,
      categoryId: ingredientsCategory.id,
      kind: ProductKind.INGREDIENT,
    },
  });
  const ingTea = await prisma.product.create({
    data: {
      tenantId: nejatHotelOrg.id,
      sku: 'NH-ING-TEA',
      brand: 'Wush Wush',
      baseName: 'Tea Leaves',
      attributes: {},
      currentBuyPrice: 300,
      currentSellPrice: 0,
      categoryId: ingredientsCategory.id,
      kind: ProductKind.INGREDIENT,
    },
  });
  await prisma.menuItemIngredient.createMany({
    data: [
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuCoffee.id,
        productId: ingCoffee.id,
        quantityPerUnit: 0.02,
      },
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuCoffee.id,
        productId: ingMilk.id,
        quantityPerUnit: 0.15,
      },
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuCoffee.id,
        productId: ingSugar.id,
        quantityPerUnit: 0.01,
      },
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuLatte.id,
        productId: ingCoffee.id,
        quantityPerUnit: 0.02,
      },
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuLatte.id,
        productId: ingMilk.id,
        quantityPerUnit: 0.25,
      },
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuLatte.id,
        productId: ingSugar.id,
        quantityPerUnit: 0.01,
      },
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuTea.id,
        productId: ingTea.id,
        quantityPerUnit: 0.005,
      },
      {
        tenantId: nejatHotelOrg.id,
        menuItemId: menuTea.id,
        productId: ingSugar.id,
        quantityPerUnit: 0.01,
      },
    ],
  });

  console.log('🏨 Nejat Hospitality created (menu + 2 sample orders).');

  // -------------------------------------------------------------------------
  // Owner 2 — Meron Alemu (meron@inventory.com)
  //   Business 1: Meron Trading (RETAIL)
  //   Business 2: Meron Manufacturing (MANUFACTURING)
  // -------------------------------------------------------------------------
  const meronOwner = await prisma.user.create({
    data: {
      email: 'meron@inventory.com',
      password: hashedPassword,
      name: 'Meron Alemu',
      isOwnerAccount: true,
      aiTrialEndsAt: aiTrialEnd,
      verificationStatus: 'APPROVED',
    },
  });

  const meronOrg = await createOrg(
    'Meron Trading',
    'meron-trading',
    BusinessType.RETAIL,
  );
  const meronOwnerRole = await createOrgRole(
    meronOrg.id,
    'Owner',
    'Full access to everything',
    true,
    'OWNER',
  );
  const meronStorekeeperRole = await createOrgRole(
    meronOrg.id,
    'Storekeeper',
    'Manages store stock and dispatches',
    false,
    'STOREKEEPER',
  );
  const meronShopkeeperRole = await createOrgRole(
    meronOrg.id,
    'Shopkeeper',
    'Runs a shop: sales, purchases, returns',
    false,
    'SHOPKEEPER',
  );

  await prisma.membership.create({
    data: {
      userId: meronOwner.id,
      organizationId: meronOrg.id,
      roleId: meronOwnerRole.id,
      status: 'ACTIVE',
    },
  });

  const meronStorekeeper = await prisma.user.create({
    data: {
      email: 'meron-store@inventory.com',
      password: hashedPassword,
      name: 'Hanna Bekele',
      roleId: meronStorekeeperRole.id,
    },
  });
  await prisma.membership.create({
    data: {
      userId: meronStorekeeper.id,
      organizationId: meronOrg.id,
      roleId: meronStorekeeperRole.id,
      status: 'ACTIVE',
    },
  });

  // --- Meron Trading seed data (locations, categories, products, sales) ---
  const meronLocCat = await prisma.locationCategory.create({
    data: { tenantId: meronOrg.id, name: 'General' },
  });
  const meronLoc = await prisma.location.create({
    data: {
      tenantId: meronOrg.id,
      name: 'Meron HQ',
      type: LocationType.SHOP,
      categoryId: meronLocCat.id,
    },
  });
  const meronCat = await prisma.category.create({
    data: { tenantId: meronOrg.id, name: 'General' },
  });
  const meronUnit = await prisma.unit.create({
    data: { tenantId: meronOrg.id, name: 'piece' },
  });
  const meronPm = await prisma.paymentMethod.create({
    data: { name: 'Cash', tenantId: meronOrg.id },
  });

  const meronProducts = await Promise.all([
    prisma.product.create({
      data: {
        tenantId: meronOrg.id,
        sku: 'MRN-CRATE-01',
        brand: 'Meron',
        baseName: 'Plastic Crate',
        attributes: { size: 'Large' },
        currentBuyPrice: 220,
        currentSellPrice: 320,
        categoryId: meronCat.id,
        unitId: meronUnit.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: meronOrg.id,
        sku: 'MRN-CAN-01',
        brand: 'Meron',
        baseName: 'Jerry Can 20L',
        attributes: { size: '20L' },
        currentBuyPrice: 180,
        currentSellPrice: 260,
        categoryId: meronCat.id,
        unitId: meronUnit.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: meronOrg.id,
        sku: 'MRN-BAG-01',
        brand: 'Meron',
        baseName: 'Grain Bag 50kg',
        attributes: { size: '50kg' },
        currentBuyPrice: 40,
        currentSellPrice: 70,
        categoryId: meronCat.id,
        unitId: meronUnit.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: meronOrg.id,
        sku: 'MRN-ROPE-01',
        brand: 'Meron',
        baseName: 'Nylon Rope',
        attributes: { length: '50m' },
        currentBuyPrice: 60,
        currentSellPrice: 95,
        categoryId: meronCat.id,
        unitId: meronUnit.id,
      },
    }),
    prisma.product.create({
      data: {
        tenantId: meronOrg.id,
        sku: 'MRN-BUCKET-01',
        brand: 'Meron',
        baseName: 'Plastic Bucket',
        attributes: { size: '12L' },
        currentBuyPrice: 90,
        currentSellPrice: 150,
        categoryId: meronCat.id,
        unitId: meronUnit.id,
      },
    }),
  ]);

  for (const prod of meronProducts) {
    await prisma.inventory.create({
      data: {
        tenantId: meronOrg.id,
        productId: prod.id,
        locationId: meronLoc.id,
        quantity: 120,
      },
    });
  }

  for (let i = 0; i < 6; i++) {
    const prod = meronProducts[i % meronProducts.length];
    const qty = 1 + (i % 3);
    const totalAmount = prod.currentSellPrice * qty;
    const totalCost = prod.currentBuyPrice * qty;
    await prisma.sale.create({
      data: {
        tenantId: meronOrg.id,
        invoiceNumber: `MRN-INV-${1000 + i}`,
        shopId: meronLoc.id,
        soldById: meronOwner.id,
        totalAmount,
        totalCost,
        profit: totalAmount - totalCost,
        paymentMethodId: meronPm.id,
        paidAmount: totalAmount,
        items: {
          create: [
            {
              tenantId: meronOrg.id,
              productId: prod.id,
              quantity: qty,
              unitSellPrice: prod.currentSellPrice,
              unitBuyPrice: prod.currentBuyPrice,
            },
          ],
        },
      },
    });
  }

  const meronMfgOrg = await createOrg(
    'Meron Manufacturing',
    'meron-manufacturing',
    BusinessType.MANUFACTURING,
  );
  const meronMfgOwnerRole = await createOrgRole(
    meronMfgOrg.id,
    'Owner',
    'Full access to everything',
    true,
    'OWNER',
  );
  const meronMfgManagerRole = await createOrgRole(
    meronMfgOrg.id,
    'Production Manager',
    'Manages raw materials and finished goods',
    false,
    'STOREKEEPER',
  );
  const meronMfgOperatorRole = await createOrgRole(
    meronMfgOrg.id,
    'Operator',
    'Runs production and records output',
    false,
    'SHOPKEEPER',
  );

  await prisma.membership.create({
    data: {
      userId: meronOwner.id,
      organizationId: meronMfgOrg.id,
      roleId: meronMfgOwnerRole.id,
      status: 'ACTIVE',
    },
  });

  const meronMfgManager = await prisma.user.create({
    data: {
      email: 'meron-mfg@inventory.com',
      password: hashedPassword,
      name: 'Yonas Kassa',
      roleId: meronMfgManagerRole.id,
    },
  });
  await prisma.membership.create({
    data: {
      userId: meronMfgManager.id,
      organizationId: meronMfgOrg.id,
      roleId: meronMfgManagerRole.id,
      status: 'ACTIVE',
    },
  });

  // --- Meron Manufacturing seed data (furniture factory: catalog, BOMs, work orders) ---
  const mfgFactoryCat = await prisma.locationCategory.create({
    data: { tenantId: meronMfgOrg.id, name: "Factory" },
  });
  const mfgLocation = await prisma.location.create({
    data: {
      tenantId: meronMfgOrg.id,
      name: "Meron Furniture Factory",
      type: LocationType.SHOP,
      categoryId: mfgFactoryCat.id,
    },
  });

  const mfgCatRaw = await prisma.category.create({
    data: { tenantId: meronMfgOrg.id, name: "Raw Materials" },
  });
  const mfgCatFg = await prisma.category.create({
    data: { tenantId: meronMfgOrg.id, name: "Finished Goods" },
  });
  const mfgUnitKg = await prisma.unit.create({
    data: { tenantId: meronMfgOrg.id, name: "kg" },
  });
  const mfgUnitPiece = await prisma.unit.create({
    data: { tenantId: meronMfgOrg.id, name: "piece" },
  });

  // Raw materials (component products).
  const mfgWood = await prisma.product.create({
    data: {
      tenantId: meronMfgOrg.id,
      sku: "MFG-WOOD-01",
      brand: "Meron Timber",
      baseName: "Oak Wood Plank",
      attributes: { source: "local" },
      currentBuyPrice: 120,
      currentSellPrice: 150,
      categoryId: mfgCatRaw.id,
      unitId: mfgUnitKg.id,
      kind: ProductKind.GOODS,
    },
  });
  const mfgNails = await prisma.product.create({
    data: {
      tenantId: meronMfgOrg.id,
      sku: "MFG-NAIL-01",
      brand: "Meron Hardware",
      baseName: "Steel Nails",
      attributes: { size: "1kg box" },
      currentBuyPrice: 90,
      currentSellPrice: 110,
      categoryId: mfgCatRaw.id,
      unitId: mfgUnitKg.id,
      kind: ProductKind.GOODS,
    },
  });


  // Finished goods (manufactured products).
  const mfgChair = await prisma.product.create({
    data: {
      tenantId: meronMfgOrg.id,
      sku: "MFG-CHR-01",
      brand: "Meron Furniture",
      baseName: "Classic Wooden Chair",
      attributes: { style: "classic" },
      currentBuyPrice: 0,
      currentSellPrice: 2500,
      categoryId: mfgCatFg.id,
      unitId: mfgUnitPiece.id,
      kind: ProductKind.GOODS,
    },
  });
  const mfgTable = await prisma.product.create({
    data: {
      tenantId: meronMfgOrg.id,
      sku: "MFG-TBL-01",
      brand: "Meron Furniture",
      baseName: "Oak Dining Table",
      attributes: { seats: 6 },
      currentBuyPrice: 0,
      currentSellPrice: 6000,
      categoryId: mfgCatFg.id,
      unitId: mfgUnitPiece.id,
      kind: ProductKind.GOODS,
    },
  });

  // Location stock (raw materials valued at purchase WAC, finished on hand).
  const mfgWoodInv = await prisma.inventory.create({
    data: {
      tenantId: meronMfgOrg.id,
      productId: mfgWood.id,
      locationId: mfgLocation.id,
      quantity: 400,
      avgCost: 120,
    },
  });
  const mfgNailsInv = await prisma.inventory.create({
    data: {
      tenantId: meronMfgOrg.id,
      productId: mfgNails.id,
      locationId: mfgLocation.id,
      quantity: 120,
      avgCost: 90,
    },
  });
  const mfgChairInv = await prisma.inventory.create({
    data: {
      tenantId: meronMfgOrg.id,
      productId: mfgChair.id,
      locationId: mfgLocation.id,
      quantity: 8,
      avgCost: 260,
    },
  });
  const mfgTableInv = await prisma.inventory.create({
    data: {
      tenantId: meronMfgOrg.id,
      productId: mfgTable.id,
      locationId: mfgLocation.id,
      quantity: 2,
      avgCost: 1500,
    },
  });


  // Bills of materials (recipes) with a 5% expected scrap allowance.
  const mfgChairBom = await prisma.billOfMaterials.create({
    data: {
      organizationId: meronMfgOrg.id,
      finishedProductId: mfgChair.id,
      quantityProduced: 1,
      scrapPercentage: 5,
      notes: "Classic wooden chair recipe",
      items: {
        create: [
          {
            rawMaterialProductId: mfgWood.id,
            quantityRequired: 2,
            unitId: mfgUnitKg.id,
          },
          {
            rawMaterialProductId: mfgNails.id,
            quantityRequired: 0.2,
            unitId: mfgUnitKg.id,
          },
        ],
      },
    },
  });
  const mfgTableBom = await prisma.billOfMaterials.create({
    data: {
      organizationId: meronMfgOrg.id,
      finishedProductId: mfgTable.id,
      quantityProduced: 1,
      scrapPercentage: 5,
      notes: "Oak dining table recipe",
      items: {
        create: [
          {
            rawMaterialProductId: mfgWood.id,
            quantityRequired: 6,
            unitId: mfgUnitKg.id,
          },
          {
            rawMaterialProductId: mfgNails.id,
            quantityRequired: 0.5,
            unitId: mfgUnitKg.id,
          },
        ],
      },
    },
  });

  // Completed run: 12 chairs, batch CHR-2026-001. Backflush at 5% scrap:
  // wood 25.2 kg + nails 2.52 kg = COGM 3,250.80 (270.90 / unit).
  const chairRun = await prisma.workOrder.create({
    data: {
      organizationId: meronMfgOrg.id,
      bomId: mfgChairBom.id,
      finishedProductId: mfgChair.id,
      targetQuantity: 12,
      producedQuantity: 12,
      locationId: mfgLocation.id,
      batchNumber: "CHR-2026-001",
      status: WorkOrderStatus.COMPLETED,
      totalCogmCost: 3250.8,
      cogmUnitCost: 270.9,
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      notes: "First chair batch (seed demo)",
      createdById: meronMfgManager.id,
    },
  });

  // Mirror the backflush that a completion transaction would perform.
  await prisma.inventory.update({
    where: { id: mfgWoodInv.id },
    data: { quantity: { decrement: 25.2 } },
  });
  await prisma.inventory.update({
    where: { id: mfgNailsInv.id },
    data: { quantity: { decrement: 2.52 } },
  });
  await prisma.inventory.update({
    where: { id: mfgChairInv.id },
    data: { quantity: { increment: 12 }, avgCost: 266.54 },
  });
  await prisma.productBatch.create({
    data: {
      tenantId: meronMfgOrg.id,
      productId: mfgChair.id,
      locationId: mfgLocation.id,
      batchNumber: "CHR-2026-001",
      manufactureDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      quantity: 12,
      unitCost: 270.9,
    },
  });


  await prisma.auditLog.create({
    data: {
      userId: meronMfgManager.id,
      tenantId: meronMfgOrg.id,
      action: "PRODUCTION_ISSUE",
      details: "Chair run #" + chairRun.id + " material issue: Oak Wood Plank 25.2, Steel Nails 2.52",
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: meronMfgManager.id,
      tenantId: meronMfgOrg.id,
      action: "WORK_ORDER_COMPLETED",
      details: "Work order #" + chairRun.id + " produced 12 Classic Wooden Chair — COGM 3250.8 (270.9/unit, batch CHR-2026-001)",
    },
  });

  // In-progress table run (completion will backflush when tested).
  await prisma.workOrder.create({
    data: {
      organizationId: meronMfgOrg.id,
      bomId: mfgTableBom.id,
      finishedProductId: mfgTable.id,
      targetQuantity: 5,
      locationId: mfgLocation.id,
      status: WorkOrderStatus.IN_PROGRESS,
      startedAt: new Date(Date.now() - 30 * 60 * 1000),
      notes: "First table batch (seed demo)",
      createdById: meronMfgManager.id,
    },
  });

  // Draft rerun of the chair recipe for lifecycle testing.
  await prisma.workOrder.create({
    data: {
      organizationId: meronMfgOrg.id,
      bomId: mfgChairBom.id,
      finishedProductId: mfgChair.id,
      targetQuantity: 10,
      locationId: mfgLocation.id,
      batchNumber: "CHR-2026-002",
      status: WorkOrderStatus.DRAFT,
      notes: "Chair replenishment run (draft)",
      createdById: meronMfgManager.id,
    },
  });

  // Add-on services (machine rent, cutting, shapes) generating extra income.
  const mfgSvcRent = await prisma.mfgService.create({
    data: {
      organizationId: meronMfgOrg.id,
      name: 'Machine Rent (CNC Router)',
      description: 'Hourly rental of the CNC router',
      pricingModel: MfgPricingModel.PER_PERIOD,
      price: 500,
      periodUnit: 'hour',
    },
  });
  const mfgSvcCut = await prisma.mfgService.create({
    data: {
      organizationId: meronMfgOrg.id,
      name: 'Board Cutting',
      description: 'Cutting boards to size',
      pricingModel: MfgPricingModel.PER_UNIT,
      price: 25,
    },
  });
  const mfgSvcShape = await prisma.mfgService.create({
    data: {
      organizationId: meronMfgOrg.id,
      name: 'Shape Making',
      description: 'Custom shape routing',
      pricingModel: MfgPricingModel.ONE_TIME,
      price: 300,
    },
  });

  await prisma.mfgServiceIncome.createMany({
    data: [
      {
        organizationId: meronMfgOrg.id,
        serviceId: mfgSvcRent.id,
        quantity: 3,
        amount: 1500,
        incomeDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        notes: '3h CNC router rental',
        recordedById: meronMfgManager.id,
      },
      {
        organizationId: meronMfgOrg.id,
        serviceId: mfgSvcCut.id,
        quantity: 20,
        amount: 500,
        incomeDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        recordedById: meronMfgManager.id,
      },
      {
        organizationId: meronMfgOrg.id,
        serviceId: mfgSvcShape.id,
        quantity: 1,
        amount: 300,
        incomeDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        recordedById: meronMfgManager.id,
      },
    ],
  });

  // Customer-facing job orders at different pipeline stages.
  const mfgJobDesign = await prisma.manufacturingOrder.create({
    data: {
      organizationId: meronMfgOrg.id,
      jobNumber: 'JB-2026-1001',
      title: 'Custom chair set for ABC Hotel',
      customerName: 'ABC Hotel',
      bomId: mfgChairBom.id,
      targetQuantity: 8,
      dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      stage: MfgOrderStage.DESIGN,
      notes: 'Including logo engraving on the backrest',
      createdById: meronMfgManager.id,
    },
  });
  await prisma.manufacturingOrderHistory.create({
    data: {
      organizationId: meronMfgOrg.id,
      orderId: mfgJobDesign.id,
      toStage: MfgOrderStage.DESIGN,
      changedById: meronMfgManager.id,
    },
  });

  const mfgJobTable = await prisma.manufacturingOrder.create({
    data: {
      organizationId: meronMfgOrg.id,
      jobNumber: 'JB-2026-1002',
      title: 'Dining tables for a restaurant',
      customerName: 'Kaleb Restaurant',
      bomId: mfgTableBom.id,
      targetQuantity: 2,
      dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      stage: MfgOrderStage.MATERIAL_READY,
      notes: 'Materials already purchased',
      createdById: meronMfgManager.id,
    },
  });
  await prisma.manufacturingOrderHistory.createMany({
    data: [
      {
        organizationId: meronMfgOrg.id,
        orderId: mfgJobTable.id,
        toStage: MfgOrderStage.DESIGN,
        changedById: meronMfgManager.id,
      },
      {
        organizationId: meronMfgOrg.id,
        orderId: mfgJobTable.id,
        fromStage: MfgOrderStage.DESIGN,
        toStage: MfgOrderStage.PURCHASING_MATERIALS,
        changedById: meronMfgManager.id,
      },
      {
        organizationId: meronMfgOrg.id,
        orderId: mfgJobTable.id,
        fromStage: MfgOrderStage.PURCHASING_MATERIALS,
        toStage: MfgOrderStage.MATERIAL_READY,
        changedById: meronMfgManager.id,
      },
    ],
  });

  // Materials & operations demo: machine, shift session, worker issue + return.
  const mfgMachine = await prisma.machine.create({
    data: {
      organizationId: meronMfgOrg.id,
      code: 'CNC-01',
      name: 'CNC Router',
      type: 'Wood cutting',
      locationId: mfgLocation.id,
      notes: 'Furniture factory router',
    },
  });
  await prisma.machineComponent.createMany({
    data: [
      { organizationId: meronMfgOrg.id, machineId: mfgMachine.id, name: 'Cutting blade', quantity: 1 },
      { organizationId: meronMfgOrg.id, machineId: mfgMachine.id, name: 'M8 mounting screw', quantity: 4 },
    ],
  });

  // Issuable tool demo set (M3): a drill with parts that must come back.
  const mfgDrill = await prisma.machine.create({
    data: {
      organizationId: meronMfgOrg.id,
      code: 'DRL-01',
      name: 'Power Drill',
      type: 'Drilling',
      kind: 'ISSUABLE',
      locationId: mfgLocation.id,
    },
  });
  await prisma.machineComponent.createMany({
    data: [
      { organizationId: meronMfgOrg.id, machineId: mfgDrill.id, name: 'Drill bit 8mm', quantity: 2 },
      { organizationId: meronMfgOrg.id, machineId: mfgDrill.id, name: 'Battery', quantity: 1 },
    ],
  });

  const mfgMorningTemplate = await prisma.shiftTemplate.create({
    data: {
      organizationId: meronMfgOrg.id,
      name: 'Morning Shift',
      startTime: '08:00',
      endTime: '16:00',
      repeatDays: [0, 1, 2, 3, 4, 5, 6],
    },
  });
  const mfgSession = await prisma.shiftSession.create({
    data: {
      organizationId: meronMfgOrg.id,
      name: mfgMorningTemplate.name,
      shiftTemplateId: mfgMorningTemplate.id,
      date: new Date(),
      startTime: mfgMorningTemplate.startTime,
      endTime: mfgMorningTemplate.endTime,
      status: 'ACTIVE',
      startedAt: new Date(),
      triggeredBy: 'MANUAL',
    },
  });
  await prisma.shiftAssignment.create({
    data: { organizationId: meronMfgOrg.id, sessionId: mfgSession.id, workerId: meronMfgManager.id },
  });

  // One-time shift pattern example (no repeat days, carries its own date).
  const mfgOneTimePattern = await prisma.shiftTemplate.create({
    data: {
      organizationId: meronMfgOrg.id,
      name: 'Weekend Cleanup',
      startTime: '09:00',
      endTime: '12:00',
      repeatDays: [],
      date: new Date(Date.now() + 2 * 86400000),
    },
  });

  const mfgIssue = await prisma.materialIssue.create({
    data: {
      organizationId: meronMfgOrg.id,
      jobId: mfgJobDesign.id,
      productId: mfgWood.id,
      locationId: mfgLocation.id,
      issuedToId: meronMfgManager.id,
      issuedById: meronMfgManager.id,
      quantity: 2,
      unitCost: 120,
      notes: 'Cut 1m MDF-style board for chair work',
    },
  });
  await prisma.materialReturn.create({
    data: {
      organizationId: meronMfgOrg.id,
      issueId: mfgIssue.id,
      productId: mfgWood.id,
      quantity: 0.5,
      returnedById: meronMfgManager.id,
      note: 'Leftover offcut returned',
    },
  });

  // Employee roster: workers may or may not have a user account.
  await prisma.worker.upsert({
    where: { userId: meronMfgManager.id },
    update: { organizationId: meronMfgOrg.id, name: meronMfgManager.name, title: 'Production Manager', locationId: mfgLocation.id },
    create: { organizationId: meronMfgOrg.id, userId: meronMfgManager.id, name: meronMfgManager.name, title: 'Production Manager', locationId: mfgLocation.id },
  });
  const mfgEmployees = [
    { name: 'Dawit Alemu', title: 'Carpenter', phone: '+251-911-100-222' },
    { name: 'Hanna Gebre', title: 'Finisher', phone: '+251-911-100-333' },
    { name: 'Samuel Tesfaye', title: 'Machine Operator', phone: '+251-911-100-444' },
  ];
  await prisma.worker.createMany({
    data: mfgEmployees.map((w) => ({ organizationId: meronMfgOrg.id, name: w.name, title: w.title, phone: w.phone, locationId: mfgLocation.id })),
  });

  // Manufacturing V2: owner-defined teams + default order pipeline.
  const mfgPipelineTeams = ['Intake', 'Design', 'Purchasing', 'Production', 'Delivery & Settlement'];
  const mfgTeams: { id: number; name: string }[] = [];
  for (const [idx, name] of mfgPipelineTeams.entries()) {
    const team = await prisma.mfgTeam.create({
      data: { organizationId: meronMfgOrg.id, name, sortOrder: idx },
    });
    mfgTeams.push({ id: team.id, name });
  }
  const mfgDefaultFlow = await prisma.mfgFlow.create({
    data: {
      organizationId: meronMfgOrg.id,
      name: 'Default pipeline',
      description: 'Intake → Design → Purchasing → Production → Delivery & Settlement',
      isDefault: true,
      steps: {
        create: mfgTeams.map((t) => ({
          organizationId: meronMfgOrg.id,
          teamId: t.id,
          name: t.name,
          // The Production team performs the build — reaching it auto-links a
          // Work Order so materials/COGM run from the flow.
          isProductionStep: t.name.toLowerCase() === 'production',
        })),
      },
    },
  });

  console.log('🏪 Meron Trading & Meron Manufacturing created.');

  // -------------------------------------------------------------------------
  // Owner 3 — Dawit Kebede (dawit@inventory.com)
  //   Business 1: Dawit Café & Restaurant (HOSPITALITY)
  // -------------------------------------------------------------------------
  const dawitOwner = await prisma.user.create({
    data: {
      email: 'dawit@inventory.com',
      password: hashedPassword,
      name: 'Dawit Kebede',
      isOwnerAccount: true,
      aiTrialEndsAt: aiTrialEnd,
      verificationStatus: 'APPROVED',
    },
  });

  const dawitOrg = await createOrg(
    'Dawit Café & Restaurant',
    'dawit-cafe',
    BusinessType.HOSPITALITY,
  );
  const dawitOwnerRole = await createOrgRole(
    dawitOrg.id,
    'Owner',
    'Full access to everything',
    true,
    'OWNER',
  );
  const dawitManagerRole = await createOrgRole(
    dawitOrg.id,
    'Manager',
    'Oversees operations and cash collection',
    false,
    'MANAGER',
  );
  const dawitWaiterRole = await createOrgRole(
    dawitOrg.id,
    'Waiter',
    'Takes orders and serves customers',
    false,
    'WAITER',
  );
  const dawitChefRole = await createOrgRole(
    dawitOrg.id,
    'Chef',
    'Prepares meals from the kitchen board',
    false,
    'CHEF',
  );
  // "Order Served" notifications are sent to the Receptionist role, so the row
  // has to exist or those notifications are dropped silently.
  await createOrgRole(
    dawitOrg.id,
    'Receptionist',
    'Manages reservations and front desk',
    false,
    'RECEPTIONIST',
  );

  await prisma.membership.create({
    data: {
      userId: dawitOwner.id,
      organizationId: dawitOrg.id,
      roleId: dawitOwnerRole.id,
      status: 'ACTIVE',
    },
  });

  const dawitManager = await prisma.user.create({
    data: {
      email: 'dawit-cafe@inventory.com',
      password: hashedPassword,
      name: 'Bethlehem Assefa',
      roleId: dawitManagerRole.id,
    },
  });
  await prisma.membership.create({
    data: {
      userId: dawitManager.id,
      organizationId: dawitOrg.id,
      roleId: dawitManagerRole.id,
      status: 'ACTIVE',
    },
  });

  // --- Dawit Café seed data (menu, tables, sample order) ---
  const dawitPm = await prisma.paymentMethod.create({
    data: { name: 'Cash', tenantId: dawitOrg.id },
  });
  const dawitBeverages = await prisma.menuCategory.create({
    data: {
      tenantId: dawitOrg.id,
      name: 'Beverages',
      ...catRoute('bar'),
      sortOrder: 1,
    },
  });
  const dawitFood = await prisma.menuCategory.create({
    data: {
      tenantId: dawitOrg.id,
      name: 'Main Courses',
      ...catRoute('kitchen'),
      sortOrder: 2,
    },
  });

  const dawitCoffee = await prisma.menuItem.create({
    data: {
      tenantId: dawitOrg.id,
      menuCategoryId: dawitBeverages.id,
      name: 'Espresso',
      price: 40,
      cost: 12,
      sortOrder: 1,
    },
  });
  const dawitTea = await prisma.menuItem.create({
    data: {
      tenantId: dawitOrg.id,
      menuCategoryId: dawitBeverages.id,
      name: 'Black Tea',
      price: 20,
      cost: 5,
      sortOrder: 2,
    },
  });
  const dawitPizza = await prisma.menuItem.create({
    data: {
      tenantId: dawitOrg.id,
      menuCategoryId: dawitFood.id,
      name: 'Margherita Pizza',
      price: 450,
      cost: 200,
      sortOrder: 1,
    },
  });
  const dawitPasta = await prisma.menuItem.create({
    data: {
      tenantId: dawitOrg.id,
      menuCategoryId: dawitFood.id,
      name: 'Spaghetti Bolognese',
      price: 350,
      cost: 150,
      sortOrder: 2,
    },
  });

  const dawitTable = await prisma.diningTable.create({
    data: {
      tenantId: dawitOrg.id,
      name: 'T1',
      zone: 'Café',
      capacity: 2,
      status: TableStatus.FREE,
    },
  });

  const dawitOrder = await prisma.order.create({
    data: {
      tenantId: dawitOrg.id,
      orderNumber: 'DC-1001',
      tableId: dawitTable.id,
      customerName: 'Walk-in',
      status: OrderStatus.PAID,
      totalAmount: 530,
      discount: 0,
      serviceCharge: 0,
      tax: 0,
      paidAmount: 530,
      paymentMethodId: dawitPm.id,
      createdById: dawitManager.id,
      items: {
        create: [
          {
            tenantId: dawitOrg.id,
            menuItemId: dawitPizza.id,
            name: dawitPizza.name,
            quantity: 1,
            unitPrice: dawitPizza.price,
            cost: dawitPizza.cost,
            ...itemStation('kitchen'),
          },
          {
            tenantId: dawitOrg.id,
            menuItemId: dawitCoffee.id,
            name: dawitCoffee.name,
            quantity: 2,
            unitPrice: dawitCoffee.price,
            cost: dawitCoffee.cost,
            ...itemStation('bar'),
          },
        ],
      },
    },
  });
  await prisma.orderPayment.create({
    data: {
      tenantId: dawitOrg.id,
      orderId: dawitOrder.id,
      amount: 530,
      paymentMethodId: dawitPm.id,
      status: 'CONFIRMED',
      collectedById: dawitManager.id,
    },
  });

  console.log('☕ Dawit Café & Restaurant created.');

  // -------------------------------------------------------------------------
  // Service vertical demo — Addis Spa & Salon (SERVICE)
  // -------------------------------------------------------------------------
  const hannaOwner = await prisma.user.create({
    data: {
      email: 'hanna@inventory.com',
      password: hashedPassword,
      name: 'Liya Girma',
      isOwnerAccount: true,
      aiTrialEndsAt: aiTrialEnd,
      verificationStatus: 'APPROVED',
    },
  });
  const salonOrg = await createOrg(
    'Addis Spa & Salon',
    'addis-salon',
    BusinessType.SERVICE,
  );
  const salonOwnerRole = await createOrgRole(
    salonOrg.id,
    'Owner',
    'Full access to everything',
    true,
    'OWNER',
  );
  const salonManagerRole = await createOrgRole(
    salonOrg.id,
    'Manager',
    'Oversees operations and cash collection',
    false,
    'MANAGER',
  );
  const salonProviderRole = await createOrgRole(
    salonOrg.id,
    'Provider',
    'Delivers services and takes tickets',
    false,
    'WAITER',
  );
  const salonCashierRole = await createOrgRole(
    salonOrg.id,
    'Cashier',
    'Collects and confirms payments',
    false,
    'CASHIER',
  );
  await prisma.membership.create({
    data: {
      userId: hannaOwner.id,
      organizationId: salonOrg.id,
      roleId: salonOwnerRole.id,
      status: 'ACTIVE',
    },
  });

  // Default SERVICE chart of accounts was seeded by createOrg above
  // (getDefaultAccounts includes Service Revenue + the shared overhead).
  const salonProvider = await prisma.user.create({
    data: {
      email: 'provider@inventory.com',
      password: hashedPassword,
      name: 'Selam Tesfaye',
      roleId: salonProviderRole.id,
    },
  });
  await prisma.membership.create({
    data: {
      userId: salonProvider.id,
      organizationId: salonOrg.id,
      roleId: salonProviderRole.id,
      status: 'ACTIVE',
    },
  });

  // Service catalog (dedicated SERVICE vertical models).
  const salonPm = await prisma.paymentMethod.create({
    data: { name: 'Cash', tenantId: salonOrg.id },
  });
  const svcHair = await prisma.serviceCategory.create({
    data: { tenantId: salonOrg.id, name: 'Hair' },
  });
  const svcNails = await prisma.serviceCategory.create({
    data: { tenantId: salonOrg.id, name: 'Nails' },
  });
  const svcHaircut = await prisma.serviceItem.create({
    data: {
      tenantId: salonOrg.id,
      categoryId: svcHair.id,
      name: 'Haircut & Styling',
      price: 350,
      durationMins: 45,
    },
  });
  const svcManicure = await prisma.serviceItem.create({
    data: {
      tenantId: salonOrg.id,
      categoryId: svcNails.id,
      name: 'Manicure',
      price: 250,
      durationMins: 30,
    },
  });

  const salonClient = await prisma.customer.create({
    data: { organizationId: salonOrg.id, name: 'Walk-in client' },
  });

  // A sample completed + paid ticket.
  const salonTicket = await prisma.serviceTicket.create({
    data: {
      tenantId: salonOrg.id,
      clientId: salonClient.id,
      totalAmount: 600,
      status: 'PAID',
      items: {
        create: [
          {
            tenantId: salonOrg.id,
            serviceItemId: svcHaircut.id,
            quantity: 1,
            unitPrice: svcHaircut.price,
          },
          {
            tenantId: salonOrg.id,
            serviceItemId: svcManicure.id,
            quantity: 1,
            unitPrice: svcManicure.price,
          },
        ],
      },
    },
  });
  await prisma.servicePayment.create({
    data: {
      tenantId: salonOrg.id,
      ticketId: salonTicket.id,
      amount: 600,
      paymentMethodId: salonPm.id,
    },
  });
  console.log('💇 Addis Spa & Salon (SERVICE) created.');

  // 5. Create Categories
  const catBulb = await prisma.category.create({
    data: { name: 'LED Bulbs & Lighting' },
  });
  const catWire = await prisma.category.create({
    data: { name: 'Electrical Wires & Cables' },
  });
  const catSwitch = await prisma.category.create({
    data: { name: 'Switches & Sockets' },
  });
  const catBreaker = await prisma.category.create({
    data: { name: 'Circuit Breakers & Protection' },
  });
  const catTools = await prisma.category.create({
    data: { name: 'Electrical Tools & Hardware' },
  });

  console.log('🏷️ Categories created.');

  // 6. Create Products
  const products = await Promise.all([
    // Bulbs
    prisma.product.create({
      data: {
        sku: 'BLB-PHILIPS-12W-SPOT',
        brand: 'Philips',
        baseName: 'LED Spotlight',
        attributes: { watt: '12W', type: 'Spot Light', holder: 'GU10' },
        currentBuyPrice: 4.5,
        currentSellPrice: 8.0,
        categoryId: catBulb.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'BLB-OSRAM-15W-HANG',
        brand: 'Osram',
        baseName: 'LED Hanging Bulb',
        attributes: { watt: '15W', type: 'Hanging', holder: 'E27' },
        currentBuyPrice: 5.0,
        currentSellPrice: 10.0,
        categoryId: catBulb.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'BLB-GE-20W-PANEL',
        brand: 'GE',
        baseName: 'Slim LED Panel Light',
        attributes: { watt: '20W', type: 'Panel', shape: 'Square' },
        currentBuyPrice: 12.0,
        currentSellPrice: 22.0,
        categoryId: catBulb.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'BLB-PHILIPS-50W-FLOOD',
        brand: 'Philips',
        baseName: 'Outdoor Flood Light',
        attributes: { watt: '50W', type: 'Floodlight', ipRating: 'IP65' },
        currentBuyPrice: 35.0,
        currentSellPrice: 60.0,
        categoryId: catBulb.id,
      },
    }),

    // Wires
    prisma.product.create({
      data: {
        sku: 'WIRE-DUCAB-2.5-3C',
        brand: 'Ducab',
        baseName: 'Copper Wire Roll',
        attributes: { size: '2.5mm', cores: '3 Core', length: '100m' },
        currentBuyPrice: 45.0,
        currentSellPrice: 75.0,
        categoryId: catWire.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'WIRE-DUCAB-1.5-1C',
        brand: 'Ducab',
        baseName: 'Single Core Building Wire',
        attributes: { size: '1.5mm', color: 'Red', length: '100m' },
        currentBuyPrice: 18.0,
        currentSellPrice: 30.0,
        categoryId: catWire.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'WIRE-ALSHEM-4.0-4C',
        brand: 'Al-Shem',
        baseName: 'Armored Power Cable',
        attributes: { size: '4.0mm', cores: '4 Core', rating: 'Heavy Duty' },
        currentBuyPrice: 120.0,
        currentSellPrice: 190.0,
        categoryId: catWire.id,
      },
    }),

    // Switches
    prisma.product.create({
      data: {
        sku: 'SWT-LEGRAND-1G1W',
        brand: 'Legrand',
        baseName: '1-Gang 1-Way Switch',
        attributes: { Gang: '1', Way: '1', Color: 'White' },
        currentBuyPrice: 2.1,
        currentSellPrice: 4.5,
        categoryId: catSwitch.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'SWT-LEGRAND-2G2W',
        brand: 'Legrand',
        baseName: '2-Gang 2-Way Switch',
        attributes: { Gang: '2', Way: '2', Color: 'White' },
        currentBuyPrice: 3.5,
        currentSellPrice: 7.0,
        categoryId: catSwitch.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'SOC-SCHNEIDER-13A-DUAL',
        brand: 'Schneider',
        baseName: 'Double Switched Socket',
        attributes: { Amps: '13A', Features: 'USB Charging' },
        currentBuyPrice: 8.5,
        currentSellPrice: 16.0,
        categoryId: catSwitch.id,
      },
    }),

    // Circuit Breakers
    prisma.product.create({
      data: {
        sku: 'BRK-ABB-16A-MCB',
        brand: 'ABB',
        baseName: 'Single Pole MCB 16A',
        attributes: { Poles: '1P', Amps: '16A', Curve: 'C-Curve' },
        currentBuyPrice: 6.0,
        currentSellPrice: 11.0,
        categoryId: catBreaker.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'BRK-ABB-32A-MCB',
        brand: 'ABB',
        baseName: 'Single Pole MCB 32A',
        attributes: { Poles: '1P', Amps: '32A', Curve: 'C-Curve' },
        currentBuyPrice: 6.5,
        currentSellPrice: 12.0,
        categoryId: catBreaker.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'BRK-SCHNEIDER-63A-RCCB',
        brand: 'Schneider',
        baseName: 'Residual Current Breaker',
        attributes: { Poles: '2P', Amps: '63A', Sensitivity: '30mA' },
        currentBuyPrice: 28.0,
        currentSellPrice: 50.0,
        categoryId: catBreaker.id,
      },
    }),

    // Tools
    prisma.product.create({
      data: {
        sku: 'TL-FLUKE-117-MULTIMETER',
        brand: 'Fluke',
        baseName: 'Digital Multimeter',
        attributes: { Display: 'Digital', CAT: 'CAT III 600V' },
        currentBuyPrice: 110.0,
        currentSellPrice: 180.0,
        categoryId: catTools.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'TL-INGCO-STRIPPER-8IN',
        brand: 'Ingco',
        baseName: 'Automatic Wire Stripper',
        attributes: { Size: '8 Inch', Capability: '0.2-6.0mm' },
        currentBuyPrice: 7.0,
        currentSellPrice: 14.0,
        categoryId: catTools.id,
      },
    }),
  ]);

  const [
    prodSpot,
    prodHang,
    prodPanel,
    prodFlood,
    prodWire25,
    prodWire15,
    prodWireArmored,
    prodSwt1G,
    prodSwt2G,
    prodSocUsb,
    prodMcb16,
    prodMcb32,
    prodRccb63,
    prodFluke,
    prodStripper,
  ] = products;

  console.log('📦 Products created.');

  // 7. Seed Inventories
  await prisma.inventory.createMany({
    data: [
      // Main Warehouse
      { productId: prodSpot.id, locationId: nejatStore.id, quantity: 300 },
      { productId: prodHang.id, locationId: nejatStore.id, quantity: 200 },
      { productId: prodPanel.id, locationId: nejatStore.id, quantity: 80 },
      { productId: prodFlood.id, locationId: nejatStore.id, quantity: 45 },
      { productId: prodSwt1G.id, locationId: nejatStore.id, quantity: 500 },
      { productId: prodSwt2G.id, locationId: nejatStore.id, quantity: 400 },
      { productId: prodSocUsb.id, locationId: nejatStore.id, quantity: 150 },
      { productId: prodMcb16.id, locationId: nejatStore.id, quantity: 250 },
      { productId: prodMcb32.id, locationId: nejatStore.id, quantity: 200 },
      { productId: prodRccb63.id, locationId: nejatStore.id, quantity: 60 },
      { productId: prodFluke.id, locationId: nejatStore.id, quantity: 15 },
      { productId: prodStripper.id, locationId: nejatStore.id, quantity: 90 },

      // Cable Depot
      { productId: prodWire25.id, locationId: sosaStore.id, quantity: 200 },
      { productId: prodWire15.id, locationId: sosaStore.id, quantity: 350 },
      {
        productId: prodWireArmored.id,
        locationId: sosaStore.id,
        quantity: 50,
      },

      // Shop 1 (Bole)
      { productId: prodSpot.id, locationId: shop1.id, quantity: 12 },
      { productId: prodHang.id, locationId: shop1.id, quantity: 25 },
      { productId: prodWire25.id, locationId: shop1.id, quantity: 8 },
      { productId: prodSwt1G.id, locationId: shop1.id, quantity: 45 },
      { productId: prodSocUsb.id, locationId: shop1.id, quantity: 10 },
      { productId: prodFluke.id, locationId: shop1.id, quantity: 2 },

      // Shop 2 (Megenagna)
      { productId: prodSpot.id, locationId: shop2.id, quantity: 18 },
      { productId: prodPanel.id, locationId: shop2.id, quantity: 5 },
      { productId: prodWire15.id, locationId: shop2.id, quantity: 14 },
      { productId: prodMcb16.id, locationId: shop2.id, quantity: 30 },
      { productId: prodStripper.id, locationId: shop2.id, quantity: 6 },

      // Shop 3 (Merkato)
      { productId: prodFlood.id, locationId: shop3.id, quantity: 8 },
      { productId: prodWireArmored.id, locationId: shop3.id, quantity: 4 },
      { productId: prodSwt2G.id, locationId: shop3.id, quantity: 60 },
      { productId: prodRccb63.id, locationId: shop3.id, quantity: 10 },
    ],
  });

  console.log('🏭 Inventories distributed.');

  // 7.5 Seed low-stock notifications for existing data
  const lowStockEntries = [
    {
      productName: 'Ducab Copper Wire Roll (2.5mm)',
      productId: prodWire25.id,
      locationId: shop1.id,
      locationName: shop1.name,
      locationType: shop1.type,
      qty: 8,
    },
    {
      productName: 'Fluke Digital Multimeter',
      productId: prodFluke.id,
      locationId: shop1.id,
      locationName: shop1.name,
      locationType: shop1.type,
      qty: 2,
    },
    {
      productName: 'GE Slim LED Panel Light (20W)',
      productId: prodPanel.id,
      locationId: shop2.id,
      locationName: shop2.name,
      locationType: shop2.type,
      qty: 5,
    },
    {
      productName: 'Ingco Automatic Wire Stripper',
      productId: prodStripper.id,
      locationId: shop2.id,
      locationName: shop2.name,
      locationType: shop2.type,
      qty: 6,
    },
    {
      productName: 'Philips Outdoor Flood Light (50W)',
      productId: prodFlood.id,
      locationId: shop3.id,
      locationName: shop3.name,
      locationType: shop3.type,
      qty: 8,
    },
    {
      productName: 'Al-Shem Armored Power Cable (4.0mm)',
      productId: prodWireArmored.id,
      locationId: shop3.id,
      locationName: shop3.name,
      locationType: shop3.type,
      qty: 4,
    },
  ];

  for (const entry of lowStockEntries) {
    const message = `${entry.productName} is running low (${entry.qty} remaining) at ${entry.locationName}.`;

    // Owner notification
    await prisma.notification.create({
      data: {
        type: 'LOW_STOCK',
        title: 'Low Stock Alert',
        message,
        productId: entry.productId,
        locationId: entry.locationId,
        targetRoleId: ownerRole.id,
      },
    });

    // Location-specific user notification
    await prisma.notification.create({
      data: {
        type: 'LOW_STOCK',
        title: 'Low Stock Alert',
        message,
        productId: entry.productId,
        locationId: entry.locationId,
        targetRoleId: null,
        targetLocationId: entry.locationId,
      },
    });
  }

  console.log('🔔 Low-stock notifications seeded.');

  // 8. Stock Requests

  // 1. PENDING Request
  await prisma.stockRequest.create({
    data: {
      shopId: shop1.id,
      storeId: nejatStore.id,
      status: RequestStatus.PENDING,
      createdById: shopkeeper1.id,
      items: {
        create: [
          {
            productId: prodSpot.id,
            quantityRequested: 50,
            status: RequestItemStatus.PENDING,
          },
          {
            productId: prodSocUsb.id,
            quantityRequested: 20,
            status: RequestItemStatus.PENDING,
          },
        ],
      },
    },
  });

  // 2. APPROVED Request
  await prisma.stockRequest.create({
    data: {
      shopId: shop2.id,
      storeId: sosaStore.id,
      status: RequestStatus.APPROVED,
      createdById: shopkeeper2.id,
      approvedById: storekeeper2.id,
      items: {
        create: [
          {
            productId: prodWire25.id,
            quantityRequested: 15,
            status: RequestItemStatus.APPROVED,
          },
          {
            productId: prodWire15.id,
            quantityRequested: 25,
            status: RequestItemStatus.APPROVED,
          },
        ],
      },
    },
  });

  // 3. PARTIALLY_APPROVED Request
  await prisma.stockRequest.create({
    data: {
      shopId: shop3.id,
      storeId: nejatStore.id,
      status: RequestStatus.PARTIALLY_APPROVED,
      createdById: shopkeeper3.id,
      approvedById: storekeeper1.id,
      items: {
        create: [
          {
            productId: prodSwt2G.id,
            quantityRequested: 100,
            status: RequestItemStatus.APPROVED,
          },
          {
            productId: prodFluke.id,
            quantityRequested: 10,
            status: RequestItemStatus.REJECTED,
          },
        ],
      },
    },
  });

  // 4. PARTIALLY_DISPATCHED Request
  await prisma.stockRequest.create({
    data: {
      shopId: shop1.id,
      storeId: nejatStore.id,
      status: RequestStatus.PARTIALLY_DISPATCHED,
      createdById: shopkeeper1.id,
      approvedById: storekeeper1.id,
      items: {
        create: [
          {
            productId: prodHang.id,
            quantityRequested: 30,
            status: RequestItemStatus.DISPATCHED,
          },
          {
            productId: prodSwt1G.id,
            quantityRequested: 50,
            status: RequestItemStatus.APPROVED,
          },
        ],
      },
    },
  });

  // 5. REJECTED Request
  await prisma.stockRequest.create({
    data: {
      shopId: shop3.id,
      storeId: nejatStore.id,
      status: RequestStatus.REJECTED,
      createdById: shopkeeper3.id,
      items: {
        create: [
          {
            productId: prodMcb32.id,
            quantityRequested: 40,
            status: RequestItemStatus.REJECTED,
          },
        ],
      },
    },
  });

  // 6. COMPLETED Request
  await prisma.stockRequest.create({
    data: {
      shopId: shop2.id,
      storeId: nejatStore.id,
      status: RequestStatus.COMPLETED,
      createdById: shopkeeper2.id,
      approvedById: storekeeper1.id,
      items: {
        create: [
          {
            productId: prodPanel.id,
            quantityRequested: 10,
            status: RequestItemStatus.DISPATCHED,
          },
          {
            productId: prodMcb16.id,
            quantityRequested: 20,
            status: RequestItemStatus.DISPATCHED,
          },
        ],
      },
    },
  });

  console.log('📋 Stock Requests created.');

  // 9. Generate Historical Sales
  const generateSale = async (
    shopId: number,
    soldById: number,
    itemsData: Array<{ prod: typeof prodSpot; qty: number }>,
  ) => {
    let totalAmount = 0;
    let totalCost = 0;

    const items = itemsData.map(({ prod, qty }) => {
      const lineSell = prod.currentSellPrice * qty;
      const lineCost = prod.currentBuyPrice * qty;
      totalAmount += lineSell;
      totalCost += lineCost;

      return {
        productId: prod.id,
        quantity: qty,
        unitSellPrice: prod.currentSellPrice,
        unitBuyPrice: prod.currentBuyPrice,
      };
    });

    const profit = totalAmount - totalCost;

    return await prisma.sale.create({
      data: {
        invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        shopId,
        soldById,
        totalAmount,
        totalCost,
        profit,
        items: {
          createMany: {
            data: items,
          },
        },
      },
    });
  };

  // Multiple sales across different branches
  await generateSale(shop1.id, shopkeeper1.id, [
    { prod: prodSpot, qty: 4 },
    { prod: prodSwt1G, qty: 10 },
  ]);

  await generateSale(shop1.id, shopkeeper1.id, [
    { prod: prodWire25, qty: 2 },
    { prod: prodSocUsb, qty: 3 },
  ]);

  await generateSale(shop2.id, shopkeeper2.id, [
    { prod: prodPanel, qty: 2 },
    { prod: prodMcb16, qty: 12 },
    { prod: prodStripper, qty: 1 },
  ]);

  await generateSale(shop3.id, shopkeeper3.id, [
    { prod: prodFlood, qty: 3 },
    { prod: prodWireArmored, qty: 1 },
    { prod: prodRccb63, qty: 2 },
  ]);

  await generateSale(shop1.id, shopkeeper1.id, [
    { prod: prodFluke, qty: 1 },
    { prod: prodHang, qty: 8 },
  ]);

  await generateSale(shop2.id, shopkeeper2.id, [
    { prod: prodSwt2G, qty: 25 },
    { prod: prodMcb32, qty: 10 },
  ]);

  await generateSale(shop3.id, shopkeeper3.id, [
    { prod: prodWire15, qty: 5 },
    { prod: prodSwt1G, qty: 30 },
  ]);

  console.log('🛍️ Sales generated.');

  // 10. Price History Entries
  await prisma.priceHistory.createMany({
    data: [
      {
        productId: prodSpot.id,
        oldBuyPrice: 4.0,
        newBuyPrice: 4.5,
        oldSellPrice: 7.5,
        newSellPrice: 8.0,
        updatedById: owner.id,
      },
      {
        productId: prodFluke.id,
        oldBuyPrice: 100.0,
        newBuyPrice: 110.0,
        oldSellPrice: 165.0,
        newSellPrice: 180.0,
        updatedById: owner.id,
      },
    ],
  });

  console.log('📈 Price History seeded.');

  // 11. Payment Methods
  const pmCash = await prisma.paymentMethod.create({ data: { name: 'Cash' } });
  const pmCBE = await prisma.paymentMethod.create({ data: { name: 'CBE' } });
  const pmTelebirr = await prisma.paymentMethod.create({
    data: { name: 'Telebirr' },
  });
  console.log('💳 Payment methods created.');

  // 12. Update existing sales with payment info
  const allSales = await prisma.sale.findMany({ take: 7 });
  for (let i = 0; i < allSales.length; i++) {
    await prisma.sale.update({
      where: { id: allSales[i].id },
      data: {
        paymentMethodId:
          i % 3 === 0 ? pmCash.id : i % 3 === 1 ? pmCBE.id : pmTelebirr.id,
        paidAmount: allSales[i].totalAmount,
      },
    });
  }

  // 13. Customers (each belongs to the Nejat Electrical business)
  const custAbebe = await prisma.customer.create({
    data: {
      organizationId: inventoryOrg.id,
      name: 'Abebe Kebede',
      phone: '0911223344',
    },
  });
  const custChala = await prisma.customer.create({
    data: {
      organizationId: inventoryOrg.id,
      name: 'Chala Deresa',
      phone: '0922334455',
    },
  });
  const custMeron = await prisma.customer.create({
    data: {
      organizationId: inventoryOrg.id,
      name: 'Meron Alemu',
      phone: '0913445566',
    },
  });
  const custHana = await prisma.customer.create({
    data: {
      organizationId: inventoryOrg.id,
      name: 'Hana Bekele',
      phone: '0915667788',
    },
  });
  console.log('👥 Customers created.');

  // 14. Credit Sales with items
  const cs1 = await prisma.creditSale.create({
    data: {
      customerId: custAbebe.id,
      shopId: shop1.id,
      totalAmount: 1200,
      items: {
        create: [
          {
            productId: prodSpot.id,
            quantity: 4,
            unitPrice: prodSpot.currentSellPrice,
          },
          {
            productId: prodWire25.id,
            quantity: 2,
            unitPrice: prodWire25.currentSellPrice,
          },
        ],
      },
    },
  });
  const cs2 = await prisma.creditSale.create({
    data: {
      customerId: custAbebe.id,
      shopId: shop2.id,
      totalAmount: 1500,
      items: {
        create: [
          {
            productId: prodSocUsb.id,
            quantity: 3,
            unitPrice: prodSocUsb.currentSellPrice,
          },
        ],
      },
    },
  });
  const cs3 = await prisma.creditSale.create({
    data: {
      customerId: custAbebe.id,
      shopId: shop1.id,
      totalAmount: 750,
      items: {
        create: [
          {
            productId: prodMcb16.id,
            quantity: 1,
            unitPrice: prodMcb16.currentSellPrice,
          },
          {
            productId: prodSwt1G.id,
            quantity: 2,
            unitPrice: prodSwt1G.currentSellPrice,
          },
        ],
      },
    },
  });
  const cs4 = await prisma.creditSale.create({
    data: {
      customerId: custChala.id,
      shopId: shop1.id,
      totalAmount: 800,
      items: {
        create: [
          {
            productId: prodFlood.id,
            quantity: 2,
            unitPrice: prodFlood.currentSellPrice,
          },
        ],
      },
    },
  });
  const cs5 = await prisma.creditSale.create({
    data: {
      customerId: custMeron.id,
      shopId: shop3.id,
      totalAmount: 3200,
      items: {
        create: [
          {
            productId: prodFluke.id,
            quantity: 1,
            unitPrice: prodFluke.currentSellPrice,
          },
          {
            productId: prodPanel.id,
            quantity: 1,
            unitPrice: prodPanel.currentSellPrice,
          },
          {
            productId: prodWireArmored.id,
            quantity: 3,
            unitPrice: prodWireArmored.currentSellPrice,
          },
        ],
      },
    },
  });
  const cs6 = await prisma.creditSale.create({
    data: {
      customerId: custMeron.id,
      shopId: shop2.id,
      totalAmount: 1900,
      items: {
        create: [
          {
            productId: prodRccb63.id,
            quantity: 2,
            unitPrice: prodRccb63.currentSellPrice,
          },
          {
            productId: prodMcb32.id,
            quantity: 5,
            unitPrice: prodMcb32.currentSellPrice,
          },
        ],
      },
    },
  });
  console.log('📦 Credit sales created.');

  // 15. Credit Payments
  await prisma.creditPayment.create({
    data: {
      customerId: custAbebe.id,
      amount: 500,
      notes: 'Paid via CBE',
      paidAt: new Date('2026-08-04'),
    },
  });
  await prisma.creditPayment.create({
    data: {
      customerId: custAbebe.id,
      amount: 500,
      notes: 'Cash',
      paidAt: new Date('2026-07-25'),
    },
  });
  await prisma.creditPayment.create({
    data: {
      customerId: custChala.id,
      amount: 800,
      notes: 'Telebirr - full payment',
      paidAt: new Date('2026-08-05'),
    },
  });
  await prisma.creditPayment.create({
    data: {
      customerId: custMeron.id,
      amount: 2000,
      notes: 'Partial via CBE',
      paidAt: new Date('2026-08-01'),
    },
  });
  console.log('💰 Credit payments created.');

  // 16. Link every seeded business row to the Nejat Electrical organization.
  // (Customer is excluded — it now uses a required organizationId FK that is
  // already set on every seeded customer.)
  const scopedModels: Array<{ name: string; model: any }> = [
    { name: 'LocationCategory', model: prisma.locationCategory },
    { name: 'Location', model: prisma.location },
    { name: 'Category', model: prisma.category },
    { name: 'Product', model: prisma.product },
    { name: 'Inventory', model: prisma.inventory },
    { name: 'PriceHistory', model: prisma.priceHistory },
    { name: 'Notification', model: prisma.notification },
    { name: 'StockRequest', model: prisma.stockRequest },
    { name: 'RequestItem', model: prisma.requestItem },
    { name: 'Sale', model: prisma.sale },
    { name: 'SaleItem', model: prisma.saleItem },
    { name: 'PaymentMethod', model: prisma.paymentMethod },
    { name: 'CreditSale', model: prisma.creditSale },
    { name: 'CreditSaleItem', model: prisma.creditSaleItem },
    { name: 'CreditPayment', model: prisma.creditPayment },
  ];
  for (const { name, model } of scopedModels) {
    const res = await model.updateMany({
      where: { tenantId: null },
      data: { tenantId: inventoryOrg.id },
    });
    if (res.count) console.log(`  Linked ${res.count} rows in ${name}`);
  }

  // 16.5 Autonomous agent configs for the demo orgs (Advisory by default; the
  // owner toggles autonomy on demand).
  for (const org of [
    inventoryOrg,
    nejatHotelOrg,
    meronOrg,
    meronMfgOrg,
    dawitOrg,
    salonOrg,
  ]) {
    await prisma.organizationAgentConfig.upsert({
      where: { organizationId: org.id },
      update: {},
      create: { organizationId: org.id, mode: AgentMode.ADVISORY },
    });
  }

  // 16.6 Five standalone demo shops. Each shop is its own independent
  // standalone organization (single SHOP location, owner account, ACTIVE
  // membership) with a tenant-scoped catalog of 20 products (variants + stock).
  // An owner with more than one shop keeps locationId null so per-org
  // single-location resolution picks the right shop when switching businesses.
  const shopOwnerUsers = new Map<string, { id: number }>();
  const shopCountPerOwner = new Map<string, number>();
  for (const s of SHOPS) {
    shopCountPerOwner.set(
      s.owner.email,
      (shopCountPerOwner.get(s.owner.email) ?? 0) + 1,
    );
  }
  for (const shop of SHOPS) {
    const shopLocation = await prisma.location.create({
      data: { name: shop.shopName, type: LocationType.SHOP },
    });
    const shopHashedPassword = await bcrypt.hash(shop.owner.password, 10);
    let shopOwner = shopOwnerUsers.get(shop.owner.email);
    if (!shopOwner) {
      shopOwner = await prisma.user.create({
        data: {
          email: shop.owner.email,
          password: shopHashedPassword,
          name: shop.owner.name,
          phone: shop.owner.phone,
          roleId: standaloneRole.id,
          locationId:
            (shopCountPerOwner.get(shop.owner.email) ?? 1) > 1
              ? null
              : shopLocation.id,
          isOwnerAccount: true,
          verificationStatus: 'APPROVED',
        },
      });
      shopOwnerUsers.set(shop.owner.email, shopOwner);
    }
    const shopOrg = await prisma.organization.create({
      data: {
        name: shop.orgName,
        slug: shop.slug,
        businessType: BusinessType.RETAIL,
        standalone: true,
        aiEnabled: true,
        aiTrialEndsAt: aiTrialEnd,
        verificationStatus: 'APPROVED',
      },
    });
    await seedOrgAccounts(shopOrg);
    const shopOwnerRole = await prisma.role.create({
      data: {
        name: 'Owner',
        description: 'Full access to everything',
        isSystem: true,
        organizationId: shopOrg.id,
      },
    });
    await linkRolePermissions(shopOwnerRole.id, DEFAULT_ROLE_PERMISSIONS.OWNER);
    const existingMembership = await prisma.membership.findFirst({
      where: { userId: shopOwner.id, organizationId: shopOrg.id },
    });
    if (!existingMembership) {
      await prisma.membership.create({
        data: {
          userId: shopOwner.id,
          organizationId: shopOrg.id,
          roleId: shopOwnerRole.id,
          status: 'ACTIVE',
        },
      });
    }
    await prisma.location.update({
      where: { id: shopLocation.id },
      data: { tenantId: shopOrg.id },
    });

    // Categories + units (tenant-scoped).
    const shopCatMap: Record<string, number> = {};
    for (const cat of shop.categories) {
      const c = await prisma.category.create({
        data: { tenantId: shopOrg.id, name: cat },
      });
      shopCatMap[cat] = c.id;
    }
    const shopUnitMap: Record<string, number> = {};
    for (const u of shop.units) {
      const unit = await prisma.unit.create({
        data: { tenantId: shopOrg.id, name: u },
      });
      shopUnitMap[u] = unit.id;
    }

    // Products + variants + inventory (all tenant-scoped to the shop).
    for (const p of shop.products) {
      const product = await prisma.product.create({
        data: {
          tenantId: shopOrg.id,
          sku: p.sku,
          brand: p.brand,
          baseName: p.baseName,
          categoryId: shopCatMap[p.category],
          unitId: shopUnitMap[p.unit],
          hasVariants: true,
          currentBuyPrice: p.buyPrice,
          currentSellPrice: p.sellPrice,
          attributes: { source: 'standalone-demo' },
        },
      });
      for (const v of p.variants) {
        const variant = await prisma.productVariant.create({
          data: {
            tenantId: shopOrg.id,
            productId: product.id,
            sku: v.sku,
            barcode: v.barcode,
            attributes: v.attributes,
            buyPrice: v.buyPrice,
            sellPrice: v.sellPrice,
          },
        });
        await prisma.inventory.create({
          data: {
            tenantId: shopOrg.id,
            productId: product.id,
            variantId: variant.id,
            locationId: shopLocation.id,
            quantity: v.qty,
          },
        });
      }
    }
    console.log(
      `  🏪 Seeded ${shop.orgName} — ${shop.products.length} products (owner ${shop.owner.email})`,
    );
  }

  // 17. Demo login guide
  console.log('');
  console.log('🔑 Demo logins (all demo staff use password: password123):');
  console.log(
    '  🛡️ Platform Admin    : kass3me@gmail.com / KASS@3ko (Kassahun Takele)',
  );
  console.log('  --- Nejat Electrical (RETAIL) ---');
  console.log('    Owner         : owner@inventory.com (Abebe Bikila)');
  console.log('    Storekeeper   : storekeeper@inventory.com (Chala Gemechu)');
  console.log('    Storekeeper   : cablestore@inventory.com (Taye Desta)');
  console.log('    Shopkeeper    : shopkeeper1@inventory.com (Selam Tesfaye)');
  console.log('    Shopkeeper    : shopkeeper2@inventory.com (Kebede Alemu)');
  console.log('    Shopkeeper    : shopkeeper3@inventory.com (Tigist Haile)');
  console.log('  --- Nejat Hospitality (HOSPITALITY) ---');
  console.log('    Owner         : owner@inventory.com (Abebe Bikila)');
  console.log('    Manager       : manager@inventory.com (Sara Mohammed)');
  console.log('    Waiter        : waiter@inventory.com (Daniel Girma)');
  console.log('    Chef          : chef@inventory.com (Fikru Tadesse)');
  console.log('  --- Meron Trading (RETAIL) ---');
  console.log('    Owner         : meron@inventory.com (Meron Alemu)');
  console.log('    Storekeeper   : meron-store@inventory.com (Hanna Bekele)');
  console.log('  --- Meron Manufacturing (MANUFACTURING) ---');
  console.log('    Owner         : meron@inventory.com (Meron Alemu)');
  console.log('    Manager       : meron-mfg@inventory.com (Yonas Kassa)');
  console.log('  --- Dawit Café & Restaurant (HOSPITALITY) ---');
  console.log('    Owner         : dawit@inventory.com (Dawit Kebede)');
  console.log(
    '    Manager       : dawit-cafe@inventory.com (Bethlehem Assefa)',
  );
  console.log('  --- Addis Spa & Salon (SERVICE) ---');
  console.log('    Owner         : hanna@inventory.com (Liya Girma)');
  console.log('    Provider      : provider@inventory.com (Selam Tesfaye)');

  console.log('  --- Standalone Demo Shops (RETAIL) ---');
  console.log(
    '    Temesgen Footwear    : teme@gmail.com / TEST@1234 (Temesgen Aleme)',
  );
  console.log(
    '    Mussie Kids & Baby   : mus@gmail.com / TEST@1234 (Mussie Kebede)',
  );
  console.log(
    '    Haile Mobile         : haile@gmail.com / Haile@1234 (Haile Melaku)',
  );
  console.log(
    '    Meseret Mobile       : messi@gmail.com / Messi@1234 (Meseret Mulugeta)',
  );
  console.log(
    '    Meseret Cloths/Shoes : messi@gmail.com / Messi@1234 (Meseret Mulugeta)',
  );
  console.log(
    '    Tame Tools           : tame@gmail.com / Tame@1234 (Tamiru Taye)',
  );

  console.log('✅ Database Seeding Complete! 🎉');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
