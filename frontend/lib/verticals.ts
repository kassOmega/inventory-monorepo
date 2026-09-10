// lib/verticals.ts
// Frontend mirror of the backend vertical registry. Maps a business type to the
// feature modules it uses, so the dashboard shell can show the right navigation.
import i18n from "./i18n";

export type BusinessType = "RETAIL" | "HOSPITALITY" | "MANUFACTURING" | "SERVICE";

export interface VerticalFeatures {
  inventory: boolean;
  retail: boolean;
  pos: boolean;
  kitchen: boolean;
  tables: boolean;
  reservations: boolean;
  rooms: boolean;
  folio: boolean;
  finance: boolean;
}

const retail = (): VerticalFeatures => ({
  inventory: true,
  retail: true,
  pos: false,
  kitchen: false,
  tables: false,
  reservations: false,
  rooms: false,
  folio: false,
  finance: true,
});

export const VERTICAL_FEATURES: Record<string, VerticalFeatures> = {
  RETAIL: retail(),
  MANUFACTURING: {
    inventory: true,
    retail: false,
    pos: false,
    kitchen: false,
    tables: false,
    reservations: false,
    rooms: false,
    folio: false,
    finance: true,
  },
  HOSPITALITY: {
    inventory: false,
    retail: false,
    pos: true,
    kitchen: true,
    tables: true,
    reservations: true,
    rooms: true,
    folio: true,
    finance: true,
  },
  SERVICE: {
    inventory: false,
    retail: false,
    pos: true,
    kitchen: false,
    tables: false,
    reservations: true,
    rooms: false,
    folio: false,
    finance: true,
  },
};

export const VERTICAL_LABELS: Record<string, string> = {
  RETAIL: "Retail & Distribution",
  HOSPITALITY: "Hotels & Restaurants",
  MANUFACTURING: "Manufacturing & Production",
  SERVICE: "Services & Consulting",
};

export function getVerticalFeatures(businessType?: string | null): VerticalFeatures {
  return VERTICAL_FEATURES[businessType ?? ""] ?? retail();
}

// ---------------------------------------------------------------------------
// Common terminology per vertical. SERVICE businesses talk about Catalog,
// Tickets, Services and Clients instead of Menu / Orders / Menu Items.
// ---------------------------------------------------------------------------
export type VerticalTerminology = Record<string, string>;

const HOSPITALITY_TERMS: VerticalTerminology = {
  catalog: "terms.hosp.catalog",
  service: "terms.hosp.service",
  order: "terms.hosp.order",
  orders: "terms.hosp.orders",
  booking: "terms.hosp.booking",
  customer: "terms.hosp.customer",
};

const SERVICE_TERMS: VerticalTerminology = {
  catalog: "terms.svc.catalog",
  service: "terms.svc.service",
  order: "terms.svc.order",
  orders: "terms.svc.orders",
  booking: "terms.svc.booking",
  customer: "terms.svc.customer",
};

export function getVerticalTerminology(businessType?: string | null): VerticalTerminology {
  const source = businessType === "SERVICE" ? SERVICE_TERMS : HOSPITALITY_TERMS;
  const out: VerticalTerminology = {};
  for (const [k, key] of Object.entries(source)) out[k] = i18n.t(key);
  return out;
}
