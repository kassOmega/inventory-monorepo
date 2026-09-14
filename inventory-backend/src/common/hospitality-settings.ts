// src/common/hospitality-settings.ts
// Typed access to the Hospitality Packages & Guest Folio policy stored in
// Organization.settings. ZERO POLICY: if nothing is configured/enabled the
// system defaults entirely to the standard POS/Kitchen/Cashier workflow, and
// every package/entitlement/room-charge path must be explicitly enabled.

/**
 * Guest identification type every hospitality organization starts with. Owners
 * can rename / reorder / deactivate these and add their own; types are never
 * deleted, so historical check-ins keep their reference.
 */
export interface DefaultGuestIdType {
  code: string;
  name: string;
  nameI18n: { en: string; am: string };
  requiresExpiry: boolean;
  sortOrder: number;
}

export const DEFAULT_GUEST_ID_TYPES: DefaultGuestIdType[] = [
  {
    code: 'NATIONAL_ID',
    name: 'National ID',
    nameI18n: { en: 'National ID', am: 'ብሔራዊ መታወቂያ' },
    requiresExpiry: false,
    sortOrder: 0,
  },
  {
    code: 'PASSPORT',
    name: 'Passport',
    nameI18n: { en: 'Passport', am: 'ፓስፖርት' },
    requiresExpiry: true,
    sortOrder: 1,
  },
  {
    code: 'DRIVERS_LICENSE',
    name: "Driver's License",
    nameI18n: { en: "Driver's License", am: 'የመንጃ ፈቃድ' },
    requiresExpiry: true,
    sortOrder: 2,
  },
  {
    code: 'OTHER',
    name: 'Other',
    nameI18n: { en: 'Other', am: 'ሌላ' },
    requiresExpiry: false,
    sortOrder: 3,
  },
];

export type ExcessSettlementMode =
  'FLEXIBLE' | 'DEFER_TO_FOLIO_ONLY' | 'COLLECT_NOW_ONLY';

/**
 * Terminal settlement routing for a net charge:
 *  - PAY_NOW        = collect immediately at the terminal.
 *  - DEFER_TO_FOLIO = append the itemized line to the active room/guest ledger.
 * `COLLECT_NOW` / `FOLIO` are the legacy aliases and stay accepted.
 */
export type NetChargeMode =
  'FOLIO' | 'COLLECT_NOW' | 'PAY_NOW' | 'DEFER_TO_FOLIO';

/** Normalize the PAY_NOW / DEFER_TO_FOLIO aliases to the internal mode. */
export function normalizeNetChargeMode(
  mode?: string | null,
): 'FOLIO' | 'COLLECT_NOW' | null {
  if (mode === 'PAY_NOW' || mode === 'COLLECT_NOW') return 'COLLECT_NOW';
  if (mode === 'DEFER_TO_FOLIO' || mode === 'FOLIO') return 'FOLIO';
  return null;
}

export interface HospitalityPolicySettings {
  enablePackageRouting: boolean;
  enableRoomFolioCharging: boolean;
  allowPackagePriceCompensation: boolean;
  defaultExcessSettlementMode: ExcessSettlementMode;
}

export const DEFAULT_HOSPITALITY_POLICY: HospitalityPolicySettings = {
  enablePackageRouting: false,
  enableRoomFolioCharging: false,
  allowPackagePriceCompensation: true,
  defaultExcessSettlementMode: 'FLEXIBLE',
};

/**
 * Normalize an Organization.settings JSON payload into the typed hospitality
 * policy. Every field defaults to OFF / the safe standard-workflow value when
 * absent, so the standard POS/Kitchen/Cashier flow is always preserved unless
 * a company admin explicitly enables a feature.
 */
export function readHospitalityPolicy(
  settings: Record<string, unknown> | null | undefined,
): HospitalityPolicySettings {
  const s = (settings ?? {}) as Record<string, unknown>;
  const mode = String(s.defaultExcessSettlementMode ?? '');
  return {
    enablePackageRouting: s.enablePackageRouting === true,
    enableRoomFolioCharging: s.enableRoomFolioCharging === true,
    allowPackagePriceCompensation: s.allowPackagePriceCompensation !== false,
    defaultExcessSettlementMode:
      mode === 'FLEXIBLE' ||
      mode === 'DEFER_TO_FOLIO_ONLY' ||
      mode === 'COLLECT_NOW_ONLY'
        ? (mode as ExcessSettlementMode)
        : 'FLEXIBLE',
  };
}
