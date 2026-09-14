// src/facilities/facilities.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FacilityVisitType,
  HospitalityServiceType,
  MembershipStatus,
} from '@prisma/client';
import { readHospitalityPolicy } from '../common/hospitality-settings';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PackagesService } from '../packages/packages.service';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto } from './dto/facility.dto';

@Injectable()
export class FacilitiesService {
  constructor(
    private prisma: PrismaService,
    private packages: PackagesService,
  ) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  private async getServiceOrThrow(serviceId: string) {
    const tenantId = this.tenant();
    const svc = await this.prisma.hospitalityService.findFirst({
      where: { id: serviceId, organizationId: tenantId },
    });
    if (!svc) throw new NotFoundException('Facility service not found');
    return svc;
  }

  private async expireOverdue(tenantId: number) {
    await this.prisma.customerMembership.updateMany({
      where: {
        organizationId: tenantId,
        status: MembershipStatus.ACTIVE,
        endDate: { lt: new Date() },
      },
      data: { status: MembershipStatus.EXPIRED },
    });
  }

  /** Occupancy, active memberships, revenue today and available day passes. */
  async getDashboard(serviceId: string) {
    const tenantId = this.tenant();
    await this.getServiceOrThrow(serviceId);
    await this.expireOverdue(tenantId);

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [activeVisits, activeMemberships, revenueToday, dayPassTypes] =
      await Promise.all([
        this.prisma.facilityVisit.findMany({
          where: {
            organizationId: tenantId,
            hospitalityServiceId: serviceId,
            checkOutAt: null,
          },
          include: {
            customer: true,
            customerMembership: { include: { membershipType: true } },
          },
          orderBy: { checkInAt: 'desc' },
        }),
        this.prisma.customerMembership.findMany({
          where: {
            organizationId: tenantId,
            status: MembershipStatus.ACTIVE,
            membershipType: { hospitalityServiceId: serviceId },
          },
          include: { customer: true, membershipType: true },
          orderBy: { endDate: 'asc' },
        }),
        this.prisma.facilityPayment.aggregate({
          where: {
            tenantId,
            hospitalityServiceId: serviceId,
            status: 'CONFIRMED',
            confirmedAt: { gte: startOfToday },
          },
          _sum: { amount: true },
        }),
        this.prisma.membershipType.findMany({
          where: {
            organizationId: tenantId,
            hospitalityServiceId: serviceId,
            isActive: true,
            durationDays: { lte: 1 },
          },
          orderBy: { price: 'asc' },
        }),
      ]);

    return {
      serviceId,
      occupancy: activeVisits,
      occupancyCount: activeVisits.length,
      activeMemberships,
      activeMembershipCount: activeMemberships.length,
      revenueToday: revenueToday._sum.amount ?? 0,
      dayPassTypes,
    };
  }

  /** Check in a member (active pass), a package guest, or a walk-in day pass. */
  async checkIn(serviceId: string, dto: CheckInDto, userId: number) {
    const tenantId = this.tenant();
    const service = await this.getServiceOrThrow(serviceId);

    // Package guest: consume the entitlement at $0, route any overage.
    if (dto.type === FacilityVisitType.PACKAGE || dto.packageGuestId) {
      return this.checkInPackageGuest(service, dto, userId);
    }

    if (dto.type === FacilityVisitType.MEMBER) {
      if (!dto.membershipId)
        throw new BadRequestException('Select a member to check in.');
      const membership = await this.prisma.customerMembership.findFirst({
        where: {
          id: dto.membershipId,
          organizationId: tenantId,
          status: MembershipStatus.ACTIVE,
          membershipType: { hospitalityServiceId: serviceId },
        },
        include: { customer: true },
      });
      if (!membership) {
        throw new BadRequestException(
          'No active membership found for this facility.',
        );
      }
      return this.prisma.facilityVisit.create({
        data: {
          organizationId: tenantId,
          hospitalityServiceId: serviceId,
          type: FacilityVisitType.MEMBER,
          customerId: membership.customerId,
          customerMembershipId: membership.id,
        },
        include: {
          customer: true,
          customerMembership: { include: { membershipType: true } },
        },
      });
    }

    // WALK_IN — sell a day pass and queue the payment for cashier confirmation.
    if (!dto.dayPassTypeId)
      throw new BadRequestException('Select a day pass for walk-in entry.');
    const pass = await this.prisma.membershipType.findFirst({
      where: {
        id: dto.dayPassTypeId,
        organizationId: tenantId,
        hospitalityServiceId: serviceId,
        isActive: true,
      },
    });
    if (!pass) throw new NotFoundException('Day pass not found');
    const guestName = dto.guestName?.trim();
    if (!guestName)
      throw new BadRequestException(
        'Guest name is required for walk-in entry.',
      );

    let customer = dto.guestPhone
      ? await this.prisma.customer.findFirst({
          where: { organizationId: tenantId, phone: dto.guestPhone },
        })
      : null;
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          organizationId: tenantId,
          name: guestName,
          phone: dto.guestPhone,
        },
      });
    }

    const start = new Date();
    const endDate = new Date(
      start.getTime() + pass.durationDays * 24 * 60 * 60 * 1000,
    );

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.customerMembership.create({
        data: {
          organizationId: tenantId,
          customerId: customer!.id,
          membershipTypeId: pass.id,
          startDate: start,
          endDate,
        },
      });
      const visit = await tx.facilityVisit.create({
        data: {
          organizationId: tenantId,
          hospitalityServiceId: serviceId,
          type: FacilityVisitType.WALK_IN,
          customerId: customer!.id,
          customerMembershipId: membership.id,
          guestName,
          guestPhone: dto.guestPhone,
        },
      });
      await tx.facilityPayment.create({
        data: {
          tenantId,
          facilityVisitId: visit.id,
          hospitalityServiceId: serviceId,
          amount: pass.price,
          paymentMethodId: dto.paymentMethodId ?? null,
          collectedById: userId,
          notes: `Day pass — ${pass.name}`,
        },
      });
      return tx.facilityVisit.findUnique({
        where: { id: visit.id },
        include: {
          customer: true,
          customerMembership: { include: { membershipType: true } },
        },
      });
    });
  }

  /**
   * Package check-in: consume the guest's PASS/CREDIT entitlement for this
   * service at $0. Any uncovered amount is routed by `settlementMode`:
   *  - DEFER_TO_FOLIO posts an itemized line to the guest's room folio.
   *  - PAY_NOW queues a facility payment for the cashier to confirm.
   */
  private async checkInPackageGuest(
    service: { id: string; serviceType: HospitalityServiceType },
    dto: CheckInDto,
    userId: number,
  ) {
    const tenantId = this.tenant();
    if (!dto.packageGuestId) {
      throw new BadRequestException('Select the package guest to check in.');
    }
    const guest = await this.prisma.packageGuest.findFirst({
      where: {
        id: dto.packageGuestId,
        organizationId: tenantId,
        status: 'CHECKED_IN',
      },
      include: { folio: true },
    });
    if (!guest) {
      throw new NotFoundException('Package guest not found for this business.');
    }

    // Charge = explicit amount, else the selected day-pass price, else 0.
    let amount = dto.amount ?? 0;
    let passName: string | null = null;
    let membershipTypeId: string | null = null;
    if (dto.dayPassTypeId) {
      const pass = await this.prisma.membershipType.findFirst({
        where: {
          id: dto.dayPassTypeId,
          organizationId: tenantId,
          hospitalityServiceId: service.id,
        },
      });
      if (!pass) throw new NotFoundException('Day pass not found');
      passName = pass.name;
      membershipTypeId = pass.id;
      if (dto.amount == null) amount = pass.price;
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const policy = readHospitalityPolicy(
      org?.settings as Record<string, unknown> | null,
    );
    const settlementMode =
      dto.settlementMode ??
      (policy.enableRoomFolioCharging ? 'DEFER_TO_FOLIO' : 'PAY_NOW');
    const guestName = dto.guestName?.trim() || guest.guestName;
    const itemName = passName ?? `${service.serviceType} visit`;

    return this.prisma.$transaction(async (tx) => {
      const coverage = await this.packages.computeFacilityEntitlement(tx, {
        organizationId: tenantId,
        packageGuestId: guest.id,
        hospitalityServiceId: service.id,
        membershipTypeId,
        amount,
      });

      const visit = await tx.facilityVisit.create({
        data: {
          organizationId: tenantId,
          hospitalityServiceId: service.id,
          type: FacilityVisitType.PACKAGE,
          packageGuestId: guest.id,
          guestName,
          guestPhone: dto.guestPhone,
        },
      });

      let folioEntryId: string | null = null;
      let paymentId: number | null = null;

      if (coverage.netCharge > 0) {
        if (settlementMode === 'DEFER_TO_FOLIO') {
          if (!guest.folio) {
            throw new BadRequestException(
              'This guest has no open folio — check them in under a package first.',
            );
          }
          const entry = await tx.guestFolioEntry.create({
            data: {
              folioId: guest.folio.id,
              itemName,
              quantity: 1,
              sourceService: service.serviceType,
              unitPrice: coverage.netCharge,
              grossPrice: amount,
              packageDiscount: coverage.packageDiscount,
              netCharge: coverage.netCharge,
              // Staff member who posted the visit to the guest's folio.
              createdById: userId,
            },
          });
          folioEntryId = entry.id;
          await tx.guestFolio.update({
            where: { id: guest.folio.id },
            data: {
              totalAddOns: { increment: coverage.netCharge },
              totalPackageDiscount: { increment: coverage.packageDiscount },
            },
          });
        } else {
          const payment = await tx.facilityPayment.create({
            data: {
              tenantId,
              facilityVisitId: visit.id,
              hospitalityServiceId: service.id,
              amount: coverage.netCharge,
              paymentMethodId: dto.paymentMethodId ?? null,
              collectedById: userId,
              notes: `${passName ? `Day pass — ${passName}` : itemName}${
                coverage.packageDiscount > 0
                  ? ` (package covered ${coverage.packageDiscount})`
                  : ''
              }`,
            },
          });
          paymentId = payment.id;
        }
      }

      return {
        visitId: visit.id,
        type: FacilityVisitType.PACKAGE,
        guestName,
        roomNumber: guest.roomNumber,
        covered: coverage.covered,
        entitlementId: coverage.entitlementId,
        entitlementKind: coverage.entitlementKind,
        grossAmount: amount,
        packageDiscount: coverage.packageDiscount,
        netCharge: coverage.netCharge,
        settlementMode: coverage.netCharge > 0 ? settlementMode : 'COVERED',
        folioEntryId,
        paymentId,
      };
    });
  }

  async checkOut(serviceId: string, visitId: string) {
    const tenantId = this.tenant();
    const visit = await this.prisma.facilityVisit.findFirst({
      where: {
        id: visitId,
        organizationId: tenantId,
        hospitalityServiceId: serviceId,
        checkOutAt: null,
      },
    });
    if (!visit) throw new NotFoundException('Active visit not found');
    return this.prisma.facilityVisit.update({
      where: { id: visitId },
      data: { checkOutAt: new Date() },
      include: { customer: true },
    });
  }

  /** Search active members for this facility by name or phone. */
  async searchMembers(serviceId: string, search?: string) {
    const tenantId = this.tenant();
    await this.getServiceOrThrow(serviceId);
    await this.expireOverdue(tenantId);

    const where: Record<string, unknown> = {
      organizationId: tenantId,
      status: MembershipStatus.ACTIVE,
      membershipType: { hospitalityServiceId: serviceId },
    };
    if (search?.trim()) {
      const q = search.trim();
      where.customer = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      };
    }
    return this.prisma.customerMembership.findMany({
      where,
      include: { customer: true, membershipType: true },
      orderBy: { endDate: 'asc' },
      take: 20,
    });
  }
}
