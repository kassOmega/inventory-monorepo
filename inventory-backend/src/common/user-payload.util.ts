// src/common/user-payload.util.ts
// Shared helper that turns a Prisma User row (with role/location/memberships
// loaded) into the JWT payload shape. The active organization defaults to the
// user's first membership; if the user has no memberships yet (pre-migration
// accounts), it falls back to the legacy `role`/`roleId` fields so the current
// single-tenant behavior keeps working.
import { BusinessType, LocationType } from '@prisma/client';
import { JwtPayload } from './interfaces/jwt-payload.interface';

interface PermissionsShape {
  permission: { key: string };
}

interface UserForPayload {
  id: number;
  email: string;
  preferredLanguage?: string | null;
  roleId: number | null;
  locationId: number | null;
  isPlatformAdmin?: boolean;
  isOwnerAccount?: boolean;
  verificationStatus?: string;
  verificationNote?: string | null;
  verificationAttempts?: number;
  role?: { name: string; isSystem: boolean; permissions?: PermissionsShape[] } | null;
  location?: { type: LocationType } | null;
  memberships?: Array<{
    organizationId: number;
    roleId: number | null;
    organization: {
      name: string;
      businessType: BusinessType;
      aiEnabled: boolean;
      aiTrialEndsAt: Date | null;
      verificationStatus?: string;
      standalone?: boolean;
      defaultLanguage?: string | null;
    };
    role?: { name: string; isSystem: boolean; permissions?: PermissionsShape[] } | null;
  }>;
}

export function buildUserPayload(user: UserForPayload): JwtPayload {
  const memberships = (user.memberships ?? []).map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    businessType: m.organization.businessType,
    standalone: m.organization.standalone ?? false,
    defaultLanguage: m.organization.defaultLanguage ?? 'en',
    roleId: m.roleId,
    roleName: m.role?.name ?? null,
    isSystem: m.role?.isSystem ?? false,
    aiEnabled: m.organization.aiEnabled,
    aiTrialEndsAt: m.organization.aiTrialEndsAt
      ? m.organization.aiTrialEndsAt.toISOString().slice(0, 10)
      : null,
    verificationStatus: m.organization.verificationStatus ?? 'PENDING',
  }));

  const active = memberships[0];

  const permissions =
    (active ? user.memberships?.[0]?.role?.permissions?.map((p) => p.permission.key) : undefined) ??
    user.role?.permissions?.map((p) => p.permission.key) ??
    [];

  return {
    sub: user.id,
    email: user.email,
    preferredLanguage: user.preferredLanguage ?? null,
    roleId: active?.roleId ?? user.roleId,
    roleName: active?.roleName ?? user.role?.name ?? null,
    isSuperuser: active?.isSystem ?? user.role?.isSystem ?? false,
    isPlatformAdmin: user.isPlatformAdmin ?? false,
    isOwnerAccount: user.isOwnerAccount ?? false,
    permissions,
    locationId: user.locationId,
    locationType: user.location?.type ?? null,
    organizationId: active?.organizationId ?? null,
    businessType: active?.businessType ?? null,
    memberships,
    verificationStatus: user.verificationStatus ?? 'PENDING',
    verificationNote: user.verificationNote ?? null,
    verificationAttempts: user.verificationAttempts ?? 0,
  };
}
