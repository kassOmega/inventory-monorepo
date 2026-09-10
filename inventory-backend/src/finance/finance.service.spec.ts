// src/finance/finance.service.spec.ts
import { FinanceService } from './finance.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
}));

describe('FinanceService universal auto-posting engine', () => {
  const accounts = [
    { id: 1, name: 'Cash', type: 'ASSET', isSystem: true },
    { id: 2, name: 'Accounts Receivable', type: 'ASSET' },
    { id: 3, name: 'Inventory Asset', type: 'ASSET' },
    { id: 4, name: 'Accounts Payable', type: 'LIABILITY' },
    { id: 5, name: 'Sales Revenue', type: 'INCOME', isSystem: true },
    { id: 6, name: 'Cost of Goods Sold', type: 'EXPENSE', isSystem: true },
  ];
  const sale = {
    id: 42,
    invoiceNumber: 'INV-42',
    totalAmount: 500,
    totalCost: 300,
    totalProfit: 200,
    saleType: 'FULLY_PAID',
    paidAmount: 500,
    remainingAmount: 0,
    saleDate: new Date('2026-08-01'),
    soldById: 7,
    items: [
      {
        productId: 10,
        variantId: null,
        quantity: 10,
        unitSellPrice: 30,
        unitBuyPrice: 20,
        product: {
          brand: 'Acme',
          baseName: 'Cable',
          categoryId: 1,
          category: { id: 1, name: 'Cables', parentId: null },
        },
        variant: null,
      },
      {
        productId: 11,
        variantId: null,
        quantity: 5,
        unitSellPrice: 40,
        unitBuyPrice: 20,
        product: {
          brand: 'Acme',
          baseName: 'Cable',
          categoryId: 1,
          category: { id: 1, name: 'Cables', parentId: null },
        },
        variant: null,
      },
    ],
  };

  const makePrisma = (overrides: Record<string, any> = {}) => {
    const prisma: Record<string, any> = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      account: {
        findMany: jest.fn(async () => accounts),
        createMany: jest.fn(async () => ({})),
      },
      organization: {
        findUnique: jest.fn(async () => ({ businessType: 'RETAIL' })),
      },
      otherIncome: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (x: any) => x.data),
      },
      cogsEntry: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (x: any) => x.data),
      },
      menuItem: {
        findMany: jest.fn(async () => []),
      },
      menuItemIngredient: {
        findMany: jest.fn(async () => []),
      },
      journalEntry: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (x: any) => x.data),
      },
      journalLine: { createMany: jest.fn(async () => ({})) },
      sale: { findUnique: jest.fn(async () => sale) },
      return: { findUnique: jest.fn(async () => null) },
      saleItem: { findMany: jest.fn(async () => []) },
      inventory: { findMany: jest.fn(async () => []) },
      category: {
        findMany: jest.fn(async () => [
          { id: 1, name: 'Cables', parentId: null },
        ]),
      },
      expense: {
        findMany: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })),
      },
      orderItem: { findMany: jest.fn(async () => []) },
      order: {
        findMany: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { totalAmount: 0 } })),
      },
      folioEntry: {
        findMany: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })),
      },
      menuCategory: { findMany: jest.fn(async () => []) },
      ...overrides,
    };
    return prisma;
  };

  it('postSaleIncome posts income + COGS + a balanced journal, and is idempotent', async () => {
    const prisma = makePrisma();
    const service = new FinanceService(prisma as any);

    const created = await service.postSaleIncome(sale.id, 1);
    expect(created).toBe(2); // one income row per exact product line (10 × Cable + 5 × Cable)

    // Idempotency: second call sees the existing OtherIncome row and skips.
    prisma.otherIncome.findFirst.mockResolvedValueOnce({ id: 99 });
    const again = await service.postSaleIncome(sale.id, 1);
    expect(again).toBe(0);

    // Item-level revenue recognition: every row is tagged with the exact
    // Product SKU it was posted for — never a generic category bucket.
    expect(prisma.otherIncome.create).toHaveBeenCalledTimes(2);
    expect(prisma.otherIncome.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ productId: 10 }) }),
    );
    expect(prisma.otherIncome.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ productId: 11 }) }),
    );
    expect(prisma.cogsEntry.create).toHaveBeenCalledTimes(2);
    expect(prisma.cogsEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: 10, saleId: 42 }),
      }),
    );
    // Timestamp alignment: auto-posted income uses the sale's own date.
    expect(prisma.otherIncome.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ incomeDate: sale.saleDate }) }),
    );

    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
    expect(prisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reference: 'SALE-42' }),
      }),
    );
    // Journal must balance: total debits = total credits.
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    const debit = lines.reduce((s: number, l: any) => s + l.debit, 0);
    const credit = lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit);
    expect(debit).toBeCloseTo(800); // 500 revenue + 300 COGS
  });
  it('postSaleIncome backfills the missing default chart before posting', async () => {
    // Tenant 1 has an empty chart: the backfill scan finds nothing, then the
    // re-read after account.createMany resolves the freshly created defaults.
    const prisma = makePrisma({
      account: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue(accounts),
        createMany: jest.fn(async (x: any) => ({ count: x.data.length })),
      },
    });
    const service = new FinanceService(prisma as any);

    const created = await service.postSaleIncome(sale.id, 1);
    expect(created).toBe(2); // posting proceeded after the chart self-healed

    const data = prisma.account.createMany.mock.calls[0][0].data;
    const names = data.map((a: any) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Cash',
        'Inventory Asset',
        'Sales Revenue',
        'Cost of Goods Sold',
      ]),
    );
    // Missing defaults are created scoped to the tenant and keep isSystem.
    expect(prisma.account.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            tenantId: 1,
            name: 'Sales Revenue',
            type: 'INCOME',
            isSystem: true,
          }),
        ]),
      }),
    );
  });

  it('postProcurement posts Inventory ↔ AP and never touches P&L accounts', async () => {
    const prisma = makePrisma();
    const service = new FinanceService(prisma as any);

    const ok = await service.postProcurement({
      ref: 'RST-5-9',
      description: 'Restock 10 × Cable',
      amount: 200,
      tenantId: 1,
      paid: false,
    });
    expect(ok).toBe(true);

    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    const inventory = lines.find((l: any) => l.accountId === 3);
    const ap = lines.find((l: any) => l.accountId === 4);
    expect(inventory.debit).toBe(200);
    expect(inventory.credit).toBe(0);
    expect(ap.credit).toBe(200);
    expect(ap.debit).toBe(0);
    // No income or expense accounts involved.
    const accountIds = lines.map((l: any) => l.accountId);
    expect(accountIds).not.toContain(5);
    expect(accountIds).not.toContain(6);

    // Idempotent per reference.
    prisma.journalEntry.findFirst.mockResolvedValueOnce({ id: 7 });
    const again = await service.postProcurement({
      ref: 'RST-5-9',
      description: 'Restock 10 × Cable',
      amount: 200,
      tenantId: 1,
    });
    expect(again).toBe(false);
    expect(prisma.journalLine.createMany).toHaveBeenCalledTimes(1);
  });

  it('getCategoryBreakdown rolls revenue + stock cost up into parent categories', async () => {
    const prisma = makePrisma({
      saleItem: {
        findMany: jest.fn(async () => [
          {
            quantity: 10,
            unitSellPrice: 30,
            unitBuyPrice: 20,
            product: {
              categoryId: 1,
              category: { id: 1, name: 'Electrical Accessories', parentId: null },
            },
          },
          {
            quantity: 5,
            unitSellPrice: 40,
            unitBuyPrice: 20,
            product: {
              categoryId: 1,
              category: { id: 1, name: 'Electrical Accessories', parentId: null },
            },
          },
          {
            quantity: 2,
            unitSellPrice: 50,
            unitBuyPrice: 30,
            product: { categoryId: 2, category: { id: 2, name: 'Cables', parentId: 1 } },
          },
        ]),
      },
      inventory: {
        findMany: jest.fn(async () => [
          {
            quantity: 25,
            product: {
              currentBuyPrice: 20,
              categoryId: 1,
              category: { id: 1, name: 'Electrical Accessories', parentId: null },
            },
          },
          {
            quantity: 10,
            product: {
              currentBuyPrice: 30,
              categoryId: 2,
              category: { id: 2, name: 'Cables', parentId: 1 },
            },
          },
        ]),
      },
      category: {
        findMany: jest.fn(async () => [
          { id: 1, name: 'Electrical Accessories', parentId: null },
          { id: 2, name: 'Cables', parentId: 1 },
        ]),
      },
    });
    const service = new FinanceService(prisma as any);

    const result = await service.getCategoryBreakdown({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      businessType: 'RETAIL',
    });

    expect(result.tenantType).toBe('PRODUCT_CATEGORY');
    const parent = result.categories[0];
    // Parent revenue includes the child: 500 (own) + 100 (Cables) = 600.
    expect(parent.revenue).toBe(600);
    // Parent stock cost includes the child: 500 + 300 = 800.
    expect(parent.stockCost).toBe(800);
    // Child row is exposed for the deep sub-category filter.
    expect(parent.children[0].name).toBe('Cables');
    expect(parent.children[0].revenue).toBe(100);
  });

  it('getCategoryBreakdown filters to a single parent (sub-category view)', async () => {
    const prisma = makePrisma({
      saleItem: {
        findMany: jest.fn(async () => [
          {
            quantity: 2,
            unitSellPrice: 50,
            unitBuyPrice: 30,
            product: { categoryId: 2, category: { id: 2, name: 'Cables', parentId: 1 } },
          },
        ]),
      },
      inventory: { findMany: jest.fn(async () => []) },
      category: {
        findMany: jest.fn(async () => [
          { id: 1, name: 'Electrical Accessories', parentId: null },
          { id: 2, name: 'Cables', parentId: 1 },
          { id: 3, name: 'Tools', parentId: 1 },
        ]),
      },
    });
    const service = new FinanceService(prisma as any);

    const result = await service.getCategoryBreakdown({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      parentCategoryId: 1,
      businessType: 'RETAIL',
    });

    // Only the children of "Electrical Accessories" are shown.
    const names = result.categories.map((c: any) => c.name).sort();
    expect(names).toEqual(['Cables', 'Tools']);
  });

  it('deductOrderIngredientStock consumes recipe ingredients from inventory + batches and clamps shortfalls', async () => {
    const invUpdates: any[] = [];
    const batchUpdates: any[] = [];
    const auditLogs: any[] = [];

    const prisma = makePrisma({
      order: {
        findUnique: jest.fn(async () => ({
          id: 9,
          orderNumber: 'ORD-9',
          createdById: 7,
          items: [{ menuItemId: 1, quantity: 2 }], // 2 × shiro
        })),
      },
      menuItem: {
        findMany: jest.fn(async () => [{ id: 1, trackingMode: 'PERPETUAL' }]),
      },
      menuItemIngredient: {
        findMany: jest.fn(async () => [
          { menuItemId: 1, productId: 10, quantityPerUnit: 0.1 }, // onion
          { menuItemId: 1, productId: 11, quantityPerUnit: 0.05 }, // oil
        ]),
      },
      inventory: {
        findMany: jest.fn(async (args: any) => {
          const productId = args.where.productId;
          // onion has 0.15 across two locations; oil has none.
          if (productId === 10)
            return [
              { id: 1, quantity: 0.1 },
              { id: 2, quantity: 0.05 },
            ];
          return [];
        }),
        update: jest.fn(async (args: any) => {
          invUpdates.push(args);
          return { id: args.where.id };
        }),
      },
      productBatch: {
        findMany: jest.fn(async () => [{ id: 5, quantity: 0.2 }]),
        update: jest.fn(async (args: any) => {
          batchUpdates.push(args);
          return { id: args.where.id };
        }),
      },
      auditLog: {
        create: jest.fn(async (args: any) => {
          auditLogs.push(args.data);
          return args.data;
        }),
      },
    });
    const service = new FinanceService(prisma as any);

    const deducted = await service.deductOrderIngredientStock(9, 1);

    // onion needs 0.2 (2 × 0.1): consume 0.1 + 0.05 = 0.15, shortfall 0.05.
    // oil needs 0.1 (2 × 0.05): no inventory → full shortfall 0.1.
    expect(deducted).toBe(0.15 + 0);
    expect(invUpdates.length).toBe(2); // two onion inventory rows touched
    // Batches FIFO-decremented for both ingredients.
    expect(batchUpdates.length).toBe(2);
    // Shortfalls recorded in the audit log.
    expect(auditLogs.length).toBe(2);
    expect(auditLogs[0].action).toBe('INGREDIENT_SHORTFALL');
    expect(auditLogs[0].details).toContain('short by 0.05');
  });

  it('postOrderIncome settles a hybrid ticket: PERPETUAL recipe COGS + stock, BENCHMARK estimated COGS, SIMPLE revenue only', async () => {
    const prisma = makePrisma({
      order: {
        findUnique: jest.fn(async () => ({
          id: 21,
          orderNumber: 'ORD-21',
          status: 'PAID',
          totalAmount: 300,
          createdById: 7,
          items: [
            {
              id: 1,
              menuItemId: 1,
              name: 'Shiro',
              quantity: 2,
              unitPrice: 100,
              cost: 0,
              menuItem: {
                id: 1,
                name: 'Shiro',
                menuCategoryId: 1,
                trackingMode: 'PERPETUAL',
                estimatedCogs: null,
                menuCategory: { stationRoute: [{ name: 'Kitchen' }] },
              },
            },
            {
              id: 2,
              menuItemId: 2,
              name: 'Sandwich',
              quantity: 3,
              unitPrice: 50,
              cost: 15,
              menuItem: {
                id: 2,
                name: 'Sandwich',
                menuCategoryId: 1,
                trackingMode: 'BENCHMARK',
                estimatedCogs: 15,
                menuCategory: { stationRoute: [{ name: 'Kitchen' }] },
              },
            },
            {
              id: 3,
              menuItemId: 3,
              name: 'Tea',
              quantity: 1,
              unitPrice: 30,
              cost: 5,
              menuItem: {
                id: 3,
                name: 'Tea',
                menuCategoryId: 2,
                trackingMode: 'SIMPLE',
                estimatedCogs: null,
                menuCategory: { stationRoute: [{ name: 'Bar' }] },
              },
            },
          ],
        })),
      },
      menuItemIngredient: {
        findMany: jest.fn(async (args: any) => {
          const ids = args.where.menuItemId?.in ?? [];
          if (ids.includes(1)) {
            return [
              { menuItemId: 1, quantityPerUnit: 0.1, product: { currentBuyPrice: 30 } },
              { menuItemId: 1, quantityPerUnit: 0.05, product: { currentBuyPrice: 60 } },
            ];
          }
          return [];
        }),
      },
      menuItem: {
        findMany: jest.fn(async () => [
          { id: 1, trackingMode: 'PERPETUAL' },
          { id: 2, trackingMode: 'BENCHMARK' },
          { id: 3, trackingMode: 'SIMPLE' },
        ]),
      },
      inventory: {
        findMany: jest.fn(async () => [{ id: 1, quantity: 1 }]),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      productBatch: {
        findMany: jest.fn(async () => []),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
    });
    const service = new FinanceService(prisma as any);

    const created = await service.postOrderIncome(21, 1);

    // Revenue: one OtherIncome per item bucket (all three items).
    expect(created).toBe(3);
    expect(prisma.otherIncome.create).toHaveBeenCalledTimes(3);

    // COGS: PERPETUAL (live recipe) + BENCHMARK (estimated). SIMPLE posts none.
    expect(prisma.cogsEntry.create).toHaveBeenCalledTimes(2);
    // PERPETUAL: recipe = 0.1×30 + 0.05×60 = 6 → ×2 qty = 12.
    expect(prisma.cogsEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ menuItemId: 1, amount: 12, quantity: 2 }),
      }),
    );
    // BENCHMARK: estimatedCogs 15 × 3 = 45.
    expect(prisma.cogsEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ menuItemId: 2, amount: 45, quantity: 3 }),
      }),
    );
    // No CogsEntry for the SIMPLE item.
    expect(
      prisma.cogsEntry.create.mock.calls.some(
        (c: any[]) => c[0].data.menuItemId === 3,
      ),
    ).toBe(false);

    // Balanced journal: revenue 300 + COGS 57.
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    const debit = lines.reduce((s: number, l: any) => s + l.debit, 0);
    const credit = lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit);
    expect(debit).toBeCloseTo(357);

    // Stock deduction only for the PERPETUAL item: the settlement engine
    // fetches recipes solely for it (id 1), never for SIMPLE/BENCHMARK items.
    const recipeCalls = prisma.menuItemIngredient.findMany.mock.calls;
    expect(recipeCalls[0][0].where.menuItemId.in).toEqual([1]);
    expect(prisma.inventory.update).toHaveBeenCalled();
  });

  it('postOrderIncome posts revenue only for a SIMPLE-only ticket (no COGS, no stock)', async () => {
    const prisma = makePrisma({
      order: {
        findUnique: jest.fn(async () => ({
          id: 22,
          orderNumber: 'ORD-22',
          status: 'PAID',
          totalAmount: 120,
          createdById: 7,
          items: [
            {
              id: 4,
              menuItemId: 4,
              name: 'Tea',
              quantity: 4,
              unitPrice: 30,
              cost: 5,
              menuItem: {
                id: 4,
                name: 'Tea',
                menuCategoryId: 2,
                trackingMode: 'SIMPLE',
                estimatedCogs: null,
                menuCategory: { stationRoute: [{ name: 'Bar' }] },
              },
            },
          ],
        })),
      },
      menuItem: {
        findMany: jest.fn(async () => [{ id: 4, trackingMode: 'SIMPLE' }]),
      },
    });
    const service = new FinanceService(prisma as any);

    const created = await service.postOrderIncome(22, 1);

    expect(created).toBe(1);
    expect(prisma.otherIncome.create).toHaveBeenCalledTimes(1);
    expect(prisma.cogsEntry.create).not.toHaveBeenCalled();
    // Revenue-only journal (cash ↔ revenue) — no COGS leg.
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    const debit = lines.reduce((s: number, l: any) => s + l.debit, 0);
    const credit = lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit);
    expect(debit).toBeCloseTo(120);
    // No physical stock touched; recipes never queried for a SIMPLE ticket.
    expect(prisma.inventory.findMany).not.toHaveBeenCalled();
    expect(prisma.menuItemIngredient.findMany).not.toHaveBeenCalled();
  });

  it('postWastage debits Spoilage & Wastage and credits Inventory Asset', async () => {
    const prisma = makePrisma({
      account: {
        findMany: jest.fn(async () => []), // force find-or-create of both accounts
        findFirst: jest.fn(async (args: any) => {
          if (args.where.name === 'Spoilage & Wastage') return null;
          if (args.where.name === 'Inventory Asset') return { id: 3, name: 'Inventory Asset', type: 'ASSET' };
          return null;
        }),
        create: jest.fn(async (args: any) => ({ id: 99, ...args.data })),
      },
    });
    const service = new FinanceService(prisma as any);

    const ok = await service.postWastage({
      ref: 'WST-12',
      description: 'Spoilage: 5 × Onion',
      amount: 150,
      tenantId: 1,
    });
    expect(ok).toBe(true);

    // The missing expense account was created.
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Spoilage & Wastage', code: '7100', type: 'EXPENSE' }),
      }),
    );
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    const wastageLine = lines.find((l: any) => l.accountId === 99);
    const inventoryLine = lines.find((l: any) => l.accountId === 3);
    expect(wastageLine.debit).toBe(150);
    expect(wastageLine.credit).toBe(0);
    expect(inventoryLine.credit).toBe(150);
    expect(inventoryLine.debit).toBe(0);
  });

  it('getItemizedPerformance aggregates retail revenue/COGS per product AND per variant', async () => {
    const prisma = makePrisma({
      saleItem: {
        findMany: jest.fn(async () => [
          {
            productId: 10,
            variantId: null,
            quantity: 10,
            unitSellPrice: 30,
            unitBuyPrice: 20,
            product: {
              brand: 'Nike',
              baseName: 'Air Force 1',
              category: { name: 'Footwear' },
              unit: { symbol: 'pr' },
            },
            variant: null,
          },
          {
            productId: 10,
            variantId: 4,
            quantity: 5,
            unitSellPrice: 50,
            unitBuyPrice: 35,
            product: {
              brand: 'Nike',
              baseName: 'Air Force 1',
              category: { name: 'Footwear' },
              unit: { symbol: 'pr' },
            },
            variant: {
              sku: 'NKE-AF1-BLU-41',
              attributes: { color: 'Blue', size: '41' },
            },
          },
        ]),
      },
    });
    const service = new FinanceService(prisma as any);

    const result = await service.getItemizedPerformance({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      businessType: 'RETAIL',
    });

    expect(result.tenantType).toBe('ITEMIZED');
    expect(result.rows).toHaveLength(2);
    const plain = result.rows.find((r: any) => r.kind === 'PRODUCT')!;
    expect(plain.name).toBe('Nike Air Force 1');
    expect(plain.unitsSold).toBe(10);
    expect(plain.revenue).toBe(300);
    expect(plain.cogs).toBe(200);
    expect(plain.profit).toBe(100);
    expect(plain.margin).toBeCloseTo(33.33);
    const variant = result.rows.find((r: any) => r.kind === 'VARIANT')!;
    expect(variant.name).toBe('Nike Air Force 1 (Blue · 41)');
    expect(variant.unitsSold).toBe(5);
    expect(variant.revenue).toBe(250);
    expect(variant.cogs).toBe(175);
    expect(variant.unitSymbol).toBe('pr');
    expect(result.totals.revenue).toBe(550);
    expect(result.totals.cogs).toBe(375);
    expect(result.totals.profit).toBe(175);
  });

  it('getItemizedPerformance aggregates hospitality revenue/COGS per menu item + room services', async () => {
    const prisma = makePrisma({
      orderItem: {
        findMany: jest.fn(async () => [
          {
            id: 1,
            menuItemId: 20,
            name: 'Special Shiro',
            quantity: 50,
            unitPrice: 200,
            cost: 46,
            menuItem: { menuCategory: { name: 'Meals' } },
          },
          {
            id: 2,
            menuItemId: 21,
            name: 'Bedele Beer',
            quantity: 120,
            unitPrice: 70,
            cost: 40,
            menuItem: { menuCategory: { name: 'Beverages' } },
          },
        ]),
      },
      folioEntry: {
        findMany: jest.fn(async () => [
          { amount: 5000, account: { name: 'Room Revenue' } },
        ]),
        aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })),
      },
    });
    const service = new FinanceService(prisma as any);

    const result = await service.getItemizedPerformance({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      businessType: 'HOSPITALITY',
    });

    // Special Shiro: 50 × 200 = 10,000 revenue; 50 × 46 = 2,300 COGS (77% margin).
    const shiro = result.rows.find((r: any) => r.name === 'Special Shiro')!;
    expect(shiro.unitsSold).toBe(50);
    expect(shiro.revenue).toBe(10000);
    expect(shiro.cogs).toBe(2300);
    expect(shiro.margin).toBeCloseTo(77);
    // Bedele Beer: 120 × 70 = 8,400; COGS 120 × 40 = 4,800.
    const beer = result.rows.find((r: any) => r.name === 'Bedele Beer')!;
    expect(beer.unitsSold).toBe(120);
    expect(beer.revenue).toBe(8400);
    expect(beer.cogs).toBe(4800);
    // Room services surface as a zero-COGS row so hotel income isn't dropped.
    const room = result.rows.find((r: any) => r.kind === 'SERVICE')!;
    expect(room.revenue).toBe(5000);
    expect(room.cogs).toBe(0);
    expect(result.totals.revenue).toBe(23400);
    expect(result.totals.cogs).toBe(7100);
  });

  it('getExpenseLedger combines overhead and procurement into one money-out view', async () => {
    const prisma = makePrisma({
      expense: {
        findMany: jest.fn(async () => [
          { id: 1, accountId: 705, vendor: 'Rent Co', amount: 300, expenseDate: new Date('2026-08-05'), account: { name: 'Rent' }, paymentMethod: null, notes: null },
          { id: 2, accountId: 707, vendor: 'Utility', amount: 100, expenseDate: new Date('2026-08-10'), account: { name: 'Utilities' }, paymentMethod: null, notes: null },
        ]),
        aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })),
      },
      journalEntry: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (x: any) => x.data),
        findMany: jest.fn(async () => [
          { id: 10, reference: 'PUR-77', description: 'Purchase 2 x Coffee Beans', entryDate: new Date('2026-08-12'), lines: [{ credit: 500, debit: 0 }, { credit: 0, debit: 500 }] },
          { id: 11, reference: 'RST-3-1', description: 'Restock 10 x Onion', entryDate: new Date('2026-08-13'), lines: [{ credit: 200, debit: 0 }, { credit: 0, debit: 200 }] },
        ]),
      },
    });
    const service = new FinanceService(prisma as any);

    const result = await service.getExpenseLedger('2026-08-01', '2026-08-31');

    expect(result.overhead).toHaveLength(2);
    expect(result.overhead[0].kind).toBe('OPERATIONAL');
    expect(result.overhead[0].categoryName).toBe('Rent');
    expect(result.procurements).toHaveLength(2);
    expect(result.procurements[0].kind).toBe('INVENTORY_RESTOCK');
    expect(result.procurements[0].amount).toBe(500);
    expect(result.totals.overheadTotal).toBe(400);
    expect(result.totals.procurementTotal).toBe(700);
    expect(result.totals.totalMoneyOut).toBe(1100);
  });

  it('getProfitAndLoss adheres to the unified expense formulas', async () => {
    const prisma = makePrisma({
      sale: {
        aggregate: jest.fn(async () => ({
          _sum: { totalAmount: 1000, totalCost: 600 },
        })),
      },
      otherIncome: {
        aggregate: jest.fn(async () => ({ _sum: { amount: 300 } })),
      },
      order: {
        aggregate: jest.fn(async () => ({ _sum: { totalAmount: 2000 } })),
      },
      orderItem: {
        findMany: jest.fn(async () => [{ cost: 20, quantity: 10 }]), // order COGS 200
      },
      expense: {
        aggregate: jest.fn(async () => ({ _sum: { amount: 500 } })),
      },
      folioEntry: {
        aggregate: jest.fn(async () => ({ _sum: { amount: 700 } })),
      },
    });
    const service = new FinanceService(prisma as any);

    const pl = await service.getProfitAndLoss('2026-08-01', '2026-08-31');

    // Revenue streams: 1000 retail + 2000 orders + 300 manual + 700 folio.
    expect(pl.totalRevenue).toBeCloseTo(4000);
    // COGS = retail 600 + order 200; expenses = overhead 500.
    expect(pl.costOfGoodsSold).toBeCloseTo(800);
    expect(pl.expenses).toBeCloseTo(500);
    // Total Expenses = Cost of Goods Expense + Operational Expenses.
    expect(pl.totalCosts).toBeCloseTo(pl.costOfGoodsSold + pl.expenses);
    expect(pl.totalCosts).toBeCloseTo(1300);
    // Gross Profit = Total Revenue − Cost of Goods Expense.
    expect(pl.grossProfit).toBeCloseTo(pl.totalRevenue - pl.costOfGoodsSold);
    expect(pl.grossProfit).toBeCloseTo(3200);
    // Net Profit = Total Revenue − Total Expenses (= Gross − Operational).
    expect(pl.netProfit).toBeCloseTo(pl.totalRevenue - pl.totalCosts);
    expect(pl.netProfit).toBeCloseTo(pl.grossProfit - pl.expenses);
    expect(pl.netProfit).toBeCloseTo(2700);
  });

  it('getExpenseLedger clamps the end date to end-of-day so same-day entries appear', async () => {
    const prisma = makePrisma({
      journalEntry: { findMany: jest.fn(async () => []) },
    });
    const service = new FinanceService(prisma as any);

    // Filter window = a single day (e.g. "today" in the UI). Entries stamped
    // later that day must be included, so the `lte` bound must be end-of-day.
    await service.getExpenseLedger('2026-08-31', '2026-08-31');

    const call = prisma.journalEntry.findMany.mock.calls[0][0];
    const lte = call.where.entryDate.lte as Date;
    expect(lte.getTime()).toBe(new Date('2026-08-31T23:59:59.999').getTime());
    expect(lte.getTime()).toBeGreaterThan(
      new Date('2026-08-31T00:00:00').getTime(),
    );
  });

  it('postSaleIncome values COGS at the inventory weighted-average cost', async () => {
    const prisma = makePrisma({
      sale: {
        findUnique: jest.fn(async () => ({
          id: 43,
          invoiceNumber: 'INV-43',
          shopId: 3,
          totalAmount: 300,
          totalCost: 0,
          totalProfit: 0,
          saleType: 'FULLY_PAID',
          paidAmount: 300,
          remainingAmount: 0,
          saleDate: new Date('2026-08-05'),
          soldById: 7,
          items: [
            {
              productId: 10,
              variantId: null,
              quantity: 10,
              unitSellPrice: 30,
              unitBuyPrice: 20, // snapshot — must NOT be used when an avg exists
              product: {
                brand: 'Acme',
                baseName: 'Cable',
                categoryId: 1,
                category: { id: 1, name: 'Cables', parentId: null },
              },
              variant: null,
            },
          ],
        })),
      },
      inventory: {
        findMany: jest.fn(async () => [
          { productId: 10, variantId: null, avgCost: 15 },
        ]),
      },
    });
    const service = new FinanceService(prisma as any);

    await service.postSaleIncome(43, 1);

    // COGS = 10 × 15 (weighted average), NOT 10 × 20 (unitBuyPrice snapshot).
    expect(prisma.cogsEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: 10, amount: 150 }),
      }),
    );
  });

  it('postSaleIncome splits output VAT out of revenue and credits VAT Payable', async () => {
    const prisma = makePrisma({
      account: {
        findMany: jest.fn(async () => [
          ...accounts,
          { id: 7, name: 'Output VAT Payable', type: 'LIABILITY', isSystem: true },
        ]),
      },
      sale: {
        findUnique: jest.fn(async () => ({
          ...sale,
          id: 44,
          totalAmount: 500,
          totalCost: 300,
          taxAmount: 65.22, // inclusive 15% embedded in 500
          taxRateId: 9,
        })),
      },
    });
    const service = new FinanceService(prisma as any);

    await service.postSaleIncome(44, 1);

    // Revenue rows are booked net (gross minus embedded VAT).
    const incomeRows = prisma.otherIncome.create.mock.calls.map((c: any) => c[0].data.amount);
    expect(incomeRows.reduce((s: number, a: number) => s + a, 0)).toBeCloseTo(434.78);

    // Journal stays balanced: DR Cash gross · CR Revenue net · CR VAT Payable.
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    const vatLine = lines.find((l: any) => l.accountId === 7);
    const revenueLine = lines.find(
      (l: any) => l.credit > 0 && l.debit === 0 && l.accountId !== 7,
    );
    expect(vatLine.credit).toBeCloseTo(65.22);
    expect(revenueLine.credit).toBeCloseTo(434.78);
    const debit = lines.reduce((s: number, l: any) => s + l.debit, 0);
    const credit = lines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit);
  });

  it('postInventoryAdjustment books surplus/shortage against Inventory Asset', async () => {
    const prisma = makePrisma({
      account: {
        findMany: jest.fn(async () => accounts), // no adjustment account → auto-created
        create: jest.fn(async (args: any) => ({ id: 90, ...args.data })),
      },
    });
    const service = new FinanceService(prisma as any);

    // Surplus: Debit Inventory Asset (3) ↔ Credit Inventory Adjustment (90).
    await service.postInventoryAdjustment({
      ref: 'ADJ-1',
      description: 'Count found +5',
      signedAmount: 500,
      tenantId: 1,
      createdById: 7,
    });
    let lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    expect(lines[0]).toEqual(
      expect.objectContaining({ accountId: 3, debit: 500, credit: 0 }),
    );
    expect(lines[1]).toEqual(
      expect.objectContaining({ accountId: 90, debit: 0, credit: 500 }),
    );
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Inventory Adjustment', type: 'EXPENSE' }),
      }),
    );

    // Shortage: Debit Inventory Adjustment (90) ↔ Credit Inventory Asset (3).
    await service.postInventoryAdjustment({
      ref: 'ADJ-2',
      description: 'Count short -3',
      signedAmount: -300,
      tenantId: 1,
      createdById: 7,
    });
    lines = prisma.journalLine.createMany.mock.calls[1][0].data;
    expect(lines[0]).toEqual(
      expect.objectContaining({ accountId: 90, debit: 300, credit: 0 }),
    );
    expect(lines[1]).toEqual(
      expect.objectContaining({ accountId: 3, debit: 0, credit: 300 }),
    );
  });
});


describe('FinanceService General Ledger views', () => {
  const cashAcc = { id: 1, code: '1000', name: 'Cash', type: 'ASSET', isSystem: true };
  const revAcc = { id: 5, code: '4000', name: 'Sales Revenue', type: 'INCOME', isSystem: true };
  const entry = { id: 11, reference: 'SALE-42', description: 'Sale auto-posted', entryDate: new Date('2026-08-01T10:00:00Z'), lines: [
    { id: 1, accountId: 1, debit: 500, credit: 0, account: cashAcc },
    { id: 2, accountId: 5, debit: 0, credit: 500, account: revAcc },
  ] };
  const line = (id: number, accountId: number, debit: number, credit: number, account: any, ref: string) => ({
    id, accountId, debit, credit, account,
    journalEntry: { id, reference: ref, description: 'entry', entryDate: new Date('2026-08-01T10:00:00Z') },
  });

  it('getGlJournal buckets SALE entries and applies account filters', async () => {
    const j: any = { count: jest.fn(async () => 1), findMany: jest.fn(async () => [entry]) };
    const prisma: any = { journalEntry: j, journalLine: { aggregate: jest.fn(async () => ({ _sum: { debit: 500, credit: 500 } })) } };
    const service = new FinanceService(prisma);
    const res = await service.getGlJournal({ page: 1, pageSize: 10, source: 'SALE', accountId: 1 });
    expect(res.total).toBe(1);
    expect(res.data[0].source).toBe('SALE');
    expect(res.data[0].totalDebit).toBe(500);
    expect(res.totals.debit).toBe(500);
    const where = (j.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.reference).toEqual({ startsWith: 'SALE-' });
    expect(where.lines).toEqual({ some: { accountId: 1 } });
  });
  it('getGlTrialBalance groups lines per account and flags the balance', async () => {
    const lines = [line(1, 1, 500, 0, cashAcc, 'SALE-42'), line(2, 5, 0, 500, revAcc, 'SALE-42')];
    const prisma: any = { journalLine: { findMany: jest.fn(async () => lines) } };
    const service = new FinanceService(prisma);
    const tb = await service.getGlTrialBalance({});
    expect(tb.totals.debit).toBe(500);
    expect(tb.totals.credit).toBe(500);
    expect(tb.balanced).toBe(true);
    const cashRow = tb.rows.find((r: any) => r.accountId === 1);
    expect(cashRow.balance).toBe(500);
    const revRow = tb.rows.find((r: any) => r.accountId === 5);
    expect(revRow.balance).toBe(500);
  });
  it('getGlAccountLedger computes opening, running and closing balances', async () => {
    const prisma: any = {
      account: { findFirst: jest.fn(async () => cashAcc) },
      journalLine: {
        aggregate: jest.fn(async () => ({ _sum: { debit: 100, credit: 0 } })),
        findMany: jest.fn(async () => [line(1, 1, 500, 0, cashAcc, 'SALE-42'), line(2, 1, 0, 300, cashAcc, 'EXP-1')]),
      },
    };
    const service = new FinanceService(prisma);
    const led = await service.getGlAccountLedger(1, {});
    expect(led.openingBalance).toBe(100);
    expect(led.normal).toBe('DEBIT');
    expect(led.rows).toHaveLength(2);
    expect(led.rows[0].balance).toBe(600);
    expect(led.rows[1].balance).toBe(300);
    expect(led.closingBalance).toBe(300);
  });
  it('getGlCoverage reports auto-posting health for sales and returns', async () => {
    const prisma: any = {
      journalEntry: { findMany: jest.fn(async () => [{ id: 1, reference: 'SALE-42' }, { id: 2, reference: 'RTRN-1' }]) },
      journalLine: { aggregate: jest.fn(async () => ({ _sum: { debit: 500, credit: 500 }, _count: 2 })) },
      sale: { aggregate: jest.fn(async () => ({ _count: 1, _sum: { totalAmount: 500, totalCost: 300 } })) },
      return: { aggregate: jest.fn(async () => ({ _count: 1, _sum: { totalRefund: 100 } })) },
      expense: { aggregate: jest.fn(async () => ({ _count: 0, _sum: { amount: 0 } })) },
      otherIncome: { groupBy: jest.fn(async () => [{ source: 'SALE', _count: { _all: 1 }, _sum: { amount: 500 } }]) },
      cogsEntry: { groupBy: jest.fn(async () => [{ source: 'SALE_REVERSAL', _count: { _all: 1 }, _sum: { amount: -60 } }]) },
    };
    const service = new FinanceService(prisma);
    const cov = await service.getGlCoverage({});
    expect(cov.totals.journalEntries).toBe(2);
    expect(cov.totals.balanced).toBe(true);
    const sale = cov.sources.find((s: any) => s.key === 'sale');
    expect(sale.status).toBe('ok');
    expect(sale.incomeAmount).toBe(500);
    expect(sale.expectedAmount).toBe(500);
    const ret = cov.sources.find((s: any) => s.key === 'return');
    expect(ret.status).toBe('ok');
    expect(cov.byReference.find((b: any) => b.key === 'SALE').count).toBe(1);
  });
});
