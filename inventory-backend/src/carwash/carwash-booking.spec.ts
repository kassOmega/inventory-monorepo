// src/carwash/carwash-booking.spec.ts
// Booking model: one header with multiple vehicle items, auto queue position,
// and summed amount. Collection summary exposes the outstanding gap.
import { CarWashService } from './carwash.service';
import { tenantContext } from '../common/tenant/tenant.context';

function setup() {
  const created: any = {};
  const prisma: any = {
    carWashBooking: {
      findFirst: jest.fn(() => Promise.resolve({ positionInQueue: 4 })),
      create: jest.fn(({ data }: any) => {
        created.data = data;
        return Promise.resolve({ id: 1, ...data });
      }),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    carWash: { findMany: jest.fn(() => Promise.resolve([])) },
    carWashEquipmentIssue: { findMany: jest.fn(() => Promise.resolve([])) },
    expense: { findMany: jest.fn(() => Promise.resolve([])) },
    carWashCollection: { findMany: jest.fn(() => Promise.resolve([])) },
  };
  return { svc: new CarWashService(prisma, {} as any), prisma, created };
}

describe('CarWashService.createBooking (multi-vehicle)', () => {
  it('creates one booking with an item per vehicle and a summed amount', async () => {
    const { svc, created } = setup();
    await tenantContext.run(1, () =>
      svc.createBooking({
        customerId: 7,
        washerId: 2,
        startsAt: '2026-10-12T09:00:00.000Z',
        items: [
          { vehicleId: 1, vehicleType: 'Car', washTypeId: 3, amount: 100 },
          { vehicleId: 2, vehicleType: 'SUV', washTypeId: 4, amount: 150 },
        ],
      } as any),
    );
    expect(created.data.amount).toBe(250);
    expect(created.data.items.create).toHaveLength(2);
    expect(created.data.items.create[0]).toMatchObject({
      vehicleId: 1,
      washTypeId: 3,
      amount: 100,
    });
  });

  it('auto-fills the next queue position from that day', async () => {
    const { svc, created } = setup();
    await tenantContext.run(1, () =>
      svc.createBooking({
        startsAt: '2026-10-12T09:00:00.000Z',
        items: [{ vehicleId: 1, amount: 100 }],
      } as any),
    );
    expect(created.data.positionInQueue).toBe(5);
  });

  it('wraps a single-vehicle payload into one item (backward compatible)', async () => {
    const { svc, created } = setup();
    await tenantContext.run(1, () =>
      svc.createBooking({
        startsAt: '2026-10-12T09:00:00.000Z',
        vehicleId: 9,
        vehicleType: 'Car',
        amount: 120,
      } as any),
    );
    expect(created.data.items.create).toHaveLength(1);
    expect(created.data.items.create[0].vehicleId).toBe(9);
    expect(created.data.amount).toBe(120);
  });
});
