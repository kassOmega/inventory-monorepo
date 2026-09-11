// Helpers for turning raw scanner output into a clean, displayable value.
//
// Both the camera decoder and USB/Bluetooth "wedge" scanners can deliver noise:
// trailing whitespace, zero-width characters, or a GS1/AIM symbology identifier
// prefix ("]C1", "]d2", "]Q3", …) that a label carries for the scanner rather
// than for the user.

/** Strip invisible characters, line breaks and any AIM identifier prefix. */
export function normalizeScannedCode(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width + BOM
    .replace(/[\r\n\t]/g, "")
    .trimStart() // the AIM prefix is only valid at the very start
    .replace(/^\]\w{2}/, "") // AIM symbology identifier, e.g. ]C1 ]d2 ]Q3
    .trim();
}

/** Human label for a symbology name reported by the scanner (EAN_13 → EAN-13). */
export function formatSymbologyLabel(formatName: string): string {
  if (!formatName) return "";
  if (formatName === "QR_CODE") return "QR";
  if (formatName === "UPC_EAN_EXTENSION") return "UPC/EAN add-on";
  if (formatName === "DATA_MATRIX") return "DataMatrix";
  if (formatName === "PDF_417") return "PDF417";
  return formatName.replace(/_/g, "-");
}

/** State of the scan-acceptance guard: the last accepted code + when. */
export interface ScanGuard {
  code: string;
  at: number;
}

/** Same code re-read inside this window is treated as a double read. */
export const SCAN_RESCAN_WINDOW_MS = 1500;

/**
 * Decide whether a successful decode starts a new scan or is a repeat of the one
 * already handled.
 *
 * A repeat is ignored while the code is still visible to the camera (`inFrame`)
 * — so holding a barcode steady can never add the same item twice — and, as a
 * backstop, while the same code was accepted less than SCAN_RESCAN_WINDOW_MS ago
 * (covers double decodes within one frame burst).
 */
export function nextScanGuard(
  guard: ScanGuard,
  code: string,
  at: number,
  inFrame: boolean,
): { accept: boolean; guard: ScanGuard } {
  if (code === guard.code && (inFrame || at - guard.at < SCAN_RESCAN_WINDOW_MS)) {
    return { accept: false, guard };
  }
  return { accept: true, guard: { code, at } };
}

/**
 * Camera constraint passed to html5-qrcode's `start()`.
 *
 * IMPORTANT: that argument accepts a camera-id string or an object with EXACTLY
 * ONE key (`facingMode` or `deviceId`), and a `facingMode` value that is either
 * the string "user"/"environment" or an object with an `exact` key. Anything
 * else makes the library throw ("'cameraIdOrConfig' object should have exactly
 * 1 key…" / "'facingMode' should be string or object with exact as key"), so
 * resolution belongs in `videoConstraints` below, never here.
 */
export const SCANNER_CAMERA = { facingMode: "environment" } as const;

/**
 * Preferred capture settings, passed as `config.videoConstraints` (an `ideal`
 * value is only a preference, so it can never over-constrain the device).
 */
export const SCANNER_VIDEO_CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1280 },
  height: { ideal: 720 },
} as const;

/**
 * Soft plausibility check for retail EAN/UPC codes (check digit).
 * Returns null when the value is not a candidate at all (e.g. the alphanumeric
 * payload of a Code 128 label), so callers can warn rather than reject.
 */
export function retailCheckDigitOk(code: string): boolean | null {
  if (!/^\d+$/.test(code)) return null;
  const digits = code.split("").map(Number);
  const checkWith = (payload: number[], weights: number[]) => {
    const sum = payload.reduce((acc, d, i) => acc + d * weights[i], 0);
    return (10 - (sum % 10)) % 10;
  };

  if (code.length === 13) {
    // EAN-13: weights 1,3,1,3,… over the first 12 digits.
    const weights = digits.slice(0, 12).map((_, i) => (i % 2 === 0 ? 1 : 3));
    return checkWith(digits.slice(0, 12), weights) === digits[12];
  }
  if (code.length === 12) {
    // UPC-A: weights 3,1,3,1,… over the first 11 digits.
    const weights = digits.slice(0, 11).map((_, i) => (i % 2 === 0 ? 3 : 1));
    return checkWith(digits.slice(0, 11), weights) === digits[11];
  }
  if (code.length === 8) {
    // EAN-8: weights 3,1,3,1,… over the first 7 digits.
    const weights = digits.slice(0, 7).map((_, i) => (i % 2 === 0 ? 3 : 1));
    return checkWith(digits.slice(0, 7), weights) === digits[7];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Catalogue lookup for a scanned code
// ---------------------------------------------------------------------------

/** Minimal product shape the lookup needs; richer product types satisfy it. */
export interface ScannableProduct {
  id: number;
  sku?: string | null;
  barcode?: string | null;
  variants?: ReadonlyArray<{
    sku?: string | null;
    barcode?: string | null;
  }> | null;
}

/** A scanned code resolved to a product, plus its variant when one matched. */
export interface ScannedProductHit<P extends ScannableProduct> {
  product: P;
  /** Null when the product-level SKU/barcode was scanned. */
  variant: NonNullable<P["variants"]>[number] | null;
}

/**
 * Resolve a scanned/typed code against the loaded catalogue: a product SKU or
 * barcode first, then a variant SKU/barcode (which carries its parent product).
 * Used as the fallback when the exact `/products/by-code` lookup is unavailable.
 */
export function resolveScannedCode<P extends ScannableProduct>(
  code: string,
  products: readonly P[],
): ScannedProductHit<P> | null {
  const value = code.trim().toLowerCase();
  const product = products.find(
    (p) =>
      (p.sku || "").toLowerCase() === value ||
      (p.barcode || "").toLowerCase() === value,
  );
  if (product) return { product, variant: null };

  for (const p of products) {
    const variant = (p.variants ?? []).find(
      (v) =>
        (v.sku || "").toLowerCase() === value ||
        (v.barcode || "").toLowerCase() === value,
    );
    if (variant) return { product: p, variant };
  }
  return null;
}
