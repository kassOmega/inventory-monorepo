// src/finance/finance.service.ts
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountType, BusinessType, JournalPostingStatus, MenuItemTrackingMode, OrderStatus, Prisma, TaxDirection } from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { getDefaultAccounts } from '../common/verticals';
import { resolveTax, splitTax } from '../common/tax.util';
import {
  GL_JOURNAL_PDF_COLUMNS,
  buildGlJournalPdfRows,
  renderGlJournalPdf,
} from './gl-journal-pdf';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_POSTING_MAPS,
  isKnownPostingType,
  isManagedBySystem,
  seedAccountMappings,
} from './account-mapping.constants';
import {
  CreateAccountDto,
  CreateExpenseDto,
  CreateIncomeDto,
  CreateJournalEntryDto,
  UpdateAccountDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
} from './dto/finance.dto';

/** Shape accepted by journalLine.createMany in the auto-posting helpers. */
interface MfgPostArgs {
  ref: string;
  amount: number;
  tenantId: number | null;
  tx?: Prisma.TransactionClient;
  createdById?: number | null;
  entryDate?: Date;
  locationId?: number | null;
  postingStatus?: JournalPostingStatus;
}

interface JournalLineInput {
  tenantId: number | null;
  journalEntryId: number;
  accountId: number;
  debit: number;
  credit: number;
}

@Injectable()
export class FinanceService {
  /** Tenants whose default AccountMapping rows have been ensured this boot. */
  private _mappingEnsured = new Set<number>();
  /** Tenants whose default chart accounts have been ensured this boot. */
  private _accountsEnsured = new Set<number>();

  constructor(private prisma: PrismaService) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  private dateWhere(field: string, startDate?: string, endDate?: string) {
    const where: Record<string, unknown> = {};
    const cond: Record<string, unknown> = {};
    if (startDate) cond.gte = new Date(startDate);
    if (endDate) {
      // Clamp the end date to end-of-day so records timestamped on the end
      // date itself (e.g. today) are included — otherwise `lte: midnight`
      // silently drops everything recorded after midnight of that day.
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      cond.lte = end;
    }
    if (Object.keys(cond).length) where[field] = cond;
    return where;
  }

  private readonly logger = new Logger(FinanceService.name);

  /** Reference prefixes produced by the auto-posting engine, used to classify
   *  journal entries into source buckets (GL filters + Coverage tab). */
  private static readonly MODULE_PREFIXES: Record<string, string[]> = {
    retail: ['SALE', 'RTRN', 'PUR', 'RST', 'PRDV'],
    hospitality: ['ORD', 'FOL'],
    manufacturing: ['MGI'],
    procurement: ['PO', 'GRN', 'VBL', 'VBP', 'VCN', 'SCP'],
    manual: ['EXP', 'INC', 'ADJ', 'WST', 'MANUAL'],
  };
  private static readonly REF_KEYS = new Set([
    'SALE','RTRN','EXP','INC','MGI','ORD','FOL','PO','PUR','RST','PRDV','ADJ','WST',
    'GRN','VBP','VCN','SCP',
  ]);

  /** Classify a journal reference into a source bucket (unknown -> MANUAL). */
  private refBucket(reference?: string | null): string {
    if (!reference) return 'MANUAL';
    const head = reference.toUpperCase().split('-')[0] ?? '';
    return FinanceService.REF_KEYS.has(head) ? head : 'MANUAL';
  }

  /** Shared General Ledger filter builder -> entry-level + line-level where. */
  private glWhere(args: { startDate?: string; endDate?: string; accountId?: number; source?: string; locationId?: number; moduleSource?: string; status?: string; search?: string }) {
    const tenantId = this.tenant();
    const dateCond = this.dateWhere('entryDate', args.startDate, args.endDate);
    const journal: any = { tenantId };
    if (dateCond.entryDate) journal.entryDate = dateCond.entryDate;
    const entryWhere: any = journal;
    const lineWhere: any = { tenantId, journalEntry: journal };
    if (args.accountId) {
      entryWhere.lines = { some: { accountId: args.accountId } };
      lineWhere.accountId = args.accountId;
    }
    const source = args.source && args.source !== 'ALL' ? args.source : null;
    if (source) {
      if (source === 'MANUAL') {
        journal.NOT = {
          OR: Array.from(FinanceService.REF_KEYS).map((k) => ({ reference: { startsWith: k + '-' } })),
        };
      } else {
        journal.reference = { startsWith: source + '-' };
      }
    }
    const module = args.moduleSource && args.moduleSource !== 'ALL' ? args.moduleSource : null;
    if (module) {
      const prefixes = FinanceService.MODULE_PREFIXES[module] ?? [];
      const real = prefixes.filter((p) => p !== 'MANUAL');
      if (real.length) {
        journal.reference = { OR: real.map((p) => ({ startsWith: p + '-' })) };
      }
    }
    if (args.locationId) journal.locationId = args.locationId;
    if (args.status && args.status !== 'ALL') journal.postingStatus = args.status;
    const q = args.search?.trim();
    if (q) {
      journal.AND = [
        {
          OR: [
            { reference: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }
    return { entryWhere, lineWhere };
  }

  /** Normal debit/credit side for a chart account type. */
  private normalSide(type?: string): 'DEBIT' | 'CREDIT' {
    return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
  }

  // --- Chart of accounts ---
  /**
   * Idempotent lazy backfill of the default AccountMapping rows for tenants
   * created before the mapping engine existed. Best-effort: failures simply
   * leave the name-based fallbacks active.
   */
  private async ensureMappings(db?: any, tenantIdOverride?: number | null): Promise<void> {
    try {
      const tenantId = tenantIdOverride != null ? tenantIdOverride : this.tenant();
      if (tenantId == null || this._mappingEnsured.has(tenantId)) return;
      await seedAccountMappings(db ?? this.prisma, tenantId);
      this._mappingEnsured.add(tenantId);
    } catch {
      // Ignored — posting helpers fall back to the classic name lookups.
    }
  }

  /**
   * Idempotent lazy backfill of the default chart of accounts for orgs created
   * before chart seeding existed (e.g. old dev seeds / pre-signup orgs). Only
   * strictly-missing defaults are created with skipDuplicates; existing and
   * renamed accounts are never touched. Best-effort — on failure the posting
   * helpers keep falling back to the classic name lookups.
   */
  private async ensureDefaultAccounts(
    db?: any,
    tenantIdOverride?: number | null,
  ): Promise<void> {
    const tenantId = tenantIdOverride != null ? tenantIdOverride : this.tenant();
    if (tenantId == null || this._accountsEnsured.has(tenantId)) return;
    try {
      const dao = db ?? this.prisma;
      const [existing, org] = await Promise.all([
        dao.account.findMany({
          where: { tenantId },
          select: { name: true, type: true },
        }),
        dao.organization.findUnique({
          where: { id: tenantId },
          select: { businessType: true },
        }),
      ]);
      const defaults = getDefaultAccounts(
        org?.businessType ?? BusinessType.RETAIL,
      );
      const missing = defaults.filter(
        (d) => !existing.some((a: any) => a.name === d.name && a.type === d.type),
      );
      if (missing.length > 0) {
        await dao.account.createMany({
          data: missing.map((a) => ({
            tenantId,
            name: a.name,
            code: a.code ?? null,
            type: a.type,
            isSystem: a.isSystem ?? false,
          })),
          skipDuplicates: true,
        });
      }
      // Only cache the result for non-transactional calls. Inside a sale
      // transaction the created rows roll back with the tx on any later error,
      // so the next attempt must be allowed to backfill again.
      if (dao === this.prisma) this._accountsEnsured.add(tenantId);
    } catch {
      // Best-effort — posting helpers fall back to the classic name lookups.
    }
  }

  /**
   * Resolves a tenant's AccountMapping row for an operational action. Sides
   * that are null / absent fall through to the caller's existing logic.
   */
  private async mappingOverride(
    transactionType: string,
    db?: any,
    tenantIdOverride?: number | null,
  ): Promise<{ debitAccountId?: number; creditAccountId?: number }> {
    try {
      const tenantId = tenantIdOverride != null ? tenantIdOverride : this.tenant();
      if (tenantId == null) return {};
      const row = await (db ?? this.prisma).accountMapping.findUnique({
        where: { tenantId_transactionType: { tenantId, transactionType } },
      });
      if (!row) return {};
      return {
        debitAccountId: row.debitAccountId ?? undefined,
        creditAccountId: row.creditAccountId ?? undefined,
      };
    } catch {
      return {};
    }
  }

  // --- Account mappings (auto-posting configuration) ---

  /** Registry rows + the tenant's current mapping (defaults when untouched). */
  async getAccountMappings() {
    const tenantId = this.tenant();
    await this.ensureMappings();
    const rows = await this.prisma.accountMapping.findMany({
      where: { tenantId },
      include: { debitAccount: true, creditAccount: true },
    });
    const byType = new Map(rows.map((r) => [r.transactionType, r]));
    return DEFAULT_POSTING_MAPS.map((def) => ({
      transactionType: def.type,
      label: def.label,
      description: def.description,
      managedBySystem: !!def.managedBySystem,
      debitTypes: def.debitTypes ?? [],
      creditTypes: def.creditTypes ?? [],
      mapping: byType.get(def.type) ?? null,
    }));
  }

  async setAccountMapping(
    transactionType: string,
    debitAccountId?: number | null,
    creditAccountId?: number | null,
  ) {
    if (!isKnownPostingType(transactionType)) {
      throw new BadRequestException(`Unknown posting action '${transactionType}'.`);
    }
    if (isManagedBySystem(transactionType)) {
      throw new BadRequestException(
        'This posting is managed automatically by the system and cannot be remapped.',
      );
    }
    if (transactionType === 'SALE' && creditAccountId != null) {
      throw new BadRequestException(
        'The credit (revenue/COGS/VAT) side of a sale is managed by the engine; only the payment account can be remapped.',
      );
    }
    const tenantId = this.tenant();
    const ids = [debitAccountId, creditAccountId].filter(
      (x): x is number => typeof x === 'number',
    );
    if (ids.length > 0) {
      const found = await this.prisma.account.count({
        where: { tenantId, id: { in: ids } },
      });
      if (found !== ids.length) {
        throw new BadRequestException(
          'One or more selected accounts do not belong to this organization.',
        );
      }
    }
    return this.prisma.accountMapping.upsert({
      where: { tenantId_transactionType: { tenantId, transactionType } },
      update: {
        debitAccountId: debitAccountId ?? null,
        creditAccountId: creditAccountId ?? null,
      },
      create: {
        tenantId,
        transactionType,
        debitAccountId: debitAccountId ?? null,
        creditAccountId: creditAccountId ?? null,
      },
      include: { debitAccount: true, creditAccount: true },
    });
  }

  async resetAccountMapping(transactionType: string) {
    if (!isKnownPostingType(transactionType)) {
      throw new BadRequestException(`Unknown posting action '${transactionType}'.`);
    }
    if (isManagedBySystem(transactionType)) {
      throw new BadRequestException(
        'This posting is managed automatically by the system and cannot be remapped.',
      );
    }
    const tenantId = this.tenant();
    await this.prisma.accountMapping.deleteMany({
      where: { tenantId, transactionType },
    });
    return { ok: true };
  }

  /**
   * Revenue & expense activity summed per account for the period (from the
   * same journal lines the GL is built on), so finance dashboards can render
   * vertical-tailored cards (Room/Food/Beverage, Raw Materials, Scrap, ...)
   * without leaving the double-entry ledger.
   */
  async getOperationalSummary(startDate?: string, endDate?: string) {
    const tenantId = this.tenant();
    const journalWhere: any = { tenantId };
    const dateCond = this.dateWhere('entryDate', startDate, endDate);
    if (dateCond.entryDate) journalWhere.entryDate = dateCond.entryDate;
    const [groups, accounts] = await Promise.all([
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { tenantId, journalEntry: journalWhere },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.account.findMany({ where: { tenantId } }),
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const rows = groups
      .map((g) => {
        const acc = byId.get(g.accountId);
        const debit = Number(g._sum?.debit ?? 0);
        const credit = Number(g._sum?.credit ?? 0);
        const normal =
          acc?.type === 'ASSET' || acc?.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
        return {
          accountId: g.accountId,
          code: acc?.code ?? null,
          name: acc?.name ?? `Account #${g.accountId}`,
          type: acc?.type ?? null,
          isSystem: acc?.isSystem ?? false,
          debit: round2(debit),
          credit: round2(credit),
          amount: round2(normal === 'DEBIT' ? debit - credit : credit - debit),
        };
      })
      .filter((r) => Math.abs(r.amount) > 0.005)
      .sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')));
    let totalRevenue = 0;
    let totalExpense = 0;
    for (const r of rows) {
      if (r.type === 'INCOME') totalRevenue += r.amount;
      else if (r.type === 'EXPENSE') totalExpense += r.amount;
    }
    return {
      rows,
      totals: { revenue: round2(totalRevenue), expense: round2(totalExpense) },
    };
  }

  async listAccounts() {
    await this.ensureMappings();
    await this.ensureDefaultAccounts();
    const tenantId = this.tenant();
    return this.prisma.account.findMany({
      where: { tenantId },
      include: { children: true },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  async createAccount(dto: CreateAccountDto) {
    const tenantId = this.tenant();
    if (dto.parentId != null) {
      const parent = await this.prisma.account.findFirst({
        where: { id: dto.parentId, tenantId },
      });
      if (!parent) throw new BadRequestException('Parent account not found');
    }
    try {
      return await this.prisma.account.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          code: dto.code?.trim() || null,
          type: dto.type,
          parentId: dto.parentId ?? null,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException(
          'An account with this name and type already exists',
        );
      }
      throw err;
    }
  }

  // --- Expenses ---
  async listExpenses(startDate?: string, endDate?: string) {
    const tenantId = this.tenant();
    return this.prisma.expense.findMany({
      where: { tenantId, ...this.dateWhere('expenseDate', startDate, endDate) },
      include: { account: true, paymentMethod: true },
      orderBy: { expenseDate: 'desc' },
    });
  }

  /**
   * Unified "money out" ledger: operational overhead (Expense rows) plus
   * inventory procurement postings (JournalEntry rows refs PUR-/RST-/PRDV-,
   * i.e. purchases, restocks and initial stock). Procurement rows are asset
   * swaps (Debit Inventory <-> Credit Cash/AP) so they appear here for
   * visibility, but only overhead counts toward the P&L.
   */
  async getExpenseLedger(startDate?: string, endDate?: string, tenantId?: string) {
    const tenant = tenantId ? Number(tenantId) : this.tenant();
    const [expenses, procurements] = await Promise.all([
      this.prisma.expense.findMany({
        where: { tenantId: tenant, ...this.dateWhere('expenseDate', startDate, endDate) },
        include: { account: true, paymentMethod: true },
        orderBy: { expenseDate: 'desc' },
      }),
      this.prisma.journalEntry.findMany({
        where: {
          tenantId: tenant,
          ...this.dateWhere('entryDate', startDate, endDate),
          OR: [
            { reference: { startsWith: 'PUR-' } },
            { reference: { startsWith: 'RST-' } },
            { reference: { startsWith: 'PRDV-' } },
          ],
        },
        include: { lines: true },
        orderBy: { entryDate: 'desc' },
      }),
    ]);

    const overhead = expenses.map((e) => ({
      kind: 'OPERATIONAL' as const,
      id: e.id,
      accountId: e.accountId,
      categoryName: e.account?.name ?? null,
      vendor: e.vendor ?? null,
      notes: e.notes ?? null,
      amount: e.amount,
      date: e.expenseDate,
    }));

    const procurementsList = procurements
      .map((j) => ({
        id: j.id,
        kind: 'INVENTORY_RESTOCK' as const,
        description: j.description ?? '',
        vendor: null as string | null,
        amount: round2(j.lines.reduce((s, l) => s + (l.credit ?? 0), 0)),
        date: j.entryDate,
      }))
      .filter((p) => p.amount > 0);

    const overheadTotal = round2(expenses.reduce((s, e) => s + e.amount, 0));
    const procurementTotal = round2(
      procurementsList.reduce((s, p) => s + p.amount, 0),
    );

    return {
      overhead,
      procurements: procurementsList,
      totals: {
        overheadTotal,
        procurementTotal,
        totalMoneyOut: round2(overheadTotal + procurementTotal),
      },
    };
  }

  async createExpense(dto: CreateExpenseDto, userId: number) {
    const tenantId = this.tenant();
    const cash = await this.prisma.account.findFirst({
      where: {
        tenantId,
        name: 'Cash',
        type: AccountType.ASSET,
        isSystem: true,
      },
    });
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });

    // Strict expense boundary: the manual Expenses form is reserved for
    // non-inventory operational overhead (Rent, Utilities, Salaries, ...).
    // Inventory purchases must be recorded via Restock / Procurement (Debit
    // Inventory Asset ↔ Credit AP/Cash) and stock write-offs via the wastage
    // flow — posting them as manual expenses would double-count on the P&L.
    const systemManagedAccounts = new Set([
      'Inventory Asset',
      'Accounts Payable',
      'Cost of Goods Sold',
      'Spoilage & Wastage',
    ]);
    if (account && systemManagedAccounts.has(account.name)) {
      throw new BadRequestException(
        `"${account.name}" is managed automatically by inventory movements. Record inventory purchases via Restock / Procurement instead.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Input VAT on the expense when the company has tax enabled + a default
      // INPUT rate (or an explicit rate was chosen). `amount` stays the net
      // (tax-free) expense; the reclaimable VAT is tracked separately.
      let taxAmount = 0;
      let taxRateId: number | null = null;
      const inputVat = await tx.account.findFirst({
        where: { tenantId, name: 'Input VAT Receivable' },
      });
      let netAmount = dto.amount;
      if (inputVat) {
        const taxCtx = await resolveTax(tx, tenantId, TaxDirection.INPUT);
        if (taxCtx.enabled && taxCtx.rate > 0) {
          // Inclusive: the entered amount includes VAT → net = amount - tax.
          // Exclusive: the entered amount is the net base → tax is added on top.
          const split = splitTax(dto.amount, taxCtx.rate, taxCtx.inclusive);
          taxAmount = split.tax;
          netAmount = split.net;
          taxRateId = taxCtx.rateId;
        }
      }

      const expense = await tx.expense.create({
        data: {
          tenantId,
          accountId: dto.accountId,
          vendor: dto.vendor,
          amount: round2(netAmount),
          taxAmount,
          taxRateId,
          paymentMethodId: dto.paymentMethodId,
          notes: dto.notes,
          expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
          createdById: userId,
        },
      });

      const pair = await this.mappingOverride('EXPENSE', tx);
      const debitAccountId = pair.debitAccountId ?? dto.accountId;
      const creditAccountId = pair.creditAccountId ?? cash?.id ?? null;
      if (!creditAccountId) {
        this.logger.warn(
          `Expense #${expense.id} was recorded but its EXP journal entry was skipped - no 'Cash' account is configured for this organization.`,
        );
      } else {
        const entry = await tx.journalEntry.create({
          data: {
            tenantId,
            reference: `EXP-${expense.id}`,
            description: account?.name ?? 'Expense',
            entryDate: expense.expenseDate,
            createdById: userId,
          },
        });
        const lines = [
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: debitAccountId,
            debit: round2(netAmount),
            credit: 0,
          },
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: creditAccountId,
            debit: 0,
            credit: round2(netAmount + taxAmount),
          },
        ];
        if (taxAmount > 0 && inputVat) {
          lines.push({
            tenantId,
            journalEntryId: entry.id,
            accountId: inputVat.id,
            debit: taxAmount,
            credit: 0,
          });
        }
        await tx.journalLine.createMany({ data: lines });
      }

      return expense;
    });
  }

  // --- Other income ---
  async listIncomes(startDate?: string, endDate?: string) {
    const tenantId = this.tenant();
    return this.prisma.otherIncome.findMany({
      where: { tenantId, ...this.dateWhere('incomeDate', startDate, endDate) },
      include: { account: true },
      orderBy: { incomeDate: 'desc' },
    });
  }

  async createIncome(dto: CreateIncomeDto, userId: number) {
    const tenantId = this.tenant();
    const cash = await this.prisma.account.findFirst({
      where: {
        tenantId,
        name: 'Cash',
        type: AccountType.ASSET,
        isSystem: true,
      },
    });

    return this.prisma.$transaction(async (tx) => {
      const income = await tx.otherIncome.create({
        data: {
          tenantId,
          accountId: dto.accountId,
          description: dto.description,
          amount: dto.amount,
          incomeDate: dto.incomeDate ? new Date(dto.incomeDate) : undefined,
          createdById: userId,
        },
      });

      const pair = await this.mappingOverride('INCOME', tx);
      const debitAccountId = pair.debitAccountId ?? cash?.id ?? null;
      const creditAccountId = pair.creditAccountId ?? dto.accountId;
      if (!debitAccountId) {
        this.logger.warn(
          `Income #${income.id} was recorded but its INC journal entry was skipped - no 'Cash' account is configured for this organization.`,
        );
      } else {
        const entry = await tx.journalEntry.create({
          data: {
            tenantId,
            reference: `INC-${income.id}`,
            description: dto.description ?? 'Other income',
            entryDate: income.incomeDate,
            createdById: userId,
          },
        });
        await tx.journalLine.createMany({
          data: [
            {
              tenantId,
              journalEntryId: entry.id,
              accountId: debitAccountId,
              debit: dto.amount,
              credit: 0,
            },
            {
              tenantId,
              journalEntryId: entry.id,
              accountId: creditAccountId,
              debit: 0,
              credit: dto.amount,
            },
          ],
        });
      }

      return income;
    });
  }

  /**
   * Posts a Manufacturing add-on service income to the ledger inside the
   * caller's transaction: OtherIncome (source='MFG_SERVICE', idempotent by
   * sourceId) + journal (Debit Cash ↔ Credit income account). Mirrors the
   * manual other-income posting so it shows in P&L and finance reports.
   */
  async postManufacturingServiceIncome(args: {
    tx: any;
    tenantId: number;
    sourceId: number;
    accountId: number;
    description: string;
    amount: number;
    incomeDate: Date;
    createdById?: number | null;
  }) {
    const { tx, tenantId, sourceId, accountId } = args;
    const existing = await tx.otherIncome.findFirst({
      where: { tenantId, source: 'MFG_SERVICE', sourceId },
    });
    if (existing) return existing;
    const cash = await tx.account.findFirst({
      where: { tenantId, name: 'Cash', type: AccountType.ASSET, isSystem: true },
    });
    const income = await tx.otherIncome.create({
      data: {
        tenantId,
        accountId,
        source: 'MFG_SERVICE',
        sourceId,
        description: args.description,
        amount: args.amount,
        incomeDate: args.incomeDate,
        createdById: args.createdById ?? null,
      },
    });
    if (!cash) {
      this.logger.warn(
        `Manufacturing service income #${income.id} was recorded but its MGI journal entry was skipped - no 'Cash' account is configured for this organization.`,
      );
    } else {
      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          reference: `MGI-${income.id}`,
          description: args.description,
          entryDate: args.incomeDate,
          createdById: args.createdById ?? null,
        },
      });
      await tx.journalLine.createMany({
        data: [
          { tenantId, journalEntryId: entry.id, accountId: cash.id, debit: args.amount, credit: 0 },
          { tenantId, journalEntryId: entry.id, accountId, debit: 0, credit: args.amount },
        ],
      });
    }
    return income;
  }

  // --- Auto income from confirmed order payments ---
  /**
   * Posts categorized OtherIncome rows for a paid order, one per menu category,
   * so revenue is automatically attributed to Food/Beverage/etc. Also writes a
   * CogsEntry (COGS at the moment of sale) and a double-entry journal entry.
   * Idempotent: skips if income has already been posted for this order.
   */
  async postOrderIncome(
    orderId: number,
    tenantId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const run = (db: Prisma.TransactionClient) =>
      this.postOrderIncomeCore(db, orderId, tenantId);
    if (tx) return run(tx);
    // Income + COGS + journal + ingredient stock deduction commit atomically.
    return this.prisma.$transaction((t) => run(t));
  }

  private async postOrderIncomeCore(
    db: Prisma.TransactionClient,
    orderId: number,
    tenantId: number,
  ): Promise<number> {
    const existing = await db.otherIncome.findFirst({
      where: { tenantId, source: 'ORDER', sourceId: orderId },
    });
    if (existing) return 0;

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { menuItem: { include: { menuCategory: true } } } },
      },
    });
    if (!order || order.status !== OrderStatus.PAID) return 0;

    const accounts = await db.account.findMany({ where: { tenantId } });
    const find = (name: string) => accounts.find((a) => a.name === name);
    const salesFallback =
      find('Sales Revenue') ??
      find('Service Revenue') ??
      find('Other Income') ??
      accounts.find((a) => a.type === AccountType.INCOME);

    // Live recipe COGS per PERPETUAL menu item (Σ quantityPerUnit × current buy
    // price) at settlement time — the exact, precise COGS for perpetual items.
    const perpetualItemIds = [
      ...new Set(
        order.items
          .filter(
            (i) =>
              i.menuItem?.trackingMode === MenuItemTrackingMode.PERPETUAL,
          )
          .map((i) => i.menuItem!.id),
      ),
    ];
    const recipeCostByItem = new Map<number, number>();
    if (perpetualItemIds.length > 0) {
      const recipeRows = await db.menuItemIngredient.findMany({
        where: { tenantId, menuItemId: { in: perpetualItemIds } },
        select: {
          menuItemId: true,
          productId: true,
          quantityPerUnit: true,
          product: { select: { currentBuyPrice: true } },
        },
      });
      // Weighted-average ingredient unit costs across the tenant's inventory
      // (fallback: the ingredient's current buy price).
      const ingredientIds = [...new Set(recipeRows.map((r) => r.productId))];
      const avgByProduct = new Map<number, number>();
      if (ingredientIds.length > 0) {
        const invRows = await db.inventory.findMany({
          where: { tenantId, productId: { in: ingredientIds } },
          select: { productId: true, quantity: true, avgCost: true },
        });
        const agg = new Map<number, { qty: number; val: number }>();
        for (const r of invRows) {
          const x = agg.get(r.productId) ?? { qty: 0, val: 0 };
          x.qty += r.quantity ?? 0;
          x.val += (r.quantity ?? 0) * (r.avgCost ?? 0);
          agg.set(r.productId, x);
        }
        for (const pid of ingredientIds) {
          const x = agg.get(pid);
          avgByProduct.set(pid, x && x.qty > 0 ? round2(x.val / x.qty) : 0);
        }
      }
      for (const id of perpetualItemIds) {
        const rows = recipeRows.filter((r) => r.menuItemId === id);
        recipeCostByItem.set(
          id,
          rows.length
            ? round2(
                rows.reduce((s, r) => {
                  const unit =
                    avgByProduct.get(r.productId) ||
                    r.product?.currentBuyPrice ||
                    0;
                  return s + r.quantityPerUnit * unit;
                }, 0),
              )
            : 0,
        );
      }
    }

    const byItem = new Map<
      string,
      {
        name: string;
        menuItemId: number | null;
        menuCategoryId: number | null;
        station: string | null;
        amount: number;
        cost: number;
        qty: number;
      }
    >();
    for (const item of order.items) {
      const mi = item.menuItem;
      // Tag by menu item id; legacy rows without a linked menu item keep their
      // own raw order-item key so they never collapse into one bucket.
      const key = mi ? `mi-${mi.id}` : `raw-${item.id}`;
      const entry = byItem.get(key) ?? {
        name: mi?.name ?? item.name ?? 'Menu item',
        menuItemId: mi?.id ?? null,
        menuCategoryId: mi?.menuCategoryId ?? null,
        station:
          (mi?.menuCategory?.stationRoute as Array<{ name: string }> | null)?.[0]
            ?.name ?? null,
        amount: 0,
        cost: 0,
        qty: 0,
      };
      entry.amount += (item.unitPrice ?? 0) * item.quantity - (item.packageDiscount ?? 0);
      // Per-mode COGS per unit:
      //  PERPETUAL -> live recipe cost; BENCHMARK -> estimatedCogs;
      //  SIMPLE    -> 0 (revenue only); legacy raw rows -> snapshot item.cost.
      let costPerUnit = 0;
      if (mi) {
        if (mi.trackingMode === MenuItemTrackingMode.PERPETUAL) {
          costPerUnit = recipeCostByItem.get(mi.id) ?? 0;
        } else if (mi.trackingMode === MenuItemTrackingMode.BENCHMARK) {
          costPerUnit = Number(mi.estimatedCogs ?? 0);
        }
      } else {
        costPerUnit = item.cost ?? 0;
      }
      entry.cost += costPerUnit * item.quantity;
      entry.qty += item.quantity;
      byItem.set(key, entry);
    }

    let created = 0;
    for (const [, entry] of byItem) {
      const beverage = entry.station === 'Bar' || entry.station === 'Barista';
      const account =
        (beverage ? find('Beverage Sales') : find('Food Sales')) ??
        salesFallback;
      if (!account) continue;
      await db.otherIncome.create({
        data: {
          tenantId,
          accountId: account.id,
          menuCategoryId: entry.menuCategoryId,
          menuItemId: entry.menuItemId,
          source: 'ORDER',
          sourceId: orderId,
          description: `${entry.name} sales — ${order.orderNumber}`,
          amount: entry.amount,
          incomeDate: new Date(),
          createdById: order.createdById,
        },
      });
      created += 1;
    }

    // COGS ledger — record the exact cost of goods sold at this moment.
    const cogsAccount = find('Cost of Goods Sold');
    const cashAccount = find('Cash');
    const inventoryAccount = find('Inventory Asset');
    const totalRevenue = order.totalAmount || 0;
    // Total cost = Σ per-item COGS by tracking mode (PERPETUAL recipe +
    // BENCHMARK estimated; SIMPLE = 0), matching the CogsEntry rows below.
    const totalCost = [...byItem.values()].reduce(
      (s, entry) => s + entry.cost,
      0,
    );
    // Output VAT captured at settlement. Inclusive orders carry the tax inside
    // the subtotal (revenue = total − tax); exclusive orders add it on top
    // (cash = total + tax, revenue = total). Only splits when the VAT account
    // exists — otherwise legacy behaviour is preserved (no tax booked).
    const orderTax = round2(Number(order.tax ?? 0));
    const vatAccount = find('Output VAT Payable');
    const splitVat = Boolean(vatAccount && orderTax > 0);
    const exclusiveTax = splitVat && order.taxInclusive === false;
    const netRevenue = splitVat
      ? exclusiveTax
        ? round2(totalRevenue)
        : round2(totalRevenue - orderTax)
      : round2(totalRevenue);

    if (cogsAccount && totalCost > 0) {
      for (const [, entry] of byItem) {
        if (entry.cost <= 0) continue;
        await db.cogsEntry.create({
          data: {
            tenantId,
            accountId: cogsAccount.id,
            source: 'ORDER',
            sourceId: orderId,
            menuItemId: entry.menuItemId,
            description: `${entry.name} COGS — ${order.orderNumber}`,
            amount: round2(entry.cost),
            quantity: entry.qty,
            entryDate: new Date(),
            createdById: order.createdById,
          },
        });
      }
    }

    // Double-entry journal for the settled order.
    if (cashAccount && inventoryAccount && totalRevenue > 0 && salesFallback) {
      const entry = await db.journalEntry.create({
        data: {
          tenantId,
          reference: `ORD-${orderId}`,
          description: `Order ${order.orderNumber} auto-posted`,
          entryDate: new Date(),
          createdById: order.createdById,
        },
      });
      const lines: JournalLineInput[] = [
        {
          tenantId,
          journalEntryId: entry.id,
          accountId: cashAccount.id,
          debit: exclusiveTax
            ? round2(totalRevenue + orderTax)
            : round2(totalRevenue),
          credit: 0,
        },
        {
          tenantId,
          journalEntryId: entry.id,
          accountId: salesFallback.id,
          debit: 0,
          credit: netRevenue,
        },
      ];
      if (splitVat) {
        lines.push({
          tenantId,
          journalEntryId: entry.id,
          accountId: vatAccount!.id,
          debit: 0,
          credit: orderTax,
        });
      }
      if (totalCost > 0 && cogsAccount) {
        lines.push(
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: cogsAccount.id,
            debit: round2(totalCost),
            credit: 0,
          },
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: inventoryAccount.id,
            debit: 0,
            credit: round2(totalCost),
          },
        );
      }
      await db.journalLine.createMany({ data: lines });
    }

    // Settlement-time raw-ingredient stock deduction for recipe-based food
    // orders. Gated by the same (source='ORDER') idempotency check above, so
    // it runs exactly once per order even with split/cashier-confirmed
    // payments. Best-effort: never blocks settlement.
    await this.deductOrderIngredientStock(orderId, tenantId, db).catch(
      () => 0,
    );

    return created;
  }

  /** Post facility day-pass income to the ledger once the cashier confirms it. */
  async postFacilityIncome(paymentId: number, tenantId: number): Promise<number> {
    const existing = await this.prisma.otherIncome.findFirst({
      where: { tenantId, source: 'FACILITY', sourceId: paymentId },
    });
    if (existing) return 0;

    const payment = await this.prisma.facilityPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.status !== 'CONFIRMED') return 0;

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, type: AccountType.INCOME },
    });
    const find = (name: string) => accounts.find((a) => a.name === name);
    const account =
      find('Sales Revenue') ??
      find('Service Revenue') ??
      find('Other Income') ??
      accounts[0];
    if (!account) return 0;

    await this.prisma.otherIncome.create({
      data: {
        tenantId,
        accountId: account.id,
        source: 'FACILITY',
        sourceId: paymentId,
        description: payment.notes ?? 'Facility day pass',
        amount: payment.amount,
        incomeDate: payment.confirmedAt ?? new Date(),
        createdById: payment.confirmedById,
      },
    });
    return payment.amount;
  }

  /** Book the upfront hospitality package value as income at guest check-in. */
  async postPackageIncome(
    guestId: string,
    tenantId: number,
    amount: number,
    description: string,
  ): Promise<number> {
    if (amount <= 0) return 0;
    const existing = await this.prisma.otherIncome.findFirst({
      where: { tenantId, source: 'PACKAGE', sourceRef: guestId },
    });
    if (existing) return 0;

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, type: AccountType.INCOME },
    });
    const find = (name: string) => accounts.find((a) => a.name === name);
    const account =
      find('Sales Revenue') ??
      find('Service Revenue') ??
      find('Other Income') ??
      accounts[0];
    if (!account) return 0;

    await this.prisma.otherIncome.create({
      data: {
        tenantId,
        accountId: account.id,
        source: 'PACKAGE',
        sourceRef: guestId,
        description,
        amount,
        incomeDate: new Date(),
      },
    });
    return amount;
  }

  /** Post the guest folio net balance (add-on charges) at master checkout. */
  async postPackageFolioIncome(
    guestId: string,
    tenantId: number,
    amount: number,
    description: string,
  ): Promise<number> {
    if (amount <= 0) return 0;
    const existing = await this.prisma.otherIncome.findFirst({
      where: { tenantId, source: 'FOLIO', sourceRef: guestId },
    });
    if (existing) return 0;

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, type: AccountType.INCOME },
    });
    const find = (name: string) => accounts.find((a) => a.name === name);
    const account =
      find('Sales Revenue') ??
      find('Service Revenue') ??
      find('Other Income') ??
      accounts[0];
    if (!account) return 0;

    await this.prisma.otherIncome.create({
      data: {
        tenantId,
        accountId: account.id,
        source: 'FOLIO',
        sourceRef: guestId,
        description,
        amount,
        incomeDate: new Date(),
      },
    });
    return amount;
  }

  /**
   * Deducts raw ingredient stock for a paid food order based on its recipes
   * (Σ quantityPerUnit × order-item quantity per ingredient). Deduction spans
   * all of the ingredient's inventory rows (most stock first, clamped at 0 —
   * low stock never blocks settlement) and FIFO-decrements product batches so
   * perishable ingredient records stay in sync. Idempotency is guaranteed by
   * the caller (postOrderIncome) running this inside its (source='ORDER')
   * guard exactly once.
   */
  async deductOrderIngredientStock(
    orderId: number,
    tenantId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        createdById: true,
        items: { select: { menuItemId: true, quantity: true } },
      },
    });
    if (!order) return 0;

    const menuItemIds = order.items
      .map((i) => i.menuItemId)
      .filter((id): id is number => id != null);
    if (menuItemIds.length === 0) return 0;

    // Only PERPETUAL items deduct physical raw-ingredient stock at settlement.
    const modes = await db.menuItem.findMany({
      where: { tenantId, id: { in: menuItemIds } },
      select: { id: true, trackingMode: true },
    });
    const perpetualIds = new Set(
      modes
        .filter((m) => m.trackingMode === MenuItemTrackingMode.PERPETUAL)
        .map((m) => m.id),
    );
    if (perpetualIds.size === 0) return 0;

    const recipes = await db.menuItemIngredient.findMany({
      where: { tenantId, menuItemId: { in: [...perpetualIds] } },
      select: { menuItemId: true, productId: true, quantityPerUnit: true },
    });
    if (recipes.length === 0) return 0;

    // Aggregate the required quantity per ingredient across PERPETUAL order items.
    const qtyByItem = new Map<number, number>();
    for (const item of order.items) {
      const mid = item.menuItemId;
      if (mid == null || !perpetualIds.has(mid)) continue;
      qtyByItem.set(mid, (qtyByItem.get(mid) ?? 0) + item.quantity);
    }
    const consumption = new Map<number, number>();
    for (const r of recipes) {
      const qty = qtyByItem.get(r.menuItemId) ?? 0;
      consumption.set(
        r.productId,
        (consumption.get(r.productId) ?? 0) + r.quantityPerUnit * qty,
      );
    }

    let deducted = 0;
    for (const [productId, needed] of consumption) {
      if (needed <= 0) continue;

      // 1. Deduct from inventory rows across all locations, most stock first.
      const invRows = await db.inventory.findMany({
        where: { tenantId, productId, quantity: { gt: 0 } },
        select: { id: true, quantity: true },
        orderBy: { quantity: 'desc' },
      });
      let remaining = needed;
      for (const row of invRows) {
        if (remaining <= 0) break;
        const take = Math.min(row.quantity, remaining);
        await db.inventory.update({
          where: { id: row.id },
          data: { quantity: { decrement: take } },
        });
        remaining -= take;
      }
      const shortfall = round2(Math.max(0, remaining));
      deducted += needed - shortfall;

      // 2. FIFO-decrement product batches so perishable records stay in sync.
      const batches = await db.productBatch.findMany({
        where: { tenantId, productId, quantity: { gt: 0 } },
        select: { id: true, quantity: true },
        orderBy: { createdAt: 'asc' },
      });
      let batchRemaining = needed;
      for (const b of batches) {
        if (batchRemaining <= 0) break;
        const take = Math.min(b.quantity, batchRemaining);
        await db.productBatch.update({
          where: { id: b.id },
          data: { quantity: { decrement: take } },
        });
        batchRemaining -= take;
      }

      if (shortfall > 0 && order.createdById != null) {
        await db.auditLog.create({
          data: {
            tenantId,
            userId: order.createdById,
            action: 'INGREDIENT_SHORTFALL',
            details: `Order ${order.orderNumber}: ingredient product #${productId} short by ${shortfall.toFixed(2)} unit(s) — deducted available stock only.`,
          },
        });
      }
    }
    return round2(deducted);
  }

  // =========================================================================
  // Universal auto-posting engine — SALE / FOLIO / procurement / reversals
  // =========================================================================

  /**
   * Auto-posts income + COGS for a completed retail/wholesale sale (Retail
   * Checkout, Wholesale Invoices, request direct-sales, quick-purchase flips).
   * Idempotent via (source='SALE', sourceId=saleId). One OtherIncome + one
   * CogsEntry per exact product/SKU line — each tagged with the specific
   * Product / ProductVariant sold — plus a balanced journal entry
   * (Debit Cash/AR ↔ Credit Revenue; Debit COGS ↔ Credit Inventory).
   */
  async postSaleIncome(
    saleId: number,
    tenantId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const existing = await db.otherIncome.findFirst({
      where: { tenantId, source: 'SALE', sourceId: saleId },
    });
    if (existing) return 0;

    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        items: {
          include: {
            product: { include: { category: true } },
            variant: true,
          },
        },
      },
    });
    if (!sale || sale.totalAmount <= 0) return 0;

    // Pre-existing orgs without a chart of accounts get the missing defaults
    // backfilled here so the sale can always be posted (the re-read below then
    // resolves the real account rows).
    await this.ensureDefaultAccounts(db, tenantId);

    const accounts = await db.account.findMany({ where: { tenantId } });
    const find = (name: string) => accounts.find((a) => a.name === name);
    const revenueAccount =
      find('Sales Revenue') ??
      find('Service Revenue') ??
      find('Other Income') ??
      accounts.find((a) => a.type === AccountType.INCOME);
    const cogsAccount = find('Cost of Goods Sold');
    const cashAccount = find('Cash');
    const arAccount = find('Accounts Receivable');
    const inventoryAccount = find('Inventory Asset');
    if (!revenueAccount) {
      if (sale && sale.totalAmount > 0) {
        this.logger.warn(
          `Sale #${sale.invoiceNumber} (${sale.totalAmount}) could not be posted to the ledger - no income account (Sales Revenue / Service Revenue / Other Income) exists.`,
        );
      }
      return 0;
    }

    // Output VAT snapshot captured at sale time (configured default rate). The
    // customer pays the gross; revenue is booked net and the tax is credited to
    // the Output VAT Payable liability.
    const vatAccount = find('Output VAT Payable');
    const saleTax = round2(Number(sale.taxAmount ?? 0));
    if (saleTax > 0 && !vatAccount) {
      this.logger.warn(
        `Sale #${sale.invoiceNumber} includes tax of ${saleTax} but no 'Output VAT Payable' account is configured - the tax stays inside revenue.`,
      );
    }
    const netRevenueTotal = round2(sale.totalAmount - saleTax);

    // Weighted-average COGS: value each line at the inventory row's avgCost
    // for the sale's shop (fallback: the sale-item unitBuyPrice snapshot).
    const avgByKey = new Map<string, number>();
    if (sale.items.length > 0) {
      const invRows = await db.inventory.findMany({
        where: {
          tenantId,
          locationId: sale.shopId,
          OR: sale.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId ?? null,
          })),
        },
        select: { productId: true, variantId: true, avgCost: true },
      });
      for (const r of invRows) {
        avgByKey.set(`${r.productId}-${r.variantId ?? 0}`, Number(r.avgCost ?? 0));
      }
    }

    // Group revenue + cost per exact item line (product + variant) so income
    // and COGS are tagged to the specific SKU/variant sold. Flip sales have no
    // items — attribute the whole amount to a generic "Wholesale / Flip" bucket.
    const byItem = new Map<
      string,
      {
        productId: number | null;
        variantId: number | null;
        name: string;
        revenue: number;
        cost: number;
        qty: number;
      }
    >();
    for (const item of sale.items) {
      const key = `${item.productId}-${item.variantId ?? 0}`;
      const row = byItem.get(key) ?? {
        productId: item.productId,
        variantId: item.variantId ?? null,
        name:
          `${item.product?.brand ?? ''} ${item.product?.baseName ?? ''}`.trim() +
            (item.variant?.sku ? ` (${item.variant.sku})` : '') ||
          'Product',
        revenue: 0,
        cost: 0,
        qty: 0,
      };
      row.revenue += item.unitSellPrice * item.quantity;
      const avg = avgByKey.get(key) ?? 0;
      row.cost += (avg > 0 ? avg : item.unitBuyPrice) * item.quantity;
      row.qty += item.quantity;
      byItem.set(key, row);
    }
    if (sale.items.length === 0) {
      byItem.set('wholesale', {
        productId: null,
        variantId: null,
        name: 'Wholesale / Quick Purchase',
        revenue: sale.totalAmount,
        cost: sale.totalCost,
        qty: 0,
      });
    }

    let created = 0;
    for (const [, row] of byItem) {
      await db.otherIncome.create({
        data: {
          tenantId,
          accountId: revenueAccount.id,
          menuCategoryId: null,
          productId: row.productId,
          variantId: row.variantId,
          source: 'SALE',
          sourceId: saleId,
          description: `${row.name} sales — ${sale.invoiceNumber}`,
          amount:
            saleTax > 0 && sale.totalAmount > 0
              ? round2(row.revenue * (netRevenueTotal / sale.totalAmount))
              : round2(row.revenue),
          incomeDate: sale.saleDate,
          createdById: sale.soldById,
        },
      });
      if (cogsAccount && row.cost > 0) {
        await db.cogsEntry.create({
          data: {
            tenantId,
            accountId: cogsAccount.id,
            source: 'SALE',
            sourceId: saleId,
            saleId: sale.id,
            productId: row.productId,
            variantId: row.variantId,
            description: `${row.name} COGS — ${sale.invoiceNumber}`,
            amount: round2(row.cost),
            quantity: row.qty,
            entryDate: sale.saleDate,
            createdById: sale.soldById,
          },
        });
      }
      created += 1;
    }

    // Balanced journal: Debit Cash (paid) / AR (remaining) ↔ Credit Revenue,
    // and Debit COGS ↔ Credit Inventory for the cost of the goods sold.
    const journalPosted = Boolean(cashAccount && inventoryAccount);
    if (cashAccount && inventoryAccount) {
      const entry = await db.journalEntry.create({
        data: {
          tenantId,
          reference: `SALE-${saleId}`,
          description: `Sale ${sale.invoiceNumber} auto-posted`,
          entryDate: sale.saleDate,
          createdById: sale.soldById,
          locationId: (sale as { shopId?: number | null }).shopId ?? null,
        },
      });
      const lines: JournalLineInput[] = [];
      const salePair = await this.mappingOverride('SALE', db);
      const paymentAccountId = salePair.debitAccountId ?? cashAccount.id;
      if (sale.saleType === 'FULLY_PAID') {
        lines.push({
          tenantId,
          journalEntryId: entry.id,
          accountId: paymentAccountId,
          debit: round2(sale.totalAmount),
          credit: 0,
        });
      } else if (sale.saleType === 'PARTIALLY_PAID' && sale.paidAmount > 0) {
        lines.push({
          tenantId,
          journalEntryId: entry.id,
          accountId: paymentAccountId,
          debit: round2(sale.paidAmount),
          credit: 0,
        });
        if (arAccount) {
          lines.push({
            tenantId,
            journalEntryId: entry.id,
            accountId: arAccount.id,
            debit: round2(sale.remainingAmount),
            credit: 0,
          });
        }
      } else if (arAccount) {
        lines.push({
          tenantId,
          journalEntryId: entry.id,
          accountId: arAccount.id,
          debit: round2(sale.totalAmount),
          credit: 0,
        });
      }
      lines.push({
        tenantId,
        journalEntryId: entry.id,
        accountId: revenueAccount.id,
        debit: 0,
        credit: netRevenueTotal,
      });
      if (vatAccount && saleTax > 0) {
        lines.push({
          tenantId,
          journalEntryId: entry.id,
          accountId: vatAccount.id,
          debit: 0,
          credit: saleTax,
        });
      }
      if (sale.totalCost > 0 && cogsAccount) {
        lines.push(
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: cogsAccount.id,
            debit: round2(sale.totalCost),
            credit: 0,
          },
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: inventoryAccount.id,
            debit: 0,
            credit: round2(sale.totalCost),
          },
        );
      }
      if (lines.length > 0) {
        await db.journalLine.createMany({ data: lines });
      }
    }

    if (!journalPosted && created > 0) {
      this.logger.warn(
        `Sale #${sale.invoiceNumber}: income/COGS rows were posted but the balanced SALE journal was skipped - 'Cash' and 'Inventory Asset' accounts are required.`,
      );
    }
    return created;
  }


  /**
   * Auto-posts income for a settled guest folio (Room Revenue / folio charges).
   * Idempotent via (source='FOLIO', sourceId=folioId).
   */
  async postFolioIncome(
    folioId: number,
    tenantId: number | null,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const existing = await db.otherIncome.findFirst({
      where: { tenantId, source: 'FOLIO', sourceId: folioId },
    });
    if (existing) return 0;

    const folio = await db.folio.findUnique({
      where: { id: folioId },
      include: { entries: { include: { account: true } } },
    });
    if (!folio) return 0;

    const charges = folio.entries.filter((e) => e.type === 'CHARGE');
    const totalCharges = charges.reduce((s, e) => s + e.amount, 0);
    if (totalCharges <= 0) return 0;

    const accounts = await db.account.findMany({ where: { tenantId } });
    const find = (name: string) => accounts.find((a) => a.name === name);
    const roomRevenue =
      find('Room Revenue') ??
      find('Sales Revenue') ??
      find('Service Revenue') ??
      find('Other Income') ??
      accounts.find((a) => a.type === AccountType.INCOME);
    const cashAccount = find('Cash');
    const arAccount = find('Accounts Receivable');
    if (!roomRevenue) return 0;

    // Revenue is split by the service that produced each line, so the GL reports
    // Room Revenue / Food Sales / service income separately instead of lumping
    // every folio charge into one account.
    const revenueAccountFor = (sourceService: string | null) =>
      pickFolioIncomeAccount(sourceService, accounts) ?? roomRevenue.id;

    // Output VAT snapshot captured at settlement. Inclusive folios carry the tax
    // inside the charges (revenue = total − tax); exclusive folios add it on top
    // (AR/Cash = total + tax, revenue = total). Only splits when the VAT account
    // exists — otherwise legacy behaviour is preserved.
    const vatAccount = find('Output VAT Payable');
    const folioTax = round2(Number(folio.taxAmount ?? 0));
    const splitVat = Boolean(vatAccount && folioTax > 0);
    const exclusiveTax = splitVat && folio.taxInclusive === false;
    const netTotal = splitVat
      ? exclusiveTax
        ? round2(totalCharges)
        : round2(totalCharges - folioTax)
      : round2(totalCharges);

    for (const e of charges) {
      const incomeAccount =
        e.accountId && e.account?.type === AccountType.INCOME
          ? e.accountId
          : revenueAccountFor(e.sourceService);
      await db.otherIncome.create({
        data: {
          tenantId,
          accountId: incomeAccount,
          source: 'FOLIO',
          sourceId: folioId,
          description: `${e.description} — guest ${folio.guestName}`,
          amount:
            folioTax > 0 && totalCharges > 0
              ? round2(e.amount * (netTotal / totalCharges))
              : round2(e.amount),
          incomeDate: e.createdAt,
          createdById: e.createdById,
        },
      });
    }

    if (cashAccount) {
      const entry = await db.journalEntry.create({
        data: {
          tenantId,
          reference: `FOL-${folioId}`,
          description: `Guest folio settlement — ${folio.guestName}`,
          entryDate: new Date(),
        },
      });

      // Credit each revenue account with its share of the settled charges, using
      // the same per-service split as the income rows above (scaled to the net
      // total so an inclusive VAT folio still balances).
      const byAccount = new Map<number, number>();
      for (const e of charges) {
        const accountId =
          e.accountId && e.account?.type === AccountType.INCOME
            ? e.accountId
            : revenueAccountFor(e.sourceService);
        byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + e.amount);
      }
      const scale = totalCharges > 0 ? netTotal / totalCharges : 0;
      const revenueLines = Array.from(byAccount.entries()).map(
        ([accountId, gross]) => ({
          tenantId,
          journalEntryId: entry.id,
          accountId,
          debit: 0,
          credit: round2(gross * scale),
        }),
      );

      await db.journalLine.createMany({
        data: [
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: arAccount ? arAccount.id : cashAccount.id,
            debit: exclusiveTax
              ? round2(totalCharges + folioTax)
              : round2(totalCharges),
            credit: 0,
          },
          ...(revenueLines.length > 0
            ? revenueLines
            : [
                {
                  tenantId,
                  journalEntryId: entry.id,
                  accountId: roomRevenue.id,
                  debit: 0,
                  credit: netTotal,
                },
              ]),
        ],
      });
      if (splitVat) {
        await db.journalLine.create({
          data: {
            tenantId,
            journalEntryId: entry.id,
            accountId: vatAccount!.id,
            debit: 0,
            credit: folioTax,
          },
        });
      }
    }

    return charges.length;
  }


  /**
   * Procurement posting: when stock is restocked/created (Quick Purchases,
   * Purchase Orders, Restock Orders) the buy-side value is posted as an
   * Asset/Liability adjustment — Debit Inventory Asset ↔ Credit Accounts
   * Payable (or Cash when paid) — so procurement never skews Net Income.
   * Idempotent per reference (e.g. "RST-12", "PUR-7", "PRD-45").
   */
  async postProcurement(args: {
    ref: string;
    description: string;
    amount: number;
    entryDate?: Date;
    createdById?: number | null;
    paid?: boolean; // credit Cash instead of Accounts Payable
    tenantId: number | null;
    tx?: Prisma.TransactionClient;
    locationId?: number | null;
  }): Promise<boolean> {
    if (!args.amount || args.amount <= 0) return false;
    const db = args.tx ?? this.prisma;
    const existing = await db.journalEntry.findFirst({
      where: { tenantId: args.tenantId, reference: args.ref },
    });
    if (existing) return false;

    const accounts = await db.account.findMany({
      where: { tenantId: args.tenantId },
    });
    const find = (name: string, type: AccountType) =>
      accounts.find((a) => a.name === name && a.type === type);
    const inventory = find('Inventory Asset', AccountType.ASSET);
    const fallbackCredit = args.paid
      ? find('Cash', AccountType.ASSET)
      : find('Accounts Payable', AccountType.LIABILITY);

    // Tenant AccountMapping wins; without one we fall back to the classic
    // Inventory ↔ AP/Cash chart names (historic behaviour unchanged).
    await this.ensureMappings(db, args.tenantId);
    const pair = await this.mappingOverride(
      args.paid ? 'PURCHASE_PAID' : 'PURCHASE',
      db,
      args.tenantId,
    );
    const debitAccountId = pair.debitAccountId ?? inventory?.id ?? null;
    const creditId = pair.creditAccountId ?? fallbackCredit?.id ?? null;
    if (!debitAccountId || !creditId) return false;

    const entry = await db.journalEntry.create({
      data: {
        tenantId: args.tenantId,
        reference: args.ref,
        description: args.description,
        entryDate: args.entryDate ?? new Date(),
        createdById: args.createdById ?? null,
        locationId: args.locationId ?? null,
      },
    });
    await db.journalLine.createMany({
      data: [
        {
          tenantId: args.tenantId,
          journalEntryId: entry.id,
          accountId: debitAccountId,
          debit: round2(args.amount),
          credit: 0,
        },
        {
          tenantId: args.tenantId,
          journalEntryId: entry.id,
          accountId: creditId,
          debit: 0,
          credit: round2(args.amount),
        },
      ],
    });
    return true;
  }

  /**
   * Inventory reconciliation / stock-adjustment posting. Books the value
   * difference between the counted and system stock:
   *   - surplus  (signedAmount > 0): Debit Inventory Asset ↔ Credit Inventory Adjustment
   *   - shortage (signedAmount < 0): Debit Inventory Adjustment ↔ Credit Inventory Asset
   * Idempotent per reference (e.g. "ADJ-..."). Best-effort: a missing
   * "Inventory Adjustment" account is auto-created; otherwise it falls back to
   * Spoilage & Wastage.
   */
  async postInventoryAdjustment(args: {
    ref: string;
    description: string;
    signedAmount: number; // > 0 surplus, < 0 shortage
    entryDate?: Date;
    createdById?: number | null;
    tenantId: number | null;
    tx?: Prisma.TransactionClient;
  }): Promise<boolean> {
    if (!args.signedAmount || Math.abs(args.signedAmount) <= 0) return false;
    const db = args.tx ?? this.prisma;
    const existing = await db.journalEntry.findFirst({
      where: { tenantId: args.tenantId, reference: args.ref },
    });
    if (existing) return false;

    const accounts = await db.account.findMany({
      where: { tenantId: args.tenantId },
    });
    const find = (name: string, type: AccountType) =>
      accounts.find((a) => a.name === name && a.type === type);
    const inventory = find('Inventory Asset', AccountType.ASSET);

    let adjustment =
      find('Inventory Adjustment', AccountType.EXPENSE) ??
      find('Spoilage & Wastage', AccountType.EXPENSE);
    if (!adjustment) {
      const created = await db.account.create({
        data: {
          tenantId: args.tenantId,
          name: 'Inventory Adjustment',
          code: '7200',
          type: AccountType.EXPENSE,
          isSystem: true,
        },
      });
      adjustment = created;
    }

    // The mapping pair defines the two accounts that participate in a count
    // variance; the engine keeps the direction (surplus debits the asset,
    // shortage debits the expense). Sides fall back to the chart names.
    await this.ensureMappings(db, args.tenantId);
    const pair = await this.mappingOverride('ADJUSTMENT', db, args.tenantId);
    const assetSide = pair.debitAccountId ?? inventory?.id ?? null;
    const varianceSide = pair.creditAccountId ?? adjustment?.id ?? null;
    if (!assetSide || !varianceSide) return false;

    const amount = round2(Math.abs(args.signedAmount));
    const entry = await db.journalEntry.create({
      data: {
        tenantId: args.tenantId,
        reference: args.ref,
        description: args.description,
        entryDate: args.entryDate ?? new Date(),
        createdById: args.createdById ?? null,
      },
    });
    await db.journalLine.createMany({
      data:
        args.signedAmount > 0
          ? [
              {
                tenantId: args.tenantId,
                journalEntryId: entry.id,
                accountId: assetSide,
                debit: amount,
                credit: 0,
              },
              {
                tenantId: args.tenantId,
                journalEntryId: entry.id,
                accountId: varianceSide,
                debit: 0,
                credit: amount,
              },
            ]
          : [
              {
                tenantId: args.tenantId,
                journalEntryId: entry.id,
                accountId: varianceSide,
                debit: amount,
                credit: 0,
              },
              {
                tenantId: args.tenantId,
                journalEntryId: entry.id,
                accountId: assetSide,
                debit: 0,
                credit: amount,
              },
            ],
    });
    return true;
  }

  /**
   * Spoilage/wastage write-off posting: Debit "Spoilage & Wastage" (expense)
   * ↔ Credit "Inventory Asset", so the loss appears on the P&L as a separate
   * operating expense without skewing standard COGS. Idempotent per reference
   * (e.g. "WST-12").
   */
  async postWastage(args: {
    ref: string;
    description: string;
    amount: number;
    entryDate?: Date;
    createdById?: number | null;
    tenantId: number | null;
    tx?: Prisma.TransactionClient;
  }): Promise<boolean> {
    if (!args.amount || args.amount <= 0) return false;
    const db = args.tx ?? this.prisma;
    const existing = await db.journalEntry.findFirst({
      where: { tenantId: args.tenantId, reference: args.ref },
    });
    if (existing) return false;

    const inventory = await db.account.findFirst({
      where: {
        tenantId: args.tenantId,
        name: 'Inventory Asset',
        type: AccountType.ASSET,
      },
    });
    // Find-or-create the dedicated wastage expense account (orgs created
    // before this account was added to the default chart need it created).
    let wastage = await db.account.findFirst({
      where: {
        tenantId: args.tenantId,
        name: 'Spoilage & Wastage',
        type: AccountType.EXPENSE,
      },
    });
    if (!wastage) {
      wastage = await db.account.create({
        data: {
          tenantId: args.tenantId,
          name: 'Spoilage & Wastage',
          code: '7100',
          type: AccountType.EXPENSE,
        },
      });
    }

    // Tenant mapping wins; chart-name lookups stay as the fallback.
    await this.ensureMappings(db, args.tenantId);
    const pair = await this.mappingOverride('WASTAGE', db, args.tenantId);
    const expenseId = pair.debitAccountId ?? wastage?.id ?? null;
    const inventoryId = pair.creditAccountId ?? inventory?.id ?? null;
    if (!expenseId || !inventoryId) return false;

    const entry = await db.journalEntry.create({
      data: {
        tenantId: args.tenantId,
        reference: args.ref,
        description: args.description,
        entryDate: args.entryDate ?? new Date(),
        createdById: args.createdById ?? null,
      },
    });
    await db.journalLine.createMany({
      data: [
        {
          tenantId: args.tenantId,
          journalEntryId: entry.id,
          accountId: expenseId,
          debit: round2(args.amount),
          credit: 0,
        },
        {
          tenantId: args.tenantId,
          journalEntryId: entry.id,
          accountId: inventoryId,
          debit: 0,
          credit: round2(args.amount),
        },
      ],
    });
    return true;
  }



  private async postContraJournal(args: {
    ref: string;
    description: string;
    amount: number;
    debitAccountId: number;
    creditAccountId: number;
    tenantId: number | null;
    tx?: Prisma.TransactionClient;
    createdById?: number | null;
    entryDate?: Date;
    locationId?: number | null;
    postingStatus?: JournalPostingStatus;
  }): Promise<boolean> {
    const db = args.tx ?? this.prisma;
    if (!args.amount || args.amount <= 0) return false;
    const existing = await db.journalEntry.findFirst({
      where: { tenantId: args.tenantId, reference: args.ref },
    });
    if (existing) return false;
    const entry = await db.journalEntry.create({
      data: {
        tenantId: args.tenantId,
        reference: args.ref,
        description: args.description,
        entryDate: args.entryDate ?? new Date(),
        createdById: args.createdById ?? null,
        locationId: args.locationId ?? null,
        postingStatus: args.postingStatus ?? JournalPostingStatus.POSTED,
      },
    });
    await db.journalLine.createMany({
      data: [
        { tenantId: args.tenantId, journalEntryId: entry.id, accountId: args.debitAccountId, debit: round2(args.amount), credit: 0 },
        { tenantId: args.tenantId, journalEntryId: entry.id, accountId: args.creditAccountId, debit: 0, credit: round2(args.amount) },
      ],
    });
    return true;
  }

  /**
   * Vendor-bill payment settlement: Debit Accounts Payable ↔ Credit Cash (VBP-...).
   */
  async postVendorBillPayment(args: {
    ref: string;
    amount: number;
    tenantId: number | null;
    tx?: Prisma.TransactionClient;
    createdById?: number | null;
    entryDate?: Date;
  }): Promise<boolean> {
    const db = args.tx ?? this.prisma;
    const accounts = await db.account.findMany({ where: { tenantId: args.tenantId } });
    const ap = accounts.find((a) => a.name === 'Accounts Payable');
    const cash = accounts.find((a) => a.name === 'Cash' && a.type === AccountType.ASSET);
    await this.ensureMappings(db, args.tenantId);
    const pair = await this.mappingOverride('VENDOR_PAYMENT', db, args.tenantId);
    const debitId = pair.debitAccountId ?? ap?.id ?? null;
    const creditId = pair.creditAccountId ?? cash?.id ?? null;
    if (!debitId || !creditId) {
      this.logger.warn(`Vendor-bill payment ${args.ref} skipped - 'Accounts Payable'/'Cash' accounts are missing.`);
      return false;
    }
    return this.postContraJournal({
      ...args,
      description: 'Vendor bill payment',
      debitAccountId: debitId,
      creditAccountId: creditId,
    });
  }

  /**
   * Vendor credit note for rejected/returned goods: Debit Accounts Payable ↔
   * Credit Inventory Asset (VCN-...), reversing the value accrued at GRN.
   */
  async postVendorCreditNote(args: MfgPostArgs): Promise<boolean> {
    const db = args.tx ?? this.prisma;
    const accounts = await db.account.findMany({ where: { tenantId: args.tenantId } });
    const ap = accounts.find((a) => a.name === 'Accounts Payable');
    const inventory = accounts.find((a) => a.name === 'Inventory Asset');
    await this.ensureMappings(db, args.tenantId);
    const pair = await this.mappingOverride('CREDIT_NOTE', db, args.tenantId);
    const debitId = pair.debitAccountId ?? ap?.id ?? null;
    const creditId = pair.creditAccountId ?? inventory?.id ?? null;
    if (!debitId || !creditId) {
      this.logger.warn(`Vendor credit note ${args.ref} skipped - 'Accounts Payable'/'Inventory Asset' accounts are missing.`);
      return false;
    }
    return this.postContraJournal({
      ...args,
      description: 'Vendor credit note',
      debitAccountId: debitId,
      creditAccountId: creditId,
      postingStatus: args.postingStatus ?? JournalPostingStatus.REVERSED,
    });
  }

  /**
   * Scrapped rejected stock write-off: Dr Spoilage & Wastage ↔ Cr Inventory
   * Asset (SCP-...), so the loss hits the P&L and Accounts Payable stays.
   */
  async postScrapDisposition(args: MfgPostArgs): Promise<boolean> {
    const db = args.tx ?? this.prisma;
    const accounts = await db.account.findMany({ where: { tenantId: args.tenantId } });
    const inventory = accounts.find((a) => a.name === 'Inventory Asset');
    let wastage = accounts.find((a) => a.name === 'Spoilage & Wastage');
    if (!wastage) {
      wastage = await db.account.create({
        data: {
          tenantId: args.tenantId,
          name: 'Spoilage & Wastage',
          code: '7100',
          type: AccountType.EXPENSE,
        },
      });
    }
    await this.ensureMappings(db, args.tenantId);
    const pair = await this.mappingOverride('SCRAP', db, args.tenantId);
    const debitId = pair.debitAccountId ?? wastage?.id ?? null;
    const creditId = pair.creditAccountId ?? inventory?.id ?? null;
    if (!debitId || !creditId) {
      this.logger.warn(`Scrap disposition ${args.ref} skipped - 'Spoilage & Wastage'/'Inventory Asset' accounts are missing.`);
      return false;
    }
    return this.postContraJournal({
      ...args,
      description: 'Scrapped rejected stock',
      debitAccountId: debitId,
      creditAccountId: creditId,
      postingStatus: args.postingStatus ?? JournalPostingStatus.REVERSED,
    });
  }

  /**
   * Reversal postings for a returned sale: restore Inventory, reduce COGS and
   * reverse the cash/AR leg. Idempotent via (source='SALE_REVERSAL', sourceId
   * = returnId).
   */
  async reverseSalePostings(
    returnId: number,
    tenantId: number | null,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const existing = await db.cogsEntry.findFirst({
      where: { tenantId, source: 'SALE_REVERSAL', sourceId: returnId },
    });
    if (existing) return 0;

    const ret = await db.return.findUnique({
      where: { id: returnId },
      include: {
        items: true,
        sale: { select: { id: true, saleDate: true, saleType: true } },
      },
    });
    if (!ret) return 0;

    const refund = ret.totalRefund || 0;
    const cost = ret.items.reduce(
      (s, ri) => s + (ri.unitBuyPrice ?? 0) * ri.quantity,
      0,
    );
    if (refund <= 0 && cost <= 0) return 0;

    const accounts = await db.account.findMany({ where: { tenantId } });
    const find = (name: string) => accounts.find((a) => a.name === name);
    const cogsAccount = find('Cost of Goods Sold');
    const inventoryAccount = find('Inventory Asset');
    const cashAccount = find('Cash');
    const revenueAccount =
      find('Sales Revenue') ??
      find('Service Revenue') ??
      find('Other Income') ??
      accounts.find((a) => a.type === AccountType.INCOME);
    const arAccount = find('Accounts Receivable');

    // SALE mapping can override the settlement side of the reversal (the same
    // account that was debited at the sale), e.g. Bank instead of Cash.
    const salePair = await this.mappingOverride('SALE', db);

    if (cogsAccount && cost > 0) {
      await db.cogsEntry.create({
        data: {
          tenantId,
          accountId: cogsAccount.id,
          source: 'SALE_REVERSAL',
          sourceId: returnId,
          saleId: ret.sale?.id ?? null,
          description: `Return reversal — refund ${refund.toFixed(2)}`,
          amount: round2(-cost),
          quantity: -ret.items.reduce((s, ri) => s + ri.quantity, 0),
          entryDate: ret.createdAt,
          createdById: ret.createdById,
        },
      });
    }

    const journalPosted = Boolean(cashAccount && inventoryAccount && revenueAccount);
    if (cashAccount && inventoryAccount && revenueAccount) {
      const entry = await db.journalEntry.create({
        data: {
          tenantId,
          reference: `RTRN-${returnId}`,
          description: `Return reversal — refund ${refund.toFixed(2)}`,
          entryDate: ret.createdAt,
          createdById: ret.createdById,
          locationId: (ret as { shopId?: number | null }).shopId ?? null,
          postingStatus: JournalPostingStatus.REVERSED,
        },
      });
      const lines: JournalLineInput[] = [];
      if (refund > 0) {
        // Reverse the sale: Debit Revenue ↔ Credit Cash / AR.
        lines.push(
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: revenueAccount.id,
            debit: round2(refund),
            credit: 0,
          },
          {
            tenantId,
            journalEntryId: entry.id,
            accountId:
              salePair.debitAccountId ??
              (ret.sale?.saleType === 'FULLY_PAID' && cashAccount
                ? cashAccount.id
                : arAccount?.id ?? cashAccount.id),
            debit: 0,
            credit: round2(refund),
          },
        );
      }
      if (cost > 0) {
        // Restore the inventory value: Debit Inventory ↔ Credit COGS.
        lines.push(
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: inventoryAccount.id,
            debit: round2(cost),
            credit: 0,
          },
          {
            tenantId,
            journalEntryId: entry.id,
            accountId: cogsAccount?.id ?? revenueAccount.id,
            debit: 0,
            credit: round2(cost),
          },
        );
      }
      if (lines.length > 0) {
        await db.journalLine.createMany({ data: lines });
      }
    }

    if (!journalPosted && (refund > 0 || cost > 0)) {
      this.logger.warn(
        `Return reversal #${returnId} (refund ${refund}, cost ${cost}) was recorded but its RTRN journal was skipped - 'Cash'/'Inventory Asset'/'Sales Revenue' accounts are required.`,
      );
    }
    return 1;
  }

  // --- Journal ---
  async listJournalEntries() {
    const tenantId = this.tenant();
    return this.prisma.journalEntry.findMany({
      where: { tenantId },
      include: { lines: { include: { account: true } } },
      orderBy: { entryDate: 'desc' },
      take: 200,
    });
  }

  async createJournalEntry(dto: CreateJournalEntryDto, userId: number) {
    const tenantId = this.tenant();
    const totalDebit = dto.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredit = dto.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new BadRequestException('Journal must balance (debits = credits)');
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          reference: dto.reference,
          description: dto.description,
          entryDate: dto.entryDate ? new Date(dto.entryDate) : undefined,
          createdById: userId,
        },
      });
      await tx.journalLine.createMany({
        data: dto.lines.map((l) => ({
          tenantId,
          journalEntryId: entry.id,
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
        })),
      });
      return entry;
    });
  }

  // --- General Ledger views (read-only) ---
  /**
   * Paginated double-entry journal. Each entry carries balanced debit/credit
   * totals plus a source bucket derived from the reference prefix (SALE, RTRN,
   * EXP, INC, MGI, ORD, FOL, PO, PUR, RST, PRDV, ADJ, WST or MANUAL).
   */
  async getGlJournal(args: {
    startDate?: string;
    endDate?: string;
    accountId?: number;
    source?: string;
    locationId?: number;
    moduleSource?: string;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 25));
    const { entryWhere, lineWhere } = this.glWhere(args);
    const [total, entries, totals] = await Promise.all([
      this.prisma.journalEntry.count({ where: entryWhere }),
      this.prisma.journalEntry.findMany({
        where: entryWhere,
        include: {
          lines: { include: { account: true }, orderBy: { id: 'asc' } },
        },
        orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalLine.aggregate({
        where: lineWhere,
        _sum: { debit: true, credit: true },
      }),
    ]);
    const data = entries.map((e) => ({
      ...e,
      source: this.refBucket(e.reference),
      totalDebit: round2((e.lines ?? []).reduce((sum, l) => sum + (l.debit ?? 0), 0)),
      totalCredit: round2((e.lines ?? []).reduce((sum, l) => sum + (l.credit ?? 0), 0)),
    }));
    return {
      data,
      page,
      pageSize,
      total,
      totals: {
        debit: round2(totals._sum?.debit ?? 0),
        credit: round2(totals._sum?.credit ?? 0),
      },
    };
  }

  /**
   * PDF export of the journal for the whole filtered period: every entry with
   * the account lines that make it up (the breakdown the shops need), then the
   * period totals. Same filters as `getGlJournal`, no paging.
   */
  async getGlJournalPdf(args: {
    startDate?: string;
    endDate?: string;
    accountId?: number;
    source?: string;
    locationId?: number;
    moduleSource?: string;
    status?: string;
    search?: string;
  }): Promise<Buffer> {
    const { entryWhere, lineWhere } = this.glWhere(args);
    const [entries, totals] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: entryWhere,
        include: {
          lines: { include: { account: true }, orderBy: { id: 'asc' } },
        },
        orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.journalLine.aggregate({
        where: lineWhere,
        _sum: { debit: true, credit: true },
      }),
    ]);

    // Location names live on the Location table; fetch just the ids in view.
    const locationIds = [
      ...new Set(
        entries
          .map((e) => e.locationId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const locations = locationIds.length
      ? await this.prisma.location.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, name: true },
        })
      : [];
    const locationName = new Map(locations.map((l) => [l.id, l.name]));

    const rows = buildGlJournalPdfRows(
      entries.map((e) => ({
        entryDate: e.entryDate,
        reference: e.reference,
        description: e.description,
        source: this.refBucket(e.reference),
        postingStatus: e.postingStatus,
        locationName: e.locationId
          ? locationName.get(e.locationId) ?? `#${e.locationId}`
          : '',
        totalDebit: (e.lines ?? []).reduce((s, l) => s + (l.debit ?? 0), 0),
        totalCredit: (e.lines ?? []).reduce((s, l) => s + (l.credit ?? 0), 0),
        lines: e.lines,
      })),
      {
        debit: totals._sum?.debit ?? 0,
        credit: totals._sum?.credit ?? 0,
      },
    );

    return renderGlJournalPdf({
      title: 'General Ledger — Journal',
      subtitle: [args.startDate, args.endDate].filter(Boolean).join(' → '),
      columns: GL_JOURNAL_PDF_COLUMNS,
      rows,
    });
  }

  /** Trial balance: debits, credits and net balance per account with activity. */
  async getGlTrialBalance(args: {
    startDate?: string;
    endDate?: string;
    locationId?: number;
    moduleSource?: string;
    status?: string;
    search?: string;
  }) {
    const { lineWhere } = this.glWhere(args);
    const lines = await this.prisma.journalLine.findMany({
      where: lineWhere,
      include: { account: true },
    });
    const byAccount = new Map();
    for (const l of lines) {
      const acc = l.account;
      const row = byAccount.get(l.accountId) ?? {
        debit: 0,
        credit: 0,
        account: acc,
      };
      row.debit += l.debit ?? 0;
      row.credit += l.credit ?? 0;
      byAccount.set(l.accountId, row);
    }
    let totalDebit = 0;
    let totalCredit = 0;
    const rows = Array.from(byAccount.values()).map((r) => {
      const account = r.account;
      const normal = this.normalSide(account?.type);
      totalDebit += r.debit;
      totalCredit += r.credit;
      return {
        accountId: account?.id ?? 0,
        code: account?.code ?? null,
        name: account?.name ?? 'Unknown account',
        type: account?.type ?? null,
        isSystem: account?.isSystem ?? false,
        debit: round2(r.debit),
        credit: round2(r.credit),
        balance: round2(normal === 'DEBIT' ? r.debit - r.credit : r.credit - r.debit),
      };
    });
    rows.sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')));
    const difference = round2(totalDebit - totalCredit);
    return {
      rows,
      totals: {
        debit: round2(totalDebit),
        credit: round2(totalCredit),
        difference,
      },
      balanced: Math.abs(difference) < 0.01,
    };
  }

  /** Per-account ledger with opening balance, running balance and closing. */
  async getGlAccountLedger(
    accountId: number,
    args: {
      startDate?: string;
      endDate?: string;
      locationId?: number;
      moduleSource?: string;
      status?: string;
      search?: string;
    },
  ) {
    const tenantId = this.tenant();
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, tenantId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const normal = this.normalSide(account.type);
    // Opening balance honours the active location/module/status/search filters
    // so the opening + activity always reconcile with what the table shows.
    const { lineWhere: filteredForOpening } = this.glWhere({ ...args, accountId });
    const openingWhere: any = { ...filteredForOpening };
    if (args.startDate) {
      openingWhere.journalEntry = {
        AND: [filteredForOpening.journalEntry, { entryDate: { lt: new Date(args.startDate) } }],
      };
    }
    const opening = await this.prisma.journalLine.aggregate({
      where: openingWhere,
      _sum: { debit: true, credit: true },
    });
    const openingBalance =
      normal === 'DEBIT'
        ? round2((opening._sum?.debit ?? 0) - (opening._sum?.credit ?? 0))
        : round2((opening._sum?.credit ?? 0) - (opening._sum?.debit ?? 0));
    const { lineWhere } = this.glWhere({ ...args, accountId });
    const activity = await this.prisma.journalLine.findMany({
      where: lineWhere,
      include: {
        journalEntry: {
          select: {
            id: true,
            reference: true,
            description: true,
            entryDate: true,
          },
        },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { id: 'asc' }],
    });
    let running = openingBalance;
    const rows = activity.map((l) => {
      const entry = l.journalEntry;
      const delta =
        normal === 'DEBIT'
          ? (l.debit ?? 0) - (l.credit ?? 0)
          : (l.credit ?? 0) - (l.debit ?? 0);
      running = round2(running + delta);
      return {
        journalEntryId: entry?.id ?? null,
        date: entry?.entryDate ?? null,
        reference: entry?.reference ?? null,
        description: entry?.description ?? null,
        debit: round2(l.debit ?? 0),
        credit: round2(l.credit ?? 0),
        balance: running,
      };
    });
    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        isSystem: account.isSystem,
      },
      normal,
      openingBalance,
      closingBalance: rows.length ? rows[rows.length - 1].balance : openingBalance,
      rows,
    };
  }

  /**
   * Auto-posting health (Coverage). Compares the journal and sub-ledgers with
   * the source transactions the engine should have posted, so claims like
   * "retail/POS sales post Income + COGS and returns reverse automatically" are
   * verifiable in the UI instead of asserted.
   */
  async getGlCoverage(args: { startDate?: string; endDate?: string }) {
    const tenantId = this.tenant();
    const startDate = args.startDate;
    const endDate = args.endDate;
    const jFilter = this.glWhere(args);
    const [journalRows, lineTotals, saleAgg, returnAgg, expenseAgg, incGroups, cogsGroups] =
      await Promise.all([
        this.prisma.journalEntry.findMany({
          where: jFilter.entryWhere,
          select: { id: true, reference: true },
        }),
        this.prisma.journalLine.aggregate({
          where: jFilter.lineWhere,
          _sum: { debit: true, credit: true },
          _count: true,
        }),
        this.prisma.sale.aggregate({
          where: { tenantId, ...this.dateWhere('saleDate', startDate, endDate) },
          _count: true,
          _sum: { totalAmount: true, totalCost: true },
        }),
        this.prisma.return.aggregate({
          where: { tenantId, ...this.dateWhere('createdAt', startDate, endDate) },
          _count: true,
          _sum: { totalRefund: true },
        }),
        this.prisma.expense.aggregate({
          where: { tenantId, ...this.dateWhere('expenseDate', startDate, endDate) },
          _count: true,
          _sum: { amount: true },
        }),
        this.prisma.otherIncome.groupBy({
          by: ['source'],
          where: { tenantId, ...this.dateWhere('incomeDate', startDate, endDate) },
          _count: true,
          _sum: { amount: true },
        }),
        this.prisma.cogsEntry.groupBy({
          by: ['source'],
          where: { tenantId, ...this.dateWhere('entryDate', startDate, endDate) },
          _count: true,
          _sum: { amount: true },
        }),
      ]);

    const bucketCounts = new Map<string, number>();
    for (const j of journalRows) {
      const key = this.refBucket(j.reference);
      bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
    }
    const countOf = (x: any) =>
      typeof x?._count === 'number' ? x._count : (x?._count?._all ?? 0);
    const sumOf = (x: any, field: string) => Number(x?._sum?.[field] ?? 0);
    const toMap = (rows: any[]) => {
      const m = new Map<string, { count: number; amount: number }>();
      for (const r of rows) {
        m.set(r.source ?? 'UNKNOWN', { count: countOf(r), amount: round2(sumOf(r, 'amount')) });
      }
      return m;
    };
    const inc = toMap(incGroups);
    const cogs = toMap(cogsGroups);
    const empty = { count: 0, amount: 0 };
    const get = (m: Map<string, { count: number; amount: number }>, k: string) => m.get(k) ?? empty;
    const saleExpected = countOf(saleAgg);
    const saleJournal = bucketCounts.get('SALE') ?? 0;
    const saleInc = get(inc, 'SALE');
    const saleCogs = get(cogs, 'SALE');
    const saleStatus = saleExpected === 0 ? 'idle' : saleJournal > 0 ? 'ok' : saleInc.count > 0 ? 'partial' : 'missing';
    const saleNote =
      saleStatus === 'ok'
        ? ''
        : saleStatus === 'partial'
          ? "Income/COGS rows posted but no SALE journal entries - 'Cash' / 'Inventory Asset' accounts may be missing."
          : saleStatus === 'missing'
            ? 'Sales exist with no auto-posted income - an income account (Sales Revenue) is missing.'
            : '';
    const returnExpected = countOf(returnAgg);
    const returnJournal = bucketCounts.get('RTRN') ?? 0;
    const returnCogs = get(cogs, 'SALE_REVERSAL');
    const returnStatus = returnExpected === 0 ? 'idle' : returnJournal > 0 ? 'ok' : returnCogs.count > 0 ? 'partial' : 'missing';
    const returnNote =
      returnStatus === 'ok'
        ? ''
        : returnStatus === 'partial'
          ? "Return refunds recorded but no RTRN reversal journal - 'Cash' / 'Inventory Asset' / 'Sales Revenue' accounts may be missing."
          : returnStatus === 'missing'
            ? 'Returns exist with no reversal entries.'
            : '';
    const expenseExpected = countOf(expenseAgg);
    const expenseJournal = bucketCounts.get('EXP') ?? 0;
    const expenseStatus = expenseExpected === 0 ? 'idle' : expenseJournal > 0 ? 'ok' : 'partial';
    const expenseNote = expenseStatus === 'partial' ? 'Expenses recorded but no EXP journal entries - a Cash account may be missing.' : '';
    const manualIncome = get(inc, 'UNKNOWN');
    const incJournal = bucketCounts.get('INC') ?? 0;
    const incStatus = manualIncome.count === 0 ? 'idle' : incJournal > 0 ? 'ok' : 'partial';
    const incNote = incStatus === 'partial' ? 'Manual income recorded but no INC journal entries - a Cash account may be missing.' : '';
    const mfgIncome = get(inc, 'MFG_SERVICE');
    const mfgJournal = bucketCounts.get('MGI') ?? 0;
    const mfgStatus = mfgIncome.count === 0 ? 'idle' : mfgJournal > 0 ? 'ok' : 'partial';
    const mfgNote = mfgStatus === 'partial' ? 'Manufacturing service income recorded but no MGI journal entries - a Cash account may be missing.' : '';
    const sources = [
      {
        key: 'sale',
        label: 'Retail sales / POS',
        expectedCount: saleExpected,
        expectedAmount: round2(sumOf(saleAgg, 'totalAmount')),
        expectedCost: round2(sumOf(saleAgg, 'totalCost')),
        journalCount: saleJournal,
        incomeCount: saleInc.count,
        incomeAmount: saleInc.amount,
        cogsCount: saleCogs.count,
        cogsAmount: saleCogs.amount,
        status: saleStatus,
        note: saleNote,
      },
      {
        key: 'return',
        label: 'Returns (refunds)',
        expectedCount: returnExpected,
        expectedAmount: round2(sumOf(returnAgg, 'totalRefund')),
        journalCount: returnJournal,
        incomeCount: 0,
        incomeAmount: 0,
        cogsCount: returnCogs.count,
        cogsAmount: returnCogs.amount,
        status: returnStatus,
        note: returnNote,
      },
      {
        key: 'expense',
        label: 'Manual expenses',
        expectedCount: expenseExpected,
        expectedAmount: round2(sumOf(expenseAgg, 'amount')),
        journalCount: expenseJournal,
        incomeCount: 0,
        incomeAmount: 0,
        cogsCount: 0,
        cogsAmount: 0,
        status: expenseStatus,
        note: expenseNote,
      },
      {
        key: 'manualIncome',
        label: 'Manual income',
        expectedCount: manualIncome.count,
        expectedAmount: manualIncome.amount,
        journalCount: incJournal,
        incomeCount: manualIncome.count,
        incomeAmount: manualIncome.amount,
        cogsCount: 0,
        cogsAmount: 0,
        status: incStatus,
        note: incNote,
      },
      {
        key: 'mfgService',
        label: 'Manufacturing services',
        expectedCount: mfgIncome.count,
        expectedAmount: mfgIncome.amount,
        journalCount: mfgJournal,
        incomeCount: mfgIncome.count,
        incomeAmount: mfgIncome.amount,
        cogsCount: 0,
        cogsAmount: 0,
        status: mfgStatus,
        note: mfgNote,
      },
    ];
    const order = ['SALE', 'RTRN', 'EXP', 'INC', 'MGI', 'ORD', 'FOL', 'PO', 'PUR', 'RST', 'PRDV', 'ADJ', 'WST', 'MANUAL'];
    const byReference = order
      .filter((k) => bucketCounts.has(k))
      .map((k) => ({ key: k, count: bucketCounts.get(k) ?? 0 }));
    const totalDebit = round2(lineTotals._sum?.debit ?? 0);
    const totalCredit = round2(lineTotals._sum?.credit ?? 0);
    const difference = round2(totalDebit - totalCredit);
    return {
      totals: {
        journalEntries: journalRows.length,
        journalLines: lineTotals._count ?? 0,
        debit: totalDebit,
        credit: totalCredit,
        difference,
        balanced: Math.abs(difference) < 0.01,
      },
      byReference,
      sources,
    };
  }

  // --- Profit & Loss ---
  async getProfitAndLoss(startDate?: string, endDate?: string) {
    const tenantId = this.tenant();

    const [salesAgg, ordersAgg, orderItems, incomeAgg, expenseAgg, folioAgg] =
      await Promise.all([
        this.prisma.sale.aggregate({
          where: {
            tenantId,
            ...this.dateWhere('saleDate', startDate, endDate),
          },
          _sum: { totalAmount: true, totalCost: true },
        }),
        this.prisma.order.aggregate({
          where: {
            tenantId,
            status: OrderStatus.PAID,
            ...this.dateWhere('createdAt', startDate, endDate),
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.orderItem.findMany({
          where: {
            tenantId,
            order: {
              status: OrderStatus.PAID,
              ...this.dateWhere('createdAt', startDate, endDate),
            },
          },
          select: { cost: true, quantity: true },
        }),
        this.prisma.otherIncome.aggregate({
          where: {
            tenantId,
            source: null,
            ...this.dateWhere('incomeDate', startDate, endDate),
          },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: {
            tenantId,
            ...this.dateWhere('expenseDate', startDate, endDate),
          },
          _sum: { amount: true },
        }),
        this.prisma.folioEntry.aggregate({
          where: {
            tenantId,
            type: 'CHARGE',
            ...this.dateWhere('createdAt', startDate, endDate),
          },
          _sum: { amount: true },
        }),
      ]);

    const salesRevenue = salesAgg._sum.totalAmount ?? 0;
    const orderRevenue = ordersAgg._sum.totalAmount ?? 0;
    const otherIncome = incomeAgg._sum.amount ?? 0;
    const hotelRevenue = folioAgg._sum.amount ?? 0;
    const retailCogs = salesAgg._sum.totalCost ?? 0;
    // Restaurant COGS = Σ(item cost × quantity) across paid orders.
    const orderCogs = orderItems.reduce(
      (s, i) => s + (i.cost ?? 0) * i.quantity,
      0,
    );
    const cogs = retailCogs + orderCogs;
    const expenses = expenseAgg._sum.amount ?? 0;

    const totalRevenue =
      salesRevenue + orderRevenue + otherIncome + hotelRevenue;
    const totalCosts = cogs + expenses;

    return {
      salesRevenue,
      orderRevenue,
      otherIncome,
      hotelRevenue,
      totalRevenue,
      costOfGoodsSold: cogs,
      expenses,
      totalCosts,
      // Unified P&L: Gross Profit = Total Revenue − Cost of Goods Expense;
      // Net Profit = Total Revenue − Total Expenses (= Gross − Operational).
      grossProfit: round2(totalRevenue - cogs),
      netProfit: round2(totalRevenue - totalCosts),
    };
  }

  /**
   * Per-category profitability: income, COGS, profit and margin grouped by
   * menu category (e.g. "finance related to beer only" when filtered).
   * COGS uses direct item cost; overhead is reported as a single unallocated
   * figure (allocate by revenue share if needed).
   */
  async getProfitByCategory(
    startDate?: string,
    endDate?: string,
    categoryId?: number,
  ) {
    const tenantId = this.tenant();

    const [orderItems, taggedIncome, expenseAgg] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: {
          tenantId,
          order: {
            status: OrderStatus.PAID,
            ...this.dateWhere('createdAt', startDate, endDate),
          },
        },
        select: {
          unitPrice: true,
          cost: true,
          quantity: true,
          menuItem: {
            select: {
              menuCategoryId: true,
              menuCategory: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.otherIncome.findMany({
        where: {
          tenantId,
          source: null,
          ...this.dateWhere('incomeDate', startDate, endDate),
          ...(categoryId
            ? { menuCategoryId: categoryId }
            : { menuCategoryId: { not: null } }),
        },
        select: {
          amount: true,
          menuCategoryId: true,
          menuCategory: { select: { name: true } },
        },
      }),
      this.prisma.expense.aggregate({
        where: {
          tenantId,
          ...this.dateWhere('expenseDate', startDate, endDate),
        },
        _sum: { amount: true },
      }),
    ]);

    const map = new Map<
      number,
      { categoryId: number; category: string; income: number; cogs: number }
    >();

    for (const item of orderItems) {
      const catId = item.menuItem?.menuCategoryId;
      const catName = item.menuItem?.menuCategory?.name ?? 'Uncategorized';
      const key = catId ?? 0;
      const row = map.get(key) ?? {
        categoryId: key,
        category: catName,
        income: 0,
        cogs: 0,
      };
      row.income += (item.unitPrice ?? 0) * item.quantity;
      row.cogs += (item.cost ?? 0) * item.quantity;
      map.set(key, row);
    }

    for (const inc of taggedIncome) {
      const key = inc.menuCategoryId ?? 0;
      const row = map.get(key) ?? {
        categoryId: key,
        category: inc.menuCategory?.name ?? 'Other income',
        income: 0,
        cogs: 0,
      };
      row.income += inc.amount;
      map.set(key, row);
    }

    if (categoryId != null) {
      const row = map.get(categoryId);
      return {
        category: row ?? { categoryId, category: 'N/A', income: 0, cogs: 0 },
        totalOverhead: expenseAgg._sum.amount ?? 0,
      };
    }

    const categories = [...map.values()].map((r) => ({
      ...r,
      income: round2(r.income),
      cogs: round2(r.cogs),
      profit: round2(r.income - r.cogs),
      margin: r.income > 0 ? round2(((r.income - r.cogs) / r.income) * 100) : 0,
    }));
    const totalIncome = categories.reduce((s, c) => s + c.income, 0);
    const totalCogs = categories.reduce((s, c) => s + c.cogs, 0);

    return {
      categories,
      totalIncome: round2(totalIncome),
      totalCogs: round2(totalCogs),
      totalOverhead: round2(expenseAgg._sum.amount ?? 0),
      netProfit: round2(
        totalIncome - totalCogs - (expenseAgg._sum.amount ?? 0),
      ),
    };
  }

  // =========================================================================
  // Tenant-aware financial breakdown & comparison reports
  // =========================================================================

  /**
   * Multi-level category breakdown, tailored to the tenant's industry:
   *  - RETAIL / MANUFACTURING: product categories with revenue, COGS, profit,
   *    margin AND Category Stock Cost (Σ inventory.qty × buy price) — supports
   *    deep sub-category filters via Category.parentId.
   *  - HOSPITALITY / SERVICE: menu categories (Meals vs Beverages vs Room
   *    Services) with optional sub-category filters (e.g. Beer / Wine /
   *    Spirits under Beverages) via MenuCategory.parentId.
   */
  async getCategoryBreakdown(opts: {
    startDate?: string;
    endDate?: string;
    categoryId?: number;
    parentCategoryId?: number;
    locationId?: number;
    businessType: string;
  }) {
    const isInventory =
      opts.businessType === 'RETAIL' || opts.businessType === 'MANUFACTURING';
    if (isInventory) {
      return this.getProductCategoryBreakdown(opts);
    }
    return this.getMenuCategoryBreakdown(opts);
  }

  /** Retail / Wholesale: product-category revenue vs stock cost breakdown. */
  private async getProductCategoryBreakdown(opts: {
    startDate?: string;
    endDate?: string;
    categoryId?: number;
    parentCategoryId?: number;
    locationId?: number;
    businessType: string;
  }) {
    const tenantId = this.tenant();
    const { startDate, endDate, categoryId, parentCategoryId, locationId } =
      opts;

    const saleWhere: Record<string, unknown> = {
      tenantId,
      ...this.dateWhere('saleDate', startDate, endDate),
    };
    if (locationId) saleWhere.shopId = locationId;

    const [saleItems, inventories, categories] = await Promise.all([
      this.prisma.saleItem.findMany({
        where: { sale: saleWhere },
        select: {
          quantity: true,
          unitSellPrice: true,
          unitBuyPrice: true,
          product: {
            select: {
              categoryId: true,
              category: { select: { id: true, name: true, parentId: true } },
            },
          },
        },
      }),
      this.prisma.inventory.findMany({
        where: {
          tenantId,
          ...(locationId ? { locationId } : {}),
        },
        select: {
          quantity: true,
          product: {
            select: {
              currentBuyPrice: true,
              categoryId: true,
              category: { select: { id: true, name: true, parentId: true } },
            },
          },
        },
      }),
      this.prisma.category.findMany({
        where: { tenantId },
        select: { id: true, name: true, parentId: true },
      }),
    ]);


    const catMeta = new Map<
      number,
      { id: number; name: string; parentId: number | null }
    >();
    for (const c of categories) catMeta.set(c.id, c);

    type Row = {
      revenue: number;
      cogs: number;
      qty: number;
      stockCost: number;
      stockQty: number;
    };
    const rows = new Map<number, Row>();
    const row = (id: number, name: string, parentId: number | null): Row => {
      let r = rows.get(id);
      if (!r) {
        r = { revenue: 0, cogs: 0, qty: 0, stockCost: 0, stockQty: 0 };
        rows.set(id, r);
        if (!catMeta.has(id)) catMeta.set(id, { id, name, parentId });
      }
      return r;
    };

    for (const si of saleItems) {
      const cat = si.product?.category;
      if (!cat) {
        const r = row(0, 'Uncategorized', null);
        r.revenue += si.unitSellPrice * si.quantity;
        r.cogs += si.unitBuyPrice * si.quantity;
        r.qty += si.quantity;
        continue;
      }
      const r = row(cat.id, cat.name, cat.parentId);
      r.revenue += si.unitSellPrice * si.quantity;
      r.cogs += si.unitBuyPrice * si.quantity;
      r.qty += si.quantity;
    }

    for (const inv of inventories) {
      const cat = inv.product?.category;
      if (!cat) {
        const r = row(0, 'Uncategorized', null);
        r.stockCost += (inv.product?.currentBuyPrice ?? 0) * inv.quantity;
        r.stockQty += inv.quantity;
        continue;
      }
      const r = row(cat.id, cat.name, cat.parentId);
      r.stockCost += (inv.product?.currentBuyPrice ?? 0) * inv.quantity;
      r.stockQty += inv.quantity;
    }

    // Build the tree and roll children totals up into their parents so a
    // parent category's "Category Revenue" includes its sub-categories.
    const childrenOf = new Map<number, number[]>();
    for (const meta of catMeta.values()) {
      const pid = meta.parentId ?? -1;
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid)!.push(meta.id);
    }
    const rollUp = (id: number): Row => {
      const own = rows.get(id) ?? {
        revenue: 0,
        cogs: 0,
        qty: 0,
        stockCost: 0,
        stockQty: 0,
      };
      const total: Row = { ...own };
      for (const child of childrenOf.get(id) ?? []) {
        const c = rollUp(child);
        total.revenue += c.revenue;
        total.cogs += c.cogs;
        total.qty += c.qty;
        total.stockCost += c.stockCost;
        total.stockQty += c.stockQty;
      }
      return total;
    };

    const toRow = (
      id: number,
      meta: { id: number; name: string; parentId: number | null },
    ): any => {
      const r = rollUp(id);
      const profit = r.revenue - r.cogs;
      return {
        categoryId: id,
        name: meta.name,
        parentId: meta.parentId,
        revenue: round2(r.revenue),
        cogs: round2(r.cogs),
        profit: round2(profit),
        margin: r.revenue > 0 ? round2((profit / r.revenue) * 100) : 0,
        unitsSold: r.qty,
        stockCost: round2(r.stockCost),
        stockQty: r.stockQty,
        children: (childrenOf.get(id) ?? [])
          .filter((cid) => catMeta.has(cid))
          .map((cid) => toRow(cid, catMeta.get(cid)!)),
      };
    };

    let roots = childrenOf.get(-1) ?? [];
    if (categoryId != null && catMeta.has(categoryId)) {
      roots = [categoryId];
    } else if (parentCategoryId != null && catMeta.has(parentCategoryId)) {
      roots = childrenOf.get(parentCategoryId) ?? [];
    }
    roots = roots.filter((id) => catMeta.has(id));
    // Never show the synthetic "Uncategorized" bucket unless it has data.
    roots = roots.filter(
      (id) =>
        id !== 0 ||
        (rows.get(0)?.revenue ?? 0) > 0 ||
        (rows.get(0)?.stockCost ?? 0) > 0,
    );

    const categoriesOut = roots.map((id) => toRow(id, catMeta.get(id)!));

    const totals = categoriesOut.reduce(
      (acc, c) => {
        const r = rollUp(c.categoryId);
        acc.revenue += r.revenue;
        acc.cogs += r.cogs;
        acc.stockCost += r.stockCost;
        return acc;
      },
      { revenue: 0, cogs: 0, stockCost: 0 },
    );

    return {
      tenantType: 'PRODUCT_CATEGORY',
      categories: categoriesOut,
      totals: {
        revenue: round2(totals.revenue),
        cogs: round2(totals.cogs),
        profit: round2(totals.revenue - totals.cogs),
        margin:
          totals.revenue > 0
            ? round2(((totals.revenue - totals.cogs) / totals.revenue) * 100)
            : 0,
        stockCost: round2(totals.stockCost),
      },
    };
  }


  /** Hospitality: Meals vs Beverages vs Room Services with sub-categories. */
  private async getMenuCategoryBreakdown(opts: {
    startDate?: string;
    endDate?: string;
    categoryId?: number;
    parentCategoryId?: number;
    locationId?: number;
    businessType: string;
  }) {
    const tenantId = this.tenant();
    const { startDate, endDate, categoryId, parentCategoryId } = opts;

    const [orderItems, taggedIncome, folioCharges, expenseAgg, menuCategories] =
      await Promise.all([
        this.prisma.orderItem.findMany({
          where: {
            tenantId,
            order: {
              status: OrderStatus.PAID,
              ...this.dateWhere('createdAt', startDate, endDate),
            },
          },
          select: {
            unitPrice: true,
            cost: true,
            quantity: true,
            menuItem: {
              select: {
                menuCategoryId: true,
                menuCategory: { select: { id: true, name: true, parentId: true } },
              },
            },
          },
        }),
        this.prisma.otherIncome.findMany({
          where: {
            tenantId,
            source: null,
            ...this.dateWhere('incomeDate', startDate, endDate),
          },
          select: {
            amount: true,
            menuCategoryId: true,
            menuCategory: { select: { id: true, name: true, parentId: true } },
          },
        }),
        this.prisma.folioEntry.aggregate({
          where: {
            tenantId,
            type: 'CHARGE',
            ...this.dateWhere('createdAt', startDate, endDate),
          },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: {
            tenantId,
            ...this.dateWhere('expenseDate', startDate, endDate),
          },
          _sum: { amount: true },
        }),
        this.prisma.menuCategory.findMany({
          where: { tenantId },
          select: {
            id: true,
            name: true,
            parentId: true,
            station: { select: { name: true, key: true } },
          },
        }),
      ]);

    const catMeta = new Map<
      number,
      {
        id: number;
        name: string;
        parentId: number | null;
        stationName?: string | null;
      }
    >();
    for (const c of menuCategories)
      catMeta.set(c.id, {
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        stationName: c.station?.name ?? null,
      });

    type Row = { income: number; cogs: number; qty: number };
    const rows = new Map<number, Row>();
    const row = (id: number): Row => {
      let r = rows.get(id);
      if (!r) {
        r = { income: 0, cogs: 0, qty: 0 };
        rows.set(id, r);
      }
      return r;
    };

    for (const item of orderItems) {
      const catId = item.menuItem?.menuCategoryId ?? 0;
      const r = row(catId);
      r.income += (item.unitPrice ?? 0) * item.quantity;
      r.cogs += (item.cost ?? 0) * item.quantity;
      r.qty += item.quantity;
    }
    for (const inc of taggedIncome) {
      const catId = inc.menuCategoryId ?? 0;
      row(catId).income += inc.amount;
    }

    // Room services: folio charges form their own top-level group.
    const roomRevenue = folioCharges._sum.amount ?? 0;


    const childrenOf = new Map<number, number[]>();
    for (const meta of catMeta.values()) {
      const pid = meta.parentId ?? -1;
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid)!.push(meta.id);
    }
    const rollUp = (id: number): Row => {
      const own = rows.get(id) ?? { income: 0, cogs: 0, qty: 0 };
      const total: Row = { ...own };
      for (const child of childrenOf.get(id) ?? []) {
        const c = rollUp(child);
        total.income += c.income;
        total.cogs += c.cogs;
        total.qty += c.qty;
      }
      return total;
    };

    const toRow = (id: number): any => {
      const r = rollUp(id);
      const profit = r.income - r.cogs;
      return {
        categoryId: id,
        name: catMeta.get(id)?.name ?? 'Uncategorized',
        parentId: catMeta.get(id)?.parentId ?? null,
        revenue: round2(r.income),
        cogs: round2(r.cogs),
        profit: round2(profit),
        margin: r.income > 0 ? round2((profit / r.income) * 100) : 0,
        unitsSold: r.qty,
        children: (childrenOf.get(id) ?? [])
          .filter((cid) => catMeta.has(cid))
          .map((cid) => toRow(cid)),
      };
    };

    let roots = childrenOf.get(-1) ?? [];
    if (categoryId != null && catMeta.has(categoryId)) {
      roots = [categoryId];
    } else if (parentCategoryId != null && catMeta.has(parentCategoryId)) {
      roots = childrenOf.get(parentCategoryId) ?? [];
    }
    roots = roots.filter((id) => catMeta.has(id));

    const categories = roots.map((id) => toRow(id));

    // Group for the industry view: Meals vs Beverages (bar/barista) groups.
    const groups: any[] = [];
    const beverageNames = new Set(['Beverages', 'Beverage', 'Drinks', 'Drink']);
    const beverageChildren = new Set<number>();
    for (const c of menuCategories) {
      if (
        c.parentId != null &&
        beverageNames.has(catMeta.get(c.parentId)?.name ?? '')
      ) {
        beverageChildren.add(c.id);
      }
    }
    const isBeverage = (id: number) => {
      const meta = catMeta.get(id);
      if (!meta) return false;
      return (
        beverageNames.has(meta.name ?? '') ||
        beverageChildren.has(id) ||
        meta.stationName === 'Bar' ||
        meta.stationName === 'Barista'
      );
    };
    const meals: any[] = [];
    const beverages: any[] = [];
    for (const c of categories) {
      if (isBeverage(c.categoryId)) beverages.push(c);
      else meals.push(c);
    }
    if (beverages.length > 0) {
      groups.push({
        groupId: 'BEVERAGES',
        groupName: 'Beverages',
        totalRevenue: round2(beverages.reduce((s, c) => s + c.revenue, 0)),
        totalCogs: round2(beverages.reduce((s, c) => s + c.cogs, 0)),
        totalProfit: round2(
          beverages.reduce((s, c) => s + (c.revenue - c.cogs), 0),
        ),
        categories: beverages,
      });
    }
    if (meals.length > 0) {
      groups.push({
        groupId: 'MEALS',
        groupName: 'Meals & Food',
        totalRevenue: round2(meals.reduce((s, c) => s + c.revenue, 0)),
        totalCogs: round2(meals.reduce((s, c) => s + c.cogs, 0)),
        totalProfit: round2(meals.reduce((s, c) => s + (c.revenue - c.cogs), 0)),
        categories: meals,
      });
    }
    if (roomRevenue > 0) {
      groups.push({
        groupId: 'ROOM_SERVICES',
        groupName: 'Room Services',
        totalRevenue: round2(roomRevenue),
        totalCogs: 0,
        totalProfit: round2(roomRevenue),
        categories: [],
      });
    }

    const totalIncome = categories.reduce((s, c) => s + c.revenue, 0);
    const totalCogs = categories.reduce((s, c) => s + c.cogs, 0);
    const overhead = expenseAgg._sum.amount ?? 0;

    return {
      tenantType: 'MENU_CATEGORY',
      groups,
      categories,
      totals: {
        revenue: round2(totalIncome + roomRevenue),
        cogs: round2(totalCogs),
        profit: round2(totalIncome + roomRevenue - totalCogs - overhead),
        grossProfit: round2(totalIncome + roomRevenue - totalCogs),
        overhead: round2(overhead),
        margin:
          totalIncome + roomRevenue > 0
            ? round2(
                ((totalIncome + roomRevenue - totalCogs) /
                  (totalIncome + roomRevenue)) *
                  100,
              )
            : 0,
      },
    };
  }


  // =========================================================================
  // Itemized performance matrix — per-SKU / per-variant / per-menu-item
  // =========================================================================

  /**
   * Real-time itemized profitability, computed straight from the line-item
   * source of truth (SaleItem for retail/wholesale, OrderItem for paid
   * hospitality orders, FolioEntry charges for room services):
   *
   *   Product / Variant | Category | Units Sold | Revenue | COGS | Profit | Margin
   *
   * Retail rows aggregate per (product, variant) using the exact unit sell /
   * buy price snapshots taken at checkout; hospitality rows aggregate per menu
   * item using the recipe-cost snapshot at order time. Returns rows sorted by
   * revenue (desc) plus period totals.
   */
  async getItemizedPerformance(opts: {
    startDate?: string;
    endDate?: string;
    locationId?: number;
    businessType: string;
  }) {
    const tenantId = this.tenant();
    const { startDate, endDate, locationId, businessType } = opts;
    const isInventory =
      businessType === 'RETAIL' || businessType === 'MANUFACTURING';

    type Row = {
      id: string;
      name: string;
      category: string;
      kind: 'VARIANT' | 'PRODUCT' | 'MENU_ITEM' | 'SERVICE';
      unitsSold: number;
      unitSymbol: string;
      revenue: number;
      cogs: number;
      profit: number;
      margin: number;
    };
    const map = new Map<string, Row>();
    const ensure = (key: string, row: Row): Row => {
      const existing = map.get(key);
      if (existing) return existing;
      map.set(key, row);
      return row;
    };

    if (isInventory) {
      const saleWhere: Record<string, unknown> = {
        tenantId,
        ...this.dateWhere('saleDate', startDate, endDate),
      };
      if (locationId) saleWhere.shopId = locationId;

      const saleItems = await this.prisma.saleItem.findMany({
        where: { sale: saleWhere },
        select: {
          productId: true,
          variantId: true,
          quantity: true,
          unitSellPrice: true,
          unitBuyPrice: true,
          product: {
            select: {
              brand: true,
              baseName: true,
              category: { select: { name: true } },
              unit: { select: { symbol: true } },
            },
          },
          variant: { select: { sku: true, attributes: true } },
        },
      });

      for (const si of saleItems) {
        const attrs = (si.variant?.attributes ?? {}) as Record<string, unknown>;
        const attrLabel = Object.values(attrs)
          .filter(
            (x) => x !== null && x !== undefined && String(x).trim() !== '',
          )
          .join(' · ');
        const key = si.variantId
          ? `VARIANT-${si.variantId}`
          : `PRODUCT-${si.productId}`;
        const base =
          `${si.product?.brand ?? ''} ${si.product?.baseName ?? ''}`.trim();
        const row = ensure(key, {
          id: key,
          name: attrLabel ? `${base} (${attrLabel})` : base || 'Product',
          category: si.product?.category?.name ?? 'Uncategorized',
          kind: si.variantId ? 'VARIANT' : 'PRODUCT',
          unitsSold: 0,
          unitSymbol: si.product?.unit?.symbol ?? '',
          revenue: 0,
          cogs: 0,
          profit: 0,
          margin: 0,
        });
        row.unitsSold += si.quantity;
        row.revenue += si.unitSellPrice * si.quantity;
        row.cogs += si.unitBuyPrice * si.quantity;
      }
    } else {
      const orderWhere: Record<string, unknown> = {
        status: OrderStatus.PAID,
        ...this.dateWhere('createdAt', startDate, endDate),
      };
      const orderItems = await this.prisma.orderItem.findMany({
        where: { order: orderWhere },
        select: {
          id: true,
          menuItemId: true,
          name: true,
          quantity: true,
          unitPrice: true,
          cost: true,
          menuItem: {
            select: { menuCategory: { select: { name: true } } },
          },
        },
      });

      for (const oi of orderItems) {
        const key = oi.menuItemId
          ? `MENU_ITEM-${oi.menuItemId}`
          : `RAW-${oi.id}`;
        const row = ensure(key, {
          id: key,
          name: oi.menuItemId ? oi.name : `${oi.name} (legacy)`,
          category: oi.menuItem?.menuCategory?.name ?? 'Uncategorized',
          kind: 'MENU_ITEM',
          unitsSold: 0,
          unitSymbol: '',
          revenue: 0,
          cogs: 0,
          profit: 0,
          margin: 0,
        });
        row.unitsSold += oi.quantity;
        row.revenue += (oi.unitPrice ?? 0) * oi.quantity;
        row.cogs += (oi.cost ?? 0) * oi.quantity;
      }

      // Room & folio services are non-COGS revenue: surface them as a single
      // row per income account so hotel income isn't silently dropped from the
      // itemized view.
      const folioEntries = await this.prisma.folioEntry.findMany({
        where: {
          tenantId,
          type: 'CHARGE',
          ...this.dateWhere('createdAt', startDate, endDate),
        },
        select: { amount: true, account: { select: { name: true } } },
      });
      const folioByAccount = new Map<string, number>();
      for (const fe of folioEntries) {
        const name = fe.account?.name ?? 'Room Services';
        folioByAccount.set(name, (folioByAccount.get(name) ?? 0) + fe.amount);
      }
      for (const [name, amount] of folioByAccount) {
        const key = `SERVICE-${name}`;
        ensure(key, {
          id: key,
          name,
          category: 'Room & Services',
          kind: 'SERVICE',
          unitsSold: 0,
          unitSymbol: '',
          revenue: amount,
          cogs: 0,
          profit: amount,
          margin: 100,
        });
      }
    }

    const rows = [...map.values()]
      .map((r) => ({
        ...r,
        revenue: round2(r.revenue),
        cogs: round2(r.cogs),
        profit: round2(r.revenue - r.cogs),
        margin:
          r.revenue > 0 ? round2(((r.revenue - r.cogs) / r.revenue) * 100) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
    const totalCogs = round2(rows.reduce((s, r) => s + r.cogs, 0));
    return {
      tenantType: 'ITEMIZED',
      rows,
      totals: {
        revenue: totalRevenue,
        cogs: totalCogs,
        profit: round2(totalRevenue - totalCogs),
        margin:
          totalRevenue > 0
            ? round2(((totalRevenue - totalCogs) / totalRevenue) * 100)
            : 0,
      },
    };
  }


  /**
   * Side-by-side comparison series for charts: Revenue vs COGS vs Overhead and
   * Net Profit Margin, bucketed by day / week / month across the date range.
   */
  async getComparison(
    startDate?: string,
    endDate?: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
    locationId?: number,
  ) {
    const tenantId = this.tenant();
    const endOfDay = endDate ? new Date(endDate) : new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const start = startDate ? new Date(startDate) : new Date(0);

    const saleWhere: Record<string, unknown> = {
      tenantId,
      saleDate: { gte: start, lte: endOfDay },
    };
    if (locationId) saleWhere.shopId = locationId;

    const [sales, orders, orderItems, expenses, incomes, folioEntries, returns] =
      await Promise.all([
        this.prisma.sale.findMany({
          where: saleWhere,
          select: { saleDate: true, totalAmount: true, totalCost: true },
        }),
        this.prisma.order.findMany({
          where: {
            tenantId,
            status: OrderStatus.PAID,
            createdAt: { gte: start, lte: endOfDay },
          },
          select: { createdAt: true, totalAmount: true },
        }),
        this.prisma.orderItem.findMany({
          where: {
            tenantId,
            order: {
              status: OrderStatus.PAID,
              createdAt: { gte: start, lte: endOfDay },
            },
          },
          select: { cost: true, quantity: true, order: { select: { createdAt: true } } },
        }),
        this.prisma.expense.findMany({
          where: {
            tenantId,
            expenseDate: { gte: start, lte: endOfDay },
          },
          select: { expenseDate: true, amount: true },
        }),
        this.prisma.otherIncome.findMany({
          where: {
            tenantId,
            source: null,
            incomeDate: { gte: start, lte: endOfDay },
          },
          select: { incomeDate: true, amount: true },
        }),
        this.prisma.folioEntry.findMany({
          where: {
            tenantId,
            type: 'CHARGE',
            createdAt: { gte: start, lte: endOfDay },
          },
          select: { createdAt: true, amount: true },
        }),
        this.prisma.return.findMany({
          where: {
            tenantId,
            createdAt: { gte: start, lte: endOfDay },
          },
          select: { createdAt: true, totalRefund: true },
        }),
      ]);

    const bucketOf = (date: Date): string => {
      if (groupBy === 'month') return date.toISOString().slice(0, 7);
      if (groupBy === 'week') {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - d.getDay());
        return d.toISOString().slice(0, 10);
      }
      return date.toISOString().slice(0, 10);
    };

    type Bucket = {
      revenue: number;
      cogs: number;
      overhead: number;
    };
    const buckets = new Map<string, Bucket>();
    const b = (key: string): Bucket => {
      let x = buckets.get(key);
      if (!x) {
        x = { revenue: 0, cogs: 0, overhead: 0 };
        buckets.set(key, x);
      }
      return x;
    };

    for (const s of sales) {
      const x = b(bucketOf(s.saleDate));
      x.revenue += s.totalAmount;
      x.cogs += s.totalCost;
    }
    for (const o of orders) {
      b(bucketOf(o.createdAt)).revenue += o.totalAmount;
    }
    for (const oi of orderItems) {
      b(bucketOf(oi.order.createdAt)).cogs += (oi.cost ?? 0) * oi.quantity;
    }
    for (const e of expenses) {
      b(bucketOf(e.expenseDate)).overhead += e.amount;
    }
    for (const inc of incomes) {
      b(bucketOf(inc.incomeDate)).revenue += inc.amount;
    }
    for (const f of folioEntries) {
      b(bucketOf(f.createdAt)).revenue += f.amount;
    }
    for (const r of returns) {
      const x = b(bucketOf(r.createdAt));
      x.revenue -= r.totalRefund;
    }

    return [...buckets.entries()]
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([date, x]) => {
        const grossProfit = x.revenue - x.cogs;
        const netProfit = grossProfit - x.overhead;
        return {
          date,
          revenue: round2(x.revenue),
          cogs: round2(x.cogs),
          overhead: round2(x.overhead),
          grossProfit: round2(grossProfit),
          netProfit: round2(netProfit),
          margin:
            x.revenue > 0 ? round2((grossProfit / x.revenue) * 100) : 0,
        };
      });
  }

  /** Overhead expenses grouped by account (Rent, Salaries, Utilities, ...). */
  async getExpenseSummary(startDate?: string, endDate?: string) {
    const tenantId = this.tenant();
    const expenses = await this.prisma.expense.findMany({
      where: { tenantId, ...this.dateWhere('expenseDate', startDate, endDate) },
      include: { account: true },
    });
    const byAccount = new Map<string, { accountId: number; amount: number; count: number }>();
    for (const e of expenses) {
      const name = e.account?.name ?? e.category ?? 'Other';
      const r = byAccount.get(name) ?? { accountId: e.accountId, amount: 0, count: 0 };
      r.amount += e.amount;
      r.count += 1;
      byAccount.set(name, r);
    }
    const items = [...byAccount.entries()].map(([name, r]) => ({
      name,
      accountId: r.accountId,
      amount: round2(r.amount),
      count: r.count,
    }));
    return {
      items: items.sort((a, b) => b.amount - a.amount),
      total: round2(items.reduce((s, i) => s + i.amount, 0)),
    };
  }


  // --- Full CRUD (update / delete) ---
  async updateAccount(id: number, dto: UpdateAccountDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.account.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new BadRequestException('Account not found');

    if (dto.parentId != null) {
      if (dto.parentId === id)
        throw new BadRequestException('An account cannot be its own parent');
      const parent = await this.prisma.account.findFirst({
        where: { id: dto.parentId, tenantId },
      });
      if (!parent) throw new BadRequestException('Parent account not found');
    }

    if (
      existing.isSystem &&
      (dto.name !== undefined || dto.type !== undefined)
    ) {
      throw new BadRequestException(
        'System accounts cannot be renamed or re-typed',
      );
    }

    try {
      await this.prisma.account.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          code: dto.code === undefined ? undefined : dto.code?.trim() || null,
          type: dto.type,
          parentId: dto.parentId === undefined ? undefined : dto.parentId,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException(
          'An account with this name and type already exists',
        );
      }
      throw err;
    }
    return this.prisma.account.findFirst({
      where: { id, tenantId },
      include: { children: true },
    });
  }

  async deleteAccount(id: number) {
    const tenantId = this.tenant();
    const account = await this.prisma.account.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { children: true } } },
    });
    if (!account) throw new BadRequestException('Account not found');
    if (account.isSystem)
      throw new BadRequestException('System accounts cannot be deleted');
    if (account._count.children > 0)
      throw new BadRequestException('Delete child accounts first');

    const [journal, expenses, incomes] = await Promise.all([
      this.prisma.journalLine.count({ where: { accountId: id } }),
      this.prisma.expense.count({ where: { accountId: id } }),
      this.prisma.otherIncome.count({ where: { accountId: id } }),
    ]);
    if (journal + expenses + incomes > 0) {
      throw new BadRequestException('Account is in use and cannot be deleted');
    }
    await this.prisma.account.deleteMany({ where: { id, tenantId } });
    return { id };
  }

  async updateExpense(id: number, dto: UpdateExpenseDto) {
    const tenantId = this.tenant();
    await this.prisma.expense.updateMany({
      where: { id, tenantId },
      data: {
        accountId: dto.accountId,
        vendor: dto.vendor,
        amount: dto.amount,
        paymentMethodId: dto.paymentMethodId,
        notes: dto.notes,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
      },
    });
    return this.prisma.expense.findFirst({ where: { id, tenantId } });
  }

  async deleteExpense(id: number) {
    const tenantId = this.tenant();
    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.deleteMany({
        where: { tenantId, reference: `EXP-${id}` },
      });
      await tx.expense.deleteMany({ where: { id, tenantId } });
    });
    return { id };
  }

  async updateIncome(id: number, dto: UpdateIncomeDto) {
    const tenantId = this.tenant();
    await this.prisma.otherIncome.updateMany({
      where: { id, tenantId },
      data: {
        accountId: dto.accountId,
        description: dto.description,
        amount: dto.amount,
        incomeDate: dto.incomeDate ? new Date(dto.incomeDate) : undefined,
      },
    });
    return this.prisma.otherIncome.findFirst({ where: { id, tenantId } });
  }

  async deleteIncome(id: number) {
    const tenantId = this.tenant();
    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.deleteMany({
        where: { tenantId, reference: `INC-${id}` },
      });
      await tx.otherIncome.deleteMany({ where: { id, tenantId } });
    });
    return { id };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Revenue-account preference per hospitality service. Folio settlement splits
 * income across the chart-of-accounts revenue lines (Room Revenue, Food Sales,
 * Beverage Sales, Service Revenue, …) instead of dumping every charge into one
 * account, while still falling back gracefully for custom service keys.
 */
const FOLIO_SERVICE_ACCOUNTS: Record<string, string[]> = {
  ACCOMMODATION: ['Room Revenue'],
  FOOD_AND_BEVERAGE: ['Food Sales', 'Sales Revenue'],
  RESTAURANT: ['Food Sales', 'Sales Revenue'],
  ROOM_SERVICE: ['Food Sales', 'Sales Revenue'],
  BAR: ['Beverage Sales', 'Sales Revenue'],
  MINIBAR: ['Beverage Sales', 'Sales Revenue'],
  SPA: ['Service Revenue'],
  GYM: ['Service Revenue'],
  POOL: ['Service Revenue'],
  EVENTS: ['Event Revenue', 'Sales Revenue', 'Service Revenue'],
  LAUNDRY: ['Laundry Revenue', 'Service Revenue'],
};

/** Generic revenue fallbacks, tried after the service-specific accounts. */
const FOLIO_INCOME_FALLBACKS = [
  'Sales Revenue',
  'Service Revenue',
  'Other Income',
];

/**
 * Pick the income account for a folio line: the service's preferred account
 * first, then the generic revenue accounts, then any income account.
 */
function pickFolioIncomeAccount(
  sourceService: string | null | undefined,
  accounts: Array<{ id: number; name: string; type: AccountType }>,
): number | null {
  const findIncome = (name: string) =>
    accounts.find((a) => a.name === name && a.type === AccountType.INCOME);
  const candidates = [
    ...(sourceService ? FOLIO_SERVICE_ACCOUNTS[sourceService] ?? [] : []),
    ...FOLIO_INCOME_FALLBACKS,
  ];
  for (const name of candidates) {
    const account = findIncome(name);
    if (account) return account.id;
  }
  return accounts.find((a) => a.type === AccountType.INCOME)?.id ?? null;
}
