// src/hotel/dto/hotel.dto.ts
import { RoomStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRoomTypeDto {
  @IsString() name!: string;
  @IsString() @IsOptional() description?: string;
  @IsNumber() @Type(() => Number) basePrice!: number;
}

export class UpdateRoomTypeDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsNumber() @Type(() => Number) @IsOptional() basePrice?: number;
}

export class CreateRoomDto {
  @IsInt() roomTypeId!: number;
  @IsString() number!: string;
  @IsString() @IsOptional() floor?: string;
}

export class UpdateRoomDto {
  @IsInt() @IsOptional() roomTypeId?: number;
  @IsString() @IsOptional() number?: string;
  @IsString() @IsOptional() floor?: string;
}

export class UpdateRoomStatusDto {
  @IsEnum(RoomStatus) status!: RoomStatus;
}

export class CreateHotelReservationDto {
  @IsInt() roomId!: number;
  @IsString() guestName!: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() checkIn!: string;
  @IsString() checkOut!: string;
  @IsString() @IsOptional() notes?: string;
}

export class UpdateHotelReservationDto {
  @IsInt() @IsOptional() roomId?: number;
  @IsString() @IsOptional() guestName?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() checkIn?: string;
  @IsString() @IsOptional() checkOut?: string;
  @IsString() @IsOptional() notes?: string;
}

export class AddFolioEntryDto {
  @IsString() description!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() @IsOptional() type?: string; // CHARGE | PAYMENT
  @IsInt() @IsOptional() accountId?: number;
}
