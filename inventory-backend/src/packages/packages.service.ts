// src/packages/packages.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, HotelReservationStatus } from '@prisma/client';
import {
  businessToday,
  formatBusinessDate,
  formatBusinessWeekday,
} from '../common/business-date.util';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckInGuestDto,
  CreatePackageDto,
  PackageEntitlementInputDto,
  UpdatePackageDto,
} from './dto/packages.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PackagesService {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
  ) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  /**
   * Business-local calendar date (YYYY-MM-DD) used for daily entitlement caps.
   * Resolved from the organization's timezone so allowances reset at the
   * business's midnight rather than the Node process's midnight.
   */
  private async businessDateFor(
    db: Prisma.TransactionClient,
    organizationId: number,
  ): Promise<string> {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return businessToday(org?.timezone);
  }

  // --- Package CRUD ---
  async listPackages() {
    const tenantId = this.tenant();
    return this.prisma.hospitalityPackage.findMany({
      where: { organizationId: tenantId },
      include: {
        hospitalityService: {
          select: { serviceType: true, customName: true, customKey: true },
        },
        entitlements: {
          include: {
            station: { select: { id: true, name: true, key: true } },
            menuCategory: { select: { id: true, name: true } },
            menuItem: { select: { id: true, name: true } },
            hospitalityService: {
              select: {
                id: true,
                serviceType: true,
                customName: true,
                customKey: true,
              },
            },
            membershipType: {
              select: { id: true, name: true, durationDays: true },
            },
          },
        },
        _count: {
          select: { guests: { where: { status: 'CHECKED_IN' } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Normalize an entitlement input into the persisted row. ITEM lines target a
   * restaurant station (F&B coverage); CREDIT / PASS lines target a service line
   * and optionally a specific pass plan (MembershipType).
   */
  private entitlementData(e: PackageEntitlementInputDto) {
    const kind =
      e.entitlementKind ??
      (e.hospitalityServiceId && e.stationId == null ? 'CREDIT' : 'ITEM');
    if (kind === 'ITEM') {
      if (e.stationId == null) {
        throw new BadRequestException(
          'ITEM entitlements must target a station.',
        );
      }
      return {
        entitlementKind: 'ITEM' as const,
        stationId: e.stationId,
        menuCategoryId: e.menuCategoryId ?? null,
        menuItemId: e.menuItemId ?? null,
        hospitalityServiceId: null,
        membershipTypeId: null,
        allowanceValue: e.allowanceValue ?? 0,
        dailyLimit: e.dailyLimit ?? null,
      };
    }
    if (!e.hospitalityServiceId) {
      throw new BadRequestException(
        `${kind} entitlements must target a service.`,
      );
    }
    return {
      entitlementKind: kind,
      stationId: null,
      menuCategoryId: null,
      menuItemId: null,
      hospitalityServiceId: e.hospitalityServiceId,
      membershipTypeId: e.membershipTypeId ?? null,
      allowanceValue: e.allowanceValue ?? 0,
      dailyLimit: e.dailyLimit ?? null,
    };
  }

  async createPackage(dto: CreatePackageDto) {
    const tenantId = this.tenant();
    if (dto.hospitalityServiceId) {
      const service = await this.prisma.hospitalityService.findFirst({
        where: { id: dto.hospitalityServiceId, organizationId: tenantId },
      });
      if (!service)
        throw new BadRequestException('Service not found for this business.');
    }

    // Cross-service entitlements must reference services owned by this tenant.
    const serviceIds = Array.from(
      new Set(
        (dto.entitlements ?? [])
          .map((e) => e.hospitalityServiceId)
          .filter((id): id is string => !!id),
      ),
    );
    if (serviceIds.length) {
      const owned = await this.prisma.hospitalityService.count({
        where: { id: { in: serviceIds }, organizationId: tenantId },
      });
      if (owned !== serviceIds.length) {
        throw new BadRequestException(
          'One or more entitlement services were not found for this business.',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      return tx.hospitalityPackage.create({
        data: {
          organizationId: tenantId,
          hospitalityServiceId: dto.hospitalityServiceId ?? null,
          name: dto.name,
          price: dto.price ?? 0,
          entitlements: {
            create: (dto.entitlements ?? []).map((e) =>
              this.entitlementData(e),
            ),
          },
        },
        include: { entitlements: true },
      });
    });
  }

  async updatePackage(id: string, dto: UpdatePackageDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.hospitalityPackage.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing) throw new NotFoundException('Package not found');

    return this.prisma.$transaction(async (tx) => {
      return tx.hospitalityPackage.update({
        where: { id },
        data: {
          name: dto.name,
          price: dto.price,
          isActive: dto.isActive,
          ...(dto.entitlements
            ? {
                entitlements: {
                  deleteMany: {},
                  create: dto.entitlements.map((e) => this.entitlementData(e)),
                },
              }
            : {}),
        },
        include: { entitlements: true },
      });
    });
  }

  async deletePackage(id: string) {
    const tenantId = this.tenant();
    const activeGuests = await this.prisma.packageGuest.count({
      where: { organizationId: tenantId, packageId: id, status: 'CHECKED_IN' },
    });
    if (activeGuests > 0) {
      throw new BadRequestException(
        'Cannot delete a package with active guests.',
      );
    }
    await this.prisma.hospitalityPackage.deleteMany({
      where: { id, organizationId: tenantId },
    });
    return { id };
  }

  // --- Guests ---
  /** Resolve Room # / guest name to active package guests (POS billing lookup). */
  async lookupGuests(q?: string) {
    const tenantId = this.tenant();
    const term = (q ?? '').trim();
    if (!term) return [];
    const where: Prisma.PackageGuestWhereInput = {
      organizationId: tenantId,
      status: 'CHECKED_IN',
    };
    if (/^\d+$/.test(term)) {
      where.OR = [
        { roomNumber: { contains: term, mode: 'insensitive' } },
        { guestName: { contains: term, mode: 'insensitive' } },
      ];
    } else {
      where.guestName = { contains: term, mode: 'insensitive' };
    }
    return this.prisma.packageGuest.findMany({
      where,
      include: {
        package: {
          include: {
            hospitalityService: {
              select: { serviceType: true, customName: true, customKey: true },
            },
          },
        },
        // The hotel stay the guest is billed against (ROOM_CHARGE validation).
        hotelReservation: {
          select: {
            id: true,
            guestName: true,
            checkIn: true,
            checkOut: true,
            status: true,
            room: { select: { number: true } },
          },
        },
      },
      take: 10,
      orderBy: { checkInAt: 'desc' },
    });
  }

  async checkInGuest(dto: CheckInGuestDto) {
    const tenantId = this.tenant();
    const pkg = await this.prisma.hospitalityPackage.findFirst({
      where: { id: dto.packageId, organizationId: tenantId, isActive: true },
    });
    if (!pkg) throw new NotFoundException('Package not found or inactive.');

    // Optional hotel-stay link (ROOM_CHARGE billing). Validated here so a guest
    // can never be attached to another tenant's — or an inactive — reservation.
    let reservation: { id: number; roomNumber: string | null } | null = null;
    if (dto.hotelReservationId != null) {
      const found = await this.prisma.hotelReservation.findFirst({
        where: {
          id: dto.hotelReservationId,
          tenantId,
          status: {
            in: [
              HotelReservationStatus.CONFIRMED,
              HotelReservationStatus.CHECKED_IN,
            ],
          },
        },
        include: { room: { select: { number: true } } },
      });
      if (!found) {
        throw new BadRequestException(
          'Hotel reservation not found for this business, or it is not confirmed/checked in.',
        );
      }
      reservation = { id: found.id, roomNumber: found.room?.number ?? null };
    }

    const guest = await this.prisma.$transaction(async (tx) => {
      const g = await tx.packageGuest.create({
        data: {
          organizationId: tenantId,
          packageId: pkg.id,
          guestName: dto.guestName,
          // Explicit room number wins; otherwise derive it from the stay.
          roomNumber: dto.roomNumber?.trim() || reservation?.roomNumber || null,
          hotelReservationId: reservation?.id ?? null,
        },
      });
      await tx.guestFolio.create({
        data: {
          organizationId: tenantId,
          packageGuestId: g.id,
          packageValuePaid: pkg.price,
        },
      });
      return g;
    });

    // Book the upfront package value as prepaid income.
    await this.finance.postPackageIncome(
      guest.id,
      tenantId,
      pkg.price,
      `Guest package "${pkg.name}" — ${dto.guestName}${dto.roomNumber ? ` (Room ${dto.roomNumber})` : ''}`,
    );

    return guest;
  }

  async listGuests(status?: string) {
    const tenantId = this.tenant();
    return this.prisma.packageGuest.findMany({
      where: {
        organizationId: tenantId,
        ...(status ? { status } : { status: 'CHECKED_IN' }),
      },
      include: {
        package: {
          include: {
            hospitalityService: {
              select: { serviceType: true, customName: true, customKey: true },
            },
          },
        },
        folio: true,
        // Linked hotel stay (room service / front desk view).
        hotelReservation: {
          select: {
            id: true,
            guestName: true,
            checkIn: true,
            checkOut: true,
            status: true,
            room: { select: { number: true } },
          },
        },
      },
      orderBy: { checkInAt: 'desc' },
    });
  }

  // --- Folio ---
  async getFolio(guestId: string) {
    const tenantId = this.tenant();
    const guest = await this.prisma.packageGuest.findFirst({
      where: { id: guestId, organizationId: tenantId },
      include: {
        package: {
          include: {
            hospitalityService: {
              select: { serviceType: true, customName: true, customKey: true },
            },
          },
        },
        folio: {
          include: { entries: { orderBy: { createdAt: 'asc' } } },
        },
        // Linked hotel stay, so the folio can show which reservation it belongs to.
        hotelReservation: {
          select: {
            id: true,
            guestName: true,
            checkIn: true,
            checkOut: true,
            status: true,
            room: { select: { number: true } },
          },
        },
      },
    });
    if (!guest || !guest.folio)
      throw new NotFoundException('Guest folio not found');

    const entries = guest.folio.entries;
    const sum = (k: 'grossPrice' | 'packageDiscount' | 'netCharge') =>
      entries.reduce((s, e) => s + (e[k] ?? 0), 0);
    const totalGross = sum('grossPrice');
    const totalPackageDiscount = sum('packageDiscount');
    const totalAddOns = sum('netCharge');
    const balance = Math.max(0, totalAddOns - guest.folio.totalPayments);

    return {
      guest,
      folio: {
        ...guest.folio,
        entries,
        totalGross,
        totalPackageDiscount,
        totalAddOns,
        balance,
      },
    };
  }

  /** Master checkout: settle the folio, mark guest checked out, post income. */
  async checkOutGuest(guestId: string, userId: number) {
    const tenantId = this.tenant();
    const guest = await this.prisma.packageGuest.findFirst({
      where: { id: guestId, organizationId: tenantId },
      include: {
        package: true,
        folio: { include: { entries: true } },
      },
    });
    if (!guest || !guest.folio) throw new NotFoundException('Guest not found');
    if (guest.status !== 'CHECKED_IN') {
      throw new BadRequestException('Guest is already checked out.');
    }

    const folio = guest.folio;
    const entries = folio.entries;
    const sum = (k: 'grossPrice' | 'packageDiscount' | 'netCharge') =>
      entries.reduce((s, e) => s + (e[k] ?? 0), 0);
    const totalPackageDiscount = sum('packageDiscount');
    const totalAddOns = sum('netCharge');
    const totalPayments = folio.totalPayments;
    const netBalanceDue = Math.max(0, totalAddOns - totalPayments);

    await this.prisma.$transaction(async (tx) => {
      await tx.guestFolio.update({
        where: { id: folio.id },
        data: {
          status: 'SETTLED',
          settledAt: new Date(),
          settledById: userId,
          packageValuePaid: guest.package.price,
          totalPackageDiscount,
          totalAddOns,
          totalPayments,
        },
      });
      await tx.packageGuest.update({
        where: { id: guest.id },
        data: { status: 'CHECKED_OUT', checkOutAt: new Date() },
      });
    });

    if (netBalanceDue > 0) {
      await this.finance.postPackageFolioIncome(
        guest.id,
        tenantId,
        netBalanceDue,
        `Guest folio settlement — ${guest.guestName}${guest.roomNumber ? ` (Room ${guest.roomNumber})` : ''} [${guest.package.name}]`,
      );
    }

    return {
      guestId: guest.id,
      guestName: guest.guestName,
      roomNumber: guest.roomNumber,
      packageName: guest.package.name,
      packageValuePaid: guest.package.price,
      totalPackageDiscount,
      totalAddOns,
      totalPayments,
      netBalanceDue,
      status: 'SETTLED',
    };
  }

  /**
   * Consume a facility entitlement for a package guest (Gym/Pool/Spa check-in).
   * Prefers an exact pass-plan match, then any PASS, then any CREDIT on the
   * service. Returns the covered amount; the caller routes the remainder to
   * PAY_NOW or DEFER_TO_FOLIO. Usage is persisted inside the caller's tx.
   */
  async computeFacilityEntitlement(
    tx: Tx,
    args: {
      organizationId: number;
      packageGuestId: string;
      hospitalityServiceId: string;
      membershipTypeId?: string | null;
      amount: number;
      quantity?: number;
    },
  ): Promise<{
    covered: boolean;
    entitlementId: string | null;
    entitlementKind: string | null;
    packageDiscount: number;
    netCharge: number;
    remainingUnits: number | null;
  }> {
    const quantity = args.quantity ?? 1;
    const guest = await tx.packageGuest.findFirst({
      where: {
        id: args.packageGuestId,
        organizationId: args.organizationId,
        status: 'CHECKED_IN',
      },
      include: {
        package: { include: { entitlements: { where: { isActive: true } } } },
      },
    });
    if (!guest) {
      throw new NotFoundException(
        'No active package guest found for this facility billing.',
      );
    }

    const candidates = guest.package.entitlements.filter(
      (e) => e.hospitalityServiceId === args.hospitalityServiceId,
    );
    const entitlement =
      (args.membershipTypeId
        ? candidates.find((e) => e.membershipTypeId === args.membershipTypeId)
        : undefined) ??
      candidates.find((e) => e.entitlementKind === 'PASS') ??
      candidates.find((e) => e.entitlementKind === 'CREDIT') ??
      candidates[0] ??
      null;

    if (!entitlement) {
      return {
        covered: false,
        entitlementId: null,
        entitlementKind: null,
        packageDiscount: 0,
        netCharge: args.amount,
        remainingUnits: null,
      };
    }

    const today = await this.businessDateFor(tx, args.organizationId);
    const usage = await tx.packageGuestEntitlementUsage.findUnique({
      where: {
        packageGuestId_entitlementId_usageDate: {
          packageGuestId: guest.id,
          entitlementId: entitlement.id,
          usageDate: today,
        },
      },
    });
    const remainingUnits =
      entitlement.dailyLimit != null
        ? Math.max(0, entitlement.dailyLimit - (usage?.quantityUsed ?? 0))
        : Infinity;

    if (remainingUnits <= 0) {
      return {
        covered: false,
        entitlementId: entitlement.id,
        entitlementKind: entitlement.entitlementKind,
        packageDiscount: 0,
        netCharge: args.amount,
        remainingUnits: 0,
      };
    }

    // PASS = the whole visit is covered; CREDIT = min(amount, allowance) per unit.
    const isPass = entitlement.entitlementKind === 'PASS';
    const coveredPerUnit = isPass
      ? args.amount
      : entitlement.allowanceValue > 0
        ? Math.min(args.amount, entitlement.allowanceValue)
        : args.amount;
    const coveredQty =
      remainingUnits === Infinity
        ? quantity
        : Math.min(quantity, remainingUnits);
    const packageDiscount = coveredPerUnit * coveredQty;

    if (coveredQty > 0) {
      await tx.packageGuestEntitlementUsage.upsert({
        where: {
          packageGuestId_entitlementId_usageDate: {
            packageGuestId: guest.id,
            entitlementId: entitlement.id,
            usageDate: today,
          },
        },
        update: {
          quantityUsed: { increment: coveredQty },
          valueUsed: { increment: packageDiscount },
        },
        create: {
          packageGuestId: guest.id,
          entitlementId: entitlement.id,
          usageDate: today,
          quantityUsed: coveredQty,
          valueUsed: packageDiscount,
        },
      });
    }

    return {
      covered: packageDiscount >= args.amount,
      entitlementId: entitlement.id,
      entitlementKind: entitlement.entitlementKind,
      packageDiscount,
      netCharge: Math.max(0, args.amount - packageDiscount),
      remainingUnits:
        remainingUnits === Infinity
          ? null
          : Math.max(0, remainingUnits - coveredQty),
    };
  }

  // --- Itemized bill (front desk / folio ledger) ---
  /**
   * Itemized guest folio bill: every consumed line across all services with the
   * business-local date + weekday, the service it came from, unit price and line
   * total, plus the advance-deposit / partial-payment / net-balance summary.
   * `id` accepts the PackageGuest id (what the folios UI holds) or the GuestFolio id.
   */
  async getItemizedBill(id: string) {
    const tenantId = this.tenant();
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timeZone = org?.timezone ?? null;

    const folio = await this.prisma.guestFolio.findFirst({
      where: {
        organizationId: tenantId,
        OR: [{ id }, { packageGuestId: id }],
      },
      include: {
        // Who posted each line (staff accountability on the printed bill).
        entries: {
          orderBy: { createdAt: 'asc' },
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                role: { select: { name: true } },
                // The authoritative per-tenant role (membership) wins; the
                // global User.role is the legacy fallback.
                memberships: {
                  where: { organizationId: tenantId },
                  select: { role: { select: { name: true } } },
                  take: 1,
                },
              },
            },
          },
        },
        settledBy: { select: { id: true, name: true } },
        packageGuest: {
          include: {
            package: {
              include: {
                hospitalityService: {
                  select: {
                    serviceType: true,
                    customName: true,
                    customKey: true,
                  },
                },
              },
            },
            hotelReservation: {
              select: {
                id: true,
                guestName: true,
                checkIn: true,
                checkOut: true,
                status: true,
                room: { select: { number: true } },
              },
            },
          },
        },
      },
    });
    if (!folio) throw new NotFoundException('Guest folio not found');

    const guest = folio.packageGuest;
    const items = folio.entries.map((e) => {
      const quantity = e.quantity ?? 1;
      // unitPrice snapshot; legacy rows (pre-migration) fall back to gross / qty.
      const unitPrice =
        e.unitPrice || (quantity > 0 ? e.grossPrice / quantity : e.grossPrice);
      return {
        id: e.id,
        createdAt: e.createdAt,
        date: formatBusinessDate(e.createdAt, timeZone),
        weekday: formatBusinessWeekday(e.createdAt, timeZone),
        sourceService: e.sourceService,
        stationName: e.stationName,
        servedByName: e.servedByName,
        // Staff who actually posted the line (fallback to the POS name snapshot).
        staffName: e.createdBy?.name ?? e.servedByName ?? null,
        staffRole:
          e.createdBy?.memberships?.[0]?.role?.name ??
          e.createdBy?.role?.name ??
          null,
        itemName: e.itemName,
        quantity,
        unitPrice,
        totalPrice: unitPrice * quantity,
        grossPrice: e.grossPrice,
        packageDiscount: e.packageDiscount,
        netCharge: e.netCharge,
      };
    });

    const totalGross = items.reduce((s, e) => s + e.grossPrice, 0);
    const totalPackageDiscount = items.reduce(
      (s, e) => s + e.packageDiscount,
      0,
    );
    const totalAddOns = items.reduce((s, e) => s + e.netCharge, 0);
    const totalPayments = folio.totalPayments ?? 0;
    const advancedDeposit = folio.packageValuePaid || guest.package?.price || 0;

    return {
      folioId: folio.id,
      guestId: guest.id,
      status: folio.status,
      settledAt: folio.settledAt,
      // Front-desk user who settled the folio (printed on the receipt).
      settledByName: folio.settledBy?.name ?? null,
      guestName: guest.guestName,
      roomNumber:
        guest.roomNumber ?? guest.hotelReservation?.room?.number ?? null,
      packageName: guest.package?.name ?? null,
      sourceService:
        guest.package?.hospitalityService?.customKey ??
        guest.package?.hospitalityService?.serviceType ??
        null,
      checkInAt: guest.checkInAt,
      checkOutAt: guest.checkOutAt,
      hotelReservationId: guest.hotelReservationId ?? null,
      hotelReservationStatus: guest.hotelReservation?.status ?? null,
      items,
      summary: {
        // Advance deposits taken at check-in (upfront package value).
        packageValuePaid: advancedDeposit,
        totalGross,
        totalPackageDiscount,
        totalAddOns,
        // Partial payments collected at the POS.
        totalPayments,
        netBalanceDue: Math.max(0, totalAddOns - totalPayments),
      },
    };
  }

  // --- Remaining entitlements (POS modal display) ---
  async remainingEntitlements(packageId: string, guestId: string) {
    const tenantId = this.tenant();
    const guest = await this.prisma.packageGuest.findFirst({
      where: {
        id: guestId,
        organizationId: tenantId,
        status: 'CHECKED_IN',
        packageId,
      },
      include: {
        package: {
          include: {
            entitlements: {
              where: { isActive: true },
              include: {
                station: { select: { id: true, name: true, key: true } },
                menuCategory: { select: { id: true, name: true } },
                menuItem: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!guest) throw new NotFoundException('Guest not found');
    const today = await this.businessDateFor(this.prisma, tenantId);
    const usage = await this.prisma.packageGuestEntitlementUsage.findMany({
      where: { packageGuestId: guest.id, usageDate: today },
    });
    const usageMap = new Map(usage.map((u) => [u.entitlementId, u]));
    return guest.package.entitlements.map((e) => {
      const used = usageMap.get(e.id);
      const usedQty = used?.quantityUsed ?? 0;
      const usedValue = used?.valueUsed ?? 0;
      return {
        id: e.id,
        stationName: e.station?.name ?? null,
        menuCategoryName: e.menuCategory?.name ?? null,
        menuItemName: e.menuItem?.name ?? null,
        allowanceValue: e.allowanceValue,
        dailyLimit: e.dailyLimit,
        usedQuantity: usedQty,
        usedValue: usedValue,
        remainingQuantity:
          e.dailyLimit != null ? Math.max(0, e.dailyLimit - usedQty) : null,
      };
    });
  }

  // --- Entitlement computation (used by the order-taking flow) ---
  /**
   * Pick the most specific entitlement line for a consumption:
   *   1. exact item (station + menu item)
   *   2. category (station + menu category)
   *   3. station catch-all (station, no item/category)
   *   4. service-line catch-all (cross-service CREDIT, no station)
   */
  private matchEntitlement(
    entitlements: {
      id: string;
      entitlementKind?: string;
      stationId: number | null;
      menuCategoryId: number | null;
      menuItemId: number | null;
      hospitalityServiceId: string | null;
      membershipTypeId?: string | null;
      allowanceValue: number;
      dailyLimit: number | null;
    }[],
    ctx: {
      stationId: number | null;
      menuCategoryId: number | null;
      menuItemId: number | null;
      /** Service line the consumption belongs to (service-scoped credits). */
      hospitalityServiceId?: string | null;
    },
  ) {
    if (!entitlements.length) return null;
    const { stationId, menuCategoryId, menuItemId, hospitalityServiceId } = ctx;

    if (stationId != null) {
      const stationLines = entitlements.filter(
        (e) => e.stationId === stationId,
      );
      const byItem = stationLines.find(
        (e) => e.menuItemId != null && e.menuItemId === menuItemId,
      );
      if (byItem) return byItem;
      const byCat = stationLines.find(
        (e) => e.menuCategoryId != null && e.menuCategoryId === menuCategoryId,
      );
      if (byCat) return byCat;
      const stationAny = stationLines.find(
        (e) => e.menuItemId == null && e.menuCategoryId == null,
      );
      if (stationAny) return stationAny;
    }

    // Cross-service credit: a service-wide allowance covers any station in it.
    if (hospitalityServiceId) {
      return (
        entitlements.find(
          (e) =>
            e.stationId == null &&
            e.hospitalityServiceId === hospitalityServiceId &&
            e.menuItemId == null &&
            e.menuCategoryId == null,
        ) ?? null
      );
    }
    return null;
  }

  /**
   * Compute entitlement coverage for a package-billed order and persist today's
   * usage inside the caller's transaction. Returns per-item coverage aligned by
   * index with the input `items`, plus the folio entry payloads.
   * - allowanceValue 0  => the item is fully covered (up to dailyLimit).
   * - allowanceValue >0 => covered = min(unitPrice, allowanceValue) per unit.
   * - allowCompensation=false => any item exceeding its allowance is rejected.
   */
  async computePackageOrderBilling(
    tx: Tx,
    args: {
      packageGuestId: string;
      organizationId: number;
      items: {
        index: number;
        name: string;
        menuItemId: number;
        menuCategoryId: number | null;
        quantity: number;
        unitPrice: number;
        firstStationId: number | null;
        firstStationName: string | null;
      }[];
      allowCompensation: boolean;
      servedByName: string | null;
    },
  ) {
    const { packageGuestId, organizationId, allowCompensation, servedByName } =
      args;
    const guest = await tx.packageGuest.findFirst({
      where: { id: packageGuestId, organizationId, status: 'CHECKED_IN' },
      include: {
        package: {
          include: {
            entitlements: { where: { isActive: true } },
            hospitalityService: {
              select: { serviceType: true, customName: true, customKey: true },
            },
          },
        },
      },
    });
    if (!guest) {
      throw new NotFoundException(
        'No active package guest found for this billing.',
      );
    }

    // Service line the consumption belongs to (drives the itemized bill's
    // `sourceService`). Custom facilities store their stable key.
    const service = guest.package.hospitalityService;
    const sourceService = service?.customKey ?? service?.serviceType ?? null;
    const sourceServiceName = service?.customName ?? null;

    const today = await this.businessDateFor(tx, organizationId);
    const entitlementIds = guest.package.entitlements.map((e) => e.id);
    const usageRows = entitlementIds.length
      ? await tx.packageGuestEntitlementUsage.findMany({
          where: {
            packageGuestId: guest.id,
            usageDate: today,
            entitlementId: { in: entitlementIds },
          },
        })
      : [];
    const usageMap = new Map(usageRows.map((u) => [u.entitlementId, u]));
    const results: {
      index: number;
      packageDiscount: number;
      netCharge: number;
    }[] = [];
    const folioEntries: {
      stationName: string | null;
      servedByName: string | null;
      itemName: string;
      quantity: number;
      unitPrice: number;
      grossPrice: number;
      packageDiscount: number;
      netCharge: number;
    }[] = [];
    let totalPackageDiscount = 0;

    for (const item of args.items) {
      const entitlement = this.matchEntitlement(guest.package.entitlements, {
        stationId: item.firstStationId,
        menuCategoryId: item.menuCategoryId,
        menuItemId: item.menuItemId,
        hospitalityServiceId: guest.package.hospitalityServiceId,
      });
      let packageDiscount = 0;
      const gross = item.unitPrice * item.quantity;

      if (entitlement) {
        const usage = usageMap.get(entitlement.id) ?? { quantityUsed: 0 };
        const remainingUnits =
          entitlement.dailyLimit != null
            ? Math.max(0, entitlement.dailyLimit - usage.quantityUsed)
            : Infinity;
        const coveredPerUnit =
          entitlement.allowanceValue > 0
            ? Math.min(item.unitPrice, entitlement.allowanceValue)
            : item.unitPrice;
        const coveredQty =
          remainingUnits === Infinity
            ? item.quantity
            : Math.min(item.quantity, remainingUnits);
        packageDiscount = coveredPerUnit * coveredQty;

        if (!allowCompensation && gross - packageDiscount > 0) {
          throw new BadRequestException(
            `"${item.name}" exceeds the package allowance and price compensation is disabled — bill it separately or reduce the order.`,
          );
        }

        if (coveredQty > 0) {
          const updated = await tx.packageGuestEntitlementUsage.upsert({
            where: {
              packageGuestId_entitlementId_usageDate: {
                packageGuestId: guest.id,
                entitlementId: entitlement.id,
                usageDate: today,
              },
            },
            update: {
              quantityUsed: { increment: coveredQty },
              valueUsed: { increment: packageDiscount },
            },
            create: {
              packageGuestId: guest.id,
              entitlementId: entitlement.id,
              usageDate: today,
              quantityUsed: coveredQty,
              valueUsed: packageDiscount,
            },
          });
          usageMap.set(entitlement.id, updated);
        }
      }

      totalPackageDiscount += packageDiscount;
      const netCharge = gross - packageDiscount;
      results.push({ index: item.index, packageDiscount, netCharge });
      folioEntries.push({
        stationName: item.firstStationName,
        servedByName,
        itemName: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        grossPrice: gross,
        packageDiscount,
        netCharge,
      });
    }

    return {
      packageId: guest.package.id,
      packageName: guest.package.name,
      roomNumber: guest.roomNumber,
      guestName: guest.guestName,
      sourceService,
      sourceServiceName,
      results,
      totalPackageDiscount,
      folioEntries,
    };
  }
}
