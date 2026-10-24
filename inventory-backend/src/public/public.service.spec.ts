// src/public/public.service.spec.ts
// The public surface must be token-scoped, whitelist-only, and refuse orders to
// blocklisted phones / non-live entries.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PublicService } from './public.service';

function makeService(
  opts: {
    entry?: any;
    items?: any[];
    product?: any;
    blocked?: boolean;
  } = {},
) {
  const created: any = {};
  const entry = opts.entry ?? {
    id: 1,
    token: 'tok',
    tenantId: 9,
    kind: 'SHOP',
    label: 'Shop',
    active: true,
    state: 'LIVE',
    liveFrom: null,
    liveUntil: null,
    table: null,
  };
  const prisma: any = {
    publicEntry: { findUnique: jest.fn(() => Promise.resolve(entry)) },
    organization: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          name: 'Biz',
          businessType: 'RETAIL',
          enabledHospitalityServices: [],
        }),
      ),
    },
    tenantFiscalConfig: { findUnique: jest.fn(() => Promise.resolve(null)) },
    publicEntryItem: {
      findMany: jest.fn(() => Promise.resolve(opts.items ?? [])),
    },
    product: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          opts.product ?? {
            id: 483,
            brand: 'A',
            baseName: 'B',
            currentSellPrice: 12,
          },
        ),
      ),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    menuItem: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    serviceItem: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    roomType: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    hotelReservation: { findMany: jest.fn(() => Promise.resolve([])) },
    guestBlocklist: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts.blocked ? { id: 1 } : null),
      ),
    },
    customer: { findFirst: jest.fn(() => Promise.resolve(null)) },
    guestOrder: {
      create: jest.fn(({ data }: any) => {
        created.data = data;
        return Promise.resolve({ id: 5, ...data });
      }),
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 5,
          status: 'SUBMITTED',
          totalAmount: 24,
          entry: { label: 'Shop' },
          createdAt: new Date(),
        }),
      ),
    },
  };
  const notifications: any = { notifyOwner: jest.fn(() => Promise.resolve()) };
  const svc = new PublicService(prisma, notifications, {
    maybeAutoApprove: jest.fn(() => Promise.resolve()),
  } as any);
  return { svc, prisma, notifications, created };
}

describe('PublicService', () => {
  it('resolves a token to a whitelisted catalog with no internal ids leaked as top-level', async () => {
    const { svc, prisma } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
    });
    const view = await svc.view('tok');
    expect(view.state).toBe('LIVE');
    expect(view.items).toHaveLength(1);
    expect(view.items[0].ref).toBe('PRODUCT:483');
    // Only public-safe fields exist on the item.
    expect(Object.keys(view.items[0]).sort()).toEqual(
      ['description', 'image', 'kind', 'name', 'price', 'ref'].sort(),
    );
    expect(prisma.publicEntry.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'tok' } }),
    );
  });

  it('404s an unknown token', async () => {
    const { svc, prisma } = makeService();
    prisma.publicEntry.findUnique = jest.fn(() => Promise.resolve(null));
    await expect(svc.view('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns no catalog when the entry is HELD', async () => {
    const { svc } = makeService({
      entry: {
        id: 1,
        token: 'tok',
        tenantId: 9,
        kind: 'SHOP',
        label: 'X',
        active: true,
        state: 'HELD',
        liveFrom: null,
        liveUntil: null,
        table: null,
      },
      items: [{ itemKind: 'PRODUCT', itemId: 483 }],
    });
    const view = await svc.view('tok');
    expect(view.state).toBe('HELD');
    expect(view.items).toHaveLength(0);
  });

  it('refuses an order from a blocklisted phone', async () => {
    const { svc } = makeService({ blocked: true });
    await expect(
      svc.submit('tok', {
        items: [{ ref: 'PRODUCT:483', quantity: 1 }],
        customerPhone: '0911',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unknown item ref', async () => {
    const { svc } = makeService({ items: [] });
    await expect(
      svc.submit('tok', { items: [{ ref: 'PRODUCT:999', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('auto-publishes the tenant catalog when no items are curated', async () => {
    const { svc, prisma } = makeService({ items: [] });
    prisma.product.findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: 1,
          brand: 'N',
          baseName: 'Shoe',
          currentSellPrice: 20,
          imageUrl: null,
          variants: [],
        },
      ]),
    );
    const view = await svc.view('tok');
    expect(view.items).toHaveLength(1);
    expect(view.items[0].ref).toBe('PRODUCT:1');
    expect(view.items[0].price).toBe(20);
  });

  it('submits a valid order and notifies the privileged users', async () => {
    const { svc, created, notifications } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
    });
    const res = await svc.submit('tok', {
      items: [{ ref: 'PRODUCT:483', quantity: 2 }],
      customerName: 'Guest',
      customerPhone: '0911223344',
    });
    expect(res.status).toBe('SUBMITTED');
    expect(created.data.status).toBe('SUBMITTED');
    expect(created.data.items.create).toHaveLength(1);
    expect(created.data.items.create[0].unitPrice).toBe(12);
    expect(notifications.notifyOwner).toHaveBeenCalled();
  });

  const unitProduct = (extra: any = {}) => ({
    id: 483,
    brand: 'A',
    baseName: 'B',
    currentSellPrice: 1200,
    imageUrl: null,
    category: { name: 'Beverages' },
    units: [
      {
        unitId: 1,
        perBase: 1,
        isBase: true,
        isDefaultSale: true,
        sellPrice: null,
        buyPrice: null,
        unit: { name: 'Box', symbol: 'box' },
      },
      {
        unitId: 2,
        perBase: 24,
        isBase: false,
        isDefaultSale: false,
        sellPrice: null,
        buyPrice: null,
        unit: { name: 'Piece', symbol: 'pc' },
      },
    ],
    variants: [],
    ...extra,
  });

  it('exposes each unit with its own price and the category', async () => {
    const { svc } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
      product: unitProduct(),
    });
    const view = await svc.view('tok');

    expect(view.items[0].category).toBe('Beverages');
    expect(view.items[0].units?.map((u) => [u.name, u.price])).toEqual([
      ['Box', 1200],
      ['Piece', 50],
    ]);
  });

  it('lets a per-unit override replace the converted default', async () => {
    const product = unitProduct();
    product.units[1].sellPrice = 55;
    const { svc } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
      product,
    });
    const view = await svc.view('tok');

    expect(view.items[0].units?.find((u) => u.unitId === 2)?.price).toBe(55);
  });

  it('uses a variant per-unit override for that variant', async () => {
    const product = unitProduct({
      variants: [
        {
          id: 7,
          attributes: { slot1: 'Red' },
          sellPrice: 1000,
          imageUrl: null,
          unitPrices: { '2': { sellPrice: 45 } },
        },
      ],
    });
    const { svc } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
      product,
    });
    const view = await svc.view('tok');
    const variant = view.items[0].variants?.[0];

    expect(variant?.units?.find((u) => u.unitId === 1)?.price).toBe(1000);
    expect(variant?.units?.find((u) => u.unitId === 2)?.price).toBe(45);
  });

  it('stores the guest-selected unit and its own price', async () => {
    const { svc, created } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
      product: unitProduct(),
    });
    await svc.submit('tok', {
      items: [{ ref: 'PRODUCT:483', quantity: 2, unitId: 1 }],
      customerName: 'Guest',
      customerPhone: '0911223344',
    });

    expect(created.data.items.create[0]).toMatchObject({
      unitId: 1,
      unitNameSnapshot: 'Box',
      unitPrice: 1200,
      quantity: 2,
      variantId: null,
    });
  });

  it('stores the variant and unit for a variant ref', async () => {
    const product = unitProduct({
      variants: [
        {
          id: 7,
          attributes: { slot1: 'Red' },
          sellPrice: 1000,
          imageUrl: null,
          unitPrices: { '2': { sellPrice: 45 } },
        },
      ],
    });
    const { svc, created } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
      product,
    });
    await svc.submit('tok', {
      items: [{ ref: 'PRODUCT:483:VARIANT:7', quantity: 3, unitId: 2 }],
      customerName: 'Guest',
      customerPhone: '0911223344',
    });

    expect(created.data.items.create[0]).toMatchObject({
      itemId: 483,
      variantId: 7,
      unitId: 2,
      unitNameSnapshot: 'Piece',
      unitPrice: 45,
      quantity: 3,
    });
  });

  it('rejects a unit the product does not offer', async () => {
    const { svc } = makeService({
      items: [{ itemKind: 'PRODUCT', itemId: 483, priceOverride: null }],
      product: unitProduct(),
    });
    await expect(
      svc.submit('tok', {
        items: [{ ref: 'PRODUCT:483', quantity: 1, unitId: 99 }],
        customerName: 'Guest',
        customerPhone: '0911223344',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
