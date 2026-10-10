// src/carwash/carwash-wash-status.spec.ts
// Wash lifecycle: QUEUED → IN_PROGRESS → COMPLETED → SETTLED, with a per-day
// queue number (starts at 0) and a timestamp on each transition.
import { CarWashService } from './carwash.service';
import { tenantContext } from '../common/tenant/tenant.context';

jest.mock('bcrypt', () => ({
  hash: jest.fn(() => Promise.resolve('h')),
  compare: jest.fn(() => Promise.resolve(true)),
}));

function setup(lastQueue: number | null = 4) {
  const created: any = {};
  const updated: any = {};
  const prisma: any = {
    carWash: {
      findFirst: jest.fn(() =>
        Promise.resolve(lastQueue == null ? null : { queueNumber: lastQueue }),
      ),
      create: jest.fn(({ data }: any) => {
        created.data = data;
        return Promise.resolve({ id: 1, ...data, washer: null, participantWashers: [] });
      }),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve({ id: where.id, tenantId: 1, amount: 100, status: 'QUEUED', date: new Date(), startedAt: null, settledAt: null, washer: null, participantWashers: [] }),
      ),
      findMany: jest.fn(() => Promise.resolve([])),
      update: jest.fn(({ data }: any) => {
        updated.data = data;
        return Promise.resolve({ id: 1, ...data });
      }),
    },
    carWashWasher: { findMany: jest.fn(() => Promise.resolve([])), findUnique: jest.fn(() => Promise.resolve(null)) },
    account: { findMany: jest.fn(() => Promise.resolve([{ id: 1, name: 'Car Wash Revenue', type: 'INCOME' }])) },
    paymentMethod: { findFirst: jest.fn(() => Promise.resolve({ id: 5, name: 'Cash' })) },
    journalEntry: { create: jest.fn(), findFirst: jest.fn(() => Promise.resolve(null)) },
    otherIncome: { findFirst: jest.fn(() => Promise.resolve(null)), create: jest.fn() },
    $transaction: (fn: any) => fn(prisma),
  };
  const finance: any = { postCarWashIncome: jest.fn(() => Promise.resolve()) };
  return { svc: new CarWashService(prisma, finance), created, updated, prisma, finance };
}

describe('CarWashService wash status lifecycle', () => {
  it('creates a wash as QUEUED with the next per-day queue number (starting at 1)', async () => {
    const { svc, created } = setup(4);
    const res: any = await tenantContext.run(1, () => svc.createWash({ amount: 100 } as any, 7));
    expect(created.data.status).toBe('QUEUED');
    expect(created.data.queueNumber).toBe(5); // last was 4
    expect(created.data.queuedAt).toBeInstanceOf(Date);
    expect(typeof res.totalCommission).toBe('number');
    expect(typeof res.ownerShare).toBe('number');
  });

  it('starts the queue at 1 when no wash exists that day', async () => {
    const { svc, created } = setup(null);
    await tenantContext.run(1, () => svc.createWash({ amount: 50 } as any, 7));
    expect(created.data.queueNumber).toBe(1);
  });

  it('start moves to IN_PROGRESS and stamps startedAt', async () => {
    const { svc, updated } = setup();
    await tenantContext.run(1, () => svc.startWash(1));
    expect(updated.data.status).toBe('IN_PROGRESS');
    expect(updated.data.startedAt).toBeInstanceOf(Date);
  });

  it('complete (washed) stamps completedAt and does NOT post to the ledger', async () => {
    const { svc, updated, finance } = setup();
    await tenantContext.run(1, () => svc.completeWash(1));
    expect(updated.data.status).toBe('COMPLETED');
    expect(updated.data.completedAt).toBeInstanceOf(Date);
    expect(finance.postCarWashIncome).not.toHaveBeenCalled();
  });

  it('settle (complete/paid) stamps settledAt and posts to the ledger', async () => {
    const { svc, updated, finance } = setup();
    await tenantContext.run(1, () => svc.settleWash(1));
    expect(updated.data.status).toBe('SETTLED');
    expect(updated.data.settledAt).toBeInstanceOf(Date);
    // Revenue is recognised only when the wash is paid.
    expect(finance.postCarWashIncome).toHaveBeenCalled();
  });

  it('settle records the chosen payment method', async () => {
    const { svc, updated } = setup();
    await tenantContext.run(1, () => svc.settleWash(1, 3, 5));
    expect(updated.data.paymentMethodId).toBe(5);
  });

  it('paymentMethodsBreakdown groups settled washes by method', async () => {
    const { svc, prisma } = setup();
    prisma.carWash.findMany = jest.fn(() =>
      Promise.resolve([
        { amount: 100, paymentMethod: { name: 'Cash' } },
        { amount: 50, paymentMethod: { name: 'Cash' } },
        { amount: 80, paymentMethod: null },
      ]),
    );
    const rows: any = await tenantContext.run(1, () => svc.paymentMethodsBreakdown('2026-10-01', '2026-10-31'));
    expect(rows.find((r: any) => r.method === 'Cash')).toEqual({ method: 'Cash', count: 2, totalAmount: 150 });
    expect(rows.find((r: any) => r.method === 'Unspecified')).toEqual({ method: 'Unspecified', count: 1, totalAmount: 80 });
  });

  it('listWashers orders active-first, then name, and filters when asked', async () => {
    const { svc, prisma } = setup();
    await svc.listWashers(true);
    expect(prisma.carWashWasher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
    );
  });
});
