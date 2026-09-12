// Export rows for the General Ledger journal (CSV + print/PDF).
//
// A journal entry is a header with its own totals plus the lines that make it
// up, so the exports list an "Entry" row, then one indented "Line" row per
// account, and finish with a "Totals" row. The CSV and the printed report are
// both built from these rows, so the two files can never disagree.
//
// Formatters are injected (money, dates, labels) so this module stays pure and
// testable — the page owns every currency/locale decision.

export interface JournalLineLike {
  id?: number;
  accountId?: number;
  account?: { code?: string | null; name?: string | null; type?: string | null } | null;
  debit?: number | string | null;
  credit?: number | string | null;
}

export interface JournalEntryLike {
  id?: number;
  entryDate?: string | Date | null;
  reference?: string | null;
  description?: string | null;
  source?: string | null;
  postingStatus?: string | null;
  locationId?: number | null;
  totalDebit?: number | string | null;
  totalCredit?: number | string | null;
  lines?: readonly JournalLineLike[] | null;
}

export interface JournalExportRow {
  cells: (string | number)[];
  /** Rendered indented and muted: a line inside the entry above it. */
  detail?: boolean;
  /** Rendered bold: the report totals. */
  bold?: boolean;
}

export interface JournalExportDeps {
  money: (n: unknown) => string;
  shortDate: (d: unknown) => string;
  sourceLabel: (entry: JournalEntryLike) => string;
  locationLabel: (entry: JournalEntryLike) => string;
  accountLabel: (line: JournalLineLike) => string;
  accountType: (line: JournalLineLike) => string;
}

/** Column order shared by the CSV and the printed report. */
export const JOURNAL_EXPORT_COLUMNS = [
  "Row",
  "Date",
  "Reference",
  "Description",
  "Account",
  "Type",
  "Source",
  "Status",
  "Location",
  "Debit",
  "Credit",
];

/** First right-aligned (amount) column index. */
export const JOURNAL_AMOUNT_FROM = JOURNAL_EXPORT_COLUMNS.length - 2;

/**
 * Build the export rows: an "Entry" row per journal entry, its "Line" rows
 * (Account + Type filled, entry-level columns left blank), then the totals.
 *
 * Line rows repeat the date and reference so every row stands on its own in a
 * spreadsheet; the leading Row column keeps the kinds apart (filter
 * `Row = Line` and sum to reconcile the period).
 */
export function buildJournalExport(
  entries: readonly JournalEntryLike[],
  totals: { debit?: unknown; credit?: unknown } | null | undefined,
  deps: JournalExportDeps,
): JournalExportRow[] {
  const rows: JournalExportRow[] = [];

  for (const entry of entries ?? []) {
    const date = deps.shortDate(entry.entryDate);
    const reference = entry.reference ?? "";
    rows.push({
      cells: [
        "Entry",
        date,
        reference,
        entry.description ?? "",
        "",
        "",
        deps.sourceLabel(entry),
        entry.postingStatus ?? "POSTED",
        deps.locationLabel(entry),
        deps.money(entry.totalDebit),
        deps.money(entry.totalCredit),
      ],
    });

    for (const line of entry.lines ?? []) {
      rows.push({
        detail: true,
        cells: [
          "Line",
          date,
          reference,
          "",
          deps.accountLabel(line),
          deps.accountType(line),
          "",
          "",
          "",
          deps.money(line.debit),
          deps.money(line.credit),
        ],
      });
    }
  }

  if (totals) {
    rows.push({
      bold: true,
      cells: [
        "Totals",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        deps.money(totals.debit),
        deps.money(totals.credit),
      ],
    });
  }

  return rows;
}

/** The same rows flattened for `downloadCsv`. */
export function toCsvRows(
  rows: readonly JournalExportRow[],
): (string | number)[][] {
  return rows.map((row) => row.cells);
}
