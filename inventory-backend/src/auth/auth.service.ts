import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

/** The relation set loaded for login / payload building (shared shape). */
const AUTH_USER_INCLUDE = {
  role: {
    include: {
      permissions: { include: { permission: true } },
    },
  },
  location: true,
  memberships: {
    include: {
      organization: true,
      role: { include: { permissions: { include: { permission: true } } } },
    },
  },
} satisfies Prisma.UserInclude;
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { buildTokenClaims, buildUserPayload } from '../common/user-payload.util';
import { looksLikeEmail, normalizePhone } from '../common/phone.util';
import { tr } from '../i18n/i18n.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SignupDto } from './dto/signup.dto';

const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60 * 1000;

interface FailedAttempt {
  count: number;
  blockedUntil: number;
}

@Injectable()
export class AuthService {
  private readonly failedLogins = new Map<string, FailedAttempt>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private notifications: NotificationsService,
    private tenants: TenantsService,
  ) {}

  private lockoutKey(email: string, ip?: string): string {
    return `${email.trim().toLowerCase()}|${ip ?? 'unknown'}`;
  }

  /**
   * Resolve a login identifier (email OR phone) to a user. Email is matched by
   * its unique key; phone is normalized and matched case-insensitively. A phone
   * that maps to more than one account is treated as not found, so we never
   * guess which account to sign in (the person can use their email instead).
   */
  private async findUserByIdentifier(
    identifier: string,
    include: typeof AUTH_USER_INCLUDE,
  ) {
    if (!identifier) return null;
    if (looksLikeEmail(identifier)) {
      return this.prisma.user.findUnique({
        where: { email: identifier.toLowerCase() },
        include,
      });
    }
    const phone = normalizePhone(identifier);
    if (!phone) return null;
    // Narrow the candidate set with a `contains` on the significant tail, then
    // confirm with a full normalized comparison (handles +251/0 prefixes and
    // separators). A phone shared by more than one account is ambiguous → null.
    const tail = phone.replace(/\D/g, '').slice(-9);
    const candidates = await this.prisma.user.findMany({
      where: { phone: { contains: tail } },
      include,
    });
    const matched = candidates.filter((u) => normalizePhone(u.phone) === phone);
    return matched.length === 1 ? matched[0] : null;
  }

  private isBlocked(key: string): boolean {
    const entry = this.failedLogins.get(key);
    if (!entry) return false;
    if (entry.blockedUntil > Date.now()) return true;
    this.failedLogins.delete(key);
    return false;
  }

  private recordFailure(key: string) {
    const entry = this.failedLogins.get(key) ?? { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILED_ATTEMPTS) {
      entry.blockedUntil = Date.now() + BLOCK_MS;
      entry.count = 0;
    }
    this.failedLogins.set(key, entry);
  }

  private clearFailures(key: string) {
    this.failedLogins.delete(key);
  }

  /**
   * Attach a live staff count (non-owner members) to each membership so the
   * frontend can hide the stock-request flow for owner-only businesses.
   */
  private async enrichStaffCounts(payload: JwtPayload): Promise<JwtPayload> {
    const orgIds = payload.memberships.map((m) => m.organizationId);
    if (!orgIds.length) return payload;
    const rows = await this.prisma.membership.groupBy({
      by: ['organizationId'],
      where: {
        organizationId: { in: orgIds },
        role: { isSystem: false },
        status: 'ACTIVE',
      },
      _count: { _all: true },
    });
    const byOrg = new Map(rows.map((r) => [r.organizationId, r._count._all]));
    return {
      ...payload,
      memberships: payload.memberships.map((m) => ({
        ...m,
        staffCount: byOrg.get(m.organizationId) ?? 0,
      })),
    };
  }

  private async audit(userId: number, action: string, details: string) {
    try {
      await this.prisma.auditLog.create({
        data: { userId, action, details },
      });
    } catch {
      // Audit logging must never break the primary flow.
    }
  }

  async register(dto: RegisterDto, caller: JwtPayload) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException(tr('errors.emailAlreadyExists'));
    }

    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!role) throw new BadRequestException(tr('errors.roleNotFound'));
    if (role.isSystem && !caller.isSuperuser) {
      throw new ForbiddenException(
        tr('errors.onlyOwnerCanAssignSystemRoles'),
      );
    }

    if (dto.locationId != null) {
      const location = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
      });
      if (!location) throw new BadRequestException(tr('errors.locationNotFound'));
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const tenantId = getCurrentTenantId();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        roleId: dto.roleId,
        locationId: dto.locationId,
        ...(dto.dailyAiQuota != null ? { dailyAiQuota: dto.dailyAiQuota } : {}),
      },
    });

    // Link the new staff member to the active organization via a membership.
    if (tenantId != null) {
      await this.prisma.membership.create({
        data: { userId: user.id, organizationId: tenantId, roleId: dto.roleId, status: UserStatus.ACTIVE },
      });
      // Every user is also a worker in the organization's employee roster.
      await this.prisma.worker.upsert({
        where: { userId: user.id },
        update: { organizationId: tenantId, name: dto.name, locationId: dto.locationId ?? null, status: UserStatus.ACTIVE },
        create: { organizationId: tenantId, userId: user.id, name: dto.name, title: null, locationId: dto.locationId ?? null, status: UserStatus.ACTIVE },
      });
    }
    await this.audit(
      caller.sub,
      'USER_CREATED',
      `Created user ${user.email} with role ${role.name}`,
    );

    return { message: 'User registered successfully', userId: user.id };
  }

  /**
   * Public self-registration for user (owner) accounts. No role is assigned
   * yet — the account starts PENDING verification and the platform admin is
   * notified to review it. An optional inline business (max 2 per owner) can
   * be created together with the account.
   */
  async signup(dto: SignupDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException(tr('errors.emailAlreadyExists'));
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        phone: normalizePhone(dto.phone),
        isOwnerAccount: true,
        isPlatformAdmin: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        isOwnerAccount: true,
        verificationStatus: true,
      },
    });

    // Optional inline business creation (owner's first business). The max-2
    // limit is enforced inside TenantsService.createOrganization.
    let business: { id: number; name: string } | null = null;
    if (dto.business?.name?.trim()) {
      const org = await this.tenants.createOrganization(
        user.id,
        {
          name: dto.business.name.trim(),
          businessType: dto.business.businessType,
          hospitalityServices: dto.business.hospitalityServices,
          standalone: dto.business.standalone ?? false,
        },
        { bypassBusinessLimit: false },
      );
      business = { id: org.id, name: org.name };
    }

    // Notify platform admins that a new account was created and needs review.
    await this.notifications.notifyAdmins(
      'New account created',
      `${user.name} (${user.email}${user.phone ? ` · ${user.phone}` : ''}) just signed up. Their account needs to be verified before they can operate.`,
      'ACCOUNT_VERIFICATION',
    );

    // Return a token so the client can immediately upload documents (the
    // verification endpoints are reachable by unverified accounts).
    const full = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        location: true,
        memberships: {
          include: {
            organization: true,
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    const payload = await this.enrichStaffCounts(buildUserPayload(full!));
    const access_token = this.jwtService.sign(buildTokenClaims(payload));

    return {
      message: 'Account created. Please complete verification.',
      access_token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roleId: payload.roleId,
        roleName: payload.roleName,
        isSuperuser: payload.isSuperuser,
        isPlatformAdmin: payload.isPlatformAdmin,
        isOwnerAccount: payload.isOwnerAccount,
        permissions: payload.permissions,
        locationId: payload.locationId,
        locationType: payload.locationType,
        organizationId: payload.organizationId,
        businessType: payload.businessType,
        preferredLanguage: payload.preferredLanguage ?? null,
        memberships: payload.memberships,
        verificationStatus: payload.verificationStatus,
        verificationNote: payload.verificationNote,
        verificationAttempts: payload.verificationAttempts,
      },
      business,
    };
  }

  async login(dto: LoginDto, ip?: string) {
    // The login identifier is an email OR a phone number. `identifier` is the
    // preferred field; `email` is kept as a fallback for older clients.
    const rawIdentifier = (dto.identifier ?? dto.email ?? '').trim();
    const key = this.lockoutKey(rawIdentifier, ip);
    if (this.isBlocked(key)) {
      throw new HttpException(
        tr('errors.tooManyAttempts'),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.findUserByIdentifier(rawIdentifier, AUTH_USER_INCLUDE);

    if (!user) {
      this.recordFailure(key);
      throw new UnauthorizedException(tr('errors.invalidCredentials'));
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password,
    );
    if (!isPasswordValid) {
      this.recordFailure(key);
      await this.audit(
        user.id,
        'LOGIN_FAILED',
        `Failed login attempt for ${user.email}`,
      );
      throw new UnauthorizedException(tr('errors.invalidCredentials'));
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException(tr('errors.accountInactive'));
    }

    this.clearFailures(key);

    const payload = await this.enrichStaffCounts(buildUserPayload(user));

    const token = this.jwtService.sign(buildTokenClaims(payload));

    return {
      access_token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roleId: payload.roleId,
        roleName: payload.roleName,
        isSuperuser: payload.isSuperuser,
        isPlatformAdmin: payload.isPlatformAdmin,
        isOwnerAccount: payload.isOwnerAccount,
        permissions: payload.permissions,
        locationId: payload.locationId,
        locationType: payload.locationType,
        organizationId: payload.organizationId,
        businessType: payload.businessType,
        preferredLanguage: payload.preferredLanguage ?? null,
        memberships: payload.memberships,
        verificationStatus: payload.verificationStatus,
        verificationNote: payload.verificationNote,
        verificationAttempts: payload.verificationAttempts,
      },
    };
  }

  async getProfile(userId: number) {
    const [user, washer] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          roleId: true,
          role: { select: { id: true, name: true, isSystem: true } },
          locationId: true,
          location: true,
        },
      }),
      this.prisma.carWashWasher.findFirst({
        where: { userId },
        select: { id: true },
      }),
    ]);
    if (!user) throw new UnauthorizedException(tr('errors.userNotFound'));
    // A washer may edit only their phone/name (email is the owner-controlled
    // login id) and may change their own password. The UI keys on `isWasher`.
    const isWasher = !!washer;
    return { ...user, isWasher, emailEditable: !isWasher };
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        location: true,
        memberships: {
          include: {
            organization: true,
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException(tr('errors.userNotFound'));

    const payload = await this.enrichStaffCounts(buildUserPayload(user));

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: payload.roleId,
      roleName: payload.roleName,
      isSuperuser: payload.isSuperuser,
      isPlatformAdmin: payload.isPlatformAdmin,
      isOwnerAccount: payload.isOwnerAccount,
      permissions: payload.permissions,
      locationId: payload.locationId,
      locationType: payload.locationType,
      organizationId: payload.organizationId,
      businessType: payload.businessType,
      preferredLanguage: user.preferredLanguage ?? null,
      memberships: payload.memberships,
      phone: user.phone,
      verificationStatus: payload.verificationStatus,
      verificationNote: payload.verificationNote,
      verificationAttempts: payload.verificationAttempts,
    };
  }

  async updateProfile(
    userId: number,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      preferredLanguage?: 'en' | 'am';
    },
  ) {
    // A washer may edit their own name/phone but NOT their login email (it is
    // the account identifier the owner controls). Owners/staff keep full edit.
    const washer = await this.prisma.carWashWasher.findFirst({
      where: { userId },
      select: { id: true },
    });
    const emailLocked = !!washer;

    if (data.email && !emailLocked) {
      const existing = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException(tr('errors.emailAlreadyExists'));
      }
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined && !emailLocked) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = normalizePhone(data.phone);
    if (data.preferredLanguage !== undefined) {
      updateData.preferredLanguage = data.preferredLanguage;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        preferredLanguage: true,
        roleId: true,
        locationId: true,
      },
    });
  }

  async changePassword(
    caller: JwtPayload,
    currentPassword: string,
    newPassword: string,
  ) {
    // Owners (superusers) may change their own password. Washers may too, so
    // staff can rotate their own credentials without the owner. Anyone else is
    // rejected (their password is managed by the business owner).
    if (!caller.isSuperuser) {
      const washer = await this.prisma.carWashWasher.findFirst({
        where: { userId: caller.sub },
        select: { id: true },
      });
      if (!washer) {
        throw new ForbiddenException(tr('errors.onlyOwnerCanChangePassword'));
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: caller.sub },
    });
    if (!user) throw new UnauthorizedException(tr('errors.userNotFound'));

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      throw new UnauthorizedException(tr('errors.currentPasswordIncorrect'));
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: caller.sub },
      data: { password: hashed },
    });
    await this.audit(
      caller.sub,
      'PASSWORD_CHANGED',
      'User changed their own password',
    );
    return { message: tr('errors.passwordChanged') };
  }
}
