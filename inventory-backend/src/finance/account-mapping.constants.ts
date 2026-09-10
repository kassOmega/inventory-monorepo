// src/finance/account-mapping.constants.ts
// Registry of the operational actions that auto-posting can route through
// tenant-configurable AccountMapping rows. Each definition carries the
// *default* chart account names used for seeding (resolved to per-tenant
// account ids at tenant creation / lazy backfill) plus UI metadata.
import { BusinessType } from '@prisma/client';

export interface PostingMapDef {
  /** Stable key stored in AccountMapping.transactionType. */
  type: string;
  /** Human label shown on the Account Mappings settings page. */
  label: string;
  description: string;
  /** Default chart account for the debit side (null = caller-provided). */
  debitName?: string;
  /** Default chart account for the credit side (null = caller-provided). */
  creditName?: string;
  /**
   * Structurally multi-leg postings (SALE) are managed by the engine and are
   * not user-mappable in this pass; reserved so the surface can unlock later.
   */
  managedBySystem?: boolean;
  /** Account types suggested for the debit-side picker. */
  debitTypes?: string[];
  /** Account types suggested for the credit-side picker. */
  creditTypes?: string[];
  /** Optional vertical restriction for display purposes (default all). */
  applicable?: BusinessType[];
}

export const DEFAULT_POSTING_MAPS: PostingMapDef[] = [
  {
    type: 'EXPENSE',
    label: 'Manual expense',
    description: 'Debit the chosen expense category; the payment side comes from this mapping.',
    creditName: 'Cash',
    debitTypes: ['EXPENSE'],
    creditTypes: ['ASSET'],
  },
  {
    type: 'INCOME',
    label: 'Manual income',
    description: 'Credit the chosen income category; the receiving side comes from this mapping.',
    debitName: 'Cash',
    debitTypes: ['ASSET'],
    creditTypes: ['INCOME'],
  },
  {
    type: 'PURCHASE',
    label: 'Purchase on credit (GRN / restock)',
    description: 'Stock received against vendor credit: debit Inventory Asset, credit Accounts Payable.',
    debitName: 'Inventory Asset',
    creditName: 'Accounts Payable',
    debitTypes: ['ASSET'],
    creditTypes: ['LIABILITY', 'ASSET'],
  },
  {
    type: 'PURCHASE_PAID',
    label: 'Paid purchase / direct buy',
    description: 'Stock bought immediately: debit Inventory Asset, credit Cash.',
    debitName: 'Inventory Asset',
    creditName: 'Cash',
    debitTypes: ['ASSET'],
    creditTypes: ['ASSET'],
  },
  {
    type: 'VENDOR_PAYMENT',
    label: 'Vendor bill payment',
    description: 'Settling a vendor bill: debit Accounts Payable, credit Cash.',
    debitName: 'Accounts Payable',
    creditName: 'Cash',
    debitTypes: ['LIABILITY'],
    creditTypes: ['ASSET'],
  },
  {
    type: 'CREDIT_NOTE',
    label: 'Vendor credit note (rejected goods)',
    description: 'Returned/rejected stock credited back by the vendor: debit Accounts Payable, credit Inventory Asset.',
    debitName: 'Accounts Payable',
    creditName: 'Inventory Asset',
    debitTypes: ['LIABILITY'],
    creditTypes: ['ASSET'],
  },
  {
    type: 'SCRAP',
    label: 'Scrapped rejected stock',
    description: 'Write-off of scrapped received stock: debit Spoilage & Wastage, credit Inventory Asset.',
    debitName: 'Spoilage & Wastage',
    creditName: 'Inventory Asset',
    debitTypes: ['EXPENSE'],
    creditTypes: ['ASSET'],
  },
  {
    type: 'WASTAGE',
    label: 'Spoilage / wastage write-off',
    description: 'Losses written off to the P&L: debit Spoilage & Wastage, credit Inventory Asset.',
    debitName: 'Spoilage & Wastage',
    creditName: 'Inventory Asset',
    debitTypes: ['EXPENSE'],
    creditTypes: ['ASSET'],
  },
  {
    type: 'ADJUSTMENT',
    label: 'Inventory adjustment / count variance',
    description: 'Surplus debits Inventory and credits Inventory Adjustment; shortages do the reverse.',
    debitName: 'Inventory Asset',
    creditName: 'Inventory Adjustment',
    debitTypes: ['ASSET', 'EXPENSE'],
    creditTypes: ['ASSET', 'EXPENSE'],
  },
  {
    type: 'SALE',
    label: 'POS / retail sale — payment account',
    description:
      'Choose which asset account receives retail sale payments (and is credited back on returns). Revenue, COGS, Inventory and VAT legs stay auto-managed by the engine.',
    debitTypes: ['ASSET'],
  },
];

const MAPPED_TYPES = new Set(DEFAULT_POSTING_MAPS.map((d) => d.type));

export function isManagedBySystem(type: string): boolean {
  return !!DEFAULT_POSTING_MAPS.find((d) => d.type === type)?.managedBySystem;
}

export function isKnownPostingType(type: string): boolean {
  return MAPPED_TYPES.has(type);
}

/**
 * Seeds the default AccountMapping rows for a tenant by resolving chart
 * account names (from the per-vertical default chart) to ids. Idempotent:
 * existing rows are kept untouched via the (tenantId, transactionType) unique.
 */
export async function seedAccountMappings(db: any, tenantId: number | null): Promise<number> {
  if (!tenantId) return 0;
  const names = Array.from(
    new Set(
      DEFAULT_POSTING_MAPS.flatMap((d) => [d.debitName, d.creditName]).filter(
        (n): n is string => !!n,
      ),
    ),
  );
  if (names.length === 0) return 0;
  const accounts = await db.account.findMany({
    where: { tenantId, name: { in: names } },
    select: { id: true, name: true },
  });
  const byName = new Map<string, number>();
  for (const acc of accounts) byName.set(acc.name, acc.id);

  const data = DEFAULT_POSTING_MAPS.filter((d) => d.debitName || d.creditName).map((d) => ({
    tenantId,
    transactionType: d.type,
    debitAccountId: d.debitName ? byName.get(d.debitName) ?? null : null,
    creditAccountId: d.creditName ? byName.get(d.creditName) ?? null : null,
  }));
  if (data.length === 0) return 0;
  await db.accountMapping.createMany({ data, skipDuplicates: true });
  return data.length;
}
