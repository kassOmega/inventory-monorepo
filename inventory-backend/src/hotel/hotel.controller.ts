// src/hotel/hotel.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import {
  AddFolioEntryDto,
  CreateHotelReservationDto,
  CreateRoomDto,
  CreateRoomTypeDto,
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
  @Permissions('hotel.manage')
  updateRoomStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoomStatusDto) {
    return this.hotel.updateRoomStatus(id, dto.status);
  }

  @Get('reservations')
  listReservations(@Query('status') status?: string) {
    return this.hotel.listReservations(status);
  }

  @Post('reservations')
  @Permissions('hotel.manage')
  createReservation(@Body() dto: CreateHotelReservationDto) {
    return this.hotel.createReservation(dto);
  }

  @Patch('reservations/:id')
  @Permissions('hotel.manage')
  updateReservation(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHotelReservationDto) {
    return this.hotel.updateReservation(id, dto);
  }

  @Delete('reservations/:id')
  @Permissions('hotel.manage')
  deleteReservation(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.deleteReservation(id);
  }

  @Post('reservations/:id/check-in')
  @Permissions('hotel.manage')
  checkIn(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.checkIn(id);
  }

  @Post('reservations/:id/check-out')
  @Permissions('hotel.manage')
  checkOut(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.checkOut(id);
  }

  @Get('reservations/:id/folio')
  getFolio(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.getFolio(id);
  }

  @Post('reservations/:id/folio')
  @Permissions('hotel.manage')
  addFolioEntry(@Param('id', ParseIntPipe) id: number, @Body() dto: AddFolioEntryDto, @Req() req: RequestWithUser) {
    return this.hotel.addFolioEntry(id, dto, req.user.sub);
  }

  @Post('reservations/:id/settle')
  @Permissions('hotel.manage')
  settleFolio(@Param('id', ParseIntPipe) id: number) {
    return this.hotel.settleFolio(id);
  }
}
