// src/admin/admin.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { BusinessType, OrgStatus, UserStatus, VerificationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { getVerticalLabel } from '../common/verticals';
import { UploadedFileShape } from '../verification/verification-upload.config';
import { VerificationService } from '../verification/verification.service';
import { CreateOrgForOwnerDto, CreateOwnerDto, UpdateOrganizationDto, UpdateUserDto } from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private tenants: TenantsService,
    private notifications: NotificationsService,
    private verification: VerificationService,
  ) {}

  // --- Owner accounts (platform-level users) ---
  async listUsers() {
    return this.prisma.user.findMany({
      where: { isOwnerAccount: true },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isPlatformAdmin: true,
        isOwnerAccount: true,
        aiTrialEndsAt: true,
        dailyAiQuota: true,
        createdAt: true,
        memberships: {
          select: {
            organizationId: true,
            organization: { select: { name: true } },
            role: { select: { name: true } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  async createOwner(dto: CreateOwnerDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already exists');

    const password = await bcrypt.hash(dto.password, 10);
    // Default the AI free trial to 15 days from creation; the admin can also
    // set an explicit end date manually.
    const aiTrialEndsAt = dto.aiTrialEndsAt
      ? new Date(dto.aiTrialEndsAt)
      : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const created = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password,
        isPlatformAdmin: false,
        isOwnerAccount: true,
        aiTrialEndsAt,
        ...(dto.dailyAiQuota != null ? { dailyAiQuota: dto.dailyAiQuota } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isOwnerAccount: true,
        aiTrialEndsAt: true,
        dailyAiQuota: true,
      },
    });

    // Notify platform admins that a new account was created.
    await this.notifications.notifyAdmins(
      'New account created',
      `${dto.name} (${dto.email}) just created an account. It will need to complete verification before operating.`,
      'ACCOUNT_VERIFICATION',
    );

    return created;
  }

  async updateUserStatus(id: number, status: UserStatus) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.isOwnerAccount) throw new BadRequestException('Only owner accounts are managed here');
    if (user.isPlatformAdmin && status === UserStatus.INACTIVE) {
      throw new BadRequestException('Cannot deactivate a platform admin');
    }
    return this.prisma.user.update({ where: { id }, data: { status }, select: { id: true, status: true } });
  }

  async updateUser(id: number, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.isOwnerAccount) throw new BadRequestException('Only owner accounts are managed here');

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException('Email already exists');
    }

    const data: {
      name?: string;
      email?: string;
      password?: string;
      aiTrialEndsAt?: Date | null;
      dailyAiQuota?: number | null;
    } = {};
    if (dto.name) data.name = dto.name;
    if (dto.email) data.email = dto.email;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if ('aiTrialEndsAt' in dto) {
      data.aiTrialEndsAt = dto.aiTrialEndsAt ? new Date(dto.aiTrialEndsAt) : null;
    }
    if ('dailyAiQuota' in dto) {
      data.dailyAiQuota = dto.dailyAiQuota ?? null;
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        aiTrialEndsAt: true,
        dailyAiQuota: true,
      },
    });
  }

  async deleteUser(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { memberships: { select: { role: { select: { isSystem: true } } } } },
    });
    if (!user) throw new BadRequestException('User not found');
    if (!user.isOwnerAccount) throw new BadRequestException('Only owner accounts are managed here');
    if (user.isPlatformAdmin) throw new BadRequestException('Cannot delete a platform admin');

    const ownsBusiness = user.memberships.some((m) => m.role?.isSystem);
    if (ownsBusiness) {
      throw new BadRequestException('This owner owns businesses; delete those businesses first');
    }

    await this.prisma.$transaction([
      this.prisma.auditLog.deleteMany({ where: { userId: id } }),
      this.prisma.user.delete({ where: { id } }),
    ]);
    return { id };
  }

  // --- Businesses ---
  async listOrganizations() {
    const orgs = await this.prisma.organization.findMany({
      include: {
        memberships: {
          where: { role: { isSystem: true } },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { id: 'desc' },
    });
    return orgs.map((o) => ({ ...o, label: getVerticalLabel(o.businessType) }));
  }

  async createOrganizationForOwner(dto: CreateOrgForOwnerDto) {
    const owner = await this.prisma.user.findUnique({ where: { id: dto.ownerUserId } });
    if (!owner) throw new BadRequestException('Owner account not found');

    return this.tenants.createOrganization(
      dto.ownerUserId,
      {
        name: dto.name,
        businessType: dto.businessType,
        hospitalityServices: dto.hospitalityServices,
        standalone: dto.standalone ?? false,
      },
      {
        bypassBusinessLimit: true,
        aiEnabled: dto.aiEnabled,
        aiTrialEndsAt: dto.aiTrialEndsAt === undefined
          ? undefined
          : dto.aiTrialEndsAt === null
            ? null
            : new Date(dto.aiTrialEndsAt),
      },
    );
  }

  async updateOrganizationStatus(id: number, status: OrgStatus) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new BadRequestException('Organization not found');

    return this.prisma.organization.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, status: true },
    });
  }

  async updateOrganization(id: number, dto: UpdateOrganizationDto) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new BadRequestException('Organization not found');

    const data: { name?: string; businessType?: BusinessType; aiEnabled?: boolean; aiTrialEndsAt?: Date | null } = {};
    if (dto.name) data.name = dto.name;
    if (dto.businessType) data.businessType = dto.businessType;
    if (dto.aiEnabled !== undefined) data.aiEnabled = dto.aiEnabled;
    if ('aiTrialEndsAt' in dto) {
      data.aiTrialEndsAt = dto.aiTrialEndsAt ? new Date(dto.aiTrialEndsAt) : null;
    }

    return this.prisma.organization.update({
      where: { id },
      data,
      select: { id: true, name: true, businessType: true, status: true, aiEnabled: true, aiTrialEndsAt: true },
    });
  }

  async assignOwner(organizationId: number, ownerUserId: number) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new BadRequestException('Organization not found');

    const owner = await this.prisma.user.findUnique({ where: { id: ownerUserId } });
    if (!owner) throw new BadRequestException('Owner account not found');

    // Find (or create) the Owner role scoped to this organization.
    let ownerRole = await this.prisma.role.findFirst({
      where: { organizationId, isSystem: true },
    });
    if (!ownerRole) {
      ownerRole = await this.prisma.role.create({
        data: {
          name: 'Owner',
          systemKey: 'OWNER',
          description: 'Full access to everything',
          isSystem: true,
          organizationId,
        },
      });
    }

    await this.prisma.membership.upsert({
      where: { userId_organizationId: { userId: ownerUserId, organizationId } },
      create: { userId: ownerUserId, organizationId, roleId: ownerRole.id, status: UserStatus.ACTIVE },
      update: { roleId: ownerRole.id, status: UserStatus.ACTIVE },
    });

    await this.prisma.user.update({
      where: { id: ownerUserId },
      data: { isOwnerAccount: true },
    });

    return { organizationId, ownerUserId };
  }

  async deleteOrganization(id: number) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new BadRequestException('Organization not found');

    await this.prisma.$transaction(async (tx) => {
      const tenantId = id;

      // Delete tenant data in dependency order (children before parents).
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

      // Memberships and roles scoped to this organization.
      await tx.membership.deleteMany({ where: { organizationId: id } });
      await tx.role.deleteMany({ where: { organizationId: id } });

      // Finally, the organization itself.
      await tx.organization.delete({ where: { id } });
    });

    return { id };
  }

  // --- Account verification review queue (platform admin only) ---

  async listVerification(status?: string) {
    return this.verification.adminList(status);
  }

  async approveUserVerification(userId: number) {
    return this.verification.adminApproveUser(userId);
  }

  async rejectUserVerification(userId: number, reason: string) {
    return this.verification.adminRejectUser(userId, reason);
  }

  async approveBusinessVerification(organizationId: number) {
    return this.verification.adminApproveBusiness(organizationId);
  }

  async rejectBusinessVerification(organizationId: number, reason: string) {
    return this.verification.adminRejectBusiness(organizationId, reason);
  }

  async setVerificationStatus(
    accountType: 'USER' | 'BUSINESS',
    accountId: number,
    status: VerificationStatus,
    note?: string,
  ) {
    return this.verification.adminSetStatus(accountType, accountId, status, note);
  }

  async uploadUserVerificationDocument(userId: number, file: UploadedFileShape) {
    return this.verification.uploadUserDocument(userId, file);
  }

  async uploadBusinessVerificationDocument(
    adminUserId: number,
    organizationId: number,
    file: UploadedFileShape,
    documentType: 'TRADE_LICENSE' | 'TIN_CERTIFICATE',
  ) {
    return this.verification.adminUploadBusinessDocument(
      adminUserId,
      organizationId,
      file,
      documentType,
    );
  }
}

