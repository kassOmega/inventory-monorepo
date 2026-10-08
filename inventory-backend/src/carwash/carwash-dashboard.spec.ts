// src/carwash/carwash-dashboard.spec.ts
// Role + business scoping of the dashboard data flow. The dashboard must:
//   - accept a date range and return only washes in it,
//   - force a washer's own scope (a washer can never widen it via a query param),
//   - let an owner/manager narrow to a specific washer.
import { CarWashService } from './carwash.service';

type WashRow = {
  amount: number;
  date: Date;
  washerId: number | null;
  washer: { id: number; commissionRate: number } | null;
  participantWashers: Array<{ id: number; commissionRate: number }>;
};

function makeWash(id: number, date: string, amount: number, washerId: number): WashRow {
  return {
    amount,
    date: new Date(date),
    washerId,
    washer: { id: washerId, commissionRate: 50 },
    participantWashers: [],
  };
}

function setup(washes: WashRow[], washerRow: any = null) {
  const findMany = jest.fn(({ where }: any) => {
    let rows = washes;
    if (where?.date?.gte && where?.date?.lt) {
      rows = rows.filter(
        (w) => w.date >= where.date.gte && w.date < where.date.lt,
      );
    }
    if (where?.OR) {
      const id = where.OR[0]?.washerId;
      rows = rows.filter((w) => w.washerId === id);
    }
    return Promise.resolve(rows);
  });
  const prisma: any = {
    carWash: { findMany },
    carWashWasher: {
      count: jest.fn(() => Promise.resolve(1)),
      findUnique: jest.fn(() => Promise.resolve(washerRow)),
      findFirst: jest.fn(() => Promise.resolve(washerRow)),
    },
    carWashBooking: { count: jest.fn(() => Promise.resolve(0)) },
  };
  const svc = new CarWashService(prisma, {} as any);
  return { svc, prisma };
}

const OWNER = { sub: 1, permissions: ['carwash.collections.view', 'carwash.washes.view'] };
const WASHER = { sub: 9, permissions: ['carwash.washes.create', 'carwash.washes.view'] };

describe('CarWashService.dashboard scoping', () => {
  const washes = [
    makeWash(1, '2026-01-01', 100, 5),
    makeWash(2, '2026-01-01', 200, 6),
    makeWash(3, '2026-02-01', 300, 5),
  ];

  it('returns only washes inside the requested range', async () => {
    const { svc } = setup(washes);
    const res = await svc.dashboard(OWNER, {
      startDate: '2026-01-01',
      endDate: '2026-01-01',
    });
    expect(res.todayWashes).toBe(2);
    expect(res.todayRevenue).toBe(300);
    expect(res.role).toBe('staff');
  });

  it('forces a washer to their own scope and ignores a supplied washerId', async () => {
    const { svc, prisma } = setup(washes, { id: 5, name: 'Abel', commissionRate: 40 });
    const res = await svc.dashboard(WASHER, {
      startDate: '2026-01-01',
      endDate: '2026-02-28',
      // A washer trying to view someone else's data:
      washerId: 6,
    });
    expect(res.role).toBe('washer');
    // Only washer 5's two washes are counted, not washer 6's.
    expect(res.todayWashes).toBe(2);
    expect(prisma.carWash.findMany).toHaveBeenCalled();
  });

  it('lets an owner narrow to a single washer', async () => {
    const { svc } = setup(washes, { id: 6, name: 'Sara', commissionRate: 50 });
    const res = await svc.dashboard(OWNER, {
      startDate: '2026-01-01',
      endDate: '2026-02-28',
      washerId: 6,
    });
    expect(res.role).toBe('staff');
    expect(res.todayWashes).toBe(1);
    expect(res.todayRevenue).toBe(200);
  });

  it('exposes the resolved range so the UI can echo it', async () => {
    const { svc } = setup(washes);
    const res = await svc.dashboard(OWNER, {
      startDate: '2026-01-01',
      endDate: '2026-01-05',
    });
    expect(res.startDate).toBe('2026-01-01');
    expect(res.endDate).toBe('2026-01-05');
  });
});
