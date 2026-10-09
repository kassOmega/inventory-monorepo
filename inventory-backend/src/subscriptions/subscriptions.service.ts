// src/subscriptions/subscriptions.service.ts
// Tenant subscription lifecycle: pricing (default per business type + per-tenant
// override), admin-managed bank accounts, client receipt submission with AI
// review, and the derived ACTIVE/GRACE/EXPIRED state.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessType,
  SubscriptionPaymentStatus,
  SubscriptionStatus,
  SubscriptionTerm,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionAiService } from './subscription-ai.service';
import { classify, daysUntil, periodEnd } from './subscription.constants';
import type { UploadedFileShape } from '../common/upload.config';

export interface OrgSubscriptionView {
  status: SubscriptionStatus;
  term: SubscriptionTerm | null;
  startedAt: Date | null;
  expiresAt: Date | null;
  daysLeft: number | null;
  freeForever: boolean;
  lifetime: boolean;
  priceOverride: number | null;
  autoRenew: boolean;
  note: string | null;
  /** True while the current period is the admin-granted free trial. */
  isTrial: boolean;
  /** The business owner's name (used to default the payer when a third party pays). */
  ownerName: string | null;
  /** When true the tenant is past grace and should be read-only. */
  readOnly: boolean;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: SubscriptionAiService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Platform settings (trial) -------------------------------------------

  /** The platform trial length (days) granted to every new business. */
  async getTrialDays(): Promise<number> {
    const row = await this.prisma.subscriptionSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, trialDays: 14 },
    });
    return row.trialDays;
  }

  /** Admin: set the trial length for future businesses. */
  async setTrialDays(days: number) {
    const safe = Math.max(0, Math.floor(days));
    return this.prisma.subscriptionSetting.upsert({
      where: { id: 1 },
      update: { trialDays: safe },
      create: { id: 1, trialDays: safe },
    });
  }

  /**
   * Create the initial subscription for a brand-new business: a free trial that
   * runs `trialDays` from now (0 days disables the trial and starts it as a
   * normal billable subscription that immediately needs payment).
   */
  async startTrialForOrg(organizationId: number) {
    const days = await this.getTrialDays();
    const now = new Date();
    const expiresAt = days > 0 ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000) : null;
    return this.prisma.tenantSubscription.upsert({
      where: { organizationId },
      update: {},
      create: {
        organizationId,
        status: SubscriptionStatus.ACTIVE,
        isTrial: days > 0,
        startedAt: now,
        expiresAt,
        term: null,
      },
    });
  }

  // --- Pricing --------------------------------------------------------------

  /** All default plans (admin view), ordered by business type + term. */
  async listPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: [{ businessType: 'asc' }, { term: 'asc' }],
    });
  }

  /** Upsert a default price for (businessType?, term). `businessType` null = global. */
  async upsertPlan(input: {
    businessType: BusinessType | null;
    term: SubscriptionTerm;
    price: number;
    currency?: string;
    active?: boolean;
  }) {
    const where = input.businessType
      ? { businessType_term: { businessType: input.businessType, term: input.term } }
      : undefined;
    const existing = where
      ? await this.prisma.subscriptionPlan.findUnique({ where })
      : await this.prisma.subscriptionPlan.findFirst({
          where: { businessType: null, term: input.term },
        });

    if (existing) {
      return this.prisma.subscriptionPlan.update({
        where: { id: existing.id },
        data: {
          price: input.price,
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.active != null ? { active: input.active } : {}),
        },
      });
    }
    return this.prisma.subscriptionPlan.create({
      data: {
        businessType: input.businessType,
        term: input.term,
        price: input.price,
        currency: input.currency ?? 'ETB',
        active: input.active ?? true,
      },
    });
  }

  /**
   * The price a tenant pays for a term: their per-tenant override when set,
   * otherwise their business type's default, otherwise the global default.
   */
  async resolvePrice(
    organizationId: number,
    term: SubscriptionTerm,
  ): Promise<{ amount: number; currency: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { businessType: true, currency: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const sub = await this.prisma.tenantSubscription.findUnique({
      where: { organizationId },
      select: { priceOverride: true },
    });
    if (sub?.priceOverride != null) {
      return { amount: sub.priceOverride, currency: org.currency };
    }

    const plan =
      (await this.prisma.subscriptionPlan.findFirst({
        where: { businessType: org.businessType, term, active: true },
      })) ??
      (await this.prisma.subscriptionPlan.findFirst({
        where: { businessType: null, term, active: true },
      }));
    return { amount: plan?.price ?? 0, currency: plan?.currency ?? org.currency };
  }

  // --- Per-tenant subscription state ---------------------------------------

  private async ensureRow(organizationId: number) {
    return this.prisma.tenantSubscription.upsert({
      where: { organizationId },
      update: {},
      create: { organizationId, status: SubscriptionStatus.ACTIVE },
    });
  }

  /** Effective view of a tenant's subscription, with derived status + days left. */
  async getForOrg(organizationId: number): Promise<OrgSubscriptionView> {
    const row = await this.ensureRow(organizationId);
    const freeForever = row.status === SubscriptionStatus.FREE;
    const lifetime = row.status === SubscriptionStatus.LIFETIME;

    let status: SubscriptionStatus = row.status;
    if (!freeForever && !lifetime) {
      status = classify(row.expiresAt) as SubscriptionStatus;
    }

    const days = daysUntil(row.expiresAt);
    const readOnly = status === SubscriptionStatus.EXPIRED;

    return {
      status,
      term: row.term,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      daysLeft: days,
      freeForever,
      lifetime,
      priceOverride: row.priceOverride,
      autoRenew: row.autoRenew,
      note: row.note,
      isTrial: row.isTrial,
      ownerName: await this.ownerNameFor(organizationId),
      readOnly,
    };
  }

  /** Admin: set a tenant's subscription (override price, term, free/lifetime, expiry). */
  async adminUpdate(
    organizationId: number,
    input: {
      status?: SubscriptionStatus;
      term?: SubscriptionTerm | null;
      priceOverride?: number | null;
      expiresAt?: string | null;
      autoRenew?: boolean;
      note?: string | null;
    },
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    await this.ensureRow(organizationId);

    const data: Record<string, unknown> = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.term !== undefined) data.term = input.term;
    if (input.priceOverride !== undefined) data.priceOverride = input.priceOverride;
    if (input.autoRenew !== undefined) data.autoRenew = input.autoRenew;
    if (input.note !== undefined) data.note = input.note;
    if (input.expiresAt !== undefined) {
      data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    }
    // FREE / LIFETIME have no expiry.
    if (
      input.status === SubscriptionStatus.FREE ||
      input.status === SubscriptionStatus.LIFETIME
    ) {
      data.expiresAt = null;
    }

    return this.prisma.tenantSubscription.update({
      where: { organizationId },
      data,
    });
  }

  // --- Bank accounts --------------------------------------------------------

  async listBankAccounts(onlyActive = false) {
    return this.prisma.bankAccount.findMany({
      where: onlyActive ? { active: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Active accounts offered to a tenant of the given business type. */
  async bankAccountsForOrg(organizationId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { businessType: true },
    });
    const all = await this.prisma.bankAccount.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    // Type-specific accounts take precedence; when any exist for the type, only
    // those are shown, otherwise the general (businessType = null) accounts.
    const typed = all.filter((a) => a.businessType === org?.businessType);
    return typed.length > 0 ? typed : all.filter((a) => a.businessType === null);
  }

  async createBankAccount(input: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    branch?: string | null;
    businessType?: BusinessType | null;
    active?: boolean;
    sortOrder?: number;
  }) {
    return this.prisma.bankAccount.create({
      data: {
        bankName: input.bankName.trim(),
        accountName: input.accountName.trim(),
        accountNumber: input.accountNumber.trim(),
        branch: input.branch?.trim() || null,
        businessType: input.businessType ?? null,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async updateBankAccount(
    id: number,
    input: Partial<{
      bankName: string;
      accountName: string;
      accountNumber: string;
      branch: string | null;
      businessType: BusinessType | null;
      active: boolean;
      sortOrder: number;
    }>,
  ) {
    const existing = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Bank account not found');
    return this.prisma.bankAccount.update({ where: { id }, data: input });
  }

  async deleteBankAccount(id: number) {
    await this.prisma.bankAccount.delete({ where: { id } });
    return { ok: true };
  }

  // --- Receipt submission + AI review ---------------------------------------

  /**
   * Record a submitted receipt, run the AI review, and either extend the
   * subscription (auto-approve) or leave it for an admin (flag / reject).
   * The client response always succeeds; a review problem never blocks submit.
   */
  async submitPayment(opts: {
    organizationId: number;
    userId: number;
    term: SubscriptionTerm;
    bankAccountId?: number;
    payerName?: string;
    transactionRef?: string;
    amount?: number;
    file: UploadedFileShape;
  }) {
    const org = await this.prisma.organization.findUnique({
      where: { id: opts.organizationId },
      select: { name: true, currency: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // A bank reference can only be used once per tenant — this stops the SAME
    // receipt being replayed to extend the subscription twice.
    const ref = opts.transactionRef?.trim() || null;
    if (ref) {
      const dup = await this.prisma.subscriptionPayment.findFirst({
        where: { organizationId: opts.organizationId, transactionRef: ref },
        select: { id: true },
      });
      if (dup) throw new BadRequestException('This transaction reference was already submitted.');
    }

    const priced = await this.resolvePrice(opts.organizationId, opts.term);
    const bank = opts.bankAccountId
      ? await this.prisma.bankAccount.findUnique({ where: { id: opts.bankAccountId } })
      : null;

    // Anyone may pay for the business. When the payer name is left blank (e.g. a
    // third party paid), default it to the business owner's name so the AI has a
    // sensible expected name to compare the receipt against.
    const ownerName = await this.ownerNameFor(opts.organizationId);
    const payerName = opts.payerName?.trim() || ownerName || null;

    const created = await this.prisma.subscriptionPayment.create({
      data: {
        organizationId: opts.organizationId,
        submittedById: opts.userId,
        term: opts.term,
        amount: opts.amount ?? priced.amount,
        currency: priced.currency,
        bankAccountId: opts.bankAccountId ?? null,
        payerName,
        transactionRef: ref,
        fileName: opts.file.originalname,
        mimeType: opts.file.mimetype,
        size: opts.file.size,
        filePath: opts.file.path,
        status: SubscriptionPaymentStatus.PENDING,
      },
    });

    // AI review (best-effort). Expected values come from admin configuration,
    // never from the client.
    let review: Awaited<ReturnType<SubscriptionAiService['review']>>;
    try {
      review = await this.ai.review({
        filePath: opts.file.path,
        mimeType: opts.file.mimetype,
        businessName: org.name,
        claimedPayerName: opts.payerName,
        expectedAccountName: bank?.accountName,
        expectedAccountNumber: bank?.accountNumber,
        expectedBankName: bank?.bankName,
        expectedAmount: priced.amount,
        currency: priced.currency,
      });
    } catch (err) {
      this.logger.warn(`Receipt review threw: ${(err as Error).message}`);
      review = {
        decision: 'FLAG',
        confidence: 0,
        reasons: ['AI review errored — requires manual review.'],
        extracted: {
          payerName: null,
          bankName: null,
          accountNumber: null,
          amount: null,
          date: null,
          reference: null,
        },
        unavailable: true,
      };
    }

    // Reconcile the reference: if the client typed one, flag a mismatch against
    // what the receipt shows; if they left it blank, adopt the receipt's own
    // reference (so the anti-replay unique check still applies to it).
    const extractedRef = review.extracted?.reference?.trim() || null;
    let finalRef = ref;
    let mismatch = false;
    if (ref && extractedRef) {
      const a = ref.replace(/\D+/g, '');
      const b = extractedRef.replace(/\D+/g, '');
      mismatch = Boolean(a && b && a !== b);
    } else if (!ref && extractedRef) {
      finalRef = extractedRef;
    }
    if (mismatch) {
      review = {
        ...review,
        decision: 'FLAG',
        reasons: [
          `The transaction reference you entered (${ref}) does not match the one on the receipt (${extractedRef}).`,
          ...review.reasons,
        ].slice(0, 8),
      };
    }

    await this.prisma.subscriptionPayment.update({
      where: { id: created.id },
      data: {
        aiResult: review as object,
        aiDecision: review.decision,
        transactionRef: finalRef,
      },
    });

    if (review.decision === 'APPROVE') {
      await this.applyApproval(created.id, null, 'Auto-approved by AI review.');
      // notify the tenant
      await this.notifyOrg(
        opts.organizationId,
        'Subscription renewed',
        'Your subscription payment was verified and your subscription extended.',
      ).catch(() => {});
    } else {
      // Needs a human: queue for admin, notify them.
      await this.prisma.subscriptionPayment.update({
        where: { id: created.id },
        data: { status: SubscriptionPaymentStatus.FLAGGED },
      });
      await this.notifications
        .notifyAdmins(
          'Subscription receipt needs review',
          `${org.name} submitted a ${opts.term} payment receipt that the AI could not auto-verify.`,
          'ACCOUNT_VERIFICATION',
          `SUB_RECEIPT_FLAGGED:${created.id}`,
        )
        .catch(() => {});
    }

    return this.prisma.subscriptionPayment.findUnique({
      where: { id: created.id },
    });
  }

  /**
   * Apply an approved payment: set the period, extend from the later of now or
   * the current expiry, and flip the subscription to ACTIVE.
   */
  private async applyApproval(
    paymentId: number,
    reviewerId: number | null,
    adminNote: string | null,
  ) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const sub = await this.ensureRow(payment.organizationId);
    const now = new Date();
    // Extend from the current expiry when still in the future, otherwise now.
    const base =
      sub.expiresAt && sub.expiresAt.getTime() > now.getTime() ? sub.expiresAt : now;
    const start = now;
    const end = periodEnd(base, payment.term);

    await this.prisma.$transaction([
      this.prisma.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          status: SubscriptionPaymentStatus.APPROVED,
          periodStart: start,
          periodEnd: end,
          reviewedById: reviewerId,
          reviewedAt: now,
          adminNote,
        },
      }),
      this.prisma.tenantSubscription.update({
        where: { organizationId: payment.organizationId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          term: payment.term,
          startedAt: sub.startedAt ?? start,
          expiresAt: end,
        },
      }),
    ]);
    return { periodStart: start, periodEnd: end };
  }

  /** Admin: approve a flagged/pending payment (manual override). */
  async adminReviewPayment(
    paymentId: number,
    adminId: number,
    action: 'approve' | 'reject',
    note?: string,
  ) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      include: { organization: { select: { name: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (action === 'approve') {
      const period = await this.applyApproval(
        paymentId,
        adminId,
        note ?? 'Approved by admin.',
      );
      await this.notifyOrg(
        payment.organizationId,
        'Subscription renewed',
        `Your ${payment.term} subscription payment was approved. Valid to ${period.periodEnd.toDateString()}.`,
      ).catch(() => {});
    } else {
      await this.prisma.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          status: SubscriptionPaymentStatus.REJECTED,
          reviewedById: adminId,
          reviewedAt: new Date(),
          adminNote: note ?? 'Rejected by admin.',
        },
      });
      await this.notifyOrg(
        payment.organizationId,
        'Subscription payment rejected',
        note?.trim()
          ? note.trim()
          : 'Your receipt could not be verified. Please submit a valid receipt.',
      ).catch(() => {});
    }
    return this.prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
  }

  /** Admin: the review queue (defaults to items needing a human). */
  async listPayments(filter?: { status?: SubscriptionPaymentStatus; organizationId?: number }) {
    return this.prisma.subscriptionPayment.findMany({
      where: {
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.organizationId ? { organizationId: filter.organizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true, businessType: true } },
        bankAccount: true,
        submittedBy: { select: { id: true, name: true, email: true } },
      },
      take: 200,
    });
  }

  /** A tenant's own submission history. */
  async listOrgPayments(organizationId: number) {
    return this.prisma.subscriptionPayment.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Serve a stored receipt file with its MIME (permissioned by the controller). */
  async getPaymentFile(paymentId: number) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      select: { filePath: true, mimeType: true, fileName: true, organizationId: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /** Assert the requesting user owns / belongs to the payment's org (non-admin). */
  async assertOrgAccess(paymentId: number, organizationId: number) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      select: { organizationId: true },
    });
    if (!payment || payment.organizationId !== organizationId) {
      throw new ForbiddenException('Not your payment');
    }
  }

  // --- Reminders ------------------------------------------------------------

  /**
   * Tenants whose subscription expires within the renewal window (or is already
   * in grace / expired). Used by the client prompt and a scheduled reminder.
   */
  async expiringSoon(withinDays: number) {
    const now = new Date();
    const until = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    return this.prisma.tenantSubscription.findMany({
      where: {
        status: { notIn: [SubscriptionStatus.FREE, SubscriptionStatus.LIFETIME] },
        expiresAt: { not: null, lte: until },
      },
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  /** The business owner's display name (the default payer when a third party pays). */
  private async ownerNameFor(organizationId: number): Promise<string | null> {
    const ownerRole = await this.prisma.role.findFirst({
      where: { isSystem: true, organizationId },
      select: { id: true },
    });
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, ...(ownerRole ? { roleId: ownerRole.id } : {}) },
      include: { user: { select: { name: true } } },
      orderBy: { id: 'asc' },
    });
    return membership?.user?.name ?? null;
  }

  private async notifyOrg(organizationId: number, title: string, message: string) {
    // Owner(s) of the org get the notification. Admin actions run outside a
    // tenant context, so the org is passed explicitly.
    const ownerRole = await this.prisma.role.findFirst({
      where: { isSystem: true, organizationId },
      select: { id: true },
    });
    const owners = await this.prisma.membership.findMany({
      where: { organizationId, ...(ownerRole ? { roleId: ownerRole.id } : {}) },
      select: { userId: true },
    });
    for (const o of owners) {
      await this.notifications
        .notifyUser(o.userId, title, message, 'REQUEST_STATUS', organizationId)
        .catch(() => {});
    }
  }

  // --- Validation helper for the controller --------------------------------

  assertTerm(value: string): SubscriptionTerm {
    const terms: SubscriptionTerm[] = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'];
    if (!terms.includes(value as SubscriptionTerm)) {
      throw new BadRequestException('Invalid subscription term');
    }
    return value as SubscriptionTerm;
  }
}
