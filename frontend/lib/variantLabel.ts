/** Format a variant's dynamic attributes into a compact label, e.g.
 * "3.5 HP · 220V · 500 L/min · Cast Iron". Empty values are filtered out and
 * the label falls back to the variant SKU when nothing is filled in. */
export function variantLabel(v: any): string {
  if (!v) return "";
  const values = Object.values(v.attributes ?? {}).filter(
    (x) => x !== null && x !== undefined && String(x).trim() !== "",
  );
  return values.length ? values.join(" · ") : v.sku ?? "";
}

/** Product name + variant detail, e.g. "Nike Air Max 90 • 42 / Black". */
export function productWithVariant(p: any, v: any): string {
  const base = p ? `${p.brand ?? ""} ${p.baseName ?? ""}`.trim() : "";
  const label = variantLabel(v);
  return label ? `${base} • ${label}` : base;
}

/** Batch metadata, e.g. "Batch: #B-2026-01 | Exp: 10/2026". */
export function batchLabel(b: any): string {
  if (!b) return "";
  const num = b.batchNumber ?? "";
  let exp = "";
  if (b.expiryDate) {
    try {
      exp = new Date(b.expiryDate).toLocaleDateString(undefined, {
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      exp = "";
    }
  }
  return `${num ? `Batch: ${num}` : "Batch"}` + (exp ? ` | Exp: ${exp}` : "");
}
