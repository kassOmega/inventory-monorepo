// lib/verticals.ts
// Frontend mirror of the backend vertical registry. Maps a business type to the
// feature modules it uses, so the dashboard shell can show the right navigation.
import i18n from "./i18n";

export type BusinessType = "RETAIL" | "HOSPITALITY" | "MANUFACTURING" | "SERVICE" | "CAR_WASH";

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
  CAR_WASH: {
    inventory: true,
    retail: false,
    pos: false,
    kitchen: false,
    tables: false,
    reservations: true,
    rooms: false,
    folio: false,
    finance: true,
  },
};

// Business type → i18n key under `verticals.*`. Resolve through
// `verticalLabel()` so every screen reads the same wording.
export const VERTICAL_LABELS: Record<string, string> = {
  RETAIL: "verticals.retail",
  HOSPITALITY: "verticals.hospitality",
  MANUFACTURING: "verticals.manufacturing",
  SERVICE: "verticals.service",
  CAR_WASH: "verticals.car_wash",
};

/** Localized business-type name (falls back to the raw type value). */
export function verticalLabel(type?: string | null): string {
  if (!type) return "";
  const key = VERTICAL_LABELS[type];
  return key ? i18n.t(key) : type;
}

// ---------------------------------------------------------------------------
// Hospitality service lines. The single source of truth for every multi-select
// (signup / create business), the sidebar gating and the Hospitality Services
// settings page. Values must match the backend HospitalityServiceType enum, and
// the label/description text lives in the catalog under `hospitalityServices.*`
// (`<KEY>` for the name, `<KEY>_DESC` for the one-line description).
// ---------------------------------------------------------------------------
export interface HospitalityServiceOption {
  value: string;
  /** i18n key suffix under `hospitalityServices.*`. */
  i18nKey: string;
}

export const HOSPITALITY_SERVICES: HospitalityServiceOption[] = [
  { value: "ACCOMMODATION", i18nKey: "ACCOMMODATION" },
  { value: "FOOD_AND_BEVERAGE", i18nKey: "FOOD_AND_BEVERAGE" },
  { value: "SPA_AND_WELLNESS", i18nKey: "SPA_AND_WELLNESS" },
  { value: "GYM_AND_FITNESS", i18nKey: "GYM_AND_FITNESS" },
  { value: "SWIMMING_POOL", i18nKey: "SWIMMING_POOL" },
  { value: "EVENT_AND_HALL_RENTAL", i18nKey: "EVENT_AND_HALL_RENTAL" },
];

/** The default selection used when a hospitality owner skips the step. */
export const DEFAULT_HOSPITALITY_SERVICES = ["FOOD_AND_BEVERAGE", "ACCOMMODATION"];

/** i18n key for a service line's display name. */
export function hospitalityServiceLabelKey(serviceType: string): string {
  return `hospitalityServices.${serviceType.toUpperCase()}`;
}

/** i18n key for a service line's one-line description. */
export function hospitalityServiceDescKey(serviceType: string): string {
  return `${hospitalityServiceLabelKey(serviceType)}_DESC`;
}

/** Localized name of a standard service line (falls back to the raw value). */
export function hospitalityServiceLabel(serviceType?: string | null): string {
  if (!serviceType) return "";
  const out = i18n.t(hospitalityServiceLabelKey(serviceType), { defaultValue: "" });
  return out || serviceType;
}

/** Localized description of a standard service line ("" when there is none). */
export function hospitalityServiceDescription(serviceType?: string | null): string {
  if (!serviceType) return "";
  const out = i18n.t(hospitalityServiceDescKey(serviceType), { defaultValue: "" });
  return out || "";
}

/** Friendly display name for a HospitalityService row (incl. custom ones). */
export function hospitalityServiceName(s: {
  serviceType?: string | null;
  customName?: string | null;
} | null | undefined): string {
  if (!s) return i18n.t("hospitalityServices.facility");
  return (
    s.customName ??
    (s.serviceType
      ? hospitalityServiceLabel(s.serviceType)
      : i18n.t("hospitalityServices.facility"))
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

const CAR_WASH_TERMS: VerticalTerminology = {
  catalog: "terms.cw.catalog",
  service: "terms.cw.service",
  order: "terms.cw.order",
  orders: "terms.cw.orders",
  booking: "terms.cw.booking",
  customer: "terms.cw.customer",
};

export function getVerticalTerminology(businessType?: string | null): VerticalTerminology {
  const source =
    businessType === "SERVICE"
      ? SERVICE_TERMS
      : businessType === "CAR_WASH"
        ? CAR_WASH_TERMS
        : HOSPITALITY_TERMS;
  const out: VerticalTerminology = {};
  for (const [k, key] of Object.entries(source)) out[k] = i18n.t(key);
  return out;
}
