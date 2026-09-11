// Shared "which product is this code?" lookup for the POS scan-to-cart flows
// (sales and credit sales).
//
// The exact backend lookup (`/products/by-code`) also resolves a variant code
// and honours the selected shop; when it is unavailable — offline, or an older
// backend — we fall back to the catalogue already loaded in memory.

import api from "./api";
import {
  resolveScannedCode,
  type ScannableProduct,
  type ScannedProductHit,
} from "./scan";

/**
 * Look a scanned code up: exact barcode/SKU match from the backend first, then
 * the in-memory catalogue. Returns null when nothing matches.
 *
 * A 200 response without a product is authoritative ("no such code"), so the
 * in-memory fallback is only used when the request itself fails.
 */
export async function lookupScannedProduct<P extends ScannableProduct>(
  code: string,
  products: readonly P[],
  locationId?: string | number | null,
): Promise<ScannedProductHit<P> | null> {
  const locParam = locationId
    ? `&locationId=${encodeURIComponent(String(locationId))}`
    : "";
  try {
    const res = await api.get(
      `/products/by-code?code=${encodeURIComponent(code)}${locParam}`,
    );
    const { product, variant } = res.data ?? {};
    if (product) return { product, variant: variant ?? null };
    return null;
  } catch {
    return resolveScannedCode(code, products);
  }
}
