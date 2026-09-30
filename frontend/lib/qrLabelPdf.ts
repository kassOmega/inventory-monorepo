// QR label sheets (client-side, jsPDF).
//
// One set of labels is built by the products page and then used three times:
// the on-screen cards in the QR modal, the #print-root portal that
// `window.print()` prints, and the A4 sheet this module writes — so the labels
// on screen, on paper and in the PDF can never disagree.
//
// The layout is a fixed 3 × 4 grid per A4 page (12 labels), comfortably sized
// for a 96 pt code and the text under it, and it follows the same "core fonts
// only" rule as lib/priceListPdf.ts: names are often Amharic and Ethiopic
// glyphs do not exist in Helvetica, so isLatinText() gates them — a label whose
// name is not Latin prints its SKU and barcode instead. The QR content is
// always the SKU, so scanning is unaffected either way. The title, the
// generation line and the barcode prefix come from the caller for the same
// reason, and are passed in their Latin form (see `products.qrSheet` in the
// catalogs, the way lib/priceListPdf.ts uses its own Latin document strings).
//
// jsPDF is a few hundred KB, so it is imported lazily inside the builder: the
// products page bundle stays untouched until a user actually takes a sheet
// (the same trick lib/priceListPdf.ts uses).

/** One label: what the QR points at, plus the text printed around it. */
export interface QrLabel {
  /** Stable key for React lists (product id, or product + variant id). */
  key: string;
  /** QR content, and the code printed under the symbol. */
  sku: string;
  /** Product / variation name, printed only when it is Latin text. */
  name?: string | null;
  /** Human-readable barcode, printed under the name when it is Latin too. */
  barcode?: string | null;
}

export interface QrLabelPdfOptions {
  labels: readonly QrLabel[];
  /** Document title, e.g. "Product QR Codes". */
  title: string;
  /** Generation date, already localized by the caller. */
  generatedOnLabel: string;
  /** Drawn before each barcode, e.g. "Barcode:". */
  barcodePrefix: string;
  /** One PNG data URL per label, in the same order (see qrPngDataUrls). */
  images: readonly string[];
  /** When given, the document is saved (downloaded) before it is returned. */
  fileName?: string;
}

/** Labels per A4 page: 3 columns × 4 rows, the usual label-sheet layout. */
const GRID_COLUMNS = 3;
const GRID_ROWS = 4;
const PER_PAGE = GRID_COLUMNS * GRID_ROWS;

const PAGE_MARGIN = 28;
/** Title band above the first row of labels. */
const HEADER_HEIGHT = 30;
/** Kept clear at the foot of every page for the page numbers. */
const FOOTER_HEIGHT = 14;
/** Preferred code size; shrunk only when a cell is unusually small. */
const QR_SIZE = 96;
const TEXT_DARK: [number, number, number] = [17, 24, 39];
const TEXT_MUTED: [number, number, number] = [107, 114, 128];
const RULE: [number, number, number] = [229, 231, 235];

/**
 * Latin letters, digits, and the punctuation/symbols the PDF core fonts carry.
 * Anything outside this range (Amharic, CJK, emoji) has no glyph in Helvetica
 * and would be printed as noise.
 */
const LATIN_PRINTABLE =
  /^[\u0020-\u007E\u00A0-\u024F\u2010-\u2015\u2018-\u201D\u2022\u2026\u20AC]+$/;

/** True when `value` holds text the PDF core fonts can actually draw. */
export function isLatinText(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return text.length > 0 && LATIN_PRINTABLE.test(text);
}

/** Local YYYY-MM-DD, so the name matches the calendar day the user is in. */
function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

/** The download name, e.g. `QR_Labels_2026-09-30.pdf`. */
export function qrLabelFileName(date: Date = new Date()): string {
  return `QR_Labels_${localIsoDate(date)}.pdf`;
}

/**
 * Read the off-screen QRCodeCanvas elements inside `container`, in document
 * order, as PNG data URLs for the PDF.
 *
 * The canvases exist only to be rasterised: they render at a comfortably large
 * size and keep their bitmap even while hidden, and the caller must render them
 * in the same order as the labels they belong to.
 */
export function qrPngDataUrls(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll("canvas")).map((canvas) =>
    canvas.toDataURL("image/png"),
  );
}

/** The slice of the jsPDF API fitFontSize() needs. */
type Measurable = {
  getTextWidth: (text: string) => number;
  setFontSize: (size: number) => void;
};

/**
 * Pick the font size that makes `text` fit `maxWidth` in the current font,
 * shrinking proportionally but never below a legible floor. The caller has
 * already chosen the font family, and applies the returned size before drawing.
 */
function fitFontSize(
  doc: Measurable,
  text: string,
  maxWidth: number,
  preferred: number,
): number {
  doc.setFontSize(preferred);
  const width = doc.getTextWidth(text);
  if (width <= maxWidth || width === 0) return preferred;
  return Math.max(6, Math.floor((preferred * maxWidth) / width));
}

/**
 * Render an A4 sheet of QR labels. Nothing is written when `fileName` is
 * omitted — the caller decides whether to download, share or keep the document.
 */
export async function buildQrLabelPdf(opts: QrLabelPdfOptions) {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const cellWidth = (pageWidth - PAGE_MARGIN * 2) / GRID_COLUMNS;
  const cellHeight =
    (pageHeight - PAGE_MARGIN * 2 - HEADER_HEIGHT - FOOTER_HEIGHT) / GRID_ROWS;

  /** Title + generation date, repeated on every page. */
  const drawHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...TEXT_DARK);
    doc.text(opts.title, PAGE_MARGIN, PAGE_MARGIN + 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(opts.generatedOnLabel, pageWidth - PAGE_MARGIN, PAGE_MARGIN + 14, {
      align: "right",
    });
  };

  drawHeader();

  opts.labels.forEach((label, index) => {
    if (index > 0 && index % PER_PAGE === 0) {
      doc.addPage();
      drawHeader();
    }

    const slot = index % PER_PAGE;
    const x = PAGE_MARGIN + (slot % GRID_COLUMNS) * cellWidth;
    const y =
      PAGE_MARGIN +
      HEADER_HEIGHT +
      Math.floor(slot / GRID_COLUMNS) * cellHeight;
    const centerX = x + cellWidth / 2;
    const maxWidth = cellWidth - 24;

    // Every label gets its own frame, so the sheet can be cut with scissors.
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.roundedRect(x + 4, y + 4, cellWidth - 8, cellHeight - 8, 6, 6);

    const qr = Math.min(QR_SIZE, cellWidth - 32, cellHeight - 60);
    const qrY = y + 12;
    const image = opts.images[index];
    if (image) doc.addImage(image, "PNG", centerX - qr / 2, qrY, qr, qr);
    // The SKU doubles as the QR content, so it always prints.
    const sku = String(label.sku ?? "").trim();
    let textY = qrY + qr + 14;
    doc.setFont("courier", "bold");
    doc.setTextColor(...TEXT_DARK);
    doc.setFontSize(fitFontSize(doc, sku, maxWidth, 10));
    doc.text(sku, centerX, textY, { align: "center" });

    // The name is dropped for non-Latin scripts: Helvetica has no glyph for
    // them, so the label stays SKU + barcode instead of printing noise.
    const name = isLatinText(label.name) ? String(label.name).trim() : "";
    if (name) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...TEXT_MUTED);
      const lines = (doc.splitTextToSize(name, maxWidth) as string[]).slice(
        0,
        2,
      );
      textY += 12;
      doc.text(lines, centerX, textY, { align: "center" });
      textY += (lines.length - 1) * 10;
    }

    const barcode = isLatinText(label.barcode)
      ? String(label.barcode).trim()
      : "";
    if (barcode) {
      const text = `${opts.barcodePrefix} ${barcode}`.trim();
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT_MUTED);
      doc.setFontSize(fitFontSize(doc, text, maxWidth, 7));
      doc.text(text, centerX, textY + 12, { align: "center" });
    }
  });

  // Page numbers, so a sheet that failed to print a page is easy to spot.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(
      `${page} / ${pageCount}`,
      pageWidth - PAGE_MARGIN,
      pageHeight - 18,
      { align: "right" },
    );
  }
  doc.setPage(pageCount);

  if (opts.fileName) doc.save(opts.fileName);
  return doc;
}
