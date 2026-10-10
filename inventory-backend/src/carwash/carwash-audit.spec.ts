// src/carwash/carwash-audit.spec.ts
// Audit logging: car-wash wash lifecycle and washer/booking mutations write an
// AuditLog row so the Reports -> Audit Trail is populated.
import { CarWashService } from './carwash.service';
import { tenantContext } from '../common/tenant/tenant.context';

jest.mock('bcrypt', () => ({
  hash: jest.fn(() => Promise.resolve('h')),
  compare: jest.fn(() => Promise.resolve(true)),
}));

function setup() {
  const audits: any[] = [];
  const washFindUnique = jest.fn(() =>
    Promise.resolve({ id: 1, tenantId: 1, amount: 100, status: 'QUEUED', date: new Date(), settledAt: null, washer: null, participantWashers: [] }),
  );
  const prisma: any = {
    auditLog: { create: jest.fn(({ data }: any) => { audits.push(data); return Promise.resolve(data); }) },
    carWash: {
      findFirst: jest.fn(() => Promise.resolve({ queueNumber: 2 })),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data, washer: null, participantWashers: [] })),
      findUnique: washFindUnique,
      findMany: jest.fn(() => Promise.resolve([])),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
    },
    carWashWasher: { findMany: jest.fn(() => Promise.resolve([])), findUnique: jest.fn(() => Promise.resolve(null)) },
    account: { findMany: jest.fn(() => Promise.resolve([{ id: 1, name: 'Car Wash Revenue', type: 'INCOME' }])) },
    $transaction: (fn: any) => fn(prisma),
  };
  const finance: any = { postCarWashIncome: jest.fn(() => Promise.resolve()) };
  return { svc: new CarWashService(prisma, finance), audits };
}

describe('CarWashService audit logging', () => {
  it('records wash create / start / washed / paid', async () => {
    const { svc, audits } = setup();
    await tenantContext.run(7, async () => {
      await svc.createWash({ amount: 100 } as any, 3);
      await svc.startWash(1, 3);
      await svc.completeWash(1, 3);
      await svc.settleWash(1, 3);
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual([
      'CARWASH_WASH_CREATED',
      'CARWASH_WASH_STARTED',
      'CARWASH_WASH_WASHED',
      'CARWASH_WASH_PAID',
    ]);
    expect(audits.every((a) => a.tenantId === 7 && a.userId === 3)).toBe(true);
  });
});
