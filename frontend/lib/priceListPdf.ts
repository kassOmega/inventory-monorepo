// Customer-facing price list PDF (client-side, jsPDF + jsPDF-AutoTable).
//
// The document is handed to customers, so it exposes exactly two columns —
// Item and Price — and never internal data (buy price, product SKU, variant
// SKU, barcode, stock on hand). Every label and formatted amount is injected by
// the caller (see PriceListModal), keeping all currency/locale decisions in the
// React layer — the same convention as lib/glExport.ts.
//
// jsPDF is a few hundred KB, so both libraries are imported lazily inside the
// builder: the products page bundle stays untouched until a user actually
// generates a price list (the same trick BarcodeScanner uses for html5-qrcode).
//
// Only the PDF core fonts are used (Helvetica), which means every string handed
// to this module must be Latin-1 text. Amharic labels/item names need a real
// Ethiopic font embedded via doc.addFileToVFS()/addFont() first — until then the
// UI passes Latin equivalents (see PriceListModal), and any Ethiopic characters
// arriving from product data would be dropped by the encoder.

/** One printed row: the customer-facing item name and its formatted price. */
export interface PriceListRow {
  item: string;
  price: string;
}

export interface PriceListPdfLabels {
  /** Table header for the item column ("Item"). */
  item: string;
  /** Table header for the price column ("Price"). */
  price: string;
  /** Footer line repeated on every page ("Thank you for your business!"). */
  footer: string;
}

export interface PriceListPdfOptions {
  rows: readonly PriceListRow[];
  /** Document title, e.g. "Price List". */
  title: string;
  /** Generation date, already localized by the caller. */
  generatedOnLabel: string;
  labels: PriceListPdfLabels;
  /**
   * Header block drawn under the top margin: the first line is the business
   * name (rendered large and bold), the rest are muted detail lines. Skipped
   * entirely when empty, so the user can leave the business header out.
   */
  headerLines?: readonly string[];
  /** When given, the document is saved (downloaded) before it is returned. */
  fileName?: string;
}

const PAGE_MARGIN_X = 40;
/** Bottom margin reserved for the footer line + page numbers. */
const FOOTER_RESERVED = 56;
const TEXT_DARK: [number, number, number] = [17, 24, 39];
const TEXT_BODY: [number, number, number] = [31, 41, 55];
const TEXT_MUTED: [number, number, number] = [107, 114, 128];
const BRAND: [number, number, number] = [37, 99, 235];
const ZEBRA: [number, number, number] = [249, 250, 251];
const RULE: [number, number, number] = [229, 231, 235];

/** Local YYYY-MM-DD, so the name matches the calendar day the user is in. */
function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

/** The download name, e.g. `Price_List_2026-09-29.pdf`. */
export function priceListFileName(date: Date = new Date()): string {
  return `Price_List_${localIsoDate(date)}.pdf`;
}

/**
 * Variant "Variation / Spec" label, built from the variant's attribute values.
 *
 * Unlike lib/variantLabel.ts this never falls back to the SKU: a variant
 * without attributes must not leak its internal code into a customer document.
 */
export function specLabel(variant: unknown): string {
  const attributes = ((variant as { attributes?: unknown } | null)
    ?.attributes ?? {}) as Record<string, unknown>;
  return Object.values(attributes)
    .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
    .map((x) => String(x).trim())
    .join(" · ");
}

/** `"Nike Air Max 90 · 42 / Black"`, or just the product name without a spec. */
export function priceListItemLabel(
  productName: string,
  variant?: unknown,
): string {
  const spec = variant ? specLabel(variant) : "";
  return spec ? `${productName} · ${spec}` : productName;
}

/**
 * Render the price list. Nothing is written when `fileName` is omitted — the
 * caller decides whether to download, print or preview the returned document.
 */
export async function buildPriceListPdf(opts: PriceListPdfOptions) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  // jspdf-autotable exposes `autoTable(doc, options)` as its default export; the
  // callable can sit on `default` or on the module itself depending on how the
  // bundler unwraps the CJS interop object.
  const autoTable = ((autoTableModule as { default?: unknown }).default ??
    autoTableModule) as (doc: unknown, options: Record<string, unknown>) => void;

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN_X * 2;

  // --- Optional business header -------------------------------------------
  const headerLines = (opts.headerLines ?? [])
    .map((line) => String(line ?? "").trim())
    .filter(Boolean);
  let y = PAGE_MARGIN_X + 10;
  if (headerLines.length > 0) {
    const [businessName, ...details] = headerLines;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...TEXT_DARK);
    const nameLines = doc.splitTextToSize(businessName, contentWidth);
    doc.text(nameLines, PAGE_MARGIN_X, y);
    y += nameLines.length * 19;

    if (details.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_MUTED);
      for (const line of details) {
        const detailLines = doc.splitTextToSize(line, contentWidth);
        doc.text(detailLines, PAGE_MARGIN_X, y);
        y += detailLines.length * 12;
      }
    }

    y += 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(1);
    doc.line(PAGE_MARGIN_X, y, pageWidth - PAGE_MARGIN_X, y);
    y += 22;
  }

  // --- Title + generation date --------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...TEXT_DARK);
  doc.text(opts.title, PAGE_MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(opts.generatedOnLabel, pageWidth - PAGE_MARGIN_X, y, {
    align: "right",
  });

  // --- Table ---------------------------------------------------------------
  autoTable(doc, {
    startY: y + 16,
    head: [[opts.labels.item, opts.labels.price]],
    body: opts.rows.map((row) => [row.item, row.price]),
    theme: "striped",
    styles: {
      font: "helvetica",
      fontSize: 10,
      textColor: TEXT_BODY,
      lineColor: RULE,
      lineWidth: 0.5,
      cellPadding: { top: 6, bottom: 6, left: 8, right: 8 },
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: BRAND,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 10,
    },
    // Zebra striping for the detail rows.
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: {
      0: { cellWidth: "auto", halign: "left" },
      1: { cellWidth: 130, halign: "right" },
    },
    margin: {
      top: PAGE_MARGIN_X,
      left: PAGE_MARGIN_X,
      right: PAGE_MARGIN_X,
      bottom: FOOTER_RESERVED,
    },
    // Keep a row's item and price together across page breaks.
    rowPageBreak: "avoid",
  });

  // --- Footer on every page (thank-you line + page numbers) ----------------
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(opts.labels.footer, pageWidth / 2, pageHeight - 30, {
      align: "center",
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `${page} / ${pageCount}`,
      pageWidth - PAGE_MARGIN_X,
      pageHeight - 30,
      { align: "right" },
    );
  }
  doc.setPage(pageCount);

  if (opts.fileName) doc.save(opts.fileName);
  return doc;
}
