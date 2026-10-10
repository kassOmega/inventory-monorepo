// src/carwash/carwash-update.spec.ts
// Editing a wash: a not-yet-settled wash can be updated; a settled (posted) wash
// must be rejected.
import { BadRequestException } from '@nestjs/common';
import { CarWashService } from './carwash.service';

function setup(status: string) {
  const updated: any = {};
  const prisma: any = {
    carWash: {
      findUnique: jest.fn(() => Promise.resolve({ id: 1, status })),
      update: jest.fn(({ data }: any) => {
        updated.data = data;
        return Promise.resolve({
          id: 1,
          ...data,
          washer: null,
          participantWashers: [],
          vehicle: null,
          customer: null,
          washType: null,
          paymentMethod: null,
        });
      }),
    },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
  };
  const svc = new CarWashService(prisma, {} as any);
  return { svc, updated, prisma };
}

describe('CarWashService.updateWash', () => {
  it('updates amount / plate / participants on a non-settled wash', async () => {
    const { svc, updated } = setup('QUEUED');
    await svc.updateWash(1, { amount: 250, plateNumber: 'AB-123', participantWasherIds: [4, 5] } as any, 7);
    expect(updated.data.amount).toBe(250);
    expect(updated.data.plateNumber).toBe('AB-123');
    expect(updated.data.participantWashers).toEqual({ set: [{ id: 4 }, { id: 5 }] });
  });

  it('rejects editing a settled wash', async () => {
    const { svc } = setup('SETTLED');
    await expect(
      svc.updateWash(1, { amount: 10 } as any, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
