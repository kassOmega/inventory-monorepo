// src/employee-deductions/employee-deductions.service.spec.ts
// Cap enforcement + status transitions for employee loans/penalties.
import { BadRequestException } from '@nestjs/common';
import { EmployeeDeductionsService } from './employee-deductions.service';
import { tenantContext } from '../common/tenant/tenant.context';

function makeService(overrides: {
  deduction?: any;
  settings?: any;
  userSalary?: number;
}) {
  const deduction = overrides.deduction ?? {
    id: 1,
    tenantId: 9,
    userId: 5,
    washerId: null,
    kind: 'LOAN',
    source: 'SALARY',
    reason: 'Advance',
    amount: 1000,
    recoveredAmount: 0,
    status: 'OPEN',
  };
  const recoveries: any[] = [];
  const prisma: any = {
    organization: {
      findUnique: jest.fn(() =>
        Promise.resolve({ settings: overrides.settings ?? { deductionCapPercent: 30 } }),
      ),
      update: jest.fn(() => Promise.resolve({})),
    },
    user: {
      findUnique: jest.fn(() => Promise.resolve({ salaryAmount: overrides.userSalary ?? 0 })),
      findFirst: jest.fn(() => Promise.resolve({ id: 5 })),
    },
    carWashWasher: { findFirst: jest.fn(() => Promise.resolve(null)) },
    employeeDeduction: {
      findFirst: jest.fn(() => Promise.resolve(deduction)),
      findMany: jest.fn(() => Promise.resolve([deduction])),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 2, ...data })),
      update: jest.fn(({ data }: any) => {
        Object.assign(deduction, data);
        return Promise.resolve(deduction);
      }),
    },
    employeeDeductionRecovery: {
      create: jest.fn(({ data }: any) => {
        recoveries.push(data);
        return Promise.resolve({ id: 77, ...data });
      }),
    },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const finance: any = {
    postDeductionRecovery: jest.fn(() => Promise.resolve(true)),
    postEmployeeLoan: jest.fn(() => Promise.resolve(true)),
  };
  const svc = new EmployeeDeductionsService(prisma, finance, { notifyOwner: jest.fn(() => Promise.resolve()) } as any);
  return { svc, prisma, finance, deduction };
}

describe('EmployeeDeductionsService', () => {
  it('caps a recovery at the configured % of the period pay', async () => {
    const { svc } = makeService({ settings: { deductionCapPercent: 30 } });
    await tenantContext.run(9, async () => {
      await expect(
        svc.recover(1, 400, { periodPay: 1000 }), // 30% of 1000 = 300
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('allows a recovery within the cap and marks PAID when fully recovered', async () => {
    const { svc, finance, deduction } = makeService({
      settings: { deductionCapPercent: 50 },
      deduction: {
        id: 1, tenantId: 9, userId: 5, washerId: null, kind: 'LOAN',
        source: 'SALARY', reason: 'x', amount: 300, recoveredAmount: 0, status: 'OPEN',
      },
    });
    await tenantContext.run(9, async () => {
      await svc.recover(1, 300, { periodPay: 1000 });
    });
    expect(deduction.status).toBe('PAID');
    expect(deduction.recoveredAmount).toBe(300);
    expect(finance.postDeductionRecovery).toHaveBeenCalled();
  });

  it('marks PARTIAL on a partial recovery', async () => {
    const { svc, deduction } = makeService({
      settings: { deductionCapPercent: 50 },
      deduction: {
        id: 1, tenantId: 9, userId: 5, washerId: null, kind: 'PENALTY',
        source: 'SALARY', reason: 'x', amount: 1000, recoveredAmount: 0, status: 'OPEN',
      },
    });
    await tenantContext.run(9, async () => {
      await svc.recover(1, 200, { periodPay: 1000 });
    });
    expect(deduction.status).toBe('PARTIAL');
    expect(deduction.recoveredAmount).toBe(200);
  });

  it('rejects a recovery beyond the outstanding balance', async () => {
    const { svc } = makeService({
      settings: { deductionCapPercent: 90 },
      deduction: {
        id: 1, tenantId: 9, userId: 5, washerId: null, kind: 'LOAN',
        source: 'SALARY', reason: 'x', amount: 100, recoveredAmount: 80, status: 'PARTIAL',
      },
    });
    await tenantContext.run(9, async () => {
      await expect(
        svc.recover(1, 50, { periodPay: 1000 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('rejects a duplicate loan that would exceed the cap', async () => {
    const { svc } = makeService({
      settings: { deductionCapPercent: 30 },
      userSalary: 1000, // cap = 300
      deduction: {
        id: 1, tenantId: 9, userId: 5, washerId: null, kind: 'LOAN',
        source: 'SALARY', reason: 'x', amount: 250, recoveredAmount: 0, status: 'OPEN',
      },
    });
    await tenantContext.run(9, async () => {
      await expect(
        svc.create({
          userId: 5, kind: 'LOAN', reason: 'second', amount: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException); // 250 + 100 > 300
    });
  });
});
