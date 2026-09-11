// src/restaurant/restaurant.service.spec.ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderItemStatus, OrderStatus } from '@prisma/client';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { RestaurantService } from './restaurant.service';

// advanceItem / syncOrderStatus query the current tenant; there is no
// request-scoped tenant context in unit tests.
jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
}));

/**
 * Order/item status ownership:
 *  - orders are auto-dispatched when placed (no "send to station" step),
 *  - stations prepare (PREPARING) and make ready (READY) — never serve,
 *  - waiters serve (SERVED) only items the station made ready,
 *  - managers/owners/superusers may take any action,
 *  - the order-level status is derived from its items so all users agree.
 */
describe('RestaurantService order/item status flow', () => {
  const kitchenItem = {
    id: 10,
    orderId: 1,
    stationKey: 'kitchen',
    stationName: 'Kitchen',
    status: 'QUEUED',
    stationIndex: 0,
    stationRoute: [
      { id: 1, name: 'Kitchen', key: 'kitchen' },
      { id: 2, name: 'Bar', key: 'bar' },
    ],
  };
  const barItem = { id: 11, orderId: 1, stationKey: 'bar', status: 'QUEUED', stationIndex: 0, stationRoute: [] };
  const butcherItem = { id: 12, orderId: 2, stationKey: 'butcher', status: 'QUEUED', stationIndex: 0, stationRoute: [] };
  const noStationItem = { id: 13, orderId: 3, stationKey: null, status: 'QUEUED', stationIndex: 0, stationRoute: [] };

  const orders: Record<number, any> = {
    1: { id: 1, orderNumber: 'ORD-1', createdById: 5, status: 'DISPATCHED', items: [kitchenItem, barItem] },
    2: { id: 2, orderNumber: 'ORD-2', createdById: 5, status: 'DISPATCHED', items: [butcherItem] },
    3: { id: 3, orderNumber: 'ORD-3', createdById: 5, status: 'DISPATCHED', items: [noStationItem] },
  };
  const itemById: Record<number, any> = {
    10: kitchenItem,
    11: barItem,
    12: butcherItem,
    13: noStationItem,
  };

  const prisma = {
    orderItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    restaurantStation: { findFirst: jest.fn(), findMany: jest.fn() },
    menuItem: { findUnique: jest.fn() },
    diningTable: { update: jest.fn() },
    orderPayment: { create: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    user: { findUnique: jest.fn() },
    organization: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const notifications = { notifyUser: jest.fn(), notifyRole: jest.fn() };
  const finance = {};
  const recipes = {
    liveMenuItemCost: jest.fn(async () => null),
    recalcMenuItemCost: jest.fn(async () => false),
    setRecipe: jest.fn(),
    getRecipe: jest.fn(),
  };

  const service = new RestaurantService(
    prisma as any,
    notifications as any,
    finance as any,
    recipes as any,
  );

  const resetFixtures = () => {
    kitchenItem.status = 'QUEUED';
    kitchenItem.stationIndex = 0;
    kitchenItem.stationKey = 'kitchen';
    kitchenItem.stationName = 'Kitchen';
    barItem.status = 'QUEUED';
    butcherItem.status = 'QUEUED';
    noStationItem.status = 'QUEUED';
    orders[1].status = 'DISPATCHED';
    orders[2].status = 'DISPATCHED';
    orders[3].status = 'DISPATCHED';
  };

  const payload = (overrides: Partial<JwtPayload>): JwtPayload =>
    ({
      sub: 1,
      email: 'staff@example.com',
      roleId: null,
      roleName: null,
      isSuperuser: false,
      isPlatformAdmin: false,
      isOwnerAccount: false,
      permissions: [],
      locationId: null,
      locationType: null,
      organizationId: 1,
      businessType: 'HOSPITALITY',
      memberships: [],
      verificationStatus: 'VERIFIED',
      verificationNote: null,
      verificationAttempts: 0,
      ...overrides,
    }) as JwtPayload;
  beforeEach(() => {
    jest.clearAllMocks();
    resetFixtures();

    prisma.orderItem.findUnique.mockImplementation(
      ({ where }: { where: { id: number } }) => itemById[where.id] ?? null,
    );
    prisma.orderItem.update.mockImplementation(({ where, data }: any) => {
      Object.assign(itemById[where.id], data);
      return Promise.resolve(itemById[where.id]);
    });
    prisma.orderItem.updateMany.mockImplementation(({ where, data }: any) => {
      let count = 0;
      for (const id of where?.id?.in ?? []) {
        const it = itemById[id];
        if (it) {
          it.status = data.status;
          count++;
        }
      }
      return Promise.resolve({ count });
    });
    prisma.order.findUnique.mockImplementation(({ where, select, include }: any) => {
      const o = orders[where.id];
      if (!o) return null;
      if (select && !include) {
        return { createdById: o.createdById, orderNumber: o.orderNumber };
      }
      return o;
    });
    prisma.order.update.mockImplementation(({ where, data }: any) => {
      const o = orders[where.id];
      if (o) {
        if (data.status) o.status = data.status;
        return Promise.resolve(o);
      }
      return Promise.resolve({});
    });
    prisma.order.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(orders[where.id] ?? null),
    );
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 99,
        orderNumber: data.orderNumber,
        status: data.status,
        items: (data.items?.create ?? []).map((it: any, idx: number) => ({
          ...it,
          id: idx + 1,
        })),
      }),
    );
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.restaurantStation.findFirst.mockResolvedValue(null);
    prisma.restaurantStation.findMany.mockResolvedValue([]);
    prisma.orderStatusHistory.create.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ name: 'Daniel' });
    prisma.organization.findUnique.mockResolvedValue({ settings: {} });
  });

  describe('createOrder (auto-dispatch)', () => {
    it('creates the order as DISPATCHED and notifies the first-hop stations', async () => {
      const menuItem = {
        id: 1,
        name: 'Steak',
        price: 10,
        cost: 5,
        stationRoute: null,
        menuCategory: {
          stationRoute: [{ id: 1, name: 'Kitchen', key: 'kitchen' }],
        },
      };
      prisma.menuItem.findUnique.mockResolvedValue(menuItem);
      prisma.restaurantStation.findMany.mockResolvedValue([
        { key: 'kitchen', name: 'Kitchen', roleName: 'Chef' },
      ]);

      const waiter = payload({ permissions: ['restaurant.take-orders'] });
      const result = await service.createOrder(
        { items: [{ menuItemId: 1, quantity: 2 }], clientRef: 'ref-1' } as any,
        waiter,
      );

      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.DISPATCHED }),
        }),
      );
      expect(notifications.notifyRole).toHaveBeenCalledWith(
        'Chef',
        expect.any(String),
        expect.stringContaining('Kitchen'),
        'ORDER_STATUS',
        '/dashboard/restaurant',
      );
      expect(result).toEqual(expect.objectContaining({ status: OrderStatus.DISPATCHED }));
      // The DISPATCHED milestone is written to the audit trail with the actor.
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.DISPATCHED,
            actorId: 1,
            actorName: 'Daniel',
          }),
        }),
      );
    });
  });

  describe('updateItemStatus', () => {
    it('blocks a waiter from preparing items at a station', async () => {
      const waiter = payload({
        permissions: [
          'dashboard.view',
          'restaurant.view',
          'restaurant.take-orders',
          'restaurant.serve',
          'restaurant.settle',
        ],
      });

      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, waiter),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
    });

    it('blocks a plain viewer from changing item statuses', async () => {
      const viewer = payload({ permissions: ['dashboard.view', 'restaurant.view'] });

      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, viewer),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a chef prepare and make ready at the kitchen but never serve', async () => {
      const chef = payload({
        permissions: ['dashboard.view', 'restaurant.view', 'kitchen.view', 'kitchen.update'],
      });

      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, chef),
      ).resolves.toEqual({ orderId: 1, itemId: 10, status: OrderItemStatus.PREPARING });
      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.READY, chef),
      ).resolves.toEqual({ orderId: 1, itemId: 10, status: OrderItemStatus.READY });

      // Stations never serve.
      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.SERVED, chef),
      ).rejects.toThrow(ForbiddenException);

      // And a chef cannot touch another station's items.
      await expect(
        service.updateItemStatus(1, 11, OrderItemStatus.PREPARING, chef),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a barman update items sitting at the bar only', async () => {
      const barman = payload({
        permissions: ['dashboard.view', 'restaurant.view', 'bar.view', 'bar.update'],
      });

      await expect(
        service.updateItemStatus(1, 11, OrderItemStatus.PREPARING, barman),
      ).resolves.toEqual({ orderId: 1, itemId: 11, status: OrderItemStatus.PREPARING });

      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, barman),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a custom-station member update items at their station only', async () => {
      const butcher = payload({
        permissions: [
          'dashboard.view',
          'restaurant.view',
          'station.butcher.view',
          'station.butcher.update',
        ],
      });

      await expect(
        service.updateItemStatus(2, 12, OrderItemStatus.PREPARING, butcher),
      ).resolves.toEqual({ orderId: 2, itemId: 12, status: OrderItemStatus.PREPARING });

      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, butcher),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a waiter serve only items the station made ready', async () => {
      const waiter = payload({ permissions: ['restaurant.view', 'restaurant.serve'] });

      // Cannot serve an item that is not ready yet.
      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.SERVED, waiter),
      ).rejects.toThrow(ForbiddenException);
      // Cannot prepare or make ready from the waiter screen.
      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, waiter),
      ).rejects.toThrow(ForbiddenException);

      // Once the station makes it ready, the waiter serves it.
      kitchenItem.status = 'READY';
      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.SERVED, waiter),
      ).resolves.toEqual({ orderId: 1, itemId: 10, status: OrderItemStatus.SERVED });
    });

    it('lets a manager change any item status at any station', async () => {
      const manager = payload({
        permissions: ['dashboard.view', 'restaurant.view', 'restaurant.manage'],
      });

      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.SERVED, manager),
      ).resolves.toEqual({ orderId: 1, itemId: 10, status: OrderItemStatus.SERVED });

      await expect(
        service.updateItemStatus(2, 12, OrderItemStatus.READY, manager),
      ).resolves.toEqual({ orderId: 2, itemId: 12, status: OrderItemStatus.READY });
    });

    it('lets a superuser change any item status at any station', async () => {
      const superuser = payload({ isSuperuser: true, permissions: [] });

      await expect(
        service.updateItemStatus(1, 10, OrderItemStatus.READY, superuser),
      ).resolves.toEqual({ orderId: 1, itemId: 10, status: OrderItemStatus.READY });
    });

    it('blocks everyone but managers/superusers from items with no station', async () => {
      const waiter = payload({ permissions: ['restaurant.view', 'restaurant.serve'] });
      const chef = payload({ permissions: ['restaurant.view', 'kitchen.update'] });
      const manager = payload({ permissions: ['restaurant.manage'] });

      await expect(
        service.updateItemStatus(3, 13, OrderItemStatus.PREPARING, waiter),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateItemStatus(3, 13, OrderItemStatus.PREPARING, chef),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateItemStatus(3, 13, OrderItemStatus.PREPARING, manager),
      ).resolves.toEqual({ orderId: 3, itemId: 13, status: OrderItemStatus.PREPARING });
    });

    it('throws NotFoundException when the item does not exist', async () => {
      const manager = payload({ permissions: ['restaurant.manage'] });

      await expect(
        service.updateItemStatus(1, 999, OrderItemStatus.PREPARING, manager),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('order status sync (single source of truth)', () => {
    it('sets the order to PREPARING when an item starts', async () => {
      const chef = payload({ permissions: ['kitchen.update'] });

      await service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, chef);
      expect(orders[1].status).toBe(OrderStatus.PREPARING);
    });

    it('sets the order to READY when every item is ready', async () => {
      const chef = payload({ permissions: ['kitchen.update', 'bar.update'] });

      await service.updateItemStatus(1, 10, OrderItemStatus.READY, chef);
      await service.updateItemStatus(1, 11, OrderItemStatus.READY, chef);
      expect(orders[1].status).toBe(OrderStatus.READY);
    });

    it('never overrides a PAID order status', async () => {
      orders[1].status = OrderStatus.PAID;
      const chef = payload({ permissions: ['kitchen.update'] });

      await service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, chef);
      expect(orders[1].status).toBe(OrderStatus.PAID);
    });
  });

  describe('advanceItem (multi-hop station → station)', () => {
    it('blocks handing off an item that is not ready yet', async () => {
      const chef = payload({ permissions: ['kitchen.update'] });

      await expect(service.advanceItem(1, 10, chef)).rejects.toThrow(BadRequestException);
    });

    it('blocks a waiter from handing items off', async () => {
      kitchenItem.status = 'READY';
      const waiter = payload({ permissions: ['restaurant.view', 'restaurant.serve'] });

      await expect(service.advanceItem(1, 10, waiter)).rejects.toThrow(ForbiddenException);
    });

    it('lets the holding station hand a READY item to the next station', async () => {
      kitchenItem.status = 'READY';
      const chef = payload({ permissions: ['kitchen.update'] });

      await expect(service.advanceItem(1, 10, chef)).resolves.toEqual({
        orderId: 1,
        itemId: 10,
        stationIndex: 1,
        stationKey: 'bar',
        stationName: 'Bar',
      });
      expect(kitchenItem.status).toBe(OrderItemStatus.QUEUED);
      expect(kitchenItem.stationKey).toBe('bar');
      expect(kitchenItem.stationIndex).toBe(1);
    });

    it('blocks a station from handing off items it does not hold', async () => {
      kitchenItem.status = 'READY';
      const barman = payload({ permissions: ['restaurant.view', 'bar.view', 'bar.update'] });

      await expect(service.advanceItem(1, 10, barman)).rejects.toThrow(ForbiddenException);
    });

    it('rejects handoff when there is no next station in the route', async () => {
      butcherItem.status = 'READY';
      const butcher = payload({ permissions: ['restaurant.view', 'station.butcher.update'] });

      await expect(service.advanceItem(2, 12, butcher)).rejects.toThrow(BadRequestException);
    });
  });

  describe('markOrderServed (waiter takes the ready order to the customer)', () => {
    it('lets a waiter mark all READY items served', async () => {
      kitchenItem.status = 'READY';
      barItem.status = 'READY';
      const waiter = payload({ permissions: ['restaurant.view', 'restaurant.serve'] });

      await expect(service.markOrderServed(1, waiter)).resolves.toEqual({
        id: 1,
        status: OrderStatus.SERVED,
      });
      expect(kitchenItem.status).toBe(OrderItemStatus.SERVED);
      expect(barItem.status).toBe(OrderItemStatus.SERVED);
      expect(orders[1].status).toBe(OrderStatus.SERVED);
    });

    it('rejects serving when no item is ready yet', async () => {
      const waiter = payload({ permissions: ['restaurant.serve'] });

      await expect(service.markOrderServed(1, waiter)).rejects.toThrow(BadRequestException);
    });

    it('blocks a plain viewer from serving', async () => {
      kitchenItem.status = 'READY';
      const viewer = payload({ permissions: ['restaurant.view'] });

      await expect(service.markOrderServed(1, viewer)).rejects.toThrow(ForbiddenException);
    });

    it('lets a manager mark the order served', async () => {
      kitchenItem.status = 'READY';
      barItem.status = 'READY';
      const manager = payload({ permissions: ['restaurant.manage'] });

      await expect(service.markOrderServed(1, manager)).resolves.toEqual({
        id: 1,
        status: OrderStatus.SERVED,
      });
    });
  });

  describe('updateOrder (edit window)', () => {
    it('allows editing a DISPATCHED order whose items have not started', async () => {
      const manager = payload({ permissions: ['restaurant.manage'] });

      await expect(
        service.updateOrder(1, { customerName: 'Renamed' } as any),
      ).resolves.toBeTruthy();
    });

    it('blocks editing once any station has started an item', async () => {
      kitchenItem.status = 'PREPARING';
      const manager = payload({ permissions: ['restaurant.manage'] });

      await expect(
        service.updateOrder(1, { customerName: 'Renamed' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('audit trail & workflow notifications', () => {
    it('logs PREPARING, READY and SERVED milestones with actor + notifies the waiter', async () => {
      const chef = payload({ permissions: ['kitchen.update', 'bar.update'] });
      const waiter = payload({ permissions: ['restaurant.serve'] });

      // Item 10 starts → order PREPARING (kitchen is NOT the final hop, so
      // READY is not logged until the final station).
      await service.updateItemStatus(1, 10, OrderItemStatus.PREPARING, chef);
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.PREPARING, actorId: 1, actorName: 'Daniel' }),
        }),
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        5, // creator
        'Order Preparing',
        expect.stringContaining('ORD-1'),
        'ORDER_STATUS',
        null,
        '/dashboard/restaurant',
      );

      // Both items ready at their final stations → order READY + waiter notified.
      kitchenItem.status = 'READY';
      barItem.status = 'READY';
      kitchenItem.stationIndex = 1; // moved to the bar (final hop)
      kitchenItem.stationKey = 'bar';
      await service.markOrderServed(1, waiter);
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.SERVED }),
        }),
      );
      expect(notifications.notifyRole).toHaveBeenCalledWith(
        'Cashier',
        'Order Served',
        expect.stringContaining('ORD-1'),
        'ORDER_STATUS',
        '/dashboard/cashier',
      );
    });
  });

  describe('batchSettleOrders (multi-order table settlement)', () => {
    it('settles every selected open order in a single transaction and frees the table', async () => {
      // Two open orders on the same table.
      orders[1].tableId = 5;
      orders[2].tableId = 5;
      orders[2].totalAmount = 250;
      prisma.order.findMany.mockResolvedValue([orders[1], orders[2]]);

      const waiter = payload({ permissions: ['restaurant.settle'] });
      const result = await service.batchSettleOrders([1, 2], { paymentMethodId: 3 } as any, waiter);

      expect(result.ids).toEqual([1, 2]);
      expect(result.status).toBe(OrderStatus.PAID);
      // Both orders closed inside one $transaction.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.orderStatusHistory.create).toHaveBeenCalledTimes(2);
      // Table freed (diningTable.update called once per order that owns it).
      expect(prisma.diningTable.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FREE' }) }),
      );
      expect(orders[1].status).toBe(OrderStatus.PAID);
      expect(orders[2].status).toBe(OrderStatus.PAID);
    });

    it('rejects when there are no open orders to settle', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      const waiter = payload({ permissions: ['restaurant.settle'] });

      await expect(
        service.batchSettleOrders([1], {} as any, waiter),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

