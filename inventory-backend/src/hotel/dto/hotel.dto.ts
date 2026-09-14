// src/hotel/dto/hotel.dto.ts
import { RoomStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

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

/**
 * Guest registration / identification details. Captured when the reservation is
 * taken and completed (or corrected) at check-in; `idTypeId` points at the
 * tenant's configurable GuestIdType registry.
 */
export class GuestRegistrationDto {
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() nationality?: string;
  @IsInt() @Type(() => Number) @IsOptional() idTypeId?: number;
  @IsString() @IsOptional() idNumber?: string;
  @IsString() @IsOptional() idExpiryDate?: string; // ISO date
  @IsString() @IsOptional() emergencyContactName?: string;
  @IsString() @IsOptional() emergencyContactPhone?: string;
}

export class CreateHotelReservationDto extends GuestRegistrationDto {
  @IsInt() roomId!: number;
  @IsString() guestName!: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() checkIn!: string;
  @IsString() checkOut!: string;
  @IsString() @IsOptional() notes?: string;
}

export class UpdateHotelReservationDto extends GuestRegistrationDto {
  @IsInt() @IsOptional() roomId?: number;
  @IsString() @IsOptional() guestName?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() checkIn?: string;
  @IsString() @IsOptional() checkOut?: string;
  @IsString() @IsOptional() notes?: string;
}

/**
 * Interactive check-in. The body is optional so the one-click check-in keeps
 * working; when present it records the guest's ID details and may reassign the
 * room (e.g. the booked category is dirty and a same-category room is free).
 */
export class CheckInGuestDto extends GuestRegistrationDto {
  @IsString() @IsOptional() guestName?: string;
  @IsString() @IsOptional() phone?: string;
  @IsInt() @Type(() => Number) @IsOptional() roomId?: number;
  @IsString() @IsOptional() notes?: string;
}

/** Date-range room availability search. */
export class RoomsAvailableQueryDto {
  @IsString() checkInDate!: string;
  @IsString() checkOutDate!: string;
  @IsInt() @Type(() => Number) @IsOptional() roomTypeId?: number;
  // Ignore this reservation's own booking — used when re-picking a room at
  // check-in, so the stay's current room is still offered.
  @IsInt() @Type(() => Number) @IsOptional() excludeReservationId?: number;
}

export class CreateGuestIdTypeDto {
  @IsString() name!: string;
  // Derived from the name when omitted (e.g. "Kebele ID" -> "KEBELE_ID").
  @IsString() @IsOptional() code?: string;
  @IsBoolean() @IsOptional() requiresExpiry?: boolean;
  @IsInt() @Type(() => Number) @IsOptional() sortOrder?: number;
}

export class UpdateGuestIdTypeDto {
  @IsString() @IsOptional() name?: string;
  @IsBoolean() @IsOptional() requiresExpiry?: boolean;
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsInt() @Type(() => Number) @IsOptional() sortOrder?: number;
}

export class AddFolioEntryDto {
  @IsString() description!: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() @IsOptional() type?: string; // CHARGE | PAYMENT
  @IsInt() @IsOptional() accountId?: number;
}

/** One payment collected at front-desk checkout (split payments supported). */
export class CheckoutPaymentDto {
  @IsNumber() @Type(() => Number) amount!: number;
  @IsInt() @Type(() => Number) @IsOptional() paymentMethodId?: number;
  @IsString() @IsOptional() transactionReference?: string;
}

export class CheckoutReservationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutPaymentDto)
  @IsOptional()
  payments?: CheckoutPaymentDto[];
  // Release the room even when a balance is still unsettled.
  @IsBoolean() @IsOptional() force?: boolean;
}

