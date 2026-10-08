// src/customers/customers.service.spec.ts
// Mutual-trade netting. A customer who also sells to us carries a balance on
// both sides at once — what they took on credit from us, and what we took on
// credit from them — and only the net is what actually changes hands. These
// tests drive the public directory path against an in-memory Prisma double
// whose `groupBy` honours the real `where` clauses, so the four gross sums are
// computed from actual rows and the netted pair is asserted on top of them.
import { CustomersService } from './customers.service';

// The `onlyDebt` filter needs a tenant, and nothing else in these tests does.
jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
}));

type CreditSaleRow = { customerId: number; totalAmount: number };
type CreditPaymentRow = { customerId: number; amount: number };
type PurchaseRow = {
  vendorCustomerId: number | null;
  totalCost: number;
  paymentType: string;
};
type PurchasePaymentRow = { customerId: number; amount: number };

interface Fixture {
  ids?: number[];
  creditSales?: CreditSaleRow[];
  creditPayments?: CreditPaymentRow[];
  purchases?: PurchaseRow[];
  purchasePayments?: PurchasePaymentRow[];
  /** What the `onlyDebt` SQL would return for this fixture. */
  debtorIds?: number[];
}

/**
 * Stands in for Prisma's `groupBy`: honours the `in` filter on the bucket key
 * and the extra predicate (the purchases query's CREDIT-only filter), so the
 * service's four sums come from real rows rather than hand-fed totals.
 */
function groupSum(
  rows: Record<string, unknown>[],
  byField: string,
  sumField: string,
  ids: number[],
  keep: (row: Record<string, unknown>) => boolean = () => true,
) {
  const totals = new Map<number, number>();
  for (const row of rows) {
    const key = row[byField] as number | null;
    if (key == null || !ids.includes(key) || !keep(row)) continue;
    totals.set(key, (totals.get(key) ?? 0) + (row[sumField] as number));
  }
  return [...totals].map(([key, total]) => ({
    [byField]: key,
    _sum: { [sumField]: total },
  }));
}

function makeService(fixture: Fixture) {
  const ids = fixture.ids ?? [7];
  const rawSql: string[] = [];

  const prisma: any = {
    customer: {
      count: jest.fn(async (args: any) => {
        const allowed: number[] | undefined = args?.where?.id?.in;
        return allowed
          ? ids.filter((id) => allowed.includes(id)).length
          : ids.length;
      }),
      findMany: jest.fn(async (args: any) => {
        // The directory narrows to the debtor ids the SQL resolved.
        const allowed: number[] | undefined = args?.where?.id?.in;
        return ids
          .filter((id) => (allowed ? allowed.includes(id) : true))
          .map((id) => ({
            id,
            publicId: `cust-${id}`,
            number: id,
            name: `Customer ${id}`,
            phone: null,
            email: null,
            address: null,
            tags: [],
            source: null,
            canTakeCredit: true,
            creditLimit: null,
            isArchived: false,
            loyaltyPoints: 0,
            lastPurchaseAt: null,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          }));
      }),
    },
    creditSale: {
      groupBy: jest.fn(async (args: any) =>
        groupSum(
          fixture.creditSales ?? [],
          'customerId',
          'totalAmount',
          args.where.customerId.in,
        ),
      ),
    },
    creditPayment: {
      groupBy: jest.fn(async (args: any) =>
        groupSum(
          fixture.creditPayments ?? [],
          'customerId',
          'amount',
          args.where.customerId.in,
        ),
      ),
    },
    purchase: {
      groupBy: jest.fn(async (args: any) =>
        groupSum(
          fixture.purchases ?? [],
          'vendorCustomerId',
          'totalCost',
          args.where.vendorCustomerId.in,
          (row) => row.paymentType === 'CREDIT',
        ),
      ),
    },
    purchasePayment: {
      groupBy: jest.fn(async (args: any) =>
        groupSum(
          fixture.purchasePayments ?? [],
          'customerId',
          'amount',
          args.where.customerId.in,
        ),
      ),
    },
    $queryRaw: jest.fn(async (...args: any[]) => {
      rawSql.push(String(args[0].join('')));
      return (fixture.debtorIds ?? []).map((id) => ({ id }));
    }),
  };

  return {
    svc: new CustomersService(prisma as any, {} as any),
    prisma,
    sql: () => rawSql.join('\n'),
  };
}

/** One directory row, as the credits page receives it. */
async function listedRow(fixture: Fixture) {
  const { svc } = makeService(fixture);
  const rows = await svc.findAll(undefined, {});
  return rows[0] as any;
}

/**
 * The invariant the UI leans on: the pair is mutually exclusive, so a row can
 * never read "owed to me" and "owed to them" at the same time.
 */
function expectExclusive(row: any) {
  const live = [row.remaining, row.remainingToPay].filter((n) => n > 0);
  expect(live).toHaveLength(row.netBalance === 0 ? 0 : 1);
}

describe('CustomersService — mutual-trade netting', () => {
  it('nets a credit sale against goods taken on credit (day 1: we are owed)', async () => {
    // 4,000 sold on credit, 3,000 of goods taken from the same person on credit.
    const row = await listedRow({
      creditSales: [{ customerId: 7, totalAmount: 4000 }],
      purchases: [
        { vendorCustomerId: 7, totalCost: 3000, paymentType: 'CREDIT' },
      ],
      debtorIds: [7],
    });

    expect(row.remaining).toBe(1000);
    expect(row.remainingToPay).toBe(0);
    expect(row.netBalance).toBe(1000);
    expectExclusive(row);

    // The gross figures survive netting, so the row stays auditable.
    expect(row.totalCredits).toBe(4000);
    expect(row.totalPaid).toBe(0);
    expect(row.totalTakenOnCredit).toBe(3000);
    expect(row.totalPaidToVendor).toBe(0);
  });

  it('flips to payables when more is taken on credit than sold (day 2)', async () => {
    // A further 6,000 taken on credit: 9,000 owed to them against 6,000 owed to us.
    const row = await listedRow({
      creditSales: [
        { customerId: 7, totalAmount: 4000 },
        { customerId: 7, totalAmount: 2000 },
      ],
      purchases: [
        { vendorCustomerId: 7, totalCost: 3000, paymentType: 'CREDIT' },
        { vendorCustomerId: 7, totalCost: 6000, paymentType: 'CREDIT' },
      ],
      debtorIds: [],
    });

    expect(row.remaining).toBe(0);
    expect(row.remainingToPay).toBe(3000);
    expect(row.netBalance).toBe(-3000);
    expectExclusive(row);

    expect(row.totalCredits).toBe(6000);
    expect(row.totalTakenOnCredit).toBe(9000);
    expect(row.totalPaidToVendor).toBe(0);
  });

  it('counts both sides when both have been paid down', async () => {
    // 10,000 sold with 6,000 collected, 4,000 taken on credit with 3,000 paid.
    const row = await listedRow({
      creditSales: [{ customerId: 7, totalAmount: 10000 }],
      creditPayments: [{ customerId: 7, amount: 6000 }],
      purchases: [
        { vendorCustomerId: 7, totalCost: 4000, paymentType: 'CREDIT' },
      ],
      purchasePayments: [{ customerId: 7, amount: 3000 }],
    });

    expect(row.remaining).toBe(3000); // 4,000 receivable vs 1,000 payable
    expect(row.remainingToPay).toBe(0);
    expect(row.netBalance).toBe(3000);
    expectExclusive(row);
  });

  it('settles to exactly zero on both sides, with no negative zero', async () => {
    const row = await listedRow({
      creditSales: [{ customerId: 7, totalAmount: 2500 }],
      creditPayments: [{ customerId: 7, amount: 2500 }],
      purchases: [
        { vendorCustomerId: 7, totalCost: 1750, paymentType: 'CREDIT' },
      ],
      purchasePayments: [{ customerId: 7, amount: 1750 }],
    });

    // `toBe` is Object.is, so this also proves -0 was normalised away.
    expect(row.remaining).toBe(0);
    expect(row.remainingToPay).toBe(0);
    expect(row.netBalance).toBe(0);
  });

  it('rounds a float tail on either side away to zero', async () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
    const row = await listedRow({
      creditSales: [
        { customerId: 7, totalAmount: 0.1 },
        { customerId: 7, totalAmount: 0.2 },
      ],
      purchases: [
        { vendorCustomerId: 7, totalCost: 0.3, paymentType: 'CREDIT' },
      ],
    });

    expect(row.remaining).toBe(0);
    expect(row.remainingToPay).toBe(0);
    expect(row.netBalance).toBe(0);
  });

  it('leaves purchases already paid for out of the netting', async () => {
    // Only CREDIT purchases are a liability; a cash purchase is already settled.
    const row = await listedRow({
      creditSales: [{ customerId: 7, totalAmount: 1000 }],
      purchases: [
        { vendorCustomerId: 7, totalCost: 5000, paymentType: 'PAID' },
      ],
    });

    expect(row.totalTakenOnCredit).toBe(0);
    expect(row.remaining).toBe(1000);
    expect(row.remainingToPay).toBe(0);
  });

  it('reports zero on both sides for a customer with no trade at all', async () => {
    const row = await listedRow({});

    expect(row.totalCredits).toBe(0);
    expect(row.totalPaid).toBe(0);
    expect(row.totalTakenOnCredit).toBe(0);
    expect(row.totalPaidToVendor).toBe(0);
    expect(row.remaining).toBe(0);
    expect(row.remainingToPay).toBe(0);
    expect(row.netBalance).toBe(0);
  });

  describe('the "only with debt" filter', () => {
    it('passes the ids the netting query returns straight through', async () => {
      const { svc } = makeService({ ids: [7, 8], debtorIds: [8] });
      const rows = (await svc.findAll(undefined, { onlyDebt: true })) as any[];

      expect(rows.map((r) => r.id)).toEqual([8]);
    });

    it('decides "with debt" from both sides of the relationship', async () => {
      // Shape guard for the SQL itself: a customer whose receivable is fully
      // covered by what we took from them must not be listed as owing money,
      // which is what the Remaining column beside the row would otherwise say.
      const { svc, sql } = makeService({ debtorIds: [] });
      await svc.findAll(undefined, { onlyDebt: true });
      const query = sql();

      expect(query).toContain('FROM "CreditSale"');
      expect(query).toContain('FROM "CreditPayment"');
      expect(query).toContain('FROM "Purchase"');
      expect(query).toContain('FROM "PurchasePayment"');
      expect(query).toContain(`p."paymentType"::text = 'CREDIT'`);
      // Payables are subtracted from the receivable, payments to them added back.
      expect(query).toMatch(/- COALESCE\([\s\S]*FROM "Purchase"/);
      expect(query).toMatch(/\+ COALESCE\([\s\S]*FROM "PurchasePayment"/);
    });
  });
});
