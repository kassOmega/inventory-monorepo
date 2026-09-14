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
  HOSPITALITY: "Hospitality",
  MANUFACTURING: "Manufacturing & Production",
  SERVICE: "Services & Consulting",
};

// ---------------------------------------------------------------------------
// Hospitality service lines. The single source of truth for every multi-select
// (signup / create business), the sidebar gating and the Hospitality Services
// settings page. Values must match the backend HospitalityServiceType enum.
// ---------------------------------------------------------------------------
export interface HospitalityServiceOption {
  value: string;
  label: string;
  description: string;
  /** i18n key suffix under `hospitalityServices.*`. */
  i18nKey: string;
}

export const HOSPITALITY_SERVICES: HospitalityServiceOption[] = [
  {
    value: "ACCOMMODATION",
    label: "Accommodation",
    description: "Rooms, pensions, lodging",
    i18nKey: "ACCOMMODATION",
  },
  {
    value: "FOOD_AND_BEVERAGE",
    label: "Food & Beverage",
    description: "Restaurant, bar, kitchen, barista",
    i18nKey: "FOOD_AND_BEVERAGE",
  },
  {
    value: "SPA_AND_WELLNESS",
    label: "Spa & Wellness",
    description: "Sauna, steam, massages, salon",
    i18nKey: "SPA_AND_WELLNESS",
  },
  {
    value: "GYM_AND_FITNESS",
    label: "Gym & Fitness",
    description: "Fitness center, memberships",
    i18nKey: "GYM_AND_FITNESS",
  },
  {
    value: "SWIMMING_POOL",
    label: "Swimming Pool",
    description: "Pool access, day passes",
    i18nKey: "SWIMMING_POOL",
  },
  {
    value: "EVENT_AND_HALL_RENTAL",
    label: "Event & Hall Rental",
    description: "Halls, conference spaces",
    i18nKey: "EVENT_AND_HALL_RENTAL",
  },
];

/** The default selection used when a hospitality owner skips the step. */
export const DEFAULT_HOSPITALITY_SERVICES = ["FOOD_AND_BEVERAGE", "ACCOMMODATION"];

export const HOSPITALITY_SERVICE_LABELS: Record<string, string> =
  Object.fromEntries(HOSPITALITY_SERVICES.map((s) => [s.value, s.label]));

export const HOSPITALITY_SERVICE_DESCRIPTIONS: Record<string, string> =
  Object.fromEntries(HOSPITALITY_SERVICES.map((s) => [s.value, s.description]));

/** Friendly display name for a HospitalityService row (incl. custom ones). */
export function hospitalityServiceName(s: {
  serviceType?: string | null;
  customName?: string | null;
} | null | undefined): string {
  if (!s) return "Facility";
  return (
    s.customName ??
    (s.serviceType ? HOSPITALITY_SERVICE_LABELS[s.serviceType] ?? s.serviceType : "Facility")
  );
}

/** Services that can carry memberships (everything except the two core lines). */
export function isMembershipCapableService(s: { serviceType?: string | null } | null | undefined) {
  return s?.serviceType !== "FOOD_AND_BEVERAGE" && s?.serviceType !== "ACCOMMODATION";
}

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
