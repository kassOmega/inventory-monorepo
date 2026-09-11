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
