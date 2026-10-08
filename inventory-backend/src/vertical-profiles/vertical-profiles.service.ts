// src/vertical-profiles/vertical-profiles.service.ts
// Reads/updates the 1:1 per-vertical profile table for an organization. The
// profile is lazily created on first read with the vertical's defaults, so
// existing org-creation code is untouched (zero-risk).
import { BadRequestException, Injectable } from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import { tr } from '../i18n/i18n.service';
import { PrismaService } from '../prisma/prisma.service';

// Prisma client delegate (camelCase) per business type — also the relation name
// on the Organization model.
const PROFILE_DELEGATE: Record<BusinessType, string> = {
  [BusinessType.RETAIL]: 'retailProfile',
  [BusinessType.HOSPITALITY]: 'hospitalityProfile',
  [BusinessType.MANUFACTURING]: 'manufacturingProfile',
  [BusinessType.SERVICE]: 'serviceProfile',
  [BusinessType.CAR_WASH]: 'carWashProfile',
};

// Scalar fields each profile table accepts when updating.
const PROFILE_FIELDS = new Set([
  'allowBarcodes',
  'enableLayaway',
  'kitchenPrint',
  'autoServiceTax',
  'enableTableMap',
  'trackBOM',
  'trackWorkOrders',
  'hourlyBilling',
  'appointmentSlot',
  'slotMinutes',
]);

@Injectable()
export class VerticalProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only lookup of the profile for the org's vertical. Returns `null`
   * when the org has no profile row yet. This is the safe call for read paths
   * such as the post-login business list: it never writes, so it can never
   * fail with a unique-constraint race or a missing-table error and take the
   * whole auth flow down with it.
   */
  async findProfile(orgId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { businessType: true },
    });
    if (!org) throw new BadRequestException(tr('errors.orgNotFound'));

    const delegate = this.delegate(org.businessType);
    const existing = await (this.prisma as any)[delegate].findUnique({
      where: { organizationId: orgId },
    });
    if (!existing) return null;
    return { businessType: org.businessType, ...existing };
  }

  /**
   * Get (lazy-create) the profile for the org's vertical.
   *
   * Uses `upsert` instead of find-then-create so two concurrent first reads
   * (e.g. `/auth/me` + `/tenants/me` racing right after login) cannot both try
   * to INSERT and collide on `organizationId`.
   */
  async getProfile(orgId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { businessType: true },
    });
    if (!org) throw new BadRequestException(tr('errors.orgNotFound'));

    const delegate = this.delegate(org.businessType);
    const profile = await (this.prisma as any)[delegate].upsert({
      where: { organizationId: orgId },
      update: {},
      create: { organizationId: orgId },
    });
    return { businessType: org.businessType, ...profile };
  }

  /** Update only the known profile fields for the org's vertical. */
  async updateProfile(orgId: number, data: Record<string, unknown>) {
    const profile = await this.getProfile(orgId);
    const delegate = this.delegate(profile.businessType as BusinessType);

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data ?? {})) {
      if (PROFILE_FIELDS.has(key)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(tr('errors.noProfileFields'));
    }

    return (this.prisma as any)[delegate].update({
      where: { organizationId: orgId },
      data: patch,
    });
  }

  private delegate(businessType: BusinessType): string {
    return PROFILE_DELEGATE[businessType] ?? 'retailProfile';
  }
}
