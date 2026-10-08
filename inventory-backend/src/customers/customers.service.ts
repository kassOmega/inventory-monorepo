import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CustomerNoteKind, CustomerSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tr } from '../i18n/i18n.service';
import { Paging, pagedResult } from '../common/pagination.util';
import { round2 } from '../common/tax.util';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import {
  asNumericId,
  formatBusinessNumber,
} from '../common/business-number.util';
import { CustomerLoyaltyService } from './customer-loyalty.service';
import {
  AdjustLoyaltyDto,
  CreateCustomerDto,
  CreateCustomerNoteDto,
  UpdateCustomerDto,
  UpdateLoyaltyProgramDto,
} from './dto/customer.dto';

/** Filters the directory, the credit pickers and the sales picker all share. */
export interface CustomerFilters {
  search?: string;
  /** Only customers with an outstanding balance. */
  onlyDebt?: boolean;
  /** Only credit-eligible customers — the credit-sale picker's filter. */
  canTakeCredit?: boolean;
  /** Only archived customers (the directory's archived chip). */
  archivedOnly?: boolean;
  /** Only customers carrying this segment label. */
  tag?: string;
  /** Include archived customers (hidden by default). */
  includeArchived?: boolean;
  paging?: Paging;
}

/** Ceiling on the rows a single page of the directory may return. */
const MAX_PAGE_SIZE = 100;

/**
 * Mutual trade: a customer who also sells to us carries a balance on both sides
 * at once — what they took on credit from us, and what we took on credit from
 * them. The two cancel, and only the net is what actually changes hands, so
 * exactly one of the returned pair is ever non-zero.
 *
 * The gross figures stay on the row untouched (`totalCredits` / `totalPaid`
 * versus `totalTakenOnCredit` / `totalPaidToVendor`), so the netting is a
 * presentation of the same numbers, never a replacement for them. `round2` and
 * `Math.max(0, …)` together keep a settled pair at exactly 0 instead of a float
 * tail or a `-0`.
 */
function netPair(grossRemaining: number, grossRemainingToPay: number) {
  // `|| 0` turns the negative zero `round2` yields on a float tail (e.g. 0.1 +
  // 0.2 against 0.3) into a plain 0 — `Intl.NumberFormat` would otherwise
  // render that as "-0" in the balance column.
  const net = round2(grossRemaining - grossRemainingToPay) || 0;
  return {
    remaining: Math.max(0, net),
    remainingToPay: Math.max(0, -net),
    netBalance: net,
  };
}

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private loyalty: CustomerLoyaltyService,
  ) {}

  /**
   * Accepts either a legacy numeric id or the UUID publicId and returns the
   * numeric primary key used internally.
   */
  async resolveCustomerId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.customer.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(tr('errors.customerNotFound'));
    return row.id;
  }

  async findAll(shopId?: number, opts?: CustomerFilters) {
    const q = (opts?.search ?? '').trim();
    const numericQ = asNumericId(q);

    const where: Prisma.CustomerWhereInput = {};
    if (opts?.archivedOnly) {
      // The directory's "archived" chip asks for exactly the hidden rows.
      where.isArchived = true;
    } else if (!opts?.includeArchived && !opts?.onlyDebt) {
      // Archived customers are hidden from pickers and the directory — except
      // when the caller is chasing debt, where hiding somebody who owes money
      // would be the wrong answer.
      where.isArchived = false;
    }
    // `canTakeCredit` is a filter on the flag's value, so both the credit-sale
    // picker (`true`) and the directory's "credit blocked" chip (`false`) work.
    if (opts?.canTakeCredit !== undefined)
      where.canTakeCredit = opts.canTakeCredit;
    if (opts?.tag) where.tags = { has: opts.tag };
    // A shop filter keeps its legacy meaning: customers that actually took
    // credit at that shop.
    if (shopId) where.creditSales = { some: { shopId } };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
        ...(numericQ != null ? [{ number: numericQ }] : []),
      ];
    }
    if (opts?.onlyDebt) {
      const organizationId = getCurrentTenantId();
      if (organizationId == null) {
        throw new BadRequestException(tr('errors.businessRequiredForCustomer'));
      }
      // "Outstanding balance" is credits minus payments, which Prisma cannot
      // express as a `where` clause — resolve the ids in SQL first.
      where.id = { in: await this.debtorCustomerIds(organizationId) };
    }

    const paging = opts?.paging;
    const wantsPage = paging?.enabled === true;
    const pageSize = Math.min(paging?.pageSize ?? 20, MAX_PAGE_SIZE);

    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          publicId: true,
          number: true,
          name: true,
          phone: true,
          email: true,
          address: true,
          tags: true,
          source: true,
          canTakeCredit: true,
          creditLimit: true,
          isArchived: true,
          loyaltyPoints: true,
          lastPurchaseAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        ...(wantsPage
          ? { skip: (paging!.page - 1) * pageSize, take: pageSize }
          : {}),
      }),
    ]);

    const decorated = (await this.attachCreditTotals(rows)).filter(
      // Legacy rule, preserved: with a shop filter only customers holding credit
      // at that shop are listed (the relation filter above guarantees it).
      (c) => c.totalCredits > 0 || !shopId,
    );

    if (!wantsPage) return decorated;
    return pagedResult(decorated, total, paging!.page, pageSize);
  }

  /** Sums credits and payments per customer for one page of directory rows. */
  private async attachCreditTotals(
    rows: {
      id: number;
      publicId: string;
      number: number | null;
      name: string;
      phone: string | null;
      email: string | null;
      address: string | null;
      tags: string[];
      source: string | null;
      canTakeCredit: boolean;
      creditLimit: number | null;
      isArchived: boolean;
      loyaltyPoints: number;
      lastPurchaseAt: Date | null;
      createdAt: Date;
    }[],
  ) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [credits, payments, taken, takenPayments] = await Promise.all([
      this.prisma.creditSale.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids } },
        _sum: { totalAmount: true },
      }),
      this.prisma.creditPayment.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids } },
        _sum: { amount: true },
      }),
      this.prisma.purchase.groupBy({
        by: ['vendorCustomerId'],
        where: { vendorCustomerId: { in: ids }, paymentType: 'CREDIT' },
        _sum: { totalCost: true },
      }),
      this.prisma.purchasePayment.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids } },
        _sum: { amount: true },
      }),
    ]);
    const creditBy = new Map(
      credits.map((c) => [c.customerId, c._sum.totalAmount ?? 0]),
    );
    const paidBy = new Map(
      payments.map((p) => [p.customerId, p._sum.amount ?? 0]),
    );
    const takenBy = new Map(
      taken.map((t) => [t.vendorCustomerId, t._sum.totalCost ?? 0]),
    );
    const takenPaidBy = new Map(
      takenPayments.map((p) => [p.customerId, p._sum.amount ?? 0]),
    );

    return rows.map((c) => {
      const totalCredits = creditBy.get(c.id) ?? 0;
      const totalPaid = paidBy.get(c.id) ?? 0;
      const totalTakenOnCredit = takenBy.get(c.id) ?? 0;
      const totalPaidToVendor = takenPaidBy.get(c.id) ?? 0;
      const { remaining, remainingToPay, netBalance } = netPair(
        round2(totalCredits - totalPaid),
        round2(totalTakenOnCredit - totalPaidToVendor),
      );
      return {
        ...c,
        numberLabel: formatBusinessNumber('CUST', c.number),
        totalCredits,
        totalPaid,
        remaining,
        totalTakenOnCredit,
        totalPaidToVendor,
        remainingToPay,
        netBalance,
      };
    });
  }

  /**
   * Ids of customers who still owe us once mutual trade is netted off. The
   * receivable side (credits minus payments) has to clear both the payable side
   * (goods taken from them on credit, minus what we paid them) — otherwise a
   * row listed as "with debt" would read 0 in the Remaining column beside it.
   * Correlated subqueries rather than joins, so a customer with no credit
   * history at all (nothing to join) is still handled by COALESCE exactly like
   * the previous JS filter.
   */
  private async debtorCustomerIds(organizationId: number): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT c."id"
      FROM "Customer" c
      WHERE c."organizationId" = ${organizationId}
        AND COALESCE((
              SELECT SUM(cs."totalAmount") FROM "CreditSale" cs
              WHERE cs."customerId" = c."id"
            ), 0)
          - COALESCE((
              SELECT SUM(cp."amount") FROM "CreditPayment" cp
              WHERE cp."customerId" = c."id"
            ), 0)
          - COALESCE((
              SELECT SUM(p."totalCost") FROM "Purchase" p
              WHERE p."vendorCustomerId" = c."id"
                AND p."paymentType"::text = 'CREDIT'
            ), 0)
          + COALESCE((
              SELECT SUM(pp."amount") FROM "PurchasePayment" pp
              WHERE pp."customerId" = c."id"
            ), 0) > 0
    `;
    return rows.map((r) => r.id);
  }

  async findOne(id: number, _shopId?: number) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        creditSales: {
          include: {
            items: { include: { product: true } },
            shop: true,
            sale: {
              select: {
                id: true,
                saleType: true,
                paidAmount: true,
                remainingAmount: true,
                // The credit lines are a copy of the sale's items (created from
                // them in the same order) and carry no variant, so the variant
                // that was actually sold comes from here.
                items: { include: { variant: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        creditPayments: {
          orderBy: { paidAt: 'desc' },
          include: { paymentMethod: true },
        },
        // Items taken on credit from this vendor + the payments we made back.
        // Credit purchases are Purchases with paymentType = CREDIT.
        vendorPurchases: {
          where: { paymentType: 'CREDIT' },
          // The payback lines carry their method name, so a payback reads the
          // same here as it does in the purchase detail modal the rows open.
          include: {
            shop: true,
            payments: {
              include: { paymentMethod: true },
              orderBy: { paidAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        purchasePayments: {
          include: { paymentMethod: true, purchase: true },
          orderBy: { paidAt: 'desc' },
        },
        // CRM: interaction timeline (the legacy `notes` text column rides along
        // with the customer row itself) + loyalty ledger.
        customerNotes: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { user: { select: { id: true, name: true } } },
        },
        loyaltyEntries: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            sale: { select: { id: true, invoiceNumber: true } },
            createdBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!c) return null;

    // All credits & payments across all shops — consistent since payments have no shopId
    const totalCredits = c.creditSales.reduce((s, cs) => s + cs.totalAmount, 0);
    const totalPaid = c.creditPayments.reduce((s, cp) => s + cp.amount, 0);
    // The payables side of the same relationship: goods we took on credit from
    // this customer, minus what we have already paid them.
    const totalTakenOnCredit = c.vendorPurchases.reduce(
      (s, cp) => s + cp.totalCost,
      0,
    );
    const totalPaidToVendor = c.purchasePayments.reduce(
      (s, p) => s + p.amount,
      0,
    );
    // Mutual trade cancels — see netPair(). The gross four stay as they are.
    const netted = netPair(
      round2(totalCredits - totalPaid),
      round2(totalTakenOnCredit - totalPaidToVendor),
    );

    // CRM roll-up + the programme config, so the profile page can show what the
    // customer still earns and how much they have spent overall.
    const [loyaltyProgram, salesCount, recentSales] = await Promise.all([
      this.loyalty.getProgram(),
      this.prisma.sale.count({ where: { customerId: id } }),
      this.prisma.sale.findMany({
        where: { customerId: id },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          saleType: true,
          saleDate: true,
        },
        orderBy: { saleDate: 'desc' },
        take: 50,
      }),
    ]);
    const totalSpent = recentSales.reduce((s, r) => s + r.totalAmount, 0);

    return {
      ...c,
      numberLabel: formatBusinessNumber('CUST', c.number),
      totalCredits,
      totalPaid,
      totalTakenOnCredit,
      totalPaidToVendor,
      ...netted,
      loyaltyProgram,
      stats: {
        salesCount,
        totalSpent,
        averageOrder: salesCount > 0 ? totalSpent / salesCount : 0,
        lastPurchaseAt: c.lastPurchaseAt,
      },
      recentSales,
    };
  }

  /**
   * Normalizes a create/update payload: trims text, turns the optional birthday
   * string into a Date and collapses blank strings to null, so "cleared" and
   * "never set" behave identically in the database.
   */
  private toData(dto: UpdateCustomerDto) {
    const data: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      notes?: string | null;
      birthday?: Date | null;
      tags?: string[];
      preferredLanguage?: string | null;
      source?: CustomerSource | null;
      shopId?: number | null;
      creditLimit?: number | null;
      canTakeCredit?: boolean;
      isArchived?: boolean;
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    if (dto.email !== undefined)
      data.email = dto.email.trim().toLowerCase() || null;
    if (dto.address !== undefined) data.address = dto.address.trim() || null;
    if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;
    if (dto.birthday !== undefined)
      data.birthday = dto.birthday ? new Date(dto.birthday) : null;
    if (dto.tags !== undefined)
      data.tags = dto.tags.map((tag) => tag.trim()).filter(Boolean);
    if (dto.preferredLanguage !== undefined)
      data.preferredLanguage = dto.preferredLanguage ?? null;
    if (dto.source !== undefined)
      data.source = (dto.source as CustomerSource | undefined) ?? null;
    if (dto.shopId !== undefined) data.shopId = dto.shopId ?? null;
    if (dto.creditLimit !== undefined)
      data.creditLimit = dto.creditLimit ?? null;
    if (dto.canTakeCredit !== undefined) data.canTakeCredit = dto.canTakeCredit;
    if (dto.isArchived !== undefined) data.isArchived = dto.isArchived;
    return data;
  }

  async create(dto: CreateCustomerDto) {
    const name = dto.name.trim();
    const phone = dto.phone?.trim() || undefined;
    await this.assertNotDuplicate({ name, phone });

    const organizationId = getCurrentTenantId();
    if (organizationId == null) {
      throw new BadRequestException(tr('errors.businessRequiredForCustomer'));
    }

    return this.prisma.customer.create({
      data: { organizationId, ...this.toData(dto), name },
    });
  }

  async update(id: number, dto: UpdateCustomerDto) {
    const current = await this.prisma.customer.findFirst({
      where: { id },
      select: { id: true, name: true, phone: true },
    });
    if (!current) throw new NotFoundException(tr('errors.customerNotFound'));

    // Same duplicate-entry guard as create, but the row editing itself is not a
    // duplicate of itself.
    if (dto.name !== undefined || dto.phone !== undefined) {
      await this.assertNotDuplicate({
        name: dto.name?.trim() ?? current.name,
        phone:
          dto.phone === undefined
            ? (current.phone ?? undefined)
            : dto.phone.trim() || undefined,
        excludeId: id,
      });
    }

    return this.prisma.customer.update({
      where: { id },
      data: this.toData(dto),
    });
  }

  /**
   * Duplicate-entry guard: reject when an existing customer matches the same
   * name (case-insensitive) or the exact same phone number.
   */
  private async assertNotDuplicate(opts: {
    name: string;
    phone?: string;
    excludeId?: number;
  }) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
        OR: [
          { name: { equals: opts.name, mode: 'insensitive' } },
          ...(opts.phone ? [{ phone: { equals: opts.phone } }] : []),
        ],
      },
      select: { id: true, name: true },
    });
    if (existing) {
      throw new ConflictException(
        tr('errors.customerDuplicate', { name: existing.name }),
      );
    }
  }

  /**
   * Hard delete — only for customers with no history. A customer referenced by
   * sales or credit rows is archived instead (`PUT /customers/:id/archived`),
   * which is also what the credits page's delete action now reports.
   */
  async remove(id: number) {
    await this.getOrFail(id);
    const [sales, credits, payments] = await Promise.all([
      this.prisma.sale.count({ where: { customerId: id } }),
      this.prisma.creditSale.count({ where: { customerId: id } }),
      this.prisma.creditPayment.count({ where: { customerId: id } }),
    ]);
    if (sales > 0 || credits > 0 || payments > 0) {
      throw new BadRequestException(tr('errors.customerHasHistory'));
    }
    return this.prisma.customer.delete({ where: { id } });
  }

  /** Hide/show a customer without destroying its history. */
  async setArchived(id: number, archived: boolean) {
    await this.getOrFail(id);
    return this.prisma.customer.update({
      where: { id },
      data: { isArchived: archived },
    });
  }

  // --- Interaction timeline ----------------------------------------------

  /** Append one entry to the customer's timeline. */
  async addNote(
    customerId: number,
    dto: CreateCustomerNoteDto,
    userId: number,
  ) {
    const organizationId = getCurrentTenantId();
    if (organizationId == null) {
      throw new BadRequestException(tr('errors.businessRequiredForCustomer'));
    }
    await this.getOrFail(customerId);
    return this.prisma.customerNote.create({
      data: {
        organizationId,
        customerId,
        userId,
        kind: (dto.kind ?? 'NOTE') as CustomerNoteKind,
        body: dto.body.trim(),
        followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /** Timeline, newest first. */
  async listNotes(customerId: number, take = 100) {
    await this.getOrFail(customerId);
    return this.prisma.customerNote.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async removeNote(customerId: number, noteId: number) {
    const note = await this.prisma.customerNote.findFirst({
      where: { id: noteId, customerId },
      select: { id: true },
    });
    if (!note) throw new NotFoundException(tr('errors.customerNoteNotFound'));
    await this.prisma.customerNote.delete({ where: { id: note.id } });
    return { message: 'Note deleted' };
  }

  // --- Directory KPIs + loyalty -------------------------------------------

  /** Headline numbers for the CRM directory header. */
  async overview() {
    const organizationId = getCurrentTenantId();
    if (organizationId == null) {
      throw new BadRequestException(tr('errors.businessRequiredForCustomer'));
    }
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [total, newThisMonth, creditBlocked, archived, points, debtors, due] =
      await Promise.all([
        this.prisma.customer.count({ where: { isArchived: false } }),
        this.prisma.customer.count({
          where: { createdAt: { gte: startOfMonth } },
        }),
        this.prisma.customer.count({ where: { canTakeCredit: false } }),
        this.prisma.customer.count({ where: { isArchived: true } }),
        this.prisma.customer.aggregate({ _sum: { loyaltyPoints: true } }),
        this.debtorCustomerIds(organizationId),
        this.prisma.customerNote.count({
          where: { followUpAt: { not: null, lte: new Date() } },
        }),
      ]);
    return {
      total,
      newThisMonth,
      creditBlocked,
      archived,
      loyaltyPoints: points._sum.loyaltyPoints ?? 0,
      debtors: debtors.length,
      followUpsDue: due,
    };
  }

  /** Manual loyalty adjustment (delegates to the loyalty ledger service). */
  adjustLoyalty(customerId: number, dto: AdjustLoyaltyDto, userId: number) {
    return this.loyalty.adjust(customerId, dto, userId);
  }

  getLoyaltyProgram() {
    return this.loyalty.getProgram();
  }

  updateLoyaltyProgram(dto: UpdateLoyaltyProgramDto) {
    return this.loyalty.updateProgram(dto);
  }

  loyaltyHistory(customerId: number, take?: number) {
    return this.loyalty.history(customerId, take);
  }

  /** Tenant-scoped existence check — `findUnique` alone ignores the tenant. */
  private async getOrFail(id: number) {
    const row = await this.prisma.customer.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(tr('errors.customerNotFound'));
    return row;
  }
}
