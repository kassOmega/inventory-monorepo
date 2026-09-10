// Status / enum → localized display label helper.
//
// Converts DB enum values (e.g. "PARTIALLY_APPROVED", "CHECKED_OUT") into
// their camelCase catalog key and resolves the active-language label from the
// shared `status.*` translation section. Falls back to the raw value.
import i18n from "./i18n";

/** "PARTIALLY_APPROVED" → "partiallyApproved" */
export function statusKey(value?: string | null): string {
  if (!value) return "";
  const parts = value.toLowerCase().split("_").filter(Boolean);
  if (!parts.length) return "";
  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("")
  );
}

/** Localized display label for any status/enum value. */
export function statusLabel(value?: string | null): string {
  if (!value) return "—";
  const key = statusKey(value);
  if (!key) return value;
  const out = i18n.t(`status.${key}`, { defaultValue: "" });
  return out || value;
}
