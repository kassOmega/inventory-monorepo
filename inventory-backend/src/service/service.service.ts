// src/service/service.service.ts
// SERVICE vertical: catalog (categories + service items), bookings/appointments,
// session tickets and payments. All models are tenant-scoped by the Prisma
// middleware. Appointment slots come from ServiceProfile.appointmentSlot.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServiceBookingStatus, ServiceTicketStatus } from '@prisma/client';
import { assertNotDuplicate } from '../common/duplicate.util';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateServiceBookingDto,
  CreateServiceCategoryDto,
  CreateServiceItemDto,
  CreateServiceTicketDto,
  PayTicketDto,
} from './dto/service.dto';

const DEFAULT_SLOT_MINUTES = 30;

@Injectable()
export class ServiceService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization selected');
    return id;
  }

  private async slotMinutes(): Promise<number> {
    const tenantId = this.tenantId();
    try {
      const profile = await this.prisma.serviceProfile.findUnique({
        where: { organizationId: tenantId },
      });
      return profile?.appointmentSlot ?? DEFAULT_SLOT_MINUTES;
    } catch {
      return DEFAULT_SLOT_MINUTES;
    }
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  listCategories() {
    return this.prisma.serviceCategory.findMany({ orderBy: { name: 'asc' } });
  }

  createCategory(dto: CreateServiceCategoryDto) {
    return this.prisma.serviceCategory.create({ data: { name: dto.name } });
  }

  async updateCategory(id: number, dto: CreateServiceCategoryDto) {
    await this.assertCategory(id);
    return this.prisma.serviceCategory.update({ where: { id }, data: { name: dto.name } });
  }

  async deleteCategory(id: number) {
    await this.assertCategory(id);
    await this.prisma.serviceCategory.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Catalog items
  // -------------------------------------------------------------------------

  listItems(categoryId?: number) {
    return this.prisma.serviceItem.findMany({
      where: { ...(categoryId ? { categoryId } : {}) },
      include: { category: true },
      orderBy: { name: 'asc' },
    });
  }

  async createItem(dto: CreateServiceItemDto) {
    try {
      return await this.prisma.serviceItem.create({
        data: {
          name: dto.name,
          description: dto.description,
          price: dto.price ?? 0,
          durationMins: dto.durationMins ?? 30,
          categoryId: dto.categoryId ?? null,
        },
      });
    } catch (err) {
      return assertNotDuplicate(err, 'A service with this name already exists.');
    }
  }

  async updateItem(id: number, dto: CreateServiceItemDto) {
    await this.assertItem(id);
    return this.prisma.serviceItem.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        durationMins: dto.durationMins,
        categoryId: dto.categoryId ?? null,
      },
    });
  }

  async deleteItem(id: number) {
    await this.assertItem(id);
    await this.prisma.serviceItem.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Bookings / appointments
  // -------------------------------------------------------------------------

  async listBookings(date?: string) {
    const where: any = {};
    if (date) {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(`${date}T23:59:59.999`);
      where.startsAt = { gte: start, lte: end };
    }
    return this.prisma.serviceBooking.findMany({
      where,
      include: { client: true, serviceItem: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  async createBooking(dto: CreateServiceBookingDto) {
    const slot = await this.slotMinutes();
    const startsAt = new Date(dto.startsAt);
    const serviceItem = dto.serviceItemId
      ? await this.prisma.serviceItem.findUnique({ where: { id: dto.serviceItemId } })
      : null;
    const duration = serviceItem?.durationMins ?? slot;
    const endsAt = new Date(startsAt.getTime() + duration * 60 * 1000);

    return this.prisma.serviceBooking.create({
      data: {
        clientId: dto.clientId ?? null,
        serviceItemId: dto.serviceItemId ?? null,
        startsAt,
        endsAt,
        notes: dto.notes,
      },
      include: { client: true, serviceItem: true },
    });
  }

  async updateBookingStatus(id: number, status: ServiceBookingStatus) {
    await this.assertBooking(id);
    return this.prisma.serviceBooking.update({ where: { id }, data: { status } });
  }

  // -------------------------------------------------------------------------
  // Tickets
  // -------------------------------------------------------------------------

  async listTickets(status?: string) {
    return this.prisma.serviceTicket.findMany({
      where: { ...(status ? { status: status as ServiceTicketStatus } : {}) },
      include: { client: true, booking: true, items: { include: { serviceItem: true } }, payments: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createTicket(dto: CreateServiceTicketDto) {
    const booking = dto.bookingId
      ? await this.prisma.serviceBooking.findUnique({ where: { id: dto.bookingId } })
      : null;
    if (dto.bookingId && !booking) throw new NotFoundException('Booking not found');

    const lines: Array<{ serviceItemId: number; quantity: number; unitPrice: number }> = [];
    for (const line of dto.items ?? []) {
      const item = await this.prisma.serviceItem.findUnique({
        where: { id: line.serviceItemId },
      });
      if (!item) throw new NotFoundException(`Service item ${line.serviceItemId} not found`);
      lines.push({ serviceItemId: item.id, quantity: line.quantity ?? 1, unitPrice: item.price });
    }
    const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

    return this.prisma.serviceTicket.create({
      data: {
        clientId: dto.clientId ?? booking?.clientId ?? null,
        bookingId: dto.bookingId ?? null,
        notes: dto.notes,
        totalAmount: total,
        items: { create: lines },
      },
      include: { client: true, items: { include: { serviceItem: true } } },
    });
  }

  async addTicketItem(ticketId: number, serviceItemId: number, quantity = 1) {
    const ticket = await this.prisma.serviceTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (
      ticket.status === ServiceTicketStatus.PAID ||
      ticket.status === ServiceTicketStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot add items to a paid/cancelled ticket');
    }
    const item = await this.prisma.serviceItem.findUnique({ where: { id: serviceItemId } });
    if (!item) throw new NotFoundException('Service item not found');

    await this.prisma.serviceTicketItem.create({
      data: { ticketId, serviceItemId, quantity, unitPrice: item.price },
    });
    await this.recomputeTotal(ticketId);
    return this.getTicket(ticketId);
  }


  async payTicket(ticketId: number, dto: PayTicketDto) {
    const ticket = await this.prisma.serviceTicket.findUnique({
      where: { id: ticketId },
      include: { payments: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === ServiceTicketStatus.CANCELLED) {
      throw new BadRequestException('Cannot pay a cancelled ticket');
    }

    const paidSoFar = ticket.payments.reduce((s, p) => s + p.amount, 0);
    const amount = dto.amount ?? Math.max(0, ticket.totalAmount - paidSoFar);
    if (amount <= 0) throw new BadRequestException('No outstanding balance');

    try {
      await this.prisma.servicePayment.create({
        data: {
          ticketId,
          amount,
          paymentMethodId: dto.paymentMethodId ?? null,
          paidById: null,
          clientRef: dto.clientRef ?? null,
        },
      });
    } catch (err) {
      return assertNotDuplicate(err, 'This payment was already submitted. Please refresh and try again.');
    }

    const paid = paidSoFar + amount;
    const status =
      paid >= ticket.totalAmount ? ServiceTicketStatus.PAID : ServiceTicketStatus.IN_PROGRESS;
    await this.prisma.serviceTicket.update({ where: { id: ticketId }, data: { status } });

    return this.getTicket(ticketId);
  }

  async updateTicketStatus(ticketId: number, status: ServiceTicketStatus) {
    await this.assertTicket(ticketId);
    return this.prisma.serviceTicket.update({ where: { id: ticketId }, data: { status } });
  }

  // -------------------------------------------------------------------------
  // Clients (shared Customer records) + dashboard
  // -------------------------------------------------------------------------

  listClients(search?: string) {
    return this.prisma.customer.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
  }

  async dashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const [bookings, openTickets, paidToday, activeServices] = await Promise.all([
      this.prisma.serviceBooking.count({ where: { startsAt: { gte: today, lt: tomorrow } } }),
      this.prisma.serviceTicket.count({
        where: { status: { in: [ServiceTicketStatus.OPEN, ServiceTicketStatus.IN_PROGRESS] } },
      }),
      this.prisma.servicePayment.aggregate({
        where: { paidAt: { gte: today, lt: tomorrow } },
        _sum: { amount: true },
      }),
      this.prisma.serviceItem.count({ where: { active: true } }),
    ]);
    return {
      todayBookings: bookings,
      openTickets,
      paidToday: paidToday._sum.amount ?? 0,
      activeServices,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async getTicket(ticketId: number) {
    return this.prisma.serviceTicket.findUnique({
      where: { id: ticketId },
      include: { client: true, items: { include: { serviceItem: true } }, payments: true },
    });
  }

  private async recomputeTotal(ticketId: number): Promise<number> {
    const items = await this.prisma.serviceTicketItem.findMany({ where: { ticketId } });
    const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    await this.prisma.serviceTicket.update({ where: { id: ticketId }, data: { totalAmount: total } });
    return total;
  }

  private async assertCategory(id: number) {
    const found = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Category not found');
  }

  private async assertItem(id: number) {
    const found = await this.prisma.serviceItem.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Service item not found');
  }

  private async assertBooking(id: number) {
    const found = await this.prisma.serviceBooking.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Booking not found');
  }

  private async assertTicket(id: number) {
    const found = await this.prisma.serviceTicket.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Ticket not found');
  }
}

