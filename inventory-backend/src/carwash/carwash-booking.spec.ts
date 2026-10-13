// src/carwash/carwash-booking.spec.ts
// Booking model: one header with multiple vehicle items, auto queue position,
// and summed amount. Collection summary exposes the outstanding gap.
import { BadRequestException } from '@nestjs/common';
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
    carWashPrice: {
      findFirst: jest.fn(() => Promise.resolve({ durationMinutes: 45 })),
      findMany: jest.fn(() => Promise.resolve([])),
    },
  };
  return { svc: new CarWashService(prisma, {} as any), prisma, created };
}

function setupConflict() {
  const created: any = {};
  const prisma: any = {
    carWashBooking: {
      findFirst: jest.fn(() => Promise.resolve({ positionInQueue: 4 })),
      create: jest.fn(({ data }: any) => {
        created.data = data;
        return Promise.resolve({ id: 1, ...data });
      }),
      // A distinct active booking that already holds washer 11 over the
      // requested slot, so `washerBusy` reports a conflict.
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            id: 2,
            washerId: 11,
            startsAt: new Date('2026-10-12T09:00:00.000Z'),
            endsAt: new Date('2026-10-12T10:00:00.000Z'),
            vehicleType: 'Car',
            items: [],
          },
        ]),
      ),
    },
    carWashPrice: {
      findFirst: jest.fn(() => Promise.resolve({ durationMinutes: 45 })),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    carWash: { findMany: jest.fn(() => Promise.resolve([])) },
    carWashEquipmentIssue: { findMany: jest.fn(() => Promise.resolve([])) },
    expense: { findMany: jest.fn(() => Promise.resolve([])) },
    carWashCollection: { findMany: jest.fn(() => Promise.resolve([])) },
  };
  return { svc: new CarWashService(prisma, {} as any), prisma, created };
}

function setupServe(conflict = false) {
  const washes: any[] = [];
  const prisma: any = {
    carWashBooking: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          id: 1,
          tenantId: 1,
          status: 'BOOKED',
          customerId: 7,
          washerId: 99,
          vehicleType: 'Car',
          startsAt: new Date('2026-10-12T09:00:00.000Z'),
          endsAt: null,
          items: [
            {
              id: 10,
              vehicleId: 1,
              vehicleType: 'Car',
              washTypeId: 3,
              washerId: 11,
              amount: 100,
              startsAt: new Date('2026-10-12T09:00:00.000Z'),
              vehicle: { plateNumber: 'AAA' },
            },
            {
              id: 11,
              vehicleId: 2,
              vehicleType: 'SUV',
              washTypeId: 4,
              washerId: 22,
              amount: 150,
              startsAt: new Date('2026-10-12T09:00:00.000Z'),
              vehicle: { plateNumber: 'BBB' },
            },
          ],
        }),
      ),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      findMany: jest.fn(() =>
        conflict
          ? Promise.resolve([
              {
                id: 2,
                washerId: 11,
                startsAt: new Date('2026-10-12T09:00:00.000Z'),
                endsAt: new Date('2026-10-12T10:00:00.000Z'),
                vehicleType: 'Car',
                items: [],
              },
            ])
          : Promise.resolve([]),
      ),
    },
    carWash: {
      findFirst: jest.fn(() => Promise.resolve({ queueNumber: 0 })),
      create: jest.fn(({ data }: any) => {
        washes.push(data);
        return Promise.resolve({ id: washes.length, ...data });
      }),
    },
    carWashBookingItem: {
      update: jest.fn(({ data }: any) => Promise.resolve({ ...data })),
    },
    carWashPrice: {
      findFirst: jest.fn(() => Promise.resolve({ durationMinutes: 45 })),
      findMany: jest.fn(() =>
        Promise.resolve([
          { vehicleType: 'Car', washTypeId: 3, durationMinutes: 45 },
        ]),
      ),
    },
  };
  return { svc: new CarWashService(prisma, {} as any), prisma, washes };
}

describe('CarWashService.serveBooking', () => {
  it('keeps each line washer and ignores a different serve-time washer', async () => {
    const { svc, washes } = setupServe();
    await tenantContext.run(1, () =>
      svc.serveBooking(1, undefined, {
        washerId: 999,
        helperWasherIds: [55],
      }),
    );
    expect(washes).toHaveLength(2);
    expect(washes[0].washerId).toBe(11);
    expect(washes[1].washerId).toBe(22);
  });

  it('rejects serve when the booked washer is busy and creates no washes', async () => {
    const { svc, washes } = setupServe(true);
    await expect(
      tenantContext.run(1, () =>
        svc.serveBooking(1, undefined, { washerId: 999 }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(washes).toHaveLength(0);
  });
});

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

  it('persists each line washer and mirrors the first line on the header', async () => {
    const { svc, created } = setup();
    await tenantContext.run(1, () =>
      svc.createBooking({
        customerId: 7,
        washerId: 99,
        startsAt: '2026-10-12T09:00:00.000Z',
        items: [
          {
            vehicleId: 1,
            vehicleType: 'Car',
            washTypeId: 3,
            amount: 100,
            washerId: 11,
          },
          {
            vehicleId: 2,
            vehicleType: 'SUV',
            washTypeId: 4,
            amount: 150,
            washerId: 22,
          },
        ],
      } as any),
    );
    expect(created.data.items.create[0].washerId).toBe(11);
    expect(created.data.items.create[1].washerId).toBe(22);
    expect(created.data.washerId).toBe(11);
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

  it('rejects a booking when the selected washer is already busy', async () => {
    const { svc } = setupConflict();
    await expect(
      tenantContext.run(1, () =>
        svc.createBooking({
          customerId: 7,
          startsAt: '2026-10-12T09:00:00.000Z',
          items: [
            {
              vehicleId: 1,
              vehicleType: 'Car',
              washTypeId: 3,
              amount: 100,
              washerId: 11,
            },
          ],
        } as any),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
