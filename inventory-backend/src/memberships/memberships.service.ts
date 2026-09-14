// src/memberships/memberships.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignMembershipDto,
  CreateMembershipTypeDto,
  UpdateCustomerMembershipDto,
  UpdateMembershipTypeDto,
} from './dto/membership.dto';

@Injectable()
export class MembershipsService {
  constructor(private prisma: PrismaService) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  // --- Membership types (pass plans) ---
  async listTypes(serviceId?: string) {
    const tenantId = this.tenant();
    return this.prisma.membershipType.findMany({
      where: {
        organizationId: tenantId,
        ...(serviceId ? { hospitalityServiceId: serviceId } : {}),
      },
      include: {
        hospitalityService: {
          select: { serviceType: true, customName: true, customKey: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createType(dto: CreateMembershipTypeDto) {
    const tenantId = this.tenant();
    const service = await this.prisma.hospitalityService.findFirst({
      where: { id: dto.hospitalityServiceId, organizationId: tenantId },
    });
    if (!service || !service.isEnabled) {
      throw new BadRequestException('This service is not enabled for the business.');
    }
    return this.prisma.membershipType.create({
      data: {
        organizationId: tenantId,
        hospitalityServiceId: service.id,
        name: dto.name,
        durationDays: dto.durationDays,
        price: dto.price,
      },
    });
  }

  async updateType(id: string, dto: UpdateMembershipTypeDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.membershipType.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing) throw new NotFoundException('Membership type not found');
    return this.prisma.membershipType.update({
      where: { id },
      data: {
        name: dto.name,
        durationDays: dto.durationDays,
        price: dto.price,
        isActive: dto.isActive,
      },
    });
  }

  async deleteType(id: string) {
    const tenantId = this.tenant();
    const existing = await this.prisma.membershipType.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing) throw new NotFoundException('Membership type not found');
    const used = await this.prisma.customerMembership.count({
      where: { membershipTypeId: id },
    });
    if (used > 0) {
      throw new BadRequestException(
        'This pass is already assigned to members — deactivate it instead of deleting.',
      );
    }
    await this.prisma.membershipType.delete({ where: { id } });
    return { id };
  }

  // --- Customer memberships ---
  /** Auto-expire memberships whose end date has passed (runs on every list). */
  private async expireOverdue() {
    const tenantId = this.tenant();
    await this.prisma.customerMembership.updateMany({
      where: {
        organizationId: tenantId,
        status: MembershipStatus.ACTIVE,
        endDate: { lt: new Date() },
      },
      data: { status: MembershipStatus.EXPIRED },
    });
  }

  async listMemberships(serviceId?: string, status?: string) {
    const tenantId = this.tenant();
    await this.expireOverdue();
    return this.prisma.customerMembership.findMany({
      where: {
        organizationId: tenantId,
        ...(status ? { status: status as MembershipStatus } : {}),
        ...(serviceId ? { membershipType: { hospitalityServiceId: serviceId } } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        membershipType: {
          include: {
            hospitalityService: {
              select: { serviceType: true, customName: true, customKey: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async assignMembership(dto: AssignMembershipDto) {
    const tenantId = this.tenant();
    const type = await this.prisma.membershipType.findFirst({
      where: { id: dto.membershipTypeId, organizationId: tenantId, isActive: true },
    });
    if (!type) throw new NotFoundException('Membership type not found');

    // Find the customer by phone or name, else create a new one.
    let customer = await this.prisma.customer.findFirst({
      where: {
        organizationId: tenantId,
        OR: dto.phone
          ? [{ phone: dto.phone }, { name: dto.customerName }]
          : [{ name: dto.customerName }],
      },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          organizationId: tenantId,
          name: dto.customerName,
          phone: dto.phone,
          email: dto.email,
        },
      });
    } else if (dto.email && !customer.email) {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { email: dto.email },
      });
    }

    const start = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = new Date(start.getTime() + type.durationDays * 24 * 60 * 60 * 1000);

    return this.prisma.customerMembership.create({
      data: {
        organizationId: tenantId,
        customerId: customer.id,
        membershipTypeId: type.id,
        startDate: start,
        endDate,
      },
    });
  }

  async updateMembership(id: string, dto: UpdateCustomerMembershipDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.customerMembership.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing) throw new NotFoundException('Membership not found');

    const data: Record<string, unknown> = {};
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    if (dto.status) data.status = dto.status as MembershipStatus;

    return this.prisma.customerMembership.update({ where: { id }, data });
  }
}
