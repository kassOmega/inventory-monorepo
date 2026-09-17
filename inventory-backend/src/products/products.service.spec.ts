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

/** Run the transaction callback against the same prisma mock. */
const withTx = (prisma: any) => {
  prisma.$transaction = jest.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  return prisma;
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
    reorderLevel: 10,
  };
  const plainProduct = { ...variantProduct, hasVariants: false };

  /**
   * Mocks for the counting endpoints: products, variants and locations are now
   * loaded in bulk (one findMany each) and the sheet is applied inside a
   * transaction, so the mock needs `$transaction` plus those delegates.
   */
  const makeCount = (
    opts: {
      products?: any[];
      variants?: any[];
      locations?: any[];
      inventoryRow?: any;
      extra?: Record<string, any>;
    } = {},
  ) => {
    const products = opts.products ?? [];
    const variants = opts.variants ?? [];
    // Location lookups honour the tenant-scoped id filter, so a foreign id
    // simply resolves to nothing.
    const locations = opts.locations ?? [
      { id: 26, name: 'Sosa Store', type: 'STORE' },
      { id: 28, name: 'Negele Shop', type: 'SHOP' },
    ];
    const prisma = makePrisma({
      product: {
        findMany: jest.fn(async () => products),
        findUnique: jest.fn(async () => products[0] ?? null),
        findFirst: jest.fn(async () => products[0] ?? null),
      },
      productVariant: {
        findMany: jest.fn(async () => variants),
        findFirst: jest.fn(async () => variants[0] ?? null),
      },
      location: {
        findMany: jest.fn(async (args: any) => {
          const ids: number[] = args?.where?.id?.in ?? [];
          return locations.filter((l) => ids.includes(l.id));
        }),
        findFirst: jest.fn(async () => locations[0] ?? null),
      },
      inventory: {
        findFirst: jest.fn(async () => opts.inventoryRow ?? null),
        update: jest.fn(async (a: any) => a),
        create: jest.fn(async (a: any) => a),
      },
      auditLog: { create: jest.fn(async (a: any) => a) },
      ...(opts.extra ?? {}),
    });
    // Run the transaction callback against the same mock.
    (prisma as any).$transaction = jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    );
    return prisma;
  };

  const prepare = (prisma: any) => {
    const { service, finance, notifications } = makeService(prisma);
    (finance as any).postInventoryAdjustment = jest.fn(async () => true);
    (notifications as any).checkAndNotifyLowStock = jest.fn(
      async () => undefined,
    );
    return { service, finance, notifications };
  };

  it('requires a variant when the product has variants', async () => {
    const prisma = makeCount({ products: [variantProduct] });
    const { service } = prepare(prisma);

    await expect(
      service.adjustStock(5, { locationId: 26, quantity: 12 }, owner as any),
    ).rejects.toThrow('Select a variant to reconcile');
    expect(prisma.inventory.update).not.toHaveBeenCalled();
  });

  it('rejects a variant that belongs to another product', async () => {
    const prisma = makeCount({
      products: [variantProduct],
      variants: [{ id: 999, productId: 77, sku: 'OTHER', attributes: {} }],
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
    const prisma = makeCount({
      products: [variantProduct],
      variants: [
        {
          id: 847,
          productId: 5,
          sku: 'TES-LED-V1',
          attributes: { slot1: '9w', slot2: '3 colors' },
          reorderLevel: 0,
        },
      ],
      inventoryRow: { id: 900, quantity: 4, avgCost: 5 },
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

  it('rejects a location-bound user counting another location', async () => {
    const prisma = makeCount({
      products: [plainProduct],
      inventoryRow: { id: 902, quantity: 0, avgCost: 3 },
    });
    const { service } = prepare(prisma);
    const staff = {
      sub: 9,
      isSuperuser: false,
      locationId: 26,
      permissions: [],
    };

    await expect(
      service.adjustStock(5, { locationId: 28, quantity: 5 }, staff as any),
    ).rejects.toThrow('You can only adjust stock at your own location.');
    expect(prisma.inventory.update).not.toHaveBeenCalled();

    // Their own location still works.
    await service.adjustStock(5, { locationId: 26, quantity: 5 }, staff as any);
    expect(prisma.inventory.update).toHaveBeenCalledWith({
      where: { id: 902 },
      data: { quantity: 5 },
    });
  });

  it('still adjusts a plain product through its null-variant row', async () => {
    const prisma = makeCount({
      products: [plainProduct],
      inventoryRow: { id: 901, quantity: 2, avgCost: 4 },
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
    const prisma = makeCount({ products: [plainProduct] });
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
    const prisma = makeCount({ products: [plainProduct] });
    const { service } = prepare(prisma);
    // A location id from another business resolves to nothing.
    prisma.location.findMany = jest.fn(async () => []);

    await expect(
      service.adjustStock(5, { locationId: 999, quantity: 5 }, owner as any),
    ).rejects.toThrow('Location not found');
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [999] }, tenantId: 1 } }),
    );
    expect(prisma.inventory.update).not.toHaveBeenCalled();
    expect(prisma.inventory.create).not.toHaveBeenCalled();
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


describe('ProductsService.adjustStockBulk', () => {
  const ledPanel = {
    id: 5,
    brand: 'Test',
    baseName: 'Led panel',
    hasVariants: true,
    currentBuyPrice: 10,
    reorderLevel: 10,
  };
  const wire = {
    id: 9,
    brand: 'Kabel',
    baseName: 'Wire 2.5mm',
    hasVariants: false,
    currentBuyPrice: 12,
    reorderLevel: 5,
  };
  const variants = [
    { id: 847, productId: 5, sku: 'V847', attributes: { slot1: '9w' }, reorderLevel: 0 },
    { id: 848, productId: 5, sku: 'V848', attributes: { slot1: '12w' }, reorderLevel: 0 },
  ];
  const locations = [
    { id: 26, name: 'Sosa Store', type: 'STORE' },
    { id: 28, name: 'Negele Shop', type: 'SHOP' },
  ];

  /** inventory.findFirst is keyed per (variant, location) like the real table. */
  const make = (rows: Record<string, any> = {}, extra: any = {}) => {
    const prisma = makePrisma({
      product: { findMany: jest.fn(async () => [ledPanel, wire]) },
      productVariant: { findMany: jest.fn(async () => variants) },
      location: { findMany: jest.fn(async () => locations) },
      inventory: {
        findFirst: jest.fn(
          async (args: any) =>
            rows[
              `${args?.where?.variantId ?? 'base'}-${args?.where?.locationId}`
            ] ?? null,
        ),
        update: jest.fn(async (a: any) => a),
        create: jest.fn(async (a: any) => a),
      },
      auditLog: { create: jest.fn(async (a: any) => a) },
      ...extra,
    });
    const { service, finance, notifications } = makeService(withTx(prisma));
    (finance as any).postInventoryAdjustment = jest.fn(async () => true);
    (notifications as any).checkAndNotifyLowStock = jest.fn(
      async () => undefined,
    );
    return { service, finance, notifications, prisma };
  };

  it('applies a whole sheet and books one journal per location at the net', async () => {
    const { service, finance, notifications, prisma } = make({
      '847-26': { id: 1, quantity: 4, avgCost: 5 },
      '848-26': { id: 2, quantity: 0, avgCost: 2 },
      '847-28': { id: 3, quantity: 2, avgCost: 5 },
      'base-28': { id: 4, quantity: 10, avgCost: 12 },
    });

    const res = await service.adjustStockBulk(
      {
        batchId: 'sheet-1',
        reason: 'Monthly count',
        items: [
          { productId: 5, variantId: 847, locationId: 26, quantity: 10 },
          { productId: 5, variantId: 848, locationId: 26, quantity: 3 },
          { productId: 5, variantId: 847, locationId: 28, quantity: 4 },
          { productId: 9, locationId: 28, quantity: 6 },
        ],
      } as any,
      owner as any,
    );

    // One transaction for the whole sheet.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.inventory.update).toHaveBeenCalledTimes(4);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(4);

    expect(res.applied).toBe(4);
    expect(res.unchanged).toBe(0);
    expect(res.batchId).toBe('sheet-1');

    // Values: 847@26 +6×5=30, 848@26 +3×2=6 → 36 at store 26;
    // 847@28 +2×5=10, wire@28 −4×12=−48 → −38 at shop 28.
    const journals = (finance as any).postInventoryAdjustment.mock.calls.map(
      (c: any) => c[0],
    );
    expect(journals).toHaveLength(2);
    const at26 = journals.find((j: any) => j.ref === 'ADJ-BULK-sheet-1-26');
    const at28 = journals.find((j: any) => j.ref === 'ADJ-BULK-sheet-1-28');
    expect(at26.signedAmount).toBe(36);
    expect(at28.signedAmount).toBe(-38);

    const store26 = res.byLocation.find((l: any) => l.locationId === 26);
    expect(store26).toMatchObject({
      items: 2,
      changed: 2,
      surplusValue: 36,
      shortageValue: 0,
      netValue: 36,
      journalRef: 'ADJ-BULK-sheet-1-26',
    });
    const shop28 = res.byLocation.find((l: any) => l.locationId === 28);
    expect(shop28).toMatchObject({ items: 2, netValue: -38, surplusValue: 10, shortageValue: -48 });

    // Rows report before/after so the sheet can show what moved.
    expect(res.results[0]).toMatchObject({
      productId: 5,
      variantId: 847,
      locationId: 26,
      before: 4,
      after: 10,
      delta: 6,
      valueDelta: 30,
      lowStock: true,
    });

    // Low stock is re-evaluated once per product/location pair, not per row.
    expect((notifications as any).checkAndNotifyLowStock).toHaveBeenCalledTimes(3);
    expect((notifications as any).checkAndNotifyLowStock).toHaveBeenCalledWith(5, 26);
    expect((notifications as any).checkAndNotifyLowStock).toHaveBeenCalledWith(5, 28);
    expect((notifications as any).checkAndNotifyLowStock).toHaveBeenCalledWith(9, 28);
  });

  it('counts unchanged rows separately and books nothing for them', async () => {
    const { service, finance, prisma } = make({
      'base-26': { id: 1, quantity: 12, avgCost: 12 },
    });

    const res = await service.adjustStockBulk(
      { items: [{ productId: 9, locationId: 26, quantity: 12 }] } as any,
      owner as any,
    );

    expect(res.applied).toBe(0);
    expect(res.unchanged).toBe(1);
    expect((finance as any).postInventoryAdjustment).not.toHaveBeenCalled();
    expect(res.byLocation[0]).toMatchObject({ netValue: 0, journalRef: null });
    // The count still updates the row (idempotent) and is still audited.
    expect(prisma.inventory.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { quantity: 12 },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});


describe('ProductsService.adjustStockBulk (validation)', () => {
  const product = {
    id: 5,
    brand: 'Test',
    baseName: 'Led panel',
    hasVariants: true,
    currentBuyPrice: 10,
    reorderLevel: 10,
  };
  const wire = { ...product, id: 9, hasVariants: false, baseName: 'Wire' };
  const variants = [
    { id: 847, productId: 5, sku: 'V847', attributes: { slot1: '9w' }, reorderLevel: 0 },
  ];
  const locations = [
    { id: 26, name: 'Sosa Store', type: 'STORE' },
    // A second location of the SAME business: a bound user may see it exist but
    // not count it.
    { id: 28, name: 'Negele Shop', type: 'SHOP' },
  ];

  const make = () => {
    const prisma = makePrisma({
      product: { findMany: jest.fn(async () => [product, wire]) },
      productVariant: { findMany: jest.fn(async () => variants) },
      location: { findMany: jest.fn(async () => locations) },
      inventory: {
        findFirst: jest.fn(async () => ({ id: 1, quantity: 4, avgCost: 5 })),
        update: jest.fn(async (a: any) => a),
        create: jest.fn(async (a: any) => a),
      },
      auditLog: { create: jest.fn(async (a: any) => a) },
    });
    const { service, finance, notifications } = makeService(withTx(prisma));
    (finance as any).postInventoryAdjustment = jest.fn(async () => true);
    (notifications as any).checkAndNotifyLowStock = jest.fn(
      async () => undefined,
    );
    return { service, finance, notifications, prisma };
  };

  /** Every failure must leave the books untouched. */
  const expectNoWrites = (prisma: any, finance: any) => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.inventory.update).not.toHaveBeenCalled();
    expect(prisma.inventory.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect((finance as any).postInventoryAdjustment).not.toHaveBeenCalled();
  };

  it('rejects the whole sheet when any row is bad, naming each by index', async () => {
    const { service, finance, prisma } = make();

    const call = service.adjustStockBulk(
      {
        items: [
          { productId: 5, variantId: 847, locationId: 26, quantity: 9 },
          { productId: 9, locationId: 999, quantity: 5 },
          { productId: 404, locationId: 26, quantity: 1 },
        ],
      } as any,
      owner as any,
    );

    const err: any = await call.catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().errors).toEqual([
      { index: 1, productId: 9, variantId: null, locationId: 999, message: 'Location not found' },
      { index: 2, productId: 404, variantId: null, locationId: 26, message: 'Product not found' },
    ]);
    expectNoWrites(prisma, finance);
  });

  it('rejects the same product, variant and location listed twice', async () => {
    const { service, finance, prisma } = make();

    const call = service.adjustStockBulk(
      {
        items: [
          { productId: 5, variantId: 847, locationId: 26, quantity: 4 },
          { productId: 5, variantId: 847, locationId: 26, quantity: 7 },
        ],
      } as any,
      owner as any,
    );

    const err: any = await call.catch((e) => e);
    expect(err.getResponse().errors[0]).toMatchObject({
      index: 1,
      message: expect.stringContaining('listed twice'),
    });
    expectNoWrites(prisma, finance);
  });

  it('requires a variant on every row of a variant product', async () => {
    const { service, prisma } = make();

    const call = service.adjustStockBulk(
      { items: [{ productId: 5, locationId: 26, quantity: 5 }] } as any,
      owner as any,
    );

    const err: any = await call.catch((e) => e);
    expect(err.getResponse().errors[0]).toMatchObject({
      index: 0,
      message:
        'Select a variant to reconcile — this product keeps stock per variant.',
    });
    expect(prisma.inventory.update).not.toHaveBeenCalled();
  });

  it('blocks a location-bound user from counting another location', async () => {
    const { service, finance, prisma } = make();
    const staff = { sub: 9, isSuperuser: false, locationId: 26, permissions: [] };

    const call = service.adjustStockBulk(
      { items: [{ productId: 9, locationId: 28, quantity: 5 }] } as any,
      staff as any,
    );

    const err: any = await call.catch((e) => e);
    expect(err.getResponse().errors[0]).toMatchObject({
      index: 0,
      message: 'You can only adjust stock at your own location.',
    });
    expectNoWrites(prisma, finance);
  });

  it('echoes a client batch id and generates one when the sheet omits it', async () => {
    const first = make();
    const withId = await first.service.adjustStockBulk(
      {
        batchId: 'count-42',
        items: [{ productId: 9, locationId: 26, quantity: 6 }],
      } as any,
      owner as any,
    );
    expect(withId.batchId).toBe('count-42');
    expect(
      (first.finance as any).postInventoryAdjustment.mock.calls[0][0].ref,
    ).toBe('ADJ-BULK-count-42-26');

    const second = make();
    const generated = await second.service.adjustStockBulk(
      { items: [{ productId: 9, locationId: 26, quantity: 6 }] } as any,
      owner as any,
    );
    expect(generated.batchId).toBeTruthy();
    expect(
      (second.finance as any).postInventoryAdjustment.mock.calls[0][0].ref,
    ).toBe(`ADJ-BULK-${generated.batchId}-26`);
  });
});



describe('ProductsService.stockLookup', () => {
  const product = {
    id: 5,
    sku: 'ABC',
    brand: 'Test',
    baseName: 'Led panel',
    hasVariants: true,
    currentBuyPrice: 10,
    currentSellPrice: 20,
    reorderLevel: 10,
    variants: [{ id: 847, sku: 'V847', attributes: { slot1: '9w' } }],
  };

  const make = () => {
    const prisma = makePrisma({
      product: { findMany: jest.fn(async () => [product]) },
      inventory: {
        findMany: jest.fn(async () => [
          { productId: 5, variantId: 847, locationId: 26, quantity: 4, avgCost: 5 },
        ]),
      },
    });
    const { service } = makeService(withTx(prisma));
    return { service, prisma };
  };

  it('returns the products with their variants plus the matching stock rows', async () => {
    const { service, prisma } = make();

    const res = await service.stockLookup([5], [26], owner as any);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [5] }, tenantId: 1 } }),
    );
    expect(prisma.inventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 1,
          productId: { in: [5] },
          locationId: { in: [26] },
        },
      }),
    );
    expect(res.products).toHaveLength(1);
    expect(res.stock).toHaveLength(1);
  });

  it('never exposes another location to a bound user', async () => {
    const { service, prisma } = make();
    const staff = { sub: 9, isSuperuser: false, locationId: 26, permissions: [] };

    await service.stockLookup([5], [26, 28], staff as any);

    expect(prisma.inventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ locationId: { in: [26] } }),
      }),
    );
  });

  it('returns no stock rows when no location is asked for', async () => {
    const { service, prisma } = make();

    const res = await service.stockLookup([5], [], owner as any);

    expect(prisma.inventory.findMany).not.toHaveBeenCalled();
    expect(res.products).toHaveLength(1);
    expect(res.stock).toEqual([]);
  });

  it('releases another location to a holder of inventory.all-locations', async () => {
    const { service, prisma } = make();
    const storekeeper = {
      sub: 9,
      isSuperuser: false,
      locationId: 26,
      permissions: ['inventory.all-locations'],
    };

    await service.stockLookup([5], [26, 28], storekeeper as any);

    expect(prisma.inventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ locationId: { in: [26, 28] } }),
      }),
    );
  });
});
describe('ProductsService.adjustStockBulk (selling prices)', () => {
  const ledPanel = {
    id: 5,
    brand: 'Test',
    baseName: 'Led panel',
    hasVariants: true,
    currentBuyPrice: 10,
    currentSellPrice: 20,
    reorderLevel: 10,
  };
  const wire = {
    id: 9,
    brand: 'Kabel',
    baseName: 'Wire 2.5mm',
    hasVariants: false,
    currentBuyPrice: 12,
    currentSellPrice: 18,
    reorderLevel: 5,
  };
  // Only 847 is recounted below; 848 keeps its price so the parent's average
  // can be checked.
  const variants = [
    { id: 847, productId: 5, sku: 'V847', attributes: { slot1: '9w' }, reorderLevel: 0, buyPrice: 7, sellPrice: 30 },
    { id: 848, productId: 5, sku: 'V848', attributes: { slot1: '12w' }, reorderLevel: 0, buyPrice: 3, sellPrice: 15 },
  ];
  const locations = [
    { id: 26, name: 'Sosa Store', type: 'STORE' },
    { id: 28, name: 'Negele Shop', type: 'SHOP' },
  ];

  const make = () => {
    const prisma = makePrisma({
      product: {
        findMany: jest.fn(async () => [ledPanel, wire]),
        findFirst: jest.fn(async (args: any) =>
          args?.where?.id === 5
            ? { id: 5, currentBuyPrice: 10, currentSellPrice: 20 }
            : { id: 9, currentBuyPrice: 12, currentSellPrice: 18 },
        ),
        update: jest.fn(async (a: any) => a),
      },
      productVariant: {
        findMany: jest.fn(async () => variants),
        // the read taken just before a variant is repriced
        findFirst: jest.fn(async () => ({ buyPrice: 7, sellPrice: 20 })),
        update: jest.fn(async (a: any) => a),
      },
      location: { findMany: jest.fn(async () => locations) },
      inventory: {
        findFirst: jest.fn(async () => ({ id: 1, quantity: 4, avgCost: 5 })),
        update: jest.fn(async (a: any) => a),
        create: jest.fn(async (a: any) => a),
      },
      auditLog: { create: jest.fn(async (a: any) => a) },
      priceHistory: { create: jest.fn(async (a: any) => a) },
    });
    const { service, finance, notifications } = makeService(withTx(prisma));
    (finance as any).postInventoryAdjustment = jest.fn(async () => true);
    (notifications as any).checkAndNotifyLowStock = jest.fn(
      async () => undefined,
    );
    return { service, finance, notifications, prisma };
  };



  it('moves a variant selling price and leaves the buying price alone', async () => {
    const { service, prisma } = make();

    const res = await service.adjustStockBulk(
      {
        items: [
          { productId: 5, variantId: 847, locationId: 26, quantity: 7, sellPrice: 30 },
        ],
      } as any,
      owner as any,
    );

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 847 },
      data: { sellPrice: 30 },
    });
    expect(
      prisma.productVariant.update.mock.calls[0][0].data.buyPrice,
    ).toBeUndefined();
    // The product's own number stays the variants' AVERAGE sell price.
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { currentSellPrice: 22.5 },
    });
    expect(JSON.stringify(prisma.product.update.mock.calls)).not.toContain(
      'currentBuyPrice',
    );

    // One history row per price that moved: variant, then the parent average.
    expect(prisma.priceHistory.create).toHaveBeenCalledTimes(2);
    expect(
      prisma.priceHistory.create.mock.calls.map((c: any) => c[0].data.source),
    ).toEqual(['COUNT', 'COUNT']);
    expect(prisma.priceHistory.create.mock.calls[0][0].data).toMatchObject({
      productId: 5,
      variantId: 847,
      oldBuyPrice: 7,
      newBuyPrice: 7,
      oldSellPrice: 20,
      newSellPrice: 30,
      updatedById: 1,
    });
    expect(res.priceUpdates).toBe(2);
  });

  it('reprices a plain product while counting it', async () => {
    const { service, prisma } = make();

    const res = await service.adjustStockBulk(
      { items: [{ productId: 9, locationId: 26, quantity: 6, sellPrice: 21 }] } as any,
      owner as any,
    );

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { currentSellPrice: 21 },
    });
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
    expect(prisma.priceHistory.create).toHaveBeenCalledTimes(1);
    expect(prisma.priceHistory.create.mock.calls[0][0].data).toMatchObject({
      productId: 9,
      variantId: null,
      oldBuyPrice: 12,
      newBuyPrice: 12,
      oldSellPrice: 18,
      newSellPrice: 21,
    });
    expect(res.priceUpdates).toBe(1);
  });

  it('writes nothing when the counted price is unchanged', async () => {
    const { service, prisma } = make();

    const res = await service.adjustStockBulk(
      { items: [{ productId: 9, locationId: 26, quantity: 6, sellPrice: 18 }] } as any,
      owner as any,
    );

    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.priceHistory.create).not.toHaveBeenCalled();
    expect(res.priceUpdates).toBe(0);
  });

  it('refuses a selling price from a user who cannot edit products', async () => {
    const { service, prisma } = make();
    const shopkeeper = {
      sub: 9,
      isSuperuser: false,
      locationId: 26,
      permissions: ['products.adjust-stock'],
    };

    const err: any = await service
      .adjustStockBulk(
        {
          items: [
            { productId: 5, variantId: 847, locationId: 26, quantity: 7, sellPrice: 30 },
          ],
        } as any,
        shopkeeper as any,
      )
      .catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().errors[0]).toMatchObject({
      index: 0,
      message: 'You cannot change selling prices.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.priceHistory.create).not.toHaveBeenCalled();
  });

  it('refuses the same item priced two ways in one sheet', async () => {
    const { service, prisma } = make();

    const err: any = await service
      .adjustStockBulk(
        {
          items: [
            { productId: 5, variantId: 847, locationId: 26, quantity: 7, sellPrice: 30 },
            { productId: 5, variantId: 847, locationId: 28, quantity: 2, sellPrice: 10 },
          ],
        } as any,
        owner as any,
      )
      .catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().errors[0]).toMatchObject({
      index: 1,
      message: expect.stringContaining('two different selling prices'),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets a holder of inventory.all-locations count another location', async () => {
    const { service } = make();
    const storekeeper = {
      sub: 9,
      isSuperuser: false,
      locationId: 26,
      permissions: ['products.adjust-stock', 'inventory.all-locations'],
    };

    const res = await service.adjustStockBulk(
      { items: [{ productId: 5, variantId: 847, locationId: 28, quantity: 2 }] } as any,
      storekeeper as any,
    );

    expect(res.results[0]).toMatchObject({ locationId: 28, after: 2 });
  });
});
