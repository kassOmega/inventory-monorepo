// src/customers/customer-loyalty.service.spec.ts
// The loyalty ledger: earn on sale, idempotent re-sync, proportional reversal on
// return, and full give-back when a sale is deleted. Exercised against a small
// in-memory Prisma double so the arithmetic is asserted directly.
import { CustomerLoyaltyService } from './customer-loyalty.service';

const org = 1;

function makePrisma(initialBalance = 0) {
  const entries: {
    id: number;
    organizationId: number;
    customerId: number;
    saleId: number | null;
    type: string;
    points: number;
    balanceAfter: number | null;
    reason: string | null;
  }[] = [];
  const program = {
    organizationId: org,
    enabled: true,
    pointsPerCurrency: 0.01,
    valuePerPoint: 0,
    minRedeemPoints: 0,
  };
  const customer = { id: 7, name: 'Almaz', loyaltyPoints: initialBalance };
  let nextId = 1;

  const prisma: any = {
    loyaltyProgram: {
      findFirst: jest.fn(async () => ({ ...program })),
      upsert: jest.fn(async () => ({ ...program })),
    },
    customerLoyaltyEntry: {
      findFirst: jest.fn(async (args: any) => {
        const { saleId, type } = args.where;
        return (
          entries.find((e) => e.saleId === saleId && e.type === type) ?? null
        );
      }),
      create: jest.fn(async (args: any) => {
        const row = { id: nextId++, ...args.data };
        entries.push(row);
        return row;
      }),
      update: jest.fn(async (args: any) => {
        const row = entries.find((e) => e.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }),
      delete: jest.fn(async (args: any) => {
        const i = entries.findIndex((e) => e.id === args.where.id);
        return entries.splice(i, 1)[0];
      }),
    },
    customer: {
      findFirst: jest.fn(async () => ({ loyaltyPoints: customer.loyaltyPoints })),
      update: jest.fn(async (args: any) => {
        customer.loyaltyPoints += args.data.loyaltyPoints.increment;
        return { loyaltyPoints: customer.loyaltyPoints };
      }),
    },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return { prisma, entries, customer, program };
}

const sync = (svc: CustomerLoyaltyService, prisma: any, o: Partial<any> = {}) =>
  svc.syncSaleLoyalty(prisma, {
    organizationId: org,
    customerId: 7,
    saleId: 100,
    totalAmount: 1000,
    ...o,
  } as any);

describe('CustomerLoyaltyService.syncSaleLoyalty', () => {
  it('awards floored points for the sale total (1 point per 100 ETB)', async () => {
    const { prisma, entries, customer } = makePrisma();
    const svc = new CustomerLoyaltyService(prisma);

    const res = await sync(svc, prisma);

    expect(res.earned).toBe(10); // 1000 * 0.01
    expect(customer.loyaltyPoints).toBe(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'EARN', points: 10, balanceAfter: 10 });
  });

  it('is idempotent: re-running the same sale adds nothing', async () => {
    const { prisma, entries, customer } = makePrisma();
    const svc = new CustomerLoyaltyService(prisma);

    await sync(svc, prisma);
    await sync(svc, prisma);

    expect(entries).toHaveLength(1);
    expect(customer.loyaltyPoints).toBe(10);
  });

  it('only moves the delta when an edited sale changes the total', async () => {
    const { prisma, entries, customer } = makePrisma();
    const svc = new CustomerLoyaltyService(prisma);

    await sync(svc, prisma); // 1000 -> 10 points
    await sync(svc, prisma, { totalAmount: 1500 }); // 15 points total

    expect(entries).toHaveLength(1);
    expect(entries[0].points).toBe(15);
    expect(customer.loyaltyPoints).toBe(15);
  });

  it('reverses points proportionally to the refunded part', async () => {
    const { prisma, entries, customer } = makePrisma();
    const svc = new CustomerLoyaltyService(prisma);

    await sync(svc, prisma); // 10 points
    await sync(svc, prisma, { refundedAmount: 400 }); // 40% refunded

    expect(customer.loyaltyPoints).toBe(6);
    expect(entries.find((e) => e.type === 'REVERSE')).toMatchObject({
      points: -4,
      balanceAfter: 6,
    });
  });

  it('returns the points when a return is deleted again', async () => {
    const { prisma, entries, customer } = makePrisma();
    const svc = new CustomerLoyaltyService(prisma);

    await sync(svc, prisma);
    await sync(svc, prisma, { refundedAmount: 1000 });
    expect(customer.loyaltyPoints).toBe(0);

    // The return row is gone: no refunded amount any more.
    await sync(svc, prisma, { refundedAmount: 0 });

    expect(customer.loyaltyPoints).toBe(10);
    expect(entries.filter((e) => e.type === 'REVERSE')).toHaveLength(0);
  });

  it('gives everything back when the sale is deleted', async () => {
    const { prisma, customer } = makePrisma();
    const svc = new CustomerLoyaltyService(prisma);

    await sync(svc, prisma);
    await svc.reverseSaleLoyalty(prisma, {
      organizationId: org,
      customerId: 7,
      saleId: 100,
      totalAmount: 1000,
      reason: 'INV-1 (deleted)',
    });

    expect(customer.loyaltyPoints).toBe(0);
  });

  it('never drives the balance below zero', async () => {
    const { prisma, customer } = makePrisma(3);
    const svc = new CustomerLoyaltyService(prisma);

    await sync(svc, prisma); // +10 -> 13
    expect(customer.loyaltyPoints).toBe(13);

    // The balance was spent down elsewhere, then the whole sale is refunded.
    customer.loyaltyPoints = 2;
    await sync(svc, prisma, { refundedAmount: 1000 });

    expect(customer.loyaltyPoints).toBe(0);
  });

  it('accrues nothing while the programme is off', async () => {
    const { prisma, customer, program } = makePrisma();
    program.enabled = false;
    const svc = new CustomerLoyaltyService(prisma);

    const res = await sync(svc, prisma);

    expect(res.earned).toBe(0);
    expect(customer.loyaltyPoints).toBe(0);
  });
});
