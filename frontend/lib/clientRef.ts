// lib/clientRef.ts
// Client-generated idempotency key for double-submit protection. Generate ONCE
// per transaction/form and REUSE on retries (never regenerate after a failure),
// so an accidental double-tap on "Pay/Save" is deduped server-side.

export function newClientRef(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
