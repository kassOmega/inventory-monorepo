// src/carwash/carwash-start-assign.spec.ts
// A wash may wait in the queue without a washer; the washer is required when
// washing starts. Starting with no washer and none supplied is rejected; passing
// one (or having one already) starts the wash.
import { BadRequestException } from '@nestjs/common';
import { CarWashService } from './carwash.service';

function setup(washerId: number | null) {
  const updated: any = {};
  const tx: any = {
    carWash: {
      update: jest.fn(({ data }: any) => {
        updated.data = data;
        return Promise.resolve({ id: 1, ...data });
      }),
      // renumberQueue reads the day's queued rows (none needed for the assert).
      findMany: jest.fn(() => Promise.resolve([])),
    },
  };
  const prisma: any = {
    carWash: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: 1,
          tenantId: 1,
          washerId,
          status: 'QUEUED',
          date: new Date(),
          amount: 100,
          participantWashers: [],
        }),
      ),
    },
    carWashWasher: { findFirst: jest.fn(() => Promise.resolve({ id: 3 })) },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
    $transaction: (fn: any) => fn(tx),
  };
  const svc = new CarWashService(prisma, {} as any);
  return { svc, updated, prisma };
}

describe('CarWashService.startWash washer assignment', () => {
  it('rejects starting a washer-less wash with no washer supplied', async () => {
    const { svc } = setup(null);
    await expect(svc.startWash(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('starts a washer-less wash when a washer is supplied', async () => {
    const { svc, updated } = setup(null);
    await svc.startWash(1, 7, { washerId: 3, participantWasherIds: [4] });
    expect(updated.data.status).toBe('IN_PROGRESS');
    expect(updated.data.washerId).toBe(3);
    expect(updated.data.participantWashers).toEqual({ set: [{ id: 4 }] });
  });

  it('starts directly when a washer was already assigned', async () => {
    const { svc, updated } = setup(9);
    await svc.startWash(1);
    expect(updated.data.washerId).toBe(9);
  });
});
