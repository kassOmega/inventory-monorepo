import { NotificationsService } from './notifications.service';

// --- Fixtures ---------------------------------------------------------------

const product = (over: Record<string, unknown> = {}) => ({
  brand: 'Nike',
  baseName: 'Air',
  reorderLevel: 10,
  reorderQty: null,
  ...over,
});

const variant = (over: Record<string, unknown> = {}) => ({
  id: 500,
  sku: 'NIKE-V1',
  attributes: { slot1: '42', slot2: 'Black' },
  reorderLevel: 3,
  reorderQty: 20,
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  productId: 100,
  variantId: null,
  locationId: 7,
  quantity: 4,
  product: product(),
  variant: null,
  location: { id: 7, name: 'Sosa Branch', tenantId: 21 },
  ...over,
});

/** Matches only the scalar keys the service actually filters on. */
const matches = (stored: any, where: any) =>
  Object.entries(where).every(([key, value]) =>
    key === 'id' ? true : stored[key] === value,
  );

const makePrisma = (rows: any[], openAlerts: any[] = []) => {
  const notifications: any[] = [...openAlerts];
  return {
    inventory: { findMany: jest.fn(async () => rows) },
    role: { findFirst: jest.fn(async () => ({ id: 9 })) },
    user: { count: jest.fn(async () => 2) },
    notification: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          notifications.find((n) => matches(n, where)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        notifications.filter((n) => matches(n, where)),
      ),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: notifications.length + 1, ...data };
        notifications.push(created);
        return created;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const target = notifications.find((n) => n.id === where.id);
        Object.assign(target, data);
        return target;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ids: number[] = where.id?.in ?? [];
        let count = 0;
        for (const n of notifications) {
          if (ids.includes(n.id)) {
            Object.assign(n, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
  };
};

const makePush = () => ({
  sendToLocation: jest.fn(async () => undefined),
  sendToRoleId: jest.fn(async () => undefined),
  sendToUser: jest.fn(async () => undefined),
});

const build = (rows: any[], openAlerts: any[] = []) => {
  const prisma = makePrisma(rows, openAlerts);
  const push = makePush();
  const svc = new NotificationsService(prisma as never, push as never);
  return { svc, prisma, push };
};

const createdRows = (prisma: any) =>
  prisma.notification.create.mock.calls.map((c: any) => c[0].data);

// --- Tests ------------------------------------------------------------------

describe('NotificationsService.checkAndNotifyLowStock', () => {
  afterEach(() => jest.clearAllMocks());

  it('alerts per variant using the variant own number and label', async () => {
    const { svc, prisma, push } = build([
      row({ variantId: 500, variant: variant(), quantity: 2 }),
    ]);

    await svc.checkAndNotifyLowStock(100, 7);

    const created = createdRows(prisma);
    expect(created).toHaveLength(2);
    const owner = created.find((d: any) => d.targetRoleId === 9);
    const location = created.find((d: any) => d.targetLocationId === 7);
    expect(owner).toMatchObject({
      type: 'LOW_STOCK',
      variantId: 500,
      productId: 100,
      locationId: 7,
      threshold: 3,
    });
    expect(owner.message).toContain('Nike Air (42 / Black)');
    expect(owner.message).toContain('alert level 3');
    expect(location.threshold).toBe(3);
    expect(push.sendToLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('alert level 3'),
      }),
      7,
    );
  });

  it('falls back to the product number when the variant has none', async () => {
    const { svc, prisma } = build([
      row({
        variantId: 500,
        variant: variant({ reorderLevel: 0 }),
        quantity: 9,
      }),
    ]);

    await svc.checkAndNotifyLowStock(100, 7);

    const created = createdRows(prisma);
    expect(created[0]).toMatchObject({ variantId: 500, threshold: 10 });
    expect(created[0].message).toContain('alert level 10');
  });

  it('keeps a plain product alert on its own row', async () => {
    const { svc, prisma } = build([row({ quantity: 3 })]);

    await svc.checkAndNotifyLowStock(100, 7);

    const created = createdRows(prisma);
    expect(created[0]).toMatchObject({ variantId: null, threshold: 10 });
    expect(created[0].message).toContain('Nike Air is running low');
  });

  it('coalesces into the open alert instead of duplicating it', async () => {
    const openOwner = {
      id: 1,
      type: 'LOW_STOCK',
      tenantId: 21,
      productId: 100,
      variantId: 500,
      locationId: 7,
      targetRoleId: 9,
      targetLocationId: null,
      threshold: 3,
      message: 'stale text',
      isRead: false,
    };
    const openLocation = {
      ...openOwner,
      id: 2,
      targetRoleId: null,
      targetLocationId: 7,
      message: 'stale text',
    };
    const { svc, prisma, push } = build(
      [row({ variantId: 500, variant: variant(), quantity: 2 })],
      [openOwner, openLocation],
    );

    await svc.checkAndNotifyLowStock(100, 7);

    // Both open alerts were refreshed in place; nothing new was created.
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ threshold: 3 }),
      }),
    );
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 } }),
    );
    expect(openOwner.message).toContain('alert level 3');
    expect(prisma.notification.create).not.toHaveBeenCalled();
    // Nothing new was raised → no device push (coalesced updates stay silent).
    expect(push.sendToLocation).not.toHaveBeenCalled();
  });

  it('auto-resolves alerts once stock is back at the number', async () => {
    const open = {
      id: 1,
      type: 'LOW_STOCK',
      tenantId: 21,
      productId: 100,
      variantId: 500,
      locationId: 7,
      targetRoleId: 9,
      targetLocationId: null,
      threshold: 3,
      message: 'old',
      isRead: false,
    };
    const { svc, prisma } = build(
      [row({ variantId: 500, variant: variant(), quantity: 3 })],
      [open],
    );

    await svc.checkAndNotifyLowStock(100, 7);

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: { isRead: true },
    });
    expect(open.isRead).toBe(true);
  });

  it('never alerts when the number is 0, and closes a stale alert', async () => {
    const open = {
      id: 1,
      type: 'LOW_STOCK',
      tenantId: 21,
      productId: 100,
      variantId: null,
      locationId: 7,
      targetRoleId: 9,
      targetLocationId: null,
      threshold: 5,
      message: 'old',
      isRead: false,
    };
    const { svc, prisma } = build(
      [row({ product: product({ reorderLevel: 0 }), quantity: 0 })],
      [open],
    );

    await svc.checkAndNotifyLowStock(100, 7);

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(open.isRead).toBe(true);
  });
});
