import { ReportsService } from './reports.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

const locations = [
  { id: 2, name: 'Main Store' },
  { id: 3, name: 'Branch Shop' },
];

const invAt = (
  locationId: number,
  locationName: string,
  quantity: number,
  extra: Record<string, any> = {},
) => ({
  id: (extra.id as number) ?? locationId * 10,
  tenantId: 1,
  productId: (extra.productId as number) ?? 5,
  quantity,
  variantId: (extra.variantId as number | null) ?? null,
  locationId,
  location: { id: locationId, name: locationName },
  variant: extra.variant ?? null,
  product: {
    sku: extra.productSku ?? 'ACM-WID',
    brand: 'Acme',
    baseName: 'Widget',
    currentBuyPrice: 10,
    currentSellPrice: 25,
    category: { name: 'Cables' },
    ...(extra.product ?? {}),
  },
});

const allInventories = [
  invAt(2, 'Main Store', 3),
  invAt(3, 'Branch Shop', 5),
];

const makePrisma = (list: any[] = allInventories) => {
  const prisma: Record<string, any> = {
    inventory: {
      findMany: jest.fn(async (args: any) =>
        // Honour the service's location scoping so the caller's intent is what
        // determines the response rows (mirrors a real DB query filter).
        list.filter(
          (i) => !args?.where?.locationId || i.locationId === args.where.locationId,
        ),
      ),
    },
    location: { findMany: jest.fn(async () => locations) },
  };
  return prisma;
};

const shopkeeper = (extra: any = {}) => ({
  sub: 9,
  locationId: 2,
  locationType: 'SHOP' as const,
  permissions: ['reports.view'],
  ...extra,
});

describe('ReportsService.getInventoryBreakdown shared view', () => {
  it('populates other-location columns when the role holds inventory.shared-view', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as any);
    const user = shopkeeper({ permissions: ['reports.view', 'inventory.shared-view'] });

    const data = await service.getInventoryBreakdown(user as any, undefined);

    expect(prisma.inventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 1 }),
      }),
    );
    // No locationId restriction when shared view is active.
    const where = prisma.inventory.findMany.mock.calls[0][0].where;
    expect(where.locationId).toBeUndefined();

    expect(data.columns).toEqual(['Main Store', 'Branch Shop']);
    expect(data.rows[0].locations).toEqual({
      'Main Store': 3,
      'Branch Shop': 5,
    });
    expect(data.rows[0].total).toBe(8);
  });

  it('keeps other-location columns at zero without the shared permission', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as any);

    const data = await service.getInventoryBreakdown(shopkeeper() as any, undefined);

    // Scoped to the user's own location (Main Store = id 2).
    expect(prisma.inventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ locationId: 2 }) }),
    );
    expect(data.columns).toEqual(['Main Store', 'Branch Shop']);
    expect(data.rows[0].locations).toEqual({ 'Main Store': 3 });
    expect(data.rows[0].locations['Branch Shop']).toBeUndefined();
    expect(data.rows[0].total).toBe(3);
  });

  it('keeps owner behaviour unchanged (explicit location filter still applies)', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as any);
    const owner = {
      sub: 1,
      locationId: null,
      permissions: ['reports.view', 'inventory.shared-view'],
    };

    const data = await service.getInventoryBreakdown(owner as any, 2);

    expect(data.rows[0].locations).toEqual({ 'Main Store': 3 });
  });
});

describe('ReportsService low/dead stock variant grouping', () => {
  const owner = { sub: 1, locationId: null, permissions: ['reports.view'] };

  it('groups low-stock variant rows under one product with a variants array', async () => {
    const rows = [
      invAt(2, 'Main Store', 2, {
        productId: 12,
        productSku: 'SH-1',
        product: {
          brand: 'Shoe',
          baseName: 'Runner',
          reorderLevel: 5,
          currentBuyPrice: 10,
          currentSellPrice: 25,
        },
        variantId: 201,
        variant: { id: 201, sku: 'SH-1-42', attributes: { size: '42' } },
      }),
      invAt(2, 'Main Store', 1, {
        productId: 12,
        productSku: 'SH-1',
        product: {
          brand: 'Shoe',
          baseName: 'Runner',
          reorderLevel: 5,
          currentBuyPrice: 10,
          currentSellPrice: 25,
        },
        variantId: 202,
        variant: { id: 202, sku: 'SH-1-43', attributes: { size: '43' } },
      }),
    ];
    const prisma = makePrisma(rows);
    const service = new ReportsService(prisma as any);

    const data = await service.getLowStock(owner as any, undefined, undefined, undefined);

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(12);
    expect(data[0].total).toBe(3);
    expect(data[0].variants.map((v: any) => v.variantId)).toEqual([201, 202]);
    expect(data[0].variants.map((v: any) => v.quantity)).toEqual([2, 1]);
    expect(data[0].variants[0].locations).toEqual(['Main Store']);
  });

  it('emits one dead-stock parent per product+location with its variants', async () => {
    const rows = [
      invAt(2, 'Main Store', 4, {
        productId: 13,
        productSku: 'SH-2',
        product: {
          brand: 'Shoe',
          baseName: 'Trail',
          reorderLevel: 0,
          currentBuyPrice: 10,
          currentSellPrice: 25,
        },
        variantId: 301,
        variant: { id: 301, sku: 'SH-2-40', attributes: { size: '40' } },
      }),
      invAt(2, 'Main Store', 3, {
        productId: 13,
        productSku: 'SH-2',
        product: {
          brand: 'Shoe',
          baseName: 'Trail',
          reorderLevel: 0,
          currentBuyPrice: 10,
          currentSellPrice: 25,
        },
        variantId: 302,
        variant: { id: 302, sku: 'SH-2-41', attributes: { size: '41' } },
      }),
      // Product 14 sold recently at Branch Shop → must NOT appear as dead.
      invAt(3, 'Branch Shop', 2, {
        productId: 14,
        productSku: 'SH-3',
        product: {
          brand: 'Shoe',
          baseName: 'Active',
          reorderLevel: 0,
          currentBuyPrice: 10,
          currentSellPrice: 25,
        },
      }),
    ];
    const prisma = makePrisma(rows);
    prisma.saleItem = {
      findFirst: jest.fn(async (args: any) =>
        args.where.productId === 14 ? { id: 1 } : null,
      ),
    };
    const service = new ReportsService(prisma as any);

    const data = await service.getDeadStock(owner as any, undefined, undefined, undefined);

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(13);
    expect(data[0].locationName).toBe('Main Store');
    expect(data[0].variants.map((v: any) => v.variantId)).toEqual([301, 302]);
    // One recency check per product+location, not per variant row.
    expect(prisma.saleItem.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('ReportsService.getInventoryBreakdown valuation gating', () => {
  const owner = {
    sub: 1,
    locationId: null,
    permissions: ['reports.view', 'reports.full', 'reports.view_cost_valuation'],
  };

  it('returns prices, row valuations and grand totals for cost-permitted users', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as any);

    const data = await service.getInventoryBreakdown(owner as any, undefined);
    const row: any = data.rows[0];

    expect(row.unitBuyPrice).toBe(10);
    expect(row.unitSellPrice).toBe(25);
    expect(row.buyTotal).toBe(80); // (3 + 5) × 10
    expect(row.sellTotal).toBe(200); // (3 + 5) × 25
    expect(row.estimatedProfit).toBe(120);
    const vr: any = row.variants[0];
    expect(vr.unitBuyPrice).toBe(10);
    expect(vr.unitSellPrice).toBe(25);
    expect(vr.buyTotal).toBe(80);
    expect(data.valuation).toEqual({
      grandTotalBuyingValue: 80,
      grandTotalSellingValue: 200,
      potentialGrossProfit: 120,
      potentialMarginPct: 60,
    });
  });

  it('strips cost/margin fields without reports.view_cost_valuation but keeps sell price', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as any);

    const data = await service.getInventoryBreakdown(shopkeeper() as any, undefined);
    const row: any = data.rows[0];

    expect(row.unitSellPrice).toBe(25);
    expect(row.unitBuyPrice).toBeUndefined();
    expect(row.buyTotal).toBeUndefined();
    expect(row.sellTotal).toBeUndefined();
    expect(row.estimatedProfit).toBeUndefined();
    expect(data.valuation).toBeUndefined();
    const vr: any = row.variants[0];
    expect(vr.unitSellPrice).toBe(25);
    expect(vr.unitBuyPrice).toBeUndefined();
  });

  it('treats superusers as cost-permitted even before the key is granted', async () => {
    const prisma = makePrisma();
    const service = new ReportsService(prisma as any);
    // Existing Owner roles predate the new permission key in their stored
    // permission snapshot, so superuser status must bypass the list check.
    const ownerWithoutKey = {
      sub: 1,
      locationId: null,
      isSuperuser: true,
      permissions: ['reports.view'],
    };

    const data = await service.getInventoryBreakdown(ownerWithoutKey as any, undefined);
    const row: any = data.rows[0];

    expect(data.valuation).toBeDefined();
    expect(row.unitBuyPrice).toBe(10);
    expect(row.buyTotal).toBe(80);
    expect(row.estimatedProfit).toBe(120);
  });

  it('values each variant at its own price and rolls weighted totals to the product row', async () => {
    const rows = [
      invAt(2, 'Main Store', 3, {
        productId: 6,
        productSku: 'TEE-1',
        variantId: 101,
        variant: {
          id: 101,
          sku: 'TEE-1-S',
          attributes: { size: 'S' },
          buyPrice: 10,
          sellPrice: 20,
        },
      }),
      invAt(2, 'Main Store', 1, {
        productId: 6,
        productSku: 'TEE-1',
        variantId: 102,
        variant: {
          id: 102,
          sku: 'TEE-1-L',
          attributes: { size: 'L' },
          buyPrice: 30,
          sellPrice: 40,
        },
      }),
    ];
    const prisma = makePrisma(rows);
    const service = new ReportsService(prisma as any);

    const data = await service.getInventoryBreakdown(owner as any, undefined);
    const row: any = data.rows[0];

    expect(row.total).toBe(4);
    expect(row.buyTotal).toBe(60); // 3×10 + 1×30
    expect(row.sellTotal).toBe(100); // 3×20 + 1×40
    expect(row.estimatedProfit).toBe(40);
    expect(row.unitBuyPrice).toBe(15); // quantity-weighted average
    expect(row.unitSellPrice).toBe(25);

    // Variant rows carry their own estimated profit too (S: 3×20−3×10=30,
    // L: 1×40−1×30=10).
    const vs: any[] = row.variants;
    expect(vs[0].estimatedProfit).toBe(30);
    expect(vs[1].estimatedProfit).toBe(10);
    expect(vs[0].sellTotal).toBe(60);
    expect(vs[1].buyTotal).toBe(30);
  });
});
