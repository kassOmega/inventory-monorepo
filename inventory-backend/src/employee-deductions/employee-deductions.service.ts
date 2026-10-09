// src/employee-deductions/employee-deductions.service.ts
// Employee loans & penalties, deducted from salary or commission. A deduction
// has a running balance (append-only recoveries) and a derived status. Recovery
// is capped at a configurable % of the period pay for the payout run, and the
// same cap guards against stacking loans that could never be recovered.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { auditBestEffort } from '../common/audit.util';

/** Default cap when the tenant has not configured one. */
export const DEFAULT_DEDUCTION_CAP_PERCENT = 30;
/** Days ahead that count as "due soon". */
export const DUE_SOON_DAYS = 5;

export interface DeductionInput {
  userId?: number | null;
  washerId?: number | null;
  kind: 'LOAN' | 'PENALTY';
  source?: 'SALARY' | 'COMMISSION';
  reason: string;
  amount: number;
  dueAt?: string | null;
  notes?: string | null;
}

@Injectable()
export class EmployeeDeductionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private tenantId(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new ForbiddenException('No active organization');
    return id;
  }

  /** The tenant's configured recovery cap (% of period pay), defaulted. */
  async capPercent(tenantId = this.tenantId()): Promise<number> {
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const s = (org?.settings ?? {}) as Record<string, unknown>;
    const raw = Number(s.deductionCapPercent);
    return Number.isFinite(raw) && raw >= 0 && raw <= 100
      ? raw
      : DEFAULT_DEDUCTION_CAP_PERCENT;
  }

  async setCapPercent(percent: number): Promise<{ deductionCapPercent: number }> {
    const tenantId = this.tenantId();
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = { ...((org?.settings ?? {}) as Record<string, unknown>) };
    settings.deductionCapPercent = safe;
    await this.prisma.organization.update({
      where: { id: tenantId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    return { deductionCapPercent: safe };
  }

  // --- Queries --------------------------------------------------------------

  async list(filter?: {
    userId?: number;
    washerId?: number;
    kind?: string;
    status?: string;
    source?: string;
  }) {
    const tenantId = this.tenantId();
    return this.prisma.employeeDeduction.findMany({
      where: {
        tenantId,
        ...(filter?.userId ? { userId: filter.userId } : {}),
        ...(filter?.washerId ? { washerId: filter.washerId } : {}),
        ...(filter?.kind ? { kind: filter.kind as any } : {}),
        ...(filter?.status ? { status: filter.status as any } : {}),
        ...(filter?.source ? { source: filter.source as any } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        washer: { select: { id: true, name: true, phone: true } },
        recoveries: { orderBy: { recoveredAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async listForEmployee(opts: { userId?: number; washerId?: number }) {
    return this.list({ userId: opts.userId, washerId: opts.washerId });
  }

  async get(id: number) {
    const tenantId = this.tenantId();
    const row = await this.prisma.employeeDeduction.findFirst({
      where: { id, tenantId },
      include: {
        recoveries: { orderBy: { recoveredAt: 'desc' } },
        user: { select: { id: true, name: true } },
        washer: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('Deduction not found');
    return row;
  }

  /** Outstanding (open + partial) totals per employee. */
  async summaryForEmployee(opts: { userId?: number; washerId?: number }) {
    const tenantId = this.tenantId();
    const rows = await this.prisma.employeeDeduction.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'PARTIAL'] },
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.washerId ? { washerId: opts.washerId } : {}),
      },
    });
    const outstanding = rows.reduce(
      (s, r) => s + Math.max(0, r.amount - r.recoveredAmount),
      0,
    );
    const loans = rows
      .filter((r) => r.kind === 'LOAN')
      .reduce((s, r) => s + Math.max(0, r.amount - r.recoveredAmount), 0);
    const penalties = outstanding - loans;
    return { outstanding, loans, penalties, count: rows.length };
  }

  /** Deductions whose remainder is due within `days` and still outstanding. */
  async dueSoon(days = DUE_SOON_DAYS) {
    const tenantId = this.tenantId();
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.prisma.employeeDeduction.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'PARTIAL'] },
        dueAt: { not: null, lte: until },
      },
      include: {
        user: { select: { id: true, name: true } },
        washer: { select: { id: true, name: true } },
      },
      orderBy: { dueAt: 'asc' },
    });
  }

  /**
   * Notify owners about deductions whose remainder is due soon. Idempotent PER
   * PERIOD: the dedupe key includes the due date, so a read reminder stays gone
   * for that due date but a new due date notifies again (the intended nag).
   */
  async remindDueSoon(days = DUE_SOON_DAYS): Promise<{ reminded: number }> {
    const tenantId = this.tenantId();
    const rows = await this.dueSoon(days);
    for (const d of rows) {
      const who = d.user?.name ?? d.washer?.name ?? 'employee';
      const when = d.dueAt ? new Date(d.dueAt).toISOString().slice(0, 10) : '';
      await this.notifications.notifyOwner(
        'Deduction due soon',
        `${who}: ${d.kind === 'LOAN' ? 'loan' : 'penalty'} balance is due on ${when}.`,
        {
          type: 'DEDUCTION_DUE',
          link: '/dashboard/staff-deductions',
          dedupeKey: `DEDUCTION_DUE:${d.id}:${when}`,
        },
      );
    }
    return { reminded: rows.length };
  }

  // --- Mutations ------------------------------------------------------------

  private async assertEmployee(belongsToTenant: boolean, label: string) {
    if (!belongsToTenant) throw new BadRequestException(`${label} not found`);
  }

  async create(input: DeductionInput, actorId?: number) {
    const tenantId = this.tenantId();
    if (!input.userId && !input.washerId) {
      throw new BadRequestException('A userId or washerId is required');
    }
    if (input.userId) {
      const u = await this.prisma.user.findFirst({
        where: { id: input.userId, memberships: { some: { organizationId: tenantId } } },
        select: { id: true },
      });
      await this.assertEmployee(!!u, 'Employee');
    }
    if (input.washerId) {
      const w = await this.prisma.carWashWasher.findFirst({
        where: { id: input.washerId, tenantId },
        select: { id: true },
      });
      await this.assertEmployee(!!w, 'Washer');
    }

    const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    // Duplicate-loan guard: a new LOAN may not push the employee's outstanding
    // loan balance over the cap basis (their base salary for the period).
    if (input.kind === 'LOAN') {
      await this.assertLoanWithinCap(tenantId, input, amount);
    }

    const created = await this.prisma.employeeDeduction.create({
      data: {
        tenantId,
        userId: input.userId ?? null,
        washerId: input.washerId ?? null,
        kind: input.kind,
        source: input.source ?? 'SALARY',
        reason: input.reason.trim(),
        amount,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        notes: input.notes ?? null,
        createdById: actorId ?? null,
      },
    });

    // A loan moves cash out: post Dr Loans Receivable / Cr Cash. Penalties post
    // nothing on issue (they are recognized on recovery).
    if (input.kind === 'LOAN') {
      await this.prisma
        .$transaction((tx) =>
          this.finance.postEmployeeLoan({
            deductionId: created.id,
            amount,
            tenantId,
            tx,
            createdById: actorId ?? null,
          }),
        )
        .catch(() => {});
    }

    if (actorId != null) {
      await auditBestEffort(this.prisma, {
        userId: actorId,
        action: input.kind === 'LOAN' ? 'EMPLOYEE_LOAN' : 'EMPLOYEE_PENALTY',
        details: `${input.kind} ${amount} — ${input.reason}`,
      });
    }
    return this.get(created.id);
  }

  /**
   * Cap rule: outstanding loans must not exceed the employee's base salary for
   * one period (a conservative ceiling so a loan can always be recovered).
   */
  private async assertLoanWithinCap(
    tenantId: number,
    input: DeductionInput,
    newAmount: number,
  ) {
    const percent = await this.capPercent(tenantId);
    const base = await this.periodPayFor(tenantId, input);
    if (base <= 0) return; // no salary configured → nothing to enforce against
    const cap = (base * percent) / 100;
    const existing = await this.prisma.employeeDeduction.findMany({
      where: {
        tenantId,
        kind: 'LOAN',
        status: { in: ['OPEN', 'PARTIAL'] },
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.washerId ? { washerId: input.washerId } : {}),
      },
    });
    const outstanding = existing.reduce(
      (s, r) => s + Math.max(0, r.amount - r.recoveredAmount),
      0,
    );
    if (outstanding + newAmount > cap + 0.001) {
      throw new BadRequestException(
        `Outstanding loans would exceed the ${percent}% cap (${cap.toFixed(2)}) for one period.`,
      );
    }
  }

  /** The employee's base period pay (salary), used as the cap basis. */
  private async periodPayFor(tenantId: number, input: DeductionInput): Promise<number> {
    if (input.washerId) {
      const w = await this.prisma.carWashWasher.findFirst({
        where: { id: input.washerId, tenantId },
        select: { salaryAmount: true },
      });
      return Number(w?.salaryAmount ?? 0);
    }
    if (input.userId) {
      const u = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { salaryAmount: true },
      });
      return Number(u?.salaryAmount ?? 0);
    }
    return 0;
  }

  async update(id: number, data: Partial<DeductionInput>, actorId?: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.employeeDeduction.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Deduction not found');
    if (existing.status === 'PAID' || existing.status === 'CANCELLED') {
      throw new BadRequestException('Only open/partial deductions can be edited');
    }
    if (data.amount !== undefined && data.amount < existing.recoveredAmount) {
      throw new BadRequestException(
        'Amount cannot be less than what was already recovered',
      );
    }
    return this.prisma.employeeDeduction.update({
      where: { id },
      data: {
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.source !== undefined ? { source: data.source as any } : {}),
        ...(data.dueAt !== undefined
          ? { dueAt: data.dueAt ? new Date(data.dueAt) : null }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
  }

  async recover(
    id: number,
    amount: number,
    opts: { note?: string; periodPay?: number } = {},
    actorId?: number,
  ) {
    const tenantId = this.tenantId();
    const deduction = await this.prisma.employeeDeduction.findFirst({
      where: { id, tenantId },
    });
    if (!deduction) throw new NotFoundException('Deduction not found');
    if (deduction.status === 'CANCELLED') {
      throw new BadRequestException('Deduction is cancelled');
    }
    const remaining = Math.round((deduction.amount - deduction.recoveredAmount) * 100) / 100;
    if (remaining <= 0) return this.get(id);

    const amt = Math.round((Number(amount) || 0) * 100) / 100;
    if (amt <= 0) throw new BadRequestException('Amount must be positive');
    if (amt > remaining + 0.001) {
      throw new BadRequestException(
        `Recovery exceeds the outstanding balance (${remaining.toFixed(2)})`,
      );
    }

    // Cap this recovery at the tenant's % of the period pay for the run.
    const percent = await this.capPercent(tenantId);
    const basis = opts.periodPay ?? 0;
    if (basis > 0) {
      const max = Math.round(((basis * percent) / 100) * 100) / 100;
      if (amt > max + 0.001) {
        throw new BadRequestException(
          `Recovery exceeds the ${percent}% cap of the period pay (${max.toFixed(2)})`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const recovery = await tx.employeeDeductionRecovery.create({
        data: {
          deductionId: id,
          tenantId,
          amount: amt,
          note: opts.note ?? null,
          createdById: actorId ?? null,
        },
      });
      const recovered = Math.round((deduction.recoveredAmount + amt) * 100) / 100;
      const status =
        recovered >= deduction.amount - 0.001 ? 'PAID' : recovered > 0 ? 'PARTIAL' : 'OPEN';
      await tx.employeeDeduction.update({
        where: { id },
        data: { recoveredAmount: recovered, status },
      });
      await this.finance.postDeductionRecovery({
        recoveryId: recovery.id,
        amount: amt,
        kind: deduction.kind,
        tenantId,
        tx,
        createdById: actorId ?? null,
      });
      if (actorId != null) {
        await auditBestEffort(tx, {
          userId: actorId,
          action: 'DEDUCTION_RECOVERED',
          details: `Recovered ${amt} on deduction #${id} (${deduction.kind})`,
        });
      }
      return this.get(id);
    });
  }

  /**
   * Sweep every open deduction for an employee from a payout, oldest first,
   * respecting the % cap of the payout amount. Returns the total recovered.
   */
  async sweepForPayout(
    opts: { userId?: number; washerId?: number; source: 'SALARY' | 'COMMISSION'; periodPay: number; note?: string },
    actorId?: number,
  ) {
    const tenantId = this.tenantId();
    const percent = await this.capPercent(tenantId);
    let budget = Math.round(((Math.max(0, opts.periodPay) * percent) / 100) * 100) / 100;
    if (budget <= 0) return { recovered: 0 };

    const open = await this.prisma.employeeDeduction.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'PARTIAL'] },
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.washerId ? { washerId: opts.washerId } : {}),
      },
      orderBy: { issuedAt: 'asc' },
    });

    let recovered = 0;
    for (const d of open) {
      if (budget <= 0) break;
      const remaining = Math.round((d.amount - d.recoveredAmount) * 100) / 100;
      if (remaining <= 0) continue;
      const take = Math.min(remaining, budget);
      if (take <= 0) continue;
      await this.recover(
        d.id,
        take,
        { note: opts.note ?? 'Auto-deducted from payout', periodPay: opts.periodPay },
        actorId,
      );
      recovered = Math.round((recovered + take) * 100) / 100;
      budget = Math.round((budget - take) * 100) / 100;
    }
    return { recovered };
  }

  async cancel(id: number, actorId?: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.employeeDeduction.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Deduction not found');
    if (existing.status === 'CANCELLED') return existing;
    const updated = await this.prisma.employeeDeduction.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    if (actorId != null) {
      await auditBestEffort(this.prisma, {
        userId: actorId,
        action: 'DEDUCTION_CANCELLED',
        details: `Cancelled deduction #${id}`,
      });
    }
    return updated;
  }
}
