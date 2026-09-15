import { ProductsService } from './products.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

const makePrisma = (overrides: Record<string, any> = {}) => {
  const createdProduct = {
    id: 1,
    sku: 'ABC-XYZ-1A2B',
    brand: 'Acme',
    baseName: 'Widget',
    currentBuyPrice: 0,
    currentSellPrice: 0,
    hasVariants: false,
  };
  const prisma: Record<string, any> = {
    product: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: any) => ({ ...createdProduct, ...args.data })),
      update: jest.fn(async (args: any) => args.data),
      findUnique: jest.fn(async () => createdProduct),
    },
    productVariant: {
      createManyAndReturn: jest.fn(async (args: any) =>
        (args.data ?? []).map((d: any, i: number) => ({
          id: i + 1,
          ...d,
        })),
      ),
      update: jest.fn(async (args: any) => args.data),
      findFirst: jest.fn(async () => null),
    },
    organization: {
      findUnique: jest.fn(async () => ({ standalone: false })),
    },
    location: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => ({ type: 'STORE' })),
    },
    ...overrides,
  };
  return prisma;
};

const makeService = (prisma: any) => {
  const notifications = { notifyLocation: jest.fn(async () => undefined) };
  const finance = { postProcurement: jest.fn(async () => 1) };
  const service = new ProductsService(
    prisma,
    notifications as any,
    finance as any,
  );
  return { service, notifications, finance, prisma };
};

const owner = { sub: 1, isSuperuser: true, locationId: null, permissions: [] };
const base = (over: any = {}) => ({
  brand: 'Acme',
  baseName: 'Widget',
  categoryId: 1,
  hasVariants: false,
  ...over,
});

describe('ProductsService price + store validation', () => {
  it('rejects a plain product without positive buy/sell prices before any insert', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({ currentBuyPrice: 0, currentSellPrice: 0 }) as any,
        owner as any,
      ),
    ).rejects.toThrow('Buy Price and Sell Price are required for this product.');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('requires a store when a plain product carries initial quantity', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({
          currentBuyPrice: 10,
          currentSellPrice: 20,
          quantity: 5,
          storeId: undefined,
        }) as any,
        owner as any,
      ),
    ).rejects.toThrow(
      'Please select a target Store/Location to assign initial stock.',
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('stores the rounded variant average on the parent for variant products', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await service.create(
      base({
        hasVariants: true,
        variants: [
          { attributes: { size: 'S' }, buyPrice: 10, sellPrice: 30 },
          { attributes: { size: 'L' }, buyPrice: 20, sellPrice: 40 },
        ],
      }) as any,
      owner as any,
    );

    // Parent row = simple average of the per-variant prices (rounded).
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentBuyPrice: 15,
          currentSellPrice: 35,
          hasVariants: true,
        }),
      }),
    );
  });

  it('rejects a variant row that is missing a price', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({
          hasVariants: true,
          variants: [
            { attributes: { size: 'S' }, buyPrice: 10, sellPrice: 30 },
            { attributes: { size: 'L' }, buyPrice: 20, sellPrice: undefined },
          ],
        }) as any,
        owner as any,
      ),
    ).rejects.toThrow('Variant 2: buy and sell prices are required');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('requires a store before variant rows with initial quantity are deposited', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({
          hasVariants: true,
          variants: [
            { attributes: { size: 'S' }, buyPrice: 10, sellPrice: 20, quantity: 4 },
          ],
          storeId: undefined,
        }) as any,
        owner as any,
      ),
    ).rejects.toThrow(
      'Please select a target Store/Location to assign initial stock.',
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});

describe('ProductsService.findByCode (POS scan to cart)', () => {
  const productRow = {
    id: 7,
    sku: 'SAMBUSA-1',
    barcode: '4006381333931',
    brand: 'Nejat',
    baseName: 'Sambusa',
    hasVariants: false,
    inventory: [{ locationId: 3, quantity: 12 }],
  };

  it('matches a product barcode exactly, trimming and ignoring case', async () => {
    const prisma = makePrisma();
    prisma.product.findFirst = jest.fn(async () => productRow);
    const { service } = makeService(prisma);

    const res = await service.findByCode(' 4006381333931 ', 3);

    expect(res.matchType).toBe('PRODUCT');
    expect(res.product).toBe(productRow);
    expect(res.variant).toBeNull();
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { barcode: { equals: '4006381333931', mode: 'insensitive' } },
          { sku: { equals: '4006381333931', mode: 'insensitive' } },
        ],
      },
      include: expect.objectContaining({
        variants: { orderBy: { id: 'asc' } },
        inventory: { where: { locationId: 3 }, include: { location: true } },
      }),
    });
    expect(prisma.productVariant.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to a variant code and returns the parent product', async () => {
    const prisma = makePrisma();
    prisma.product.findFirst = jest.fn(async () => null);
    prisma.productVariant.findFirst = jest.fn(async () => ({
      id: 41,
      sku: 'SAMBUSA-1-L',
      barcode: '4006381333948',
      product: productRow,
    }));
    const { service } = makeService(prisma);

    const res = await service.findByCode('4006381333948');

    expect(res.matchType).toBe('VARIANT');
    expect(res.product).toBe(productRow);
    expect(res.variant).toEqual({
      id: 41,
      sku: 'SAMBUSA-1-L',
      barcode: '4006381333948',
    });
    // The nested parent is stripped so the client can merge both objects.
    expect((res.variant as any).product).toBeUndefined();
  });

  it('returns NONE without querying for a blank code', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    const res = await service.findByCode('   ');

    expect(res).toEqual({ product: null, variant: null, matchType: 'NONE' });
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.productVariant.findFirst).not.toHaveBeenCalled();
  });

  it('returns NONE when nothing matches', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    const res = await service.findByCode('DOES-NOT-EXIST');

    expect(res).toEqual({ product: null, variant: null, matchType: 'NONE' });
  });

  it('leaves the inventory include unscoped when no location is given', async () => {
    const prisma = makePrisma();
    prisma.product.findFirst = jest.fn(async () => productRow);
    const { service } = makeService(prisma);

    await service.findByCode('SAMBUSA-1');

    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          inventory: { include: { location: true } },
        }),
      }),
    );
  });
});

describe('ProductsService.adjustStock', () => {
  const variantProduct = {
    id: 5,
    brand: 'Test',
    baseName: 'Led panel',
    hasVariants: true,
    currentBuyPrice: 10,
  };
  const plainProduct = { ...variantProduct, hasVariants: false };

  // adjustStock writes through inventorySet, so the mock needs that delegate.
  const inventoryMock = (row: any) => ({
    findFirst: jest.fn(async () => row),
    update: jest.fn(async (a: any) => a),
    create: jest.fn(async (a: any) => a),
  });

  const prepare = (prisma: any) => {
    // adjustStock resolves the location (tenant-scoped) before anything else, so
    // every case needs a valid one unless the test overrides it afterwards.
    prisma.location = {
      ...(prisma.location ?? {}),
      findFirst: jest.fn(async () => ({
        id: 26,
        name: 'Sosa Store',
        type: 'STORE',
      })),
    };
    const { service, finance, notifications } = makeService(prisma);
    (finance as any).postInventoryAdjustment = jest.fn(async () => true);
    (notifications as any).checkAndNotifyLowStock = jest.fn(
      async () => undefined,
    );
    return { service, finance, notifications };
  };

  it('requires a variant when the product has variants', async () => {
    const prisma = makePrisma({
      product: { findUnique: jest.fn(async () => variantProduct) },
    });
    const { service } = prepare(prisma);

    await expect(
      service.adjustStock(5, { locationId: 26, quantity: 12 }, owner as any),
    ).rejects.toThrow('Select a variant to reconcile');
  });

  it('rejects a variant that belongs to another product', async () => {
    const prisma = makePrisma({
      product: { findUnique: jest.fn(async () => variantProduct) },
      productVariant: { findFirst: jest.fn(async () => null) },
    });
    const { service } = prepare(prisma);

    await expect(
      service.adjustStock(
        5,
        { locationId: 26, variantId: 999, quantity: 3 },
        owner as any,
      ),
    ).rejects.toThrow('does not belong to this product');
  });

  it('adjusts the selected variant at the selected location only', async () => {
    const prisma = makePrisma({
      product: { findUnique: jest.fn(async () => variantProduct) },
      productVariant: {
        findFirst: jest.fn(async () => ({
          sku: 'TES-LED-V1',
          attributes: { slot1: '9w', slot2: '3 colors' },
        })),
      },
      inventory: inventoryMock({ id: 900, quantity: 4, avgCost: 5 }),
      auditLog: { create: jest.fn(async (a: any) => a) },
    });
    const { service, finance, notifications } = prepare(prisma);

    await service.adjustStock(
      5,
      { locationId: 26, variantId: 847, quantity: 10 },
      owner as any,
    );

    // The row is resolved and written for (variant 847, location 26) — never the
    // plain row, which used to become a phantom row on variant products.
    expect(prisma.inventory.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 1, productId: 5, variantId: 847, locationId: 26 },
    });
    expect(prisma.inventory.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: { quantity: 10 },
    });
    expect(prisma.inventory.create).not.toHaveBeenCalled();

    // Journal: delta 6 × avgCost 5, and it names the variant.
    const journal = (finance as any).postInventoryAdjustment.mock.calls[0][0];
    expect(journal.signedAmount).toBe(30);
    expect(journal.ref).toContain('-847-');
    expect(journal.description).toContain('Test Led panel (9w / 3 colors)');

    // Audit trail names the variant too.
    const audit = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
    expect(audit.data.details).toContain('9w / 3 colors');
    expect(audit.data.details).toContain('to 10 at');

    // Low-stock is re-evaluated for that product at that location.
    expect((notifications as any).checkAndNotifyLowStock).toHaveBeenCalledWith(
      5,
      26,
    );
  });

  it('still adjusts a plain product through its null-variant row', async () => {
    const prisma = makePrisma({
      product: { findUnique: jest.fn(async () => plainProduct) },
      inventory: inventoryMock({ id: 901, quantity: 2, avgCost: 4 }),
      auditLog: { create: jest.fn(async (a: any) => a) },
    });
    const { service, finance } = prepare(prisma);

    await service.adjustStock(5, { locationId: 28, quantity: 5 }, owner as any);

    expect(prisma.inventory.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 1, productId: 5, variantId: null, locationId: 28 },
    });
    expect(prisma.inventory.update).toHaveBeenCalledWith({
      where: { id: 901 },
      data: { quantity: 5 },
    });
    expect(
      (finance as any).postInventoryAdjustment.mock.calls[0][0].signedAmount,
    ).toBe(12);
  });

  it('rejects a variantId for a product without variants', async () => {
    const prisma = makePrisma({
      product: { findUnique: jest.fn(async () => plainProduct) },
    });
    const { service } = prepare(prisma);

    await expect(
      service.adjustStock(
        5,
        { locationId: 28, variantId: 9, quantity: 5 },
        owner as any,
      ),
    ).rejects.toThrow('This product has no variants.');
  });

  it('only accepts locations of the active business', async () => {
    const prisma = makePrisma({
      product: { findUnique: jest.fn(async () => plainProduct) },
    });
    const { service } = prepare(prisma);
    // A location id from another business resolves to nothing.
    prisma.location.findFirst = jest.fn(async () => null);

    await expect(
      service.adjustStock(5, { locationId: 999, quantity: 5 }, owner as any),
    ).rejects.toThrow('Location not found');
    expect(prisma.location.findFirst).toHaveBeenCalledWith({
      where: { id: 999, tenantId: 1 },
    });
  });
});

describe('ProductsService.variantSuggestions', () => {
  const row = (attributes: any, extra: any = {}) => ({
    attributes,
    buyPrice: 10,
    sellPrice: 20,
    reorderLevel: 0,
    reorderQty: null,
    ...extra,
  });
  const product = (
    id: number,
    brand: string,
    rows: any[],
    extra: any = {},
  ): any => ({
    id,
    brand,
    baseName: `Wire ${id}`,
    updatedAt: new Date(2026, 0, id),
    variants: rows,
    ...extra,
  });

  const make = (
    products: any[],
    opts: { category?: any; children?: any[] } = {},
  ) => {
    const prisma = makePrisma({
      category: {
        findFirst: jest.fn(async () =>
          opts.category === undefined
            ? { id: 10, name: 'Electrical Wire' }
            : opts.category,
        ),
        findMany: jest.fn(async () => opts.children ?? []),
      },
      product: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(async () => products),
      },
    });
    return { prisma, service: makeService(prisma).service };
  };

  it('returns nothing until a category is chosen', async () => {
    const { prisma, service } = make([]);
    const res = await service.variantSuggestions({ brand: 'Kabel' });

    expect(res).toEqual({
      categoryId: null,
      categoryName: null,
      categoryIds: [],
      scannedProducts: 0,
      groups: [],
      products: [],
    });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('groups identical variant matrices and counts the products using them', async () => {
    const matrix = [
      row({ size: '2.5mm', color: 'Red' }),
      row({ size: '2.5mm', color: 'Blue' }),
    ];
    const { service } = make([
      product(1, 'Kabel', matrix),
      product(2, 'Nifas', matrix),
      // Case/spacing differences describe the same option, so they must not split
      // one matrix into two groups.
      product(4, 'Kabel', [
        row({ size: ' 2.5MM ', color: 'red' }),
        row({ size: '2.5mm', color: 'blue' }),
      ]),
      product(3, 'Kabel', [row({ size: '4mm', color: 'Red' })]),
    ]);

    const res = await service.variantSuggestions({ categoryId: 10 });

    expect(res.scannedProducts).toBe(4);
    expect(res.groups).toHaveLength(2);
    expect(res.groups[0]).toMatchObject({
      count: 3,
      sample: { productId: 1, brand: 'Kabel' },
    });
    expect(res.groups[0].rows).toHaveLength(2);
    expect(res.categoryName).toBe('Electrical Wire');
  });

  it('never returns sku, barcode or quantity', async () => {
    const { service } = make([
      product(1, 'Kabel', [
        row(
          { size: '2.5mm' },
          { sku: 'KAB-25-RED', barcode: '1234567890123', quantity: 42 },
        ),
      ]),
    ]);

    const res = await service.variantSuggestions({ categoryId: 10 });
    const suggested = res.groups[0].rows[0];

    // A variant row belongs to one product: its code, barcode and stock are not
    // reusable, so the builder must never pre-fill them.
    expect(Object.keys(suggested).sort()).toEqual([
      'attributes',
      'buyPrice',
      'reorderLevel',
      'reorderQty',
      'sellPrice',
    ]);
    expect(JSON.stringify(res.groups)).not.toContain('KAB-25-RED');
    expect(JSON.stringify(res.groups)).not.toContain('1234567890123');
  });

  it("prefers the typed brand's row set for the pre-filled prices", async () => {
    const { service } = make([
      product(1, 'Kabel', [row({ size: '2.5mm' }, { buyPrice: 11 })]),
      product(2, 'Nifas', [row({ size: '2.5mm' }, { buyPrice: 22 })]),
    ]);

    const res = await service.variantSuggestions({
      categoryId: 10,
      brand: 'nifas',
    });

    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].sample).toMatchObject({ productId: 2, brand: 'Nifas' });
    expect(res.groups[0].rows[0].buyPrice).toBe(22);
  });

  it('includes sub-categories of the selected category', async () => {
    const { prisma, service } = make([], { children: [{ id: 11 }] });

    await service.variantSuggestions({ categoryId: 10 });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: { in: [10, 11] } }),
      }),
    );
  });

  it('skips variant products that carry no rows', async () => {
    const { service } = make([product(1, 'Kabel', [])]);

    const res = await service.variantSuggestions({ categoryId: 10 });

    expect(res.scannedProducts).toBe(0);
    expect(res.groups).toEqual([]);
    expect(res.products).toEqual([]);
  });

  it('rejects a category outside the active business without reading products', async () => {
    const { prisma, service } = make([], { category: null });

    await expect(
      service.variantSuggestions({ categoryId: 999 }),
    ).rejects.toThrow('Category not found');

    expect(prisma.category.findFirst).toHaveBeenCalledWith({
      where: { id: 999, tenantId: 1 },
      select: { id: true, name: true },
    });
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('never suggests the product being edited back to itself', async () => {
    const { prisma, service } = make([
      product(1, 'Kabel', [row({ size: '2.5mm' })]),
    ]);

    await service.variantSuggestions({ categoryId: 10, excludeProductId: 7 });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 7 } }),
      }),
    );
  });

  it('lists at most ten copy-from sources and clamps the scan limit', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      product(i + 1, 'Kabel', [row({ size: `${i + 1}mm` })]),
    );

    const wide = make(many);
    const res = await wide.service.variantSuggestions({ categoryId: 10 });
    expect(res.products).toHaveLength(10);
    expect(res.products[0]).toMatchObject({ id: 1, variantCount: 1 });

    const clamped = make(many);
    await clamped.service.variantSuggestions({ categoryId: 10, limit: 9999 });
    expect(clamped.prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });
});

