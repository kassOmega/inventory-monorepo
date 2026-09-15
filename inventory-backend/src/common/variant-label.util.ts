// src/common/variant-label.util.ts
// One place that turns a variant's attributes into a short human label, so
// notifications, stock-adjustment journals and audit lines all name a unit the
// same way ("Nike Air (42 / Black)").

export interface VariantLabelSource {
  sku?: string | null;
  attributes?: unknown;
}

/**
 * Attribute label for a variant: slot1..slot4 when present, otherwise the legacy
 * attribute keys, otherwise its SKU. Returns '' for a plain product (no variant).
 */
export function variantAttributeLabel(
  variant: VariantLabelSource | null | undefined,
): string {
  if (!variant) return '';
  const attrs = (variant.attributes ?? {}) as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const value = attrs[key];
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
  };
  const slots = ['slot1', 'slot2', 'slot3', 'slot4']
    .map(pick)
    .filter((v): v is string => v !== null);
  const legacy = [
    'size',
    'color',
    'power',
    'capacity',
    'material',
    'voltage',
    'weight',
  ]
    .map(pick)
    .filter((v): v is string => v !== null);
  const label = slots.length ? slots : legacy;
  return label.length ? label.join(' / ') : (variant.sku ?? '').trim();
}

/** "Brand Base" — or "Brand Base (42 / Black)" when a variant is involved. */
export function itemDisplayName(
  product: { brand?: string | null; baseName?: string | null },
  variant?: VariantLabelSource | null,
): string {
  const base = `${product.brand ?? ''} ${product.baseName ?? ''}`.trim();
  const label = variantAttributeLabel(variant);
  return label ? `${base} (${label})` : base;
}
