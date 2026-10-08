import { RestockService } from './restock.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

describe('RestockService.registerPurchase', () => {
  const makePrisma = (overrides: Record<string, any> = {}) => {
    const prisma: Record<string, any> = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      product: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({
          id: 100,
          brand: 'Nike',
          baseName: 'Air Force 1',
          currentBuyPrice: 4500,
          currentSellPrice: 8000,
          ...args.data,
        })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      productVariant: {
        findFirst: jest.fn(async () => ({ id: 4 })),
        findUnique: jest.fn(async () => ({ id: 4, buyPrice: 4000 })),
        create: jest.fn(async (args: any) => ({ id: 500, ...args.data })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      organization: {
        findUnique: jest.fn(async () => ({
          name: 'Acme Org',
          standalone: false,
          businessType: 'RETAIL',
        })),
      },
      location: {
        findUnique: jest.fn(async (args: any) => ({
          id: args.where.id,
          type: 'STORE',
          name: 'Main Store',
        })),
        findFirst: jest.fn(async (args: any) => {
          if (args?.where?.id != null) {
            return { id: args.where.id, type: 'STORE', name: 'Main Store' };
          }
          return null;
        }),
        create: jest.fn(async (args: any) => ({ id: 9, ...args.data })),
      },
      priceHistory: { create: jest.fn(async (args: any) => args.data) },
      inventory: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      stockRequest: {
        create: jest.fn(async (args: any) => ({
          id: 77,
          items: [{ id: 1 }],
          ...args.data,
        })),
      },
      requestActivity: { create: jest.fn(async (args: any) => args.data) },
      auditLog: { create: jest.fn(async (args: any) => args.data) },
      cashEntry: { create: jest.fn(async (args: any) => args.data) },
      productBatch: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
      },
      ...overrides,
    };
    return prisma;
  };

  const makeService = (prisma: any) => {
    const finance = { postProcurement: jest.fn(async () => true) };
    const notifications = {
      notifyLocation: jest.fn(async () => undefined),
      checkAndNotifyLowStock: jest.fn(async () => undefined),
      notifyOwner: jest.fn(async () => undefined),
    };
    const service = new RestockService(prisma, notifications as any, finance as any);
    return { service, finance, notifications, prisma };
  };

  const user = {
    sub: 1,
    isSuperuser: true,
    locationId: null,
    permissions: [],
  };

  it('registers a root-item purchase: stock, buy-price, Cash journal + OUTFLOW', async () => {
    const prisma = makePrisma({
      product: {
        findFirst: jest.fn(async () => null),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
        findUnique: jest.fn(async () => ({
          id: 5,
          brand: 'Acme',
          baseName: 'Onion',
          sku: 'ACM-ONI-0001',
          currentBuyPrice: 40,
          currentSellPrice: 60,
          hasVariants: false,
          category: { name: 'Raw Ingredients' },
        })),
      },
    });
    const { service, finance } = makeService(prisma);

    const result = await service.registerPurchase(
      { productId: 5, quantity: 10, totalAmount: 500, storeId: 3, paid: true },
      user as any,
    );

    // unitBuyPrice = 500 / 10 = 50
    expect(result.unitBuyPrice).toBe(50);
    // Root item buy price updated + price history recorded.
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentBuyPrice: 50 }),
      }),
    );
    expect(prisma.priceHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oldBuyPrice: 40, newBuyPrice: 50 }),
      }),
    );
    // Stock landed on the root item (variantId null) at the target location.
    expect(prisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 5,
          variantId: null,
          locationId: 3,
          quantity: 10,
        }),
      }),
    );

    // Ledger: Debit Inventory Asset <-> Credit Cash (paid) at the total amount,
    // referenced as RST-<requestId> so it can never collide with a purchase's
    // own PUR-<purchaseId> entry.
    expect(finance.postProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'RST-77', amount: 500, paid: true }),
    );
    // Cash ledger OUTFLOW recorded for the paid purchase.
    expect(prisma.cashEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'OUTFLOW', amount: 500, source: 'PURCHASE' }),
      }),
    );
    // COMPLETED stock request + audit trail.
    expect(prisma.stockRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'PURCHASE' }) }),
    );
  });

  it('requires a variant for variant products', async () => {
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn(async () => ({
          id: 5,
          brand: 'Nike',
          baseName: 'Air Force 1',
          sku: 'NIK-AF1',
          currentBuyPrice: 4000,
          currentSellPrice: 8000,
          hasVariants: true,
          category: null,
        })),
      },
    });
    const { service } = makeService(prisma);

    await expect(
      service.registerPurchase(
        { productId: 5, quantity: 1, totalAmount: 4500, storeId: 3 },
        user as any,
      ),
    ).rejects.toThrow('Please select a variant for this product');
  });

  it('on-the-fly creation with variant attributes: root + variant, stocks variant, AP journal', async () => {
    const prisma = makePrisma();
    const { service, finance } = makeService(prisma);

    const result = await service.registerPurchase(
      {
        createNew: {
          name: 'Air Force 1',
          brand: 'Nike',
          categoryId: 7,
          unitId: 2,
          variantAttributes: { color: 'Blue', size: '41' },
        },
        quantity: 1,
        totalAmount: 4500,
        storeId: 3,
        paid: false,
      },
      user as any,
    );

    // Root product created with hasVariants + buy price; price = total / qty.
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hasVariants: true,
          currentBuyPrice: 4500,
          categoryId: 7,
          unitId: 2,
        }),
      }),
    );
    // Initial variant created with SKU {productSKU}-V1 + attributes.
    const productData = prisma.product.create.mock.calls[0][0].data;
    expect(prisma.productVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sku: `${productData.sku}-V1`,
          attributes: { color: 'Blue', size: '41' },
          buyPrice: 4500,
        }),
      }),
    );

    // Stock landed on the new variant.
    expect(prisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ variantId: 500, quantity: 1 }),
      }),
    );
    // AP journal (paid=false) — no cash OUTFLOW.
    expect(finance.postProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ paid: false, amount: 4500 }),
    );
    expect(prisma.cashEntry.create).not.toHaveBeenCalled();
    expect(result.variantId).toBe(500);
  });

  it('rejects duplicate on-the-fly names', async () => {
    const prisma = makePrisma({
      product: {
        findFirst: jest.fn(async () => ({
          id: 1,
          brand: 'Nike',
          baseName: 'Air Force 1',
        })),
      },
    });
    const { service } = makeService(prisma);

    await expect(
      service.registerPurchase(
        {
          createNew: { name: 'Air Force 1', brand: 'Nike', categoryId: 7 },
          quantity: 1,
          totalAmount: 100,
          storeId: 3,
        },
        user as any,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it('requires unit + category for INGREDIENT creation', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.registerPurchase(
        {
          createNew: { name: 'Onion', kind: 'INGREDIENT', categoryId: 7 },
          quantity: 2,
          totalAmount: 100,
          storeId: 3,
        },
        user as any,
      ),
    ).rejects.toThrow('Unit of measure is required for ingredient items');
  });

  it('auto-creates a default location when the tenant has none', async () => {
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn(async () => ({
          id: 5,
          brand: 'Acme',
          baseName: 'Oil',
          sku: 'ACM-OIL-0001',
          currentBuyPrice: 80,
          currentSellPrice: 120,
          hasVariants: false,
          category: { name: 'Raw Ingredients' },
        })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      location: {
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({
          id: 99,
          type: 'STORE',
          name: 'Nejat Hospitality Store',
          tenantId: 1,
          ...args.data,
        })),
      },
    });
    const { service, finance } = makeService(prisma);

    const result = await service.registerPurchase(
      { productId: 5, quantity: 2, totalAmount: 200, paid: true },
      user as any,
    );

    // No storeId, no user location, no existing location → auto-created store.
    expect(prisma.location.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'STORE', tenantId: 1 }),
      }),
    );
    // Stock landed on the auto-created location.
    expect(prisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locationId: 99, quantity: 2 }),
      }),
    );
    // Ledger still posts (Cash journal + OUTFLOW).
    expect(finance.postProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 200, paid: true }),
    );
    expect(prisma.cashEntry.create).toHaveBeenCalled();
    expect(result.unitBuyPrice).toBe(100);
  });

  it('hospitality multi-variant create: root + N variants, per-variant stock + buy price, summed journal', async () => {
    const prisma = makePrisma({
      organization: {
        findUnique: jest.fn(async () => ({
          name: 'Nejat Hospitality',
          standalone: false,
          businessType: 'HOSPITALITY',
        })),
      },
    });
    const { service, finance } = makeService(prisma);

    const result = await service.registerPurchase(
      {
        createNew: {
          name: 'Juice',
          brand: 'Fresh',
          categoryId: 7,
          unitId: 2,
          variants: [
            { attributes: { volume: '330ml' }, quantity: 10, totalCost: 1000 },
            { attributes: { volume: '500ml' }, quantity: 5, totalCost: 800 },
          ],
        },
        quantity: 15,
        totalAmount: 1800,
        storeId: 3,
        paid: true,
      },
      user as any,
    );

    // Root created with hasVariants + weighted-average buy price (1800 / 15 = 120).
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hasVariants: true, currentBuyPrice: 120 }),
      }),
    );
    // Two variants with SKU {productSKU}-V1 / -V2 and their own unit buy prices.
    const productData = prisma.product.create.mock.calls[0][0].data;
    expect(prisma.productVariant.create).toHaveBeenCalledTimes(2);
    const variantCalls = prisma.productVariant.create.mock.calls;
    expect(variantCalls[0][0].data).toEqual(
      expect.objectContaining({
        sku: `${productData.sku}-V1`,
        attributes: { volume: '330ml' },
        buyPrice: 100,
      }),
    );
    expect(variantCalls[1][0].data).toEqual(
      expect.objectContaining({
        sku: `${productData.sku}-V2`,
        attributes: { volume: '500ml' },
        buyPrice: 160,
      }),
    );
    // Per-variant stock increments.
    expect(prisma.inventory.create).toHaveBeenCalledTimes(2);
    expect(prisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ variantId: 500, quantity: 10, avgCost: 100 }),
      }),
    );
    expect(prisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ variantId: 500, quantity: 5, avgCost: 160 }),
      }),
    );
    // One COMPLETED stock request carrying both variant items.
    const reqData = prisma.stockRequest.create.mock.calls[0][0].data;
    expect(reqData.items.create).toHaveLength(2);
    // Journal + OUTFLOW post the summed total once.
    expect(finance.postProcurement).toHaveBeenCalledTimes(1);
    expect(finance.postProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1800, paid: true }),
    );
    expect(prisma.cashEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 1800 }) }),
    );
    expect(result.unitBuyPrice).toBe(120);
    expect(result.variantCount).toBe(2);
  });

  it('hospitality multi-line purchase of an existing variant product: per-variant stock + buy price + summed journal', async () => {
    const prisma = makePrisma({
      organization: {
        findUnique: jest.fn(async () => ({
          name: 'Nejat Hospitality',
          standalone: false,
          businessType: 'HOSPITALITY',
        })),
      },
      product: {
        findUnique: jest.fn(async () => ({
          id: 5,
          brand: 'Fresh',
          baseName: 'Juice',
          sku: 'FRH-JUI',
          currentBuyPrice: 100,
          currentSellPrice: 200,
          hasVariants: true,
          category: { name: 'Beverages' },
        })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      productVariant: {
        findFirst: jest.fn(async (args: any) => ({ id: args.where.id })),
        findUnique: jest.fn(async (args: any) => ({
          id: args.where.id,
          buyPrice: args.where.id === 4 ? 90 : 150,
        })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
    });
    const { service, finance } = makeService(prisma);

    const result = await service.registerPurchase(
      {
        productId: 5,
        lines: [
          { variantId: 4, quantity: 10, totalCost: 1000 },
          { variantId: 6, quantity: 5, totalCost: 800 },
        ],
        quantity: 15,
        totalAmount: 1800,
        storeId: 3,
        paid: true,
      },
      user as any,
    );

    // Per-variant buy-price updates (1000/10=100, 800/5=160).
    expect(prisma.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 4 }, data: { buyPrice: 100 } }),
    );
    expect(prisma.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 6 }, data: { buyPrice: 160 } }),
    );
    // Root product repriced to the weighted average + price history.
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentBuyPrice: 120 }),
      }),
    );
    expect(prisma.priceHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oldBuyPrice: 100, newBuyPrice: 120 }),
      }),
    );
    // Two inventory increments, one per variant.
    expect(prisma.inventory.create).toHaveBeenCalledTimes(2);
    expect(prisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ variantId: 4, quantity: 10 }),
      }),
    );
    expect(prisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ variantId: 6, quantity: 5 }),
      }),
    );
    // One summed journal entry.
    expect(finance.postProcurement).toHaveBeenCalledTimes(1);
    expect(finance.postProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1800 }),
    );
    expect(result.unitBuyPrice).toBe(120);
    expect(result.variantCount).toBe(2);
  });

  it('rejects multi-variant purchases for non-hospitality orgs', async () => {
    const prisma = makePrisma(); // organization mock returns businessType RETAIL
    const { service } = makeService(prisma);

    await expect(
      service.registerPurchase(
        {
          productId: 5,
          lines: [{ variantId: 4, quantity: 1, totalCost: 100 }],
          quantity: 1,
          totalAmount: 100,
          storeId: 3,
        },
        user as any,
      ),
    ).rejects.toThrow(
      'Multi-variant purchases are only available to hospitality businesses.',
    );
  });
});


describe('RestockService.restockBatch', () => {
  const ledPanel = {
    id: 5,
    brand: 'Test',
    baseName: 'Led panel',
    hasVariants: true,
    isPerishable: false,
    currentBuyPrice: 100,
    currentSellPrice: 150,
  };
  const wire = {
    id: 9,
    brand: 'Kabel',
    baseName: 'Wire',
    hasVariants: false,
    isPerishable: false,
    currentBuyPrice: 12,
    currentSellPrice: 20,
  };
  const variants = [
    { id: 847, productId: 5, sku: 'V847', attributes: { slot1: '9w' }, buyPrice: 100, sellPrice: 150 },
    { id: 848, productId: 5, sku: 'V848', attributes: { slot1: '12w' }, buyPrice: 120, sellPrice: 180 },
  ];
  const locations = [
    { id: 26, name: 'Sosa Store', type: 'STORE' },
    { id: 27, name: 'Ummi Store', type: 'STORE' },
  ];

  const make = (
    opts: { receivers?: number; products?: any[]; extra?: Record<string, any> } = {},
  ) => {
    const prisma: Record<string, any> = {
      product: {
        findMany: jest.fn(async () => opts.products ?? [ledPanel, wire]),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      productVariant: {
        findMany: jest.fn(async () => variants),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      organization: {
        findUnique: jest.fn(async () => ({ name: 'Acme', standalone: false })),
      },
      location: {
        findMany: jest.fn(async (args: any) => {
          const ids: number[] = args?.where?.id?.in ?? [];
          return locations.filter((l) => ids.includes(l.id));
        }),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 30, ...args.data })),
      },
      user: { count: jest.fn(async () => opts.receivers ?? 0) },
      inventory: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      stockRequest: {
        create: jest.fn(async (args: any) => ({
          id: 77,
          items: (args.data.items?.create ?? []).map((_: any, i: number) => ({
            id: i + 1,
          })),
          ...args.data,
        })),
      },
      requestActivity: { create: jest.fn(async (args: any) => args.data) },
      auditLog: { create: jest.fn(async (args: any) => args.data) },
      priceHistory: { create: jest.fn(async (args: any) => args.data) },
      productBatch: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
      },
      ...(opts.extra ?? {}),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const finance = { postProcurement: jest.fn(async () => true) };
    const notifications = {
      notifyLocation: jest.fn(async () => undefined),
      notifyOwner: jest.fn(async () => undefined),
      checkAndNotifyLowStock: jest.fn(async () => undefined),
    };
    const service = new RestockService(prisma as any, notifications as any, finance as any);
    return { service, prisma, finance, notifications };
  };

  const owner = { sub: 1, isSuperuser: true, locationId: null, permissions: [] };

  it('stocks an owner-operated location directly: one request, one journal', async () => {
    const { service, prisma, finance, notifications } = make();

    const res = await service.restockBatch(
      {
        storeId: 26,
        vendor: 'Kabel Import',
        items: [
          { productId: 5, variantId: 847, quantity: 4, buyPrice: 110, sellPrice: 160 },
          { productId: 9, quantity: 10 },
        ],
      } as any,
      owner as any,
    );

    // One request carrying both lines.
    expect(prisma.stockRequest.create).toHaveBeenCalledTimes(1);
    const created = prisma.stockRequest.create.mock.calls[0][0].data;
    expect(created.items.create).toHaveLength(2);
    expect(created.status).toBe('COMPLETED');
    expect(created.items.create[0]).toMatchObject({
      productId: 5,
      variantId: 847,
      status: 'RECEIVED',
      quantityReceived: 4,
    });

    // Stock landed for both line types.
    expect(prisma.inventory.create).toHaveBeenCalledTimes(2);
    expect(prisma.inventory.create.mock.calls[0][0].data).toMatchObject({
      productId: 5,
      variantId: 847,
      locationId: 26,
      quantity: 4,
    });
    expect(prisma.inventory.create.mock.calls[1][0].data).toMatchObject({
      productId: 9,
      variantId: null,
      quantity: 10,
    });

    // ONE procurement entry for the store, at the summed value (4 × 110 + 10 × 12).
    expect(finance.postProcurement).toHaveBeenCalledTimes(1);
    expect(finance.postProcurement).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'RST-77', amount: 560 }),
    );

    expect(res.byLocation).toEqual([
      expect.objectContaining({
        locationId: 26,
        mode: 'direct',
        items: 2,
        totalCost: 560,
        journalRef: 'RST-77',
      }),
    ]);
    expect(res.results[0]).toMatchObject({
      productId: 5,
      variantId: 847,
      unitCost: 110,
      lineCost: 440,
    });
    expect(notifications.notifyLocation).toHaveBeenCalledWith(
      'Stock Added',
      expect.stringContaining('14 unit(s)'),
      26,
      expect.anything(),
    );
  });

  it('deposits for confirmation when the location has staff', async () => {
    const { service, prisma, finance, notifications } = make({ receivers: 2 });

    const res = await service.restockBatch(
      { items: [{ productId: 9, locationId: 26, quantity: 5 }] } as any,
      owner as any,
    );

    expect(prisma.stockRequest.create.mock.calls[0][0].data.status).toBe(
      'AWAITING_CONFIRMATION',
    );
    expect(
      prisma.stockRequest.create.mock.calls[0][0].data.items.create[0],
    ).toMatchObject({ status: 'STORED', quantityStored: 5 });
    // Nothing lands until someone confirms.
    expect(prisma.inventory.create).not.toHaveBeenCalled();
    expect(finance.postProcurement).not.toHaveBeenCalled();
    expect(res.byLocation[0]).toMatchObject({ mode: 'deposit', journalRef: null });
    expect(notifications.notifyLocation).toHaveBeenCalledWith(
      'Stock Ready for Receipt',
      expect.any(String),
      26,
      expect.anything(),
    );
  });

  it('raises a request for a non-owner, scoped to their own location', async () => {
    const { service, prisma, finance, notifications } = make();
    const staff = { sub: 9, isSuperuser: false, locationId: 26, permissions: [] };

    const res = await service.restockBatch(
      { items: [{ productId: 9, locationId: 26, quantity: 3 }] } as any,
      staff as any,
    );

    expect(prisma.stockRequest.create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(
      prisma.stockRequest.create.mock.calls[0][0].data.items.create[0],
    ).toMatchObject({ status: 'PENDING', quantityRequested: 3 });
    expect(prisma.inventory.create).not.toHaveBeenCalled();
    expect(finance.postProcurement).not.toHaveBeenCalled();
    expect(notifications.notifyOwner).toHaveBeenCalled();
    expect(res.byLocation[0].mode).toBe('pending');
  });

  it('lets a holder of inventory.all-locations restock another location', async () => {
    const { service, prisma } = make();
    const storekeeper = {
      sub: 9,
      isSuperuser: false,
      locationId: 26,
      permissions: ['inventory.all-locations'],
    };

    const res = await service.restockBatch(
      { items: [{ productId: 9, locationId: 27, quantity: 3 }] } as any,
      storekeeper as any,
    );

    expect(prisma.stockRequest.create.mock.calls[0][0].data.storeId).toBe(27);
    // Still not the owner, so the other location's stock is only requested.
    expect(prisma.stockRequest.create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(res.byLocation[0]).toMatchObject({ locationId: 27, mode: 'pending' });
  });

  it('still refuses another location without inventory.all-locations', async () => {
    const { service, prisma } = make();
    const staff = { sub: 9, isSuperuser: false, locationId: 26, permissions: [] };

    const err: any = await service
      .restockBatch(
        { items: [{ productId: 9, locationId: 27, quantity: 3 }] } as any,
        staff as any,
      )
      .catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().errors[0].message).toContain(
      'restock your own store/shop',
    );
    expect(prisma.stockRequest.create).not.toHaveBeenCalled();
  });

  it('creates one request per location, each with its own journal', async () => {
    const { service, prisma, finance } = make();

    const res = await service.restockBatch(
      {
        items: [
          { productId: 9, locationId: 26, quantity: 2 },
          { productId: 5, variantId: 847, locationId: 27, quantity: 1 },
          { productId: 5, variantId: 848, locationId: 27, quantity: 3 },
        ],
      } as any,
      owner as any,
    );

    expect(prisma.stockRequest.create).toHaveBeenCalledTimes(2);
    const perStore = prisma.stockRequest.create.mock.calls.map(
      (c: any) => c[0].data,
    );
    expect(perStore[0].items.create).toHaveLength(1);
    expect(perStore[1].items.create).toHaveLength(2);
    expect(perStore.map((d: any) => d.storeId).sort()).toEqual([26, 27]);
    // One procurement entry per store.
    expect(finance.postProcurement).toHaveBeenCalledTimes(2);
    expect(res.byLocation).toHaveLength(2);
  });

  it('applies per-line prices, keeps the product average and records one grouped change', async () => {
    const { service, prisma } = make();

    await service.restockBatch(
      {
        storeId: 26,
        items: [
          { productId: 5, variantId: 847, quantity: 2, buyPrice: 130, sellPrice: 190 },
        ],
      } as any,
      owner as any,
    );

    // The variant's own row moved…
    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 847 },
      data: { buyPrice: 130, sellPrice: 190 },
    });
    // …and the product still carries the variant average (110 / 165).
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { currentBuyPrice: 110, currentSellPrice: 165 },
    });
    // History: the variant row plus the product's own row, one batch.
    const rows = prisma.priceHistory.create.mock.calls.map((c: any) => c[0].data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      productId: 5,
      variantId: 847,
      source: 'RESTOCK',
      oldBuyPrice: 100,
      newBuyPrice: 130,
    });
    expect(rows[1]).toMatchObject({ productId: 5, variantId: null, newBuyPrice: 110 });
    expect(rows[0].batchRef).toBe(rows[1].batchRef);
  });

  it('rejects a sheet with bad rows without writing anything', async () => {
    const { service, prisma, finance } = make();

    const err: any = await service
      .restockBatch(
        {
          storeId: 26,
          items: [
            { productId: 5, locationId: 26, quantity: 3 }, // variant product, no variant
            { productId: 9, locationId: 999, quantity: 1 }, // foreign location
            { productId: 9, locationId: 26, quantity: 1 }, // fine
            { productId: 9, locationId: 26, quantity: 2 }, // duplicate row
          ],
        } as any,
        owner as any,
      )
      .catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().errors.map((e: any) => e.index)).toEqual([0, 1, 3]);
    expect(err.getResponse().errors[0].message).toContain('Select a variant');
    expect(err.getResponse().errors[1].message).toBe('Location not found');
    expect(err.getResponse().errors[2].message).toContain('listed twice');
    // Nothing was written, not even opened.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stockRequest.create).not.toHaveBeenCalled();
    expect(prisma.inventory.create).not.toHaveBeenCalled();
    expect(finance.postProcurement).not.toHaveBeenCalled();
  });

  it('blocks a non-owner restocking another location or moving prices', async () => {
    const { service, prisma } = make();
    const staff = { sub: 9, isSuperuser: false, locationId: 26, permissions: [] };

    const err: any = await service
      .restockBatch(
        {
          items: [
            { productId: 9, locationId: 27, quantity: 1 },
            { productId: 9, locationId: 26, quantity: 1, buyPrice: 5 },
          ],
        } as any,
        staff as any,
      )
      .catch((e) => e);

    expect(err.getResponse().errors.map((e: any) => e.message)).toEqual([
      'You can only restock your own store/shop.',
      'Only the owner can change prices on a restock.',
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires batch and expiry for perishable lines', async () => {
    const { service, prisma } = make({
      products: [{ ...wire, isPerishable: true }],
    });

    const err: any = await service
      .restockBatch(
        { items: [{ productId: 9, locationId: 26, quantity: 1 }] } as any,
        owner as any,
      )
      .catch((e) => e);

    expect(err.getResponse().errors[0].message).toContain(
      'Batch number and expiry date are required',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

