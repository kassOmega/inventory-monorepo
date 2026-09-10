// src/tenants/tenants.service.ts
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BusinessType, LocationType, UserStatus } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '../common/permissions';
import { DEFAULT_MENU_CATEGORIES, getDefaultAccounts, VERTICALS } from '../common/verticals';
import { NotificationsService } from '../notifications/notifications.service';
import { seedAccountMappings } from '../finance/account-mapping.constants';
import { PrismaService } from '../prisma/prisma.service';
import { VerticalProfilesService } from '../vertical-profiles/vertical-profiles.service';
import { getVerticalLabel } from '../common/verticals';
import { tr } from '../i18n/i18n.service';
import { CreateOrganizationDto, UpdateMyOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private profiles: VerticalProfilesService,
  ) {}

  async myOrganizations(userId: number) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true, role: true },
      orderBy: { id: 'asc' },
    });

    return Promise.all(
      memberships.map(async (m) => {
        let profile: Record<string, unknown> | null = null;
        try {
          profile = await this.profiles.getProfile(m.organizationId);
        } catch {
          // profile is optional in the list response
        }
        return {
          organizationId: m.organizationId,
          name: m.organization.name,
          slug: m.organization.slug,
          businessType: m.organization.businessType,
          defaultLanguage: m.organization.defaultLanguage ?? 'en',
          label: getVerticalLabel(m.organization.businessType),
          roleId: m.roleId,
          roleName: m.role?.name ?? null,
          isSystem: m.role?.isSystem ?? false,
          aiEnabled: m.organization.aiEnabled,
          aiTrialEndsAt: m.organization.aiTrialEndsAt
            ? m.organization.aiTrialEndsAt.toISOString().slice(0, 10)
            : null,
          verificationStatus: m.organization.verificationStatus,
          profile,
        };
      }),
    );
  }

  async createOrganization(
    ownerUserId: number,
    dto: CreateOrganizationDto,
    opts?: {
      bypassBusinessLimit?: boolean;
      aiEnabled?: boolean;
      aiTrialEndsAt?: Date | null;
    },
  ) {
    const slug = (dto.slug ?? this.slugify(dto.name)).toLowerCase();

    const existing = await this.prisma.organization.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException(tr('errors.slugInUse'));

    // Owners can create up to 2 businesses themselves; beyond that they must
    // contact the admin (who creates additional businesses for them). Admin
    // created organizations bypass this limit.
    if (!opts?.bypassBusinessLimit) {
      const ownedCount = await this.prisma.membership.count({
        where: { userId: ownerUserId, role: { isSystem: true } },
      });
      if (ownedCount >= 2) {
        throw new ForbiddenException(tr('errors.orgLimitReached'));
      }
    }

    // The 15-day AI free trial is inherited from the owner account's manually
    // set trial end date (set when the user is created), else defaults to +15d.
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { aiTrialEndsAt: true },
    });

    const createdOrg = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
          businessType: dto.businessType ?? BusinessType.RETAIL,
          standalone: dto.standalone ?? false,
          defaultLanguage: dto.defaultLanguage ?? 'en',
          aiEnabled: opts?.aiEnabled ?? true,
          aiTrialEndsAt:
            opts?.aiTrialEndsAt !== undefined
              ? opts.aiTrialEndsAt
              : owner?.aiTrialEndsAt ?? this.defaultAiTrialEnd(),
        },
      });

      // Ensure the permission catalog exists, then clone default roles.
      const permissionIdByKey: Record<string, number> = {};
      for (const p of PERMISSIONS) {
        const perm = await tx.permission.upsert({
          where: { key: p.key },
          update: { label: p.label, group: p.group },
          create: { key: p.key, label: p.label, group: p.group },
        });
        permissionIdByKey[p.key] = perm.id;
      }

      const vertical = VERTICALS[org.businessType] ?? VERTICALS[BusinessType.RETAIL];

      const link = async (roleId: number, keys: string[]) => {
        await tx.rolePermission.createMany({
          data: keys.map((key) => ({ roleId, permissionId: permissionIdByKey[key] })),
        });
      };

      // Clone the sector-specific default roles into the new organization.
      let ownerRoleId: number | null = null;
      for (const roleDef of vertical.defaultRoles) {
        const role = await tx.role.create({
          data: {
            name: roleDef.name,
            description: roleDef.description,
            isSystem: roleDef.isSystem ?? false,
            organizationId: org.id,
          },
        });
        await link(role.id, DEFAULT_ROLE_PERMISSIONS[roleDef.permissionKey] ?? []);
        if (roleDef.name === 'Owner') ownerRoleId = role.id;
      }

      // Seed the default chart of accounts for this vertical.
      const accounts = getDefaultAccounts(org.businessType);
      await tx.account.createMany({
        data: accounts.map((a) => ({
          tenantId: org.id,
          name: a.name,
          code: a.code,
          type: a.type,
          isSystem: a.isSystem ?? false,
        })),
        skipDuplicates: true,
      });

      // Auto-configure the default account mappings so every operational
      // transaction posts without any manual chart setup.
      await seedAccountMappings(tx, org.id);

      // Hospitality businesses start with the standard menu categories.
      if (org.businessType === BusinessType.HOSPITALITY) {
        // Default stations first (Kitchen / Bar / Barista) so categories can
        // reference them.
        const stationDefs = [
          {
            name: 'Kitchen',
            key: 'kitchen',
            roleName: 'Chef',
            sortOrder: 0,
            nameI18n: { en: 'Kitchen', am: 'ኩሽና' },
            roleNameI18n: { en: 'Chef', am: 'ሼፍ' },
          },
          {
            name: 'Bar',
            key: 'bar',
            roleName: 'Barman',
            sortOrder: 1,
            nameI18n: { en: 'Bar', am: 'ባር' },
            roleNameI18n: { en: 'Barman', am: 'ባርሜን' },
          },
          {
            name: 'Barista',
            key: 'barista',
            roleName: 'Barista',
            sortOrder: 2,
            nameI18n: { en: 'Barista', am: 'ባሪስታ' },
            roleNameI18n: { en: 'Barista', am: 'ባሪስታ' },
          },
        ];
        const stationByKey = new Map<string, { id: number; name: string; key: string }>();
        for (const s of stationDefs) {
          const row = await tx.restaurantStation.create({
            data: { tenantId: org.id, ...s },
          });
          stationByKey.set(s.key, { id: row.id, name: row.name, key: row.key });
        }
        for (const c of DEFAULT_MENU_CATEGORIES) {
          const st = stationByKey.get(c.stationKey);
          if (!st) continue;
          await tx.menuCategory.create({
            data: {
              tenantId: org.id,
              name: c.name,
              nameI18n: { en: c.name, am: c.amName ?? c.name },
              sortOrder: DEFAULT_MENU_CATEGORIES.indexOf(c),
              stationId: st.id,
              stationRoute: [{ id: st.id, name: st.name, key: st.key }],
            },
          });
        }

        // Sub-category hierarchy for the finance breakdown: Beer / Wine /
        // Spirits / Hot Drinks become children of a "Beverages" parent so the
        // Finance & Reports pages can filter deep sub-categories per industry.
        const beveragesParent = await tx.menuCategory.create({
          data: {
            tenantId: org.id,
            name: 'Beverages',
            nameI18n: { en: 'Beverages', am: 'መጠጦች' },
            sortOrder: 50,
            stationId: stationByKey.get('bar')?.id ?? null,
            stationRoute: stationByKey.has('bar')
              ? [{ id: stationByKey.get('bar')!.id, name: 'Bar', key: 'bar' }]
              : [],
          },
        });
        const beverageChildren = [
          { name: 'Water', am: 'ውሃ' },
          { name: 'Beer', am: 'ቢራ' },
          { name: 'Wine', am: 'ወይን ጠጅ' },
          { name: 'Alcohol', am: 'አልኮል' },
          { name: 'Hot Drinks', am: 'ሙቅ መጠጦች' },
          { name: 'Latte', am: 'ላቴ' },
        ];
        await tx.menuCategory.updateMany({
          where: { tenantId: org.id, name: { in: beverageChildren.map((c) => c.name) } },
          data: { parentId: beveragesParent.id },
        });

        // And the standard inventory categories for goods / beverages / ingredients.
        await tx.category.createMany({
          data: [
            { tenantId: org.id, name: 'Goods', nameI18n: { en: 'Goods', am: 'ዕቃዎች' } },
            { tenantId: org.id, name: 'Beverages', nameI18n: { en: 'Beverages', am: 'መጠጦች' } },
            { tenantId: org.id, name: 'Ingredients', nameI18n: { en: 'Ingredients', am: 'ግብዓቶች' } },
          ],
          skipDuplicates: true,
        });
      }

      // The creating user becomes the Owner of the new organization.
      await tx.membership.create({
        data: { userId: ownerUserId, organizationId: org.id, roleId: ownerRoleId!, status: UserStatus.ACTIVE },
      });

      // A standalone shop is its own single SHOP location so the owner can add
      // products and restock immediately (restock auto-updates inventory).
      if (org.standalone) {
        await tx.location.create({
          data: {
            name: `${org.name} Shop`,
            type: LocationType.SHOP,
            tenantId: org.id,
          },
        });
      }

      return org;
    });

    // Notify platform admins that a new business account was created.
    await this.notifications.notifyAdmins(
      'New business created',
      `A new business "${createdOrg.name}" (${createdOrg.businessType}) was created. It must complete verification before it can operate.`,
      'ACCOUNT_VERIFICATION',
    );

    return createdOrg;
  }
  async findAllOrganizations() {
    return this.prisma.organization.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        businessType: true,
        status: true,
        aiEnabled: true,
        aiTrialEndsAt: true,
        createdAt: true,
      },
    });
  }

  private async assertOwner(organizationId: number, userId: number) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { role: true },
    });
    if (!membership || !membership.role?.isSystem) {
      throw new ForbiddenException('Only the owner of this business can perform this action');
    }
    return membership;
  }

  async getOrganization(organizationId: number, userId: number) {
    await this.assertOwner(organizationId, userId);
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        businessType: true,
        defaultLanguage: true,
        status: true,
        settings: true,
        aiEnabled: true,
        aiTrialEndsAt: true,
      },
    });
    if (!org) throw new BadRequestException('Organization not found');
    let profile: Record<string, unknown> | null = null;
    try {
      profile = await this.profiles.getProfile(organizationId);
    } catch {
      // profile is optional
    }
    return { ...org, label: getVerticalLabel(org.businessType), profile };
  }

  async updateOrganization(organizationId: number, userId: number, dto: UpdateMyOrganizationDto) {
    await this.assertOwner(organizationId, userId);
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new BadRequestException('Organization not found');

    // Upgrading a standalone shop to a multi-location business: the owner names
    // the current (hidden) location and all existing inventory stays with it.
    if (dto.standalone === false && org.standalone === true) {
      const locationName = dto.locationName?.trim();
      if (!locationName) {
        throw new BadRequestException(
          'Please name the current location to complete the upgrade.',
        );
      }
      const locations = await this.prisma.location.findMany({
        where: { tenantId: organizationId },
      });
      if (locations.length === 1) {
        await this.prisma.location.update({
          where: { id: locations[0].id },
          data: { name: locationName },
        });
      } else if (locations.length === 0) {
        await this.prisma.location.create({
          data: {
            name: locationName,
            type: LocationType.SHOP,
            tenantId: organizationId,
          },
        });
      }
      // (more than one location: leave them untouched)
    }

    // Downgrading is only allowed while the business is effectively still a
    // single-location, owner-only shop.
    if (dto.standalone === true && org.standalone === false) {
      const [locationCount, staffCount] = await Promise.all([
        this.prisma.location.count({ where: { tenantId: organizationId } }),
        this.prisma.membership.count({
          where: {
            organizationId,
            role: { isSystem: false },
            status: 'ACTIVE',
          },
        }),
      ]);
      if (locationCount > 1 || staffCount > 0) {
        throw new BadRequestException(
          'This business has multiple locations or staff and can no longer be marked as a standalone shop.',
        );
      }
    }

    const data: { name?: string; businessType?: BusinessType; standalone?: boolean } = {};
    if (dto.name) data.name = dto.name;
    if (dto.businessType) data.businessType = dto.businessType;
    if (dto.standalone !== undefined) data.standalone = dto.standalone;

    return this.prisma.organization.update({
      where: { id: organizationId },
      data,
      select: { id: true, name: true, businessType: true, status: true, standalone: true },
    });
  }

  async updateSettings(organizationId: number, userId: number, settings: Record<string, unknown>) {
    await this.assertOwner(organizationId, userId);
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: { settings: settings as object },
      select: { id: true, settings: true },
    });
  }

  async updateProfile(organizationId: number, userId: number, data: Record<string, unknown>) {
    await this.assertOwner(organizationId, userId);
    return this.profiles.updateProfile(organizationId, data);
  }

  async deleteOrganization(organizationId: number, userId: number) {
    await this.assertOwner(organizationId, userId);

    await this.prisma.$transaction(async (tx) => {
      const tenantId = organizationId;
      await tx.orderPayment.deleteMany({ where: { tenantId } });
      await tx.orderItem.deleteMany({ where: { tenantId } });
      await tx.journalLine.deleteMany({ where: { tenantId } });
      await tx.expense.deleteMany({ where: { tenantId } });
      await tx.otherIncome.deleteMany({ where: { tenantId } });
      await tx.folioEntry.deleteMany({ where: { tenantId } });
      await tx.cashFloat.deleteMany({ where: { tenantId } });
      await tx.cashCollection.deleteMany({ where: { tenantId } });
      await tx.order.deleteMany({ where: { tenantId } });
      await tx.journalEntry.deleteMany({ where: { tenantId } });
      await tx.folio.deleteMany({ where: { tenantId } });
      await tx.returnItem.deleteMany({ where: { tenantId } });
      await tx.return.deleteMany({ where: { tenantId } });
      await tx.saleItem.deleteMany({ where: { tenantId } });
      await tx.sale.deleteMany({ where: { tenantId } });
      await tx.creditSaleItem.deleteMany({ where: { tenantId } });
      await tx.creditPayment.deleteMany({ where: { tenantId } });
      await tx.creditSale.deleteMany({ where: { tenantId } });
      await tx.menuItemOption.deleteMany({ where: { tenantId } });
      await tx.menuItem.deleteMany({ where: { tenantId } });
      await tx.requestItem.deleteMany({ where: { tenantId } });
      await tx.stockRequest.deleteMany({ where: { tenantId } });
      await tx.inventory.deleteMany({ where: { tenantId } });
      await tx.priceHistory.deleteMany({ where: { tenantId } });
      await tx.purchase.deleteMany({ where: { tenantId } });
      await tx.reservation.deleteMany({ where: { tenantId } });
      await tx.hotelReservation.deleteMany({ where: { tenantId } });
      await tx.room.deleteMany({ where: { tenantId } });
      await tx.roomType.deleteMany({ where: { tenantId } });
      await tx.diningTable.deleteMany({ where: { tenantId } });
      await tx.menuCategory.deleteMany({ where: { tenantId } });
      await tx.account.deleteMany({ where: { tenantId } });
      await tx.customer.deleteMany({ where: { organizationId: tenantId } });
      await tx.paymentMethod.deleteMany({ where: { tenantId } });
      await tx.notification.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.product.deleteMany({ where: { tenantId } });
      await tx.category.deleteMany({ where: { tenantId } });
      await tx.unit.deleteMany({ where: { tenantId } });
      await tx.location.deleteMany({ where: { tenantId } });
      await tx.locationCategory.deleteMany({ where: { tenantId } });
      await tx.membership.deleteMany({ where: { organizationId } });
      await tx.role.deleteMany({ where: { organizationId } });
      await tx.organization.delete({ where: { id: organizationId } });
    });

    return { id: organizationId };
  }

  private slugify(name: string) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private defaultAiTrialEnd(): Date {
    return new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  }
}
