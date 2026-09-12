import {
  GL_JOURNAL_PDF_COLUMNS,
  GlJournalPdfEntry,
  buildGlJournalPdfRows,
  renderGlJournalPdf,
} from './gl-journal-pdf';

const entry: GlJournalPdfEntry = {
  entryDate: new Date('2026-09-08T00:00:00Z'),
  reference: 'JE-001',
  description: 'Rent payment',
  source: 'MANUAL',
  postingStatus: 'POSTED',
  locationName: 'Main shop',
  totalDebit: 5000,
  totalCredit: 5000,
  lines: [
    {
      accountId: 7,
      account: { code: '5100', name: 'Rent', type: 'EXPENSE' },
      debit: 5000,
      credit: 0,
    },
    {
      accountId: 1,
      account: { code: '1100', name: 'Cash', type: 'ASSET' },
      debit: 0,
      credit: 5000,
    },
  ],
};

describe('GL journal PDF export', () => {
  it('emits an Entry row, its account lines, then the period totals', () => {
    const rows = buildGlJournalPdfRows([entry], { debit: 5000, credit: 5000 });

    expect(rows).toHaveLength(4);
    expect(rows[0].cells[0]).toBe('Entry');
    expect(rows[0].cells[1]).toBe('2026-09-08');
    expect(rows[0].cells[2]).toBe('JE-001');
    expect(rows[0].cells[8]).toBe('Main shop');
    expect(rows[0].cells[9]).toBe('5,000.00');
    expect(rows[0].cells[10]).toBe('5,000.00');
    expect(rows[0].detail).toBeUndefined();

    expect(rows[1].detail).toBe(true);
    expect(rows[1].cells[4]).toBe('5100 · Rent');
    expect(rows[1].cells[5]).toBe('EXPENSE');
    expect(rows[1].cells[9]).toBe('5,000.00');

    expect(rows[2].detail).toBe(true);
    expect(rows[2].cells[4]).toBe('1100 · Cash');

    expect(rows[3].bold).toBe(true);
    expect(rows[3].cells[0]).toBe('Totals');
    expect(rows[3].cells[10]).toBe('5,000.00');
  });

  it('keeps entry rows free of account columns and lines free of entry columns', () => {
    const rows = buildGlJournalPdfRows([entry]);
    // Entry row: no account / type
    expect(rows[0].cells.slice(4, 6)).toEqual(['', '']);
    // Line row: no description / source / status / location
    expect([rows[1].cells[3], rows[1].cells[6], rows[1].cells[7], rows[1].cells[8]]).toEqual([
      '',
      '',
      '',
      '',
    ]);
  });

  it('falls back to the account id when the relation is missing', () => {
    const rows = buildGlJournalPdfRows([
      { entryDate: '2026-09-08', lines: [{ accountId: 42, debit: 1, credit: 0 }] },
    ]);
    expect(rows[1].cells[4]).toBe('#42');
    expect(rows[1].cells[5]).toBe('');
  });

  it('adds no totals row when no totals are given, and handles no entries', () => {
    expect(buildGlJournalPdfRows([entry]).some((r) => r.cells[0] === 'Totals')).toBe(false);
    expect(buildGlJournalPdfRows([])).toEqual([]);
    expect(buildGlJournalPdfRows([], { debit: 1, credit: 2 })).toHaveLength(1);
  });

  it('writes the breakdown lines into the PDF bytes', async () => {
    const rows = buildGlJournalPdfRows([entry], { debit: 5000, credit: 5000 });
    const pdf = await renderGlJournalPdf({
      title: 'General Ledger — Journal',
      subtitle: '2026-09-01 → 2026-09-30',
      columns: [...GL_JOURNAL_PDF_COLUMNS],
      rows,
    });

    // A real PDF…
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    // …whose content stream is uncompressed (renderGlJournalPdf passes
    // compress:false). pdfkit writes text as hex runs with kerning splits in
    // between, so decode every run and join them to read the document back.
    const decoded = [...pdf.toString('latin1').matchAll(/<([0-9a-fA-F]{2,})>/g)]
      .map((m) => Buffer.from(m[1], 'hex').toString('latin1'))
      .join('');

    expect(decoded).toContain('Entry');
    expect(decoded).toContain('5100 · Rent');
    expect(decoded).toContain('1100 · Cash');
    expect(decoded).toContain('EXPENSE');
    expect(decoded).toContain('Totals');
  });
});
