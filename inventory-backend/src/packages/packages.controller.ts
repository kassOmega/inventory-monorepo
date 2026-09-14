// src/packages/packages.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { HotelService } from '../hotel/hotel.service';
import {
  CheckInGuestDto,
  CreatePackageDto,
  UpdatePackageDto,
} from './dto/packages.dto';
import { PackagesService } from './packages.service';

@Controller('hospitality/packages')
@Permissions('packages.view')
export class PackagesController {
  constructor(private packages: PackagesService) {}

  @Get()
  list() {
    return this.packages.listPackages();
  }

  @Post()
  @Permissions('packages.manage')
  create(@Body() dto: CreatePackageDto) {
    return this.packages.createPackage(dto);
  }

  @Patch(':id')
  @Permissions('packages.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.packages.updatePackage(id, dto);
  }

  @Delete(':id')
  @Permissions('packages.manage')
  remove(@Param('id') id: string) {
    return this.packages.deletePackage(id);
  }

  /**
   * Resolve Room # / guest name to an active package guest (POS billing).
   * Waiters, cashiers and the front desk all bill package guests, so the read is
   * widened beyond `packages.view` (same pattern as `/hotel/chargeable-rooms`).
   */
  @Get('lookup')
  @Permissions(
    'packages.view',
    'restaurant.take-orders',
    'restaurant.settle',
    'hotel.reception',
    'folios.charge',
    'folios.view',
  )
  lookup(@Query('q') q?: string) {
    return this.packages.lookupGuests(q);
  }

  /** Remaining daily entitlements for the guest (shown in the POS modal). */
  @Get(':id/entitlements')
  @Permissions(
    'packages.view',
    'restaurant.take-orders',
    'restaurant.settle',
    'hotel.reception',
    'folios.charge',
    'folios.view',
  )
  remaining(@Param('id') id: string, @Query('guestId') guestId: string) {
    return this.packages.remainingEntitlements(id, guestId);
  }
}

@Controller('hospitality/guests')
@Permissions('folios.view')
export class GuestsController {
  constructor(private packages: PackagesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.packages.listGuests(status);
  }

  /** Check a guest in against a package (front desk or package desk). */
  @Post()
  @Permissions('packages.manage', 'packages.redeem', 'hotel.reception')
  checkIn(@Body() dto: CheckInGuestDto) {
    return this.packages.checkInGuest(dto);
  }

  @Get(':id/folio')
  folio(@Param('id') id: string) {
    return this.packages.getFolio(id);
  }

  /** Settle and release a package guest (money changes hands). */
  @Post(':id/check-out')
  @Permissions('folios.settle', 'folios.manage', 'hotel.reception')
  checkOut(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.packages.checkOutGuest(id, req.user.sub);
  }
}

/**
 * Itemized guest folio bill. `:id` accepts the PackageGuest id (what the folios
 * UI holds) or the GuestFolio id, so reception and the folio ledger share one
 * endpoint: chronological line items + advance-deposit / payment / balance summary.
 */
@Controller('hospitality/folios')
@Permissions('folios.view')
export class FoliosController {
  constructor(
    private packages: PackagesService,
    private hotel: HotelService,
  ) {}

  @Get(':id/itemized-bill')
  itemizedBill(@Param('id') id: string) {
    return this.packages.getItemizedBill(id);
  }

  /**
   * The unified, consolidated bill for a whole stay: the room/folio lines plus
   * every linked package guest's itemized lines, each tagged with its service and
   * the staff member who posted it. This is what the folios surface renders when
   * a reservation (rather than a single guest) is selected.
   */
  @Get('reservation/:reservationId/itemized-bill')
  reservationItemizedBill(
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.hotel.getReservationItemizedBill(reservationId);
  }
}
