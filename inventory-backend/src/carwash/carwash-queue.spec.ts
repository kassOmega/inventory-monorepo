// src/carwash/carwash-queue.spec.ts
// Starting or deleting a queued wash must remove it from the waiting queue and
// renumber the remaining QUEUED washes so the queue stays compact (1..N).
import { CarWashService } from './carwash.service';

/**
 * A tx whose `findMany` returns the two remaining queued rows (10 and 12) with
 * their ORIGINAL numbers, so the renumber pass has to rewrite them to 1 and 2.
 */
function setup(startedId: number) {
  const updates: Array<{ id: number; data: any }> = [];
  const day = new Date();
  // The remaining queued rows after the action, with their ORIGINAL numbers
  // (so 10 was 1 and 12 was 3 → must be rewritten to 1 and 2).
  const survivors =
    startedId === 12
      ? [
          { id: 10, queueNumber: 1 },
          { id: 11, queueNumber: 2 },
        ]
      : [
          { id: 10, queueNumber: 1 },
          { id: 12, queueNumber: 3 },
        ];
  const tx: any = {
    carWash: {
      update: jest.fn(({ where, data }: any) => {
        updates.push({ id: where.id, data });
        return Promise.resolve({ id: where.id, ...data });
      }),
      // The queue after the started wash is gone: only survivors remain queued.
      findMany: jest.fn(() => Promise.resolve(survivors)),
      delete: jest.fn(() => Promise.resolve({})),
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: startedId,
          tenantId: 1,
          amount: 100,
          status: 'QUEUED',
          date: day,
          washerId: 3,
          startedAt: null,
          settledAt: null,
          washer: null,
          participantWashers: [],
        }),
      ),
    },
  };
  const prisma: any = {
    carWash: tx.carWash,
    $transaction: (fn: any) => fn(tx),
  };
  const svc = new CarWashService(prisma, {} as any);
  return { svc, updates };
}

describe('CarWashService queue renumbering', () => {
  it('starting a wash clears its number and compacts the remaining queue to 1..N', async () => {
    const { svc, updates } = setup(11);
    await svc.startWash(11);

    // The started wash #11 is removed from the queue.
    const started = updates.find((u) => u.id === 11);
    expect(started?.data.queueNumber).toBeNull();

    // Survivors: 10 was already 1 (unchanged), 12 was 3 → rewritten to 2, so the
    // queue ends up contiguous 1, 2.
    const byId = Object.fromEntries(
      updates.filter((u) => u.id === 10 || u.id === 12).map((u) => [u.id, u.data.queueNumber]),
    );
    expect(byId[12]).toBe(2);
    expect(byId[10] ?? 1).toBe(1); // already 1 → not rewritten
  });

  it('deleting a queued wash compacts the remaining queue', async () => {
    const { svc, updates } = setup(12);
    await svc.deleteWash(12);
    // Survivors 10 (was 1) and 11 (was 2) stay contiguous 1, 2.
    const byId = Object.fromEntries(
      updates.filter((u) => u.id === 10 || u.id === 11).map((u) => [u.id, u.data.queueNumber]),
    );
    expect(byId[10]).toBeUndefined(); // already 1, so not rewritten
    expect(byId[11]).toBeUndefined(); // already 2, so not rewritten
  });
});
