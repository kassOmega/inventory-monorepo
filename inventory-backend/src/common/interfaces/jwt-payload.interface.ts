import { BusinessType, LocationType } from '@prisma/client';

export interface MembershipInfo {
  organizationId: number;
  organizationName: string;
  businessType: BusinessType;
  defaultLanguage?: string;
  roleId: number | null;
  roleName: string | null;
  isSystem: boolean;
  aiEnabled: boolean;
  aiTrialEndsAt: string | null;
  verificationStatus?: string;
  standalone?: boolean;
  /** Number of non-owner (staff) members in the org. 0 → owner-only business. */
  staffCount?: number;
}

export interface JwtPayload {
  sub: number;
  email: string;
  roleId: number | null;
  roleName: string | null;
  isSuperuser: boolean;
  isPlatformAdmin: boolean;
  isOwnerAccount: boolean;
  permissions: string[];
  locationId: number | null;
  locationType: LocationType | null;
  organizationId: number | null;
  businessType: BusinessType | null;
  preferredLanguage?: string | null;
  memberships: MembershipInfo[];
  verificationStatus: string;
  verificationNote: string | null;
  verificationAttempts: number;
}
