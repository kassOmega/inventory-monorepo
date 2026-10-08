// src/carwash/carwash-report-permissions.spec.ts
// The report breakdown redacts company sections the caller may not see and
// keeps the caller's OWN commission data (washer scope). Owners/managers see all.
import { CarWashService } from './carwash.service';
import { tenantContext } from '../common/tenant/tenant.context';

function setup(washerRow: any = null) {
  const washes = [
    {
      amount: 100,
      washerId: 5,
      washer: { id: 5, commissionRate: 50 },
      participantWashers: [],
    },
  ];
  const prisma: any = {
    carWash: { findMany: jest.fn(() => Promise.resolve(washes)) },
    carWashEquipmentIssue: { findMany: jest.fn(() => Promise.resolve([])) },
    expense: { findMany: jest.fn(() => Promise.resolve([])) },
    product: { findMany: jest.fn(() => Promise.resolve([])) },
    carWashWasher: {
      findMany: jest.fn(() =>
        Promise.resolve(washerRow ? [washerRow] : [{ id: 5, name: 'Abel', commissionRate: 50 }]),
      ),
      findFirst: jest.fn(() => Promise.resolve(washerRow)),
    },
  };
  return { svc: new CarWashService(prisma, {} as any), prisma };
}

describe('CarWashService.reportsBreakdown permission redaction', () => {
  it('owner (all detail keys) sees every section', async () => {
    const { svc } = setup(null);
    const res: any = await tenantContext.run(1, () =>
      svc.reportsBreakdown('2026-10-01', '2026-10-31', {
        sub: 1,
        permissions: [
          'carwash.reports.view',
          'carwash.reports.financials',
          'carwash.reports.commission',
          'carwash.reports.inventory',
          'carwash.reports.equipment',
        ],
      }),
    );
    expect(res.totalRevenue).toBe(100);
    expect(res.sections).toEqual({
      financials: true,
      commission: true,
      inventory: true,
      equipment: true,
    });
  });

  it('washer sees only their own commission, company sections redacted', async () => {
    const { svc } = setup({ id: 5, name: 'Abel', commissionRate: 50 });
    const res: any = await tenantContext.run(1, () =>
      svc.reportsBreakdown('2026-10-01', '2026-10-31', {
        sub: 9,
        permissions: ['carwash.reports.view', 'carwash.reports.commission'],
      }),
    );
    // Company financials/inventory/equipment are redacted…
    expect(res.totalRevenue).toBeNull();
    expect(res.ownerShare).toBeNull();
    expect(res.netProfit).toBeNull();
    expect(res.lowStockItems).toEqual([]);
    expect(res.paidEquipmentByWasher).toEqual([]);
    // …but own commission is present.
    expect(res.totalCommission).toBeGreaterThan(0);
    expect(res.washerEarnings.length).toBe(1);
    expect(res.washerEarnings[0].washerId).toBe(5);
    expect(res.sections).toEqual({
      financials: false,
      commission: true,
      inventory: false,
      equipment: false,
    });
  });

  it('never returns other washers rows to a washer caller', async () => {
    // The DB `carWashWasher.findMany` is called with `{ id: <own> }` when the
    // caller is a washer, so other washers can never appear in washerEarnings.
    const { svc, prisma } = setup({ id: 5, name: 'Abel', commissionRate: 50 });
    await tenantContext.run(1, () =>
      svc.reportsBreakdown('2026-10-01', '2026-10-31', {
        sub: 9,
        permissions: ['carwash.reports.view', 'carwash.reports.commission'],
      }),
    );
    expect(prisma.carWashWasher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 } }),
    );
    expect(prisma.carWashEquipmentIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ washerId: 5 }),
      }),
    );
  });

  it('financials-only caller gets financials, not inventory/equipment', async () => {
    const { svc } = setup(null);
    const res: any = await tenantContext.run(1, () =>
      svc.reportsBreakdown('2026-10-01', '2026-10-31', {
        sub: 1,
        permissions: ['carwash.reports.view', 'carwash.reports.financials'],
      }),
    );
    expect(res.totalRevenue).toBe(100);
    expect(res.lowStockItems).toEqual([]);
    expect(res.paidEquipmentByWasher).toEqual([]);
    expect(res.sections.financials).toBe(true);
    expect(res.sections.inventory).toBe(false);
    expect(res.sections.equipment).toBe(false);
  });
});
