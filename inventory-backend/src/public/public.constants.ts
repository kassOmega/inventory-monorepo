// src/public/public.constants.ts
// Public QR guest-ordering: entry kind -> what the public page shows, and the
// small helpers shared by the public + admin services.
import type { PublicEntryKind } from '@prisma/client';

/** Catalog item kinds a PublicEntryItem can reference. */
export const ITEM_KINDS = ['MENU_ITEM', 'PRODUCT', 'SERVICE_ITEM', 'ROOM_TYPE'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Order item kinds a GuestOrderItem can reference (same set). */
export type GuestItemKind = ItemKind;

/** Which catalog a public entry of each kind publishes. */
export function catalogsForKind(kind: PublicEntryKind): ItemKind[] {
  switch (kind) {
    case 'TABLE':
      return ['MENU_ITEM'];
    case 'HOTEL':
      // A hotel/rooms entry publishes room types only. F&B and other service
      // lines now have their own per-service QRs (see kindForHospitalityService).
      return ['ROOM_TYPE'];
    case 'SHOP':
      return ['PRODUCT'];
    case 'SERVICE':
      return ['SERVICE_ITEM'];
    case 'CARWASH_BAY':
      return ['SERVICE_ITEM'];
    default:
      return [];
  }
}

/**
 * Resolve the catalog item kinds for an entry. Service-scoped hospitality
 * entries use their serviceType (the source of truth); everything else falls
 * back to the entry kind.
 */
export function itemKindsForEntry(
  kind: PublicEntryKind,
  serviceType?: string | null,
): ItemKind[] {
  if (serviceType) return catalogsForKind(kindForHospitalityService(serviceType));
  return catalogsForKind(kind);
}

/**
 * The entry kinds a business may publish, derived from its type (and, for
 * hospitality, its enabled service lines). Returned to the client so the QR page
 * never offers a kind that makes no sense (no dining table for a retailer, no
 * shop for a hotel).
 */
export function entryKindsFor(
  businessType: string,
  enabledServices: string[] = [],
): PublicEntryKind[] {
  switch (businessType) {
    case 'RETAIL':
    case 'MANUFACTURING':
      return ['SHOP'];
    case 'CAR_WASH':
      return ['CARWASH_BAY'];
    case 'SERVICE':
      return ['SERVICE'];
    case 'HOSPITALITY': {
      const kinds: PublicEntryKind[] = [];
      if (enabledServices.includes('FOOD_AND_BEVERAGE')) kinds.push('TABLE');
      if (enabledServices.includes('ACCOMMODATION')) kinds.push('HOTEL');
      const other = [
        'SPA_AND_WELLNESS',
        'GYM_AND_FITNESS',
        'SWIMMING_POOL',
        'EVENT_AND_HALL_RENTAL',
        'CUSTOM',
      ];
      if (enabledServices.some((s) => other.includes(s))) kinds.push('SERVICE');
      return kinds;
    }
    default:
      return [];
  }
}

/**
 * The single public catalog "kind" for a business type. Every QR for a tenant
 * shares this kind — the catalog is resolved from the tenant's data (and, for
 * hospitality, its enabled services) at read time, not from the kind.
 */
export function publicKindFor(
  businessType: string,
): 'SHOP' | 'CARWASH_BAY' | 'SERVICE' | 'HOTEL' {
  switch (businessType) {
    case 'CAR_WASH':
      return 'CARWASH_BAY';
    case 'SERVICE':
      return 'SERVICE';
    case 'HOSPITALITY':
      return 'HOTEL';
    default:
      return 'SHOP';
  }
}

/**
 * The public entry kind for one hospitality service line. F&B is table-based,
 * accommodation is room-based, and every other line (spa/gym/pool/events/custom)
 * renders as a SERVICE booking entry.
 */
export function kindForHospitalityService(service: string): PublicEntryKind {
  switch (service) {
    case 'FOOD_AND_BEVERAGE':
      return 'TABLE';
    case 'ACCOMMODATION':
      return 'HOTEL';
    default:
      return 'SERVICE';
  }
}

/** Human-friendly display names for the hospitality service lines. */
export const HOSPITALITY_SERVICE_LABELS: Record<string, string> = {
  FOOD_AND_BEVERAGE: 'Food & Beverage',
  ACCOMMODATION: 'Rooms',
  SPA_AND_WELLNESS: 'Spa',
  GYM_AND_FITNESS: 'Gym',
  SWIMMING_POOL: 'Pool',
  EVENT_AND_HALL_RENTAL: 'Events',
  CUSTOM: 'Custom',
};

/** The display label for a hospitality service line (falls back to the key). */
export function hospitalityServiceLabel(service: string): string {
  return HOSPITALITY_SERVICE_LABELS[service] ?? service;
}
