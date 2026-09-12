// PDF export for the General Ledger journal.
//
// A journal entry is a header with its own totals plus the lines that make it
// up, so the document lists an "Entry" row, then one indented "Line" row per
// account, and finishes with a bold totals row — the same shape as the CSV
// export, so the two downloads always agree.

import PDFDocument from 'pdfkit';

export interface GlJournalPdfLine {
  accountId?: number | null;
  account?: {
    code?: string | null;
    name?: string | null;
    type?: string | null;
  } | null;
  debit?: number | null;
  credit?: number | null;
}

export interface GlJournalPdfEntry {
  entryDate?: Date | string | null;
  reference?: string | null;
  description?: string | null;
  source?: string | null;
  postingStatus?: string | null;
  locationName?: string | null;
  totalDebit?: number | null;
  totalCredit?: number | null;
  lines?: GlJournalPdfLine[] | null;
}

export interface GlJournalPdfRow {
  cells: string[];
  /** Rendered indented and muted: a line inside the entry above it. */
  detail?: boolean;
  /** Rendered bold: the report totals. */
  bold?: boolean;
}

/** Column order used by the PDF (kept in step with the CSV export). */
export const GL_JOURNAL_PDF_COLUMNS = [
  'Row',
  'Date',
  'Reference',
  'Description',
  'Account',
  'Type',
  'Source',
  'Status',
  'Location',
  'Debit',
  'Credit',
];

const money = (n?: number | null): string =>
  Number(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const dateText = (d?: Date | string | null): string =>
  d ? new Date(d).toISOString().slice(0, 10) : '';

const accountLabel = (line: GlJournalPdfLine): string =>
  `${line.account?.code ? `${line.account.code} · ` : ''}${
    line.account?.name ?? `#${line.accountId ?? ''}`
  }`;

/**
 * Build the document rows: an "Entry" row per journal entry, its account
 * "Line" rows (the breakdown the shops need), then the period totals.
 */
export function buildGlJournalPdfRows(
  entries: readonly GlJournalPdfEntry[],
  totals?: { debit?: number | null; credit?: number | null } | null,
): GlJournalPdfRow[] {
  const rows: GlJournalPdfRow[] = [];

  for (const entry of entries ?? []) {
    const date = dateText(entry.entryDate);
    const reference = entry.reference ?? '';
    rows.push({
      cells: [
        'Entry',
        date,
        reference,
        entry.description ?? '',
        '',
        '',
        entry.source ?? '',
        entry.postingStatus ?? 'POSTED',
        entry.locationName ?? '',
        money(entry.totalDebit),
        money(entry.totalCredit),
      ],
    });

    for (const line of entry.lines ?? []) {
      rows.push({
        detail: true,
        cells: [
          'Line',
          date,
          reference,
          '',
          accountLabel(line),
          line.account?.type ?? '',
          '',
          '',
          '',
          money(line.debit),
          money(line.credit),
        ],
      });
    }
  }

  if (totals) {
    rows.push({
      bold: true,
      cells: [
        'Totals',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        money(totals.debit),
        money(totals.credit),
      ],
    });
  }

  return rows;
}

/**
 * Render the report to a PDF buffer.
 *
 * `compress` is deliberately off: the text then stays greppable in the output,
 * which is how the spec proves the breakdown lines really are in the file.
 */
export function renderGlJournalPdf(opts: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: readonly GlJournalPdfRow[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 40,
      compress: false,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { columns, rows } = opts;
    const left = 40;
    const colWidth = (doc.page.width - 80) / Math.max(columns.length, 1);
    const lineHeight = 15;

    doc.font('Helvetica-Bold').fontSize(14).text(opts.title);
    if (opts.subtitle) {
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(9).fillColor('#555555');
      doc.text(opts.subtitle);
    }
    doc.fillColor('#000000');
    doc.moveDown(0.5);

    const renderRow = (
      cells: readonly string[],
      style: { bold?: boolean; detail?: boolean },
    ) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const startY = doc.y;
      cells.forEach((cell, i) => {
        const indent = style.detail && i === 0 ? 12 : 0;
        doc
          .font(style.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(style.detail ? 7 : 8)
          .fillColor(style.detail ? '#555555' : '#111111')
          .text(
            style.detail && i === 0 ? `  ↳ ${cell}` : String(cell ?? ''),
            left + i * colWidth + indent,
            startY,
            {
              width: colWidth - 6 - indent,
              height: lineHeight,
              ellipsis: true,
              lineBreak: false,
            },
          );
      });
      doc.fillColor('#000000');
      doc.y = startY + lineHeight;
    };

    renderRow(columns, { bold: true });
    doc.moveDown(0.2);
    for (const row of rows) {
      renderRow(row.cells, { bold: row.bold, detail: row.detail });
    }

    doc.end();
  });
}
