/**
 * EAN-13 barcode generator.
 *
 * Produces a valid 13-digit EAN-13 string: 12 random payload digits + the
 * standard check digit, so the result scans like a real retail barcode.
 * Collisions are unlikely (10^11 payload space); the backend DB unique
 * constraint on (tenantId, barcode) is the safety net if one ever occurs.
 */
export function generateEan13(): string {
  let payload = "";
  for (let i = 0; i < 12; i++) {
    payload += Math.floor(Math.random() * 10).toString();
  }
  // EAN-13 check digit: odd positions (1st, 3rd, …) weight 1, even positions
  // (2nd, 4th, …) weight 3 over the 12 payload digits.
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(payload[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return payload + check.toString();
}
