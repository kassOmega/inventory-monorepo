// src/hotel/hotel.controller.ts
import { createReadStream } from 'node:fs';
import {
  BadRequestException,
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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { contentTypeForFile, guestIdMulterOptions } from '../common/upload.config';
import type { UploadedFileShape } from '../common/upload.config';
import {
  AddFolioEntryDto,
  CheckInGuestDto,
  CheckoutReservationDto,
  CreateGuestIdTypeDto,
  CreateHotelReservationDto,
  CreateRoomDto,
  CreateRoomTypeDto,
  RoomsAvailableQueryDto,
  UpdateGuestIdTypeDto,
  UpdateHotelReservationDto,
  UpdateRoomDto,
  UpdateRoomStatusDto,
  UpdateRoomTypeDto,
} from './dto/hotel.dto';
import { HotelService } from './hotel.service';

@Controller('hotel')
@Permissions('hotel.view')
export class HotelController {
  constructor(private hotel: HotelService) {}

  @Get('room-types')
  listRoomTypes() {
    return this.hotel.listRoomTypes();
  }

  @Post('room-types')
  @Permissions('hotel.manage')
  createRoomType(@Body() dto: CreateRoomTypeDto) {
    return this.hotel.createRoomType(dto);
  }

  @Patch('room-types/:id')
  @Permissions('hotel.manage')
  updateRoomType(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomTypeDto) {
    return this.hotel.updateRoomType(id, dto);
  }

  @Delete('room-types/:id')
  @Permissions('hotel.manage')
  deleteRoomType(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.deleteRoomType(id);
  }

  @Get('rooms')
  listRooms() {
    return this.hotel.listRooms();
  }

  /**
   * Date-range availability: rooms with no overlapping active booking, grouped by
   * room type. Declared before the `rooms/:id` routes for clarity.
   */
  @Get('rooms/available')
  availableRooms(@Query() query: RoomsAvailableQueryDto) {
    return this.hotel.listAvailableRooms(query);
  }

  @Post('rooms')
  @Permissions('hotel.manage')
  createRoom(@Body() dto: CreateRoomDto) {
    return this.hotel.createRoom(dto);
  }

  @Patch('rooms/:id')
  @Permissions('hotel.manage')
  updateRoom(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomDto) {
    return this.hotel.updateRoom(id, dto);
  }

  @Delete('rooms/:id')
  @Permissions('hotel.manage')
  deleteRoom(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.deleteRoom(id);
  }

  @Patch('rooms/:id/status')
  @Permissions('hotel.manage', 'hotel.housekeeping.update')
  updateRoomStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomStatusDto) {
    return this.hotel.updateRoomStatus(id, dto.status);
  }

  /**
   * POS charge-to-room lookup (active checked-in stays only). The method-level
   * permission set deliberately overrides the class-level hotel.view gate so
   * waiters/cashiers can bill a room without opening the whole hotel module, and
   * the folio keys let the front desk / folio surface read the same list.
   */
  @Get('chargeable-rooms')
  @Permissions(
    'restaurant.take-orders',
    'restaurant.manage',
    'hotel.reception',
    'hotel.manage',
    'folios.charge',
    'folios.view',
  )
  chargeableRooms() {
    return this.hotel.listChargeableRooms();
  }

  @Get('reservations')
  listReservations(@Query('status') status?: string) {
    return this.hotel.listReservations(status);
  }

  @Post('reservations')
  @Permissions('hotel.manage', 'hotel.reception')
  createReservation(@Body() dto: CreateHotelReservationDto, @Req() req: RequestWithUser) {
    return this.hotel.createReservation(dto, req.user.sub);
  }

  @Patch('reservations/:id')
  @Permissions('hotel.manage', 'hotel.reception')
  updateReservation(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHotelReservationDto, @Req() req: RequestWithUser) {
    return this.hotel.updateReservation(id, dto, req.user.sub);
  }

  @Delete('reservations/:id')
  @Permissions('hotel.manage')
  deleteReservation(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.deleteReservation(id);
  }

  /**
   * Check a guest in. The body is optional: with it we capture the guest's
   * registration/ID details (and may reassign the room); without it, one-click
   * check-in. Either way the room charge is posted to the stay folio.
   */
  @Post('reservations/:id/check-in')
  @Permissions('hotel.manage', 'hotel.reception')
  checkIn(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CheckInGuestDto,
    @Req() req: RequestWithUser,
  ) {
    return this.hotel.checkIn(id, dto, req.user.sub);
  }

  @Post('reservations/:id/check-out')
  @Permissions('hotel.manage', 'hotel.reception')
  checkOut(
    @Param('id', ParseIntPipe) id: number,
    @Query('force') force?: string,
  ) {
    return this.hotel.checkOut(id, { force: force === 'true' || force === '1' });
  }

  /**
   * Atomic front-desk checkout: collect the payment split, settle the stay folio
   * and every linked package folio, free the room as DIRTY, and post the GL —
   * one transaction, one request (the single-modal checkout).
   */
  @Post('reservations/:id/checkout')
  @Permissions('folios.settle', 'folios.manage', 'hotel.manage', 'hotel.reception')
  checkout(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CheckoutReservationDto,
    @Req() req: RequestWithUser,
  ) {
    return this.hotel.checkout(id, dto, req.user.sub);
  }

  /** Linked package folios + open add-ons to review before releasing the room. */
  @Get('reservations/:id/checkout-preview')
  @Permissions('hotel.view', 'hotel.reception', 'folios.view')
  checkoutPreview(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.checkoutPreview(id);
  }

  /** Consolidated per-line bill (stay + linked package guests) for a stay. */
  @Get('reservations/:id/itemized-bill')
  @Permissions('hotel.view', 'hotel.reception', 'folios.view')
  itemizedBill(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.getReservationItemizedBill(id);
  }

  /** Attach / replace the guest's ID scan (JPG/PNG/WEBP/HEIC/PDF, ≤10 MB). */
  @Post('reservations/:id/id-document')
  @Permissions('hotel.manage', 'hotel.reception')
  @UseInterceptors(FileInterceptor('file', guestIdMulterOptions))
  uploadIdDocument(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: UploadedFileShape,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.hotel.setIdDocument(id, file);
  }

  /** Stream the guest's ID scan. Uploads are never served statically. */
  @Get('reservations/:id/id-document')
  @Permissions('hotel.view', 'hotel.reception')
  async getIdDocument(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.hotel.getIdDocument(id);
    res.set({
      'Content-Type': contentTypeForFile(doc.filename),
      'Content-Disposition': `inline; filename="${doc.filename}"`,
      'Cache-Control': 'private, max-age=0, no-store',
    });
    return new StreamableFile(createReadStream(doc.path));
  }

  // --- Guest ID types (owner-managed registry used by the check-in flow) ---

  @Get('settings/id-types')
  listIdTypes(@Query('active') active?: string) {
    return this.hotel.listIdTypes(active === 'true' || active === '1');
  }

  @Post('settings/id-types')
  @Permissions('hotel.manage')
  createIdType(@Body() dto: CreateGuestIdTypeDto) {
    return this.hotel.createIdType(dto);
  }

  @Patch('settings/id-types/:id')
  @Permissions('hotel.manage')
  updateIdType(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGuestIdTypeDto,
  ) {
    return this.hotel.updateIdType(id, dto);
  }

  @Get('reservations/:id/folio')
  getFolio(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.getFolio(id);
  }

  @Post('reservations/:id/folio')
  @Permissions('folios.charge', 'folios.manage', 'hotel.manage', 'hotel.reception')
  addFolioEntry(@Param('id', ParseIntPipe) id: number, @Body() dto: AddFolioEntryDto, @Req() req: RequestWithUser) {
    return this.hotel.addFolioEntry(id, dto, req.user.sub);
  }

  @Post('reservations/:id/settle')
  @Permissions('folios.settle', 'folios.manage', 'hotel.manage', 'hotel.reception')
  settleFolio(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.hotel.settleFolio(id, req.user.sub);
  }
}
