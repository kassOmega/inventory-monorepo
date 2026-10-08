// src/carwash/carwash-collection.spec.ts
// The daily owner-share collection must not be recordable twice for the same
// day: once a settled row exists, a second full collection is rejected so a
// double-tap can't create a duplicate.
import { BadRequestException } from '@nestjs/common';
import { CarWashService } from './carwash.service';
import { tenantContext } from '../common/tenant/tenant.context';

function setup(existing: Array<{ totalAmount: number; remainingBalance: number }>) {
  const created: any[] = [];
  const prisma: any = {
    carWash: { findMany: jest.fn(() => Promise.resolve([])) },
    carWashEquipmentIssue: { findMany: jest.fn(() => Promise.resolve([])) },
    expense: { findMany: jest.fn(() => Promise.resolve([])) },
    carWashCollection: {
      findMany: jest.fn(() => Promise.resolve(existing)),
      create: jest.fn(({ data }: any) => {
        created.push(data);
        return Promise.resolve({ id: 1, ...data });
      }),
    },
  };
  const svc = new CarWashService(prisma, {} as any);
  return { svc, prisma, created };
}

describe('CarWashService.createCollection duplicate guard', () => {
  it('rejects a second full collection once the day is settled', async () => {
    const { svc, prisma } = setup([
      { totalAmount: 100, remainingBalance: 0 },
    ]);
    await tenantContext.run(1, async () => {
      await expect(svc.createCollection({}, 9)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
    expect(prisma.carWashCollection.create).not.toHaveBeenCalled();
  });

  it('allows the first collection of the day', async () => {
    const { svc, prisma, created } = setup([]);
    await tenantContext.run(1, async () => {
      await svc.createCollection({}, 9);
    });
    expect(created).toHaveLength(1);
    expect(created[0].collectedById).toBe(9);
  });

  it('still allows an explicit partial collection on a settled day', async () => {
    // A caller passing an explicit amount is treated as an intentional
    // adjustment (e.g. recording a leftover), so the guard steps aside.
    const { svc, created } = setup([
      { totalAmount: 40, remainingBalance: 60 },
    ]);
    await tenantContext.run(1, async () => {
      await svc.createCollection({ totalAmount: 10 }, 9);
    });
    expect(created[0].totalAmount).toBe(10);
    // remainingBalance = ownerShare(0) - priorTotal(40) - 10
    expect(created[0].remainingBalance).toBe(-50);
  });
});
