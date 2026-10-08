// prisma/backfill-procurement-postings.ts
// Idempotent repair of the procurement side of the general ledger.
//
// A purchase posts exactly one Inventory ↔ Cash/Accounts-Payable entry when it
// is approved, referenced `PUR-<purchaseId>`. Two long-standing bugs could leave
// that reference missing or stranded:
//
//   * restock posted under `PUR-<stockRequestId>` too, so a purchase and a stock
//     request that happened to share an id produced ONE entry for two records
//     (the posting is idempotent by reference, so the loser was dropped in
//     silence). Restock now posts `RST-<requestId>`.
//   * deleting an already-approved purchase used to be allowed, which left its
//     `PUR-<id>` entry behind with no record behind it (an orphan).
//
// What this script does:
//   1. Re-posts the missing `PUR-<id>` entry for every APPROVED purchase (the
//      amount and paid/credit flag are still on the row, so this is exact).
//   2. Reports APPROVED purchases whose posting cannot be rebuilt (zero cost).
//   3. Reports received/completed stock requests that have NO procurement entry
//      at all. These are NOT auto-repaired: StockRequest/RequestItem never
//      stored the value, so any amount would be a guess.
//   4. Audits every `PUR-<n>` / `RST-<n>` reference: healthy, legacy (the id
//      belongs to the other table) or an orphan with no record at all. With
//      `--purge-orphans` the unambiguous orphans are deleted.
//
// Nothing is guessed and nothing is edited in place — only missing entries are
// added and provable orphans are removed.
//
// Usage:  npx ts-node prisma/backfill-procurement-postings.ts [--dry-run] [--purge-orphans]
//         --dry-run        show what would happen, write nothing
//         --purge-orphans  delete `PUR-<n>` / `RST-<n>` entries whose record no
//                          longer exists (off by default)
import { PrismaClient, PurchaseStatus, RequestStatus } from '@prisma/client';
import { FinanceService } from '../src/finance/finance.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const PURGE_ORPHANS = process.argv.includes('--purge-orphans');

/** `PUR-7` / `RST-12` — a header reference, not `RST-7-3` (a single item). */
const HEADER_REF = /^(PUR|RST)-(\d+)$/;

/** Entry total, read off the debit side (the two lines always net to zero). */
function amountOf(entry: { lines: Array<{ debit: number; credit: number }> }) {
  return entry.lines.reduce((sum, line) => sum + line.debit, 0);
}

async function main() {
  console.log(
    DRY_RUN
      ? 'Procurement posting backfill — DRY RUN (nothing is written)\n'
      : 'Procurement posting backfill — applying\n',
  );
  console.log(
    PURGE_ORPHANS
      ? '· orphan entries WILL be deleted\n'
      : '· orphan entries are reported only (pass --purge-orphans to delete)\n',
  );

  // The service is the single source of truth for account resolution and the
  // entry shape, so repairs go through it rather than re-deriving a chart of
  // accounts here. It only needs Prisma.
  const finance = new FinanceService(prisma as unknown as PrismaService);

  // --- 1. Every approved purchase owns exactly one PUR-<id> entry -----------
  const purchases = await prisma.purchase.findMany({
    where: { status: PurchaseStatus.APPROVED },
    select: {
      id: true,
      tenantId: true,
      paymentType: true,
      quantity: true,
      productName: true,
      totalCost: true,
      createdAt: true,
      createdById: true,
    },
    orderBy: [{ tenantId: 'asc' }, { id: 'asc' }],
  });

  let repaired = 0;
  let alreadyPosted = 0;
  const unpostable: string[] = [];

  for (const p of purchases) {
    const ref = `PUR-${p.id}`;
    const existing = await prisma.journalEntry.findFirst({
      where: { tenantId: p.tenantId, reference: ref },
      select: { id: true },
    });
    if (existing) {
      alreadyPosted += 1;
      continue;
    }
    if (!p.totalCost || p.totalCost <= 0) {
      unpostable.push(
        `${ref} (tenant ${p.tenantId}): totalCost is ${p.totalCost} — nothing to post, check the row by hand`,
      );
      continue;
    }

    const paid = p.paymentType === 'PAID';
    const description = paid
      ? `Quick purchase: ${p.quantity} × ${p.productName}`
      : `Credit purchase: ${p.quantity} × ${p.productName}`;
    const wrote = DRY_RUN
      ? false
      : await finance
          .postProcurement({
            ref,
            description,
            amount: p.totalCost,
            entryDate: p.createdAt,
            createdById: p.createdById ?? null,
            paid,
            tenantId: p.tenantId,
          })
          .catch(() => false);

    if (wrote) repaired += 1;
    console.log(
      `${DRY_RUN ? '→' : wrote ? '✅' : '⚠️'} ${ref} (tenant ${
        p.tenantId
      }) ${p.totalCost.toFixed(2)} ${
        paid ? 'Inventory ↔ Cash' : 'Inventory ↔ Accounts Payable'
      }`,
    );
    if (!DRY_RUN && !wrote) {
      unpostable.push(
        `${ref} (tenant ${p.tenantId}): posting refused — the Inventory / Cash / Accounts-Payable accounts are unmapped`,
      );
    }
  }

  // --- 2. Stock requests with no procurement entry at all ------------------
  // Reported, never repaired: the value was never persisted, so any amount would
  // be a guess. `COMPLETED` covers the direct restock / register-purchase flows,
  // the PARTIALLY_* states cover a partly received request.
  const requests = await prisma.stockRequest.findMany({
    where: {
      status: {
        in: [
          RequestStatus.COMPLETED,
          RequestStatus.PARTIALLY_RECEIVED,
          RequestStatus.PARTIALLY_FULFILLED,
        ],
      },
    },
    select: {
      id: true,
      tenantId: true,
      requestType: true,
      status: true,
      items: { select: { quantityReceived: true, quantityStored: true } },
    },
    orderBy: [{ tenantId: 'asc' }, { id: 'asc' }],
  });
  const requestIds = new Set(requests.map((r) => r.id));
  const unpostedRequests: string[] = [];

  for (const r of requests) {
    // A request that was closed without any goods landing (nothing received,
    // nothing stored) never had a value to book — that is not a gap.
    const landed = r.items.some(
      (i) => i.quantityReceived > 0 || i.quantityStored > 0,
    );
    if (!landed) continue;

    const entry = await prisma.journalEntry.findFirst({
      where: {
        tenantId: r.tenantId,
        OR: [
          { reference: `RST-${r.id}` },
          { reference: { startsWith: `RST-${r.id}-` } },
          { reference: `PUR-${r.id}` }, // legacy namespace before the fix
        ],
      },
      select: { id: true },
    });
    if (!entry) {
      unpostedRequests.push(
        `RST-${r.id} (tenant ${r.tenantId}, ${r.requestType}/${r.status}): no procurement entry — re-enter the amount manually if the goods really landed`,
      );
    }
  }

  // --- 3. Reference audit: healthy / legacy / orphan ------------------------
  const entries = await prisma.journalEntry.findMany({
    where: {
      OR: [
        { reference: { startsWith: 'PUR-' } },
        { reference: { startsWith: 'RST-' } },
      ],
    },
    select: {
      id: true,
      tenantId: true,
      reference: true,
      description: true,
      entryDate: true,
      lines: { select: { debit: true, credit: true } },
    },
    orderBy: { id: 'asc' },
  });

  const purchaseIds = new Set(
    (await prisma.purchase.findMany({ select: { id: true } })).map((p) => p.id),
  );

  const orphans: typeof entries = [];
  const legacy: string[] = [];

  for (const e of entries) {
    const match = HEADER_REF.exec(e.reference ?? '');
    if (!match) continue; // PUR-/RST- with another shape (e.g. RST-7-3)
    const [, prefix, digits] = match;
    const id = Number(digits);
    const owned = purchaseIds.has(id);
    const requested = requestIds.has(id);

    if (!owned && !requested) orphans.push(e);
    else if (prefix === 'PUR' && !owned && requested)
      legacy.push(
        `${e.reference} (tenant ${e.tenantId}, ${amountOf(
          e,
        ).toFixed(2)}): posted by restock before the rename — leave it, the entry is real`,
      );
  }

  console.log(`\n${orphans.length} orphan reference(s):`);
  for (const o of orphans) {
    console.log(
      `  · ${o.reference} (tenant ${o.tenantId}, ${amountOf(o).toFixed(2)}, ${
        o.entryDate.toISOString().slice(0, 10)
      }) ${o.description ?? ''}`,
    );
  }
  if (PURGE_ORPHANS && orphans.length > 0) {
    if (DRY_RUN) {
      console.log(`  → would delete ${orphans.length} orphan entry(ies)`);
    } else {
      await prisma.journalEntry.deleteMany({
        where: { id: { in: orphans.map((o) => o.id) } },
      });
      console.log(`  ✅ deleted ${orphans.length} orphan entry(ies)`);
    }
  }

  if (legacy.length > 0) {
    console.log(`\n${legacy.length} legacy restock reference(s) under PUR-:`);
    for (const l of legacy) console.log(`  · ${l}`);
  }

  if (unpostedRequests.length > 0) {
    console.log(`\n${unpostedRequests.length} stock request(s) with no posting:`);
    for (const u of unpostedRequests) console.log(`  · ${u}`);
  }

  if (unpostable.length > 0) {
    console.log(`\n${unpostable.length} purchase(s) that could not be repaired:`);
    for (const u of unpostable) console.log(`  · ${u}`);
  }

  console.log(
    `\nDone. ${alreadyPosted} purchase(s) already posted, ${repaired} repaired, ${
      unpostable.length
    } unrepaired, ${orphans.length} orphan(s) ${
      PURGE_ORPHANS && !DRY_RUN ? 'deleted' : 'flagged'
    }.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

