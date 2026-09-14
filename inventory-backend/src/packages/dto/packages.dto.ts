// src/packages/dto/packages.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PackageEntitlementInputDto {
  // ITEM (default) covers F&B/menu lines via a station; CREDIT is a service-line
  // ETB allowance; PASS is a facility voucher/pass. Service-scoped lines use
  // hospitalityServiceId (and optionally membershipTypeId for PASS).
  @IsString() @IsOptional() entitlementKind?: 'ITEM' | 'CREDIT' | 'PASS';
  @IsInt() @IsOptional() stationId?: number;
  @IsInt() @IsOptional() menuCategoryId?: number;
  @IsInt() @IsOptional() menuItemId?: number;
  @IsString() @IsOptional() hospitalityServiceId?: string;
  @IsString() @IsOptional() membershipTypeId?: string;
  // Covered ETB value per unit. 0 = the item is fully covered by the package.
  @IsNumber() @Type(() => Number) @IsOptional() allowanceValue?: number;
  // Max covered units per day (null = unlimited).
  @IsInt() @IsOptional() dailyLimit?: number;
}

export class CreatePackageDto {
  // Optional: cross-service packages (e.g. stay + spa + pool) have no single
  // primary service; the entitlements carry the per-service targets.
  @IsString() @IsOptional() hospitalityServiceId?: string;
  @IsString() name!: string;
  @IsNumber() @Type(() => Number) @IsOptional() price?: number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageEntitlementInputDto)
  @IsOptional()
  entitlements?: PackageEntitlementInputDto[];
}

export class UpdatePackageDto {
  @IsString() @IsOptional() name?: string;
  @IsNumber() @Type(() => Number) @IsOptional() price?: number;
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageEntitlementInputDto)
  @IsOptional()
  entitlements?: PackageEntitlementInputDto[];
}

export class CheckInGuestDto {
  @IsString() packageId!: string;
  @IsString() guestName!: string;
  @IsString() @IsOptional() roomNumber?: string;
  /**
   * Optional hotel stay this guest is billed against. When set, ROOM_CHARGE
   * orders are validated against it and the room number is derived from the
   * reservation's room (so POS tags/lookups stay accurate).
   */
  @IsInt() @Type(() => Number) @IsOptional() hotelReservationId?: number;
}

// Settlement routing for the net charge on a package / room-charge bill is
// handled by normalizeNetChargeMode in common/hospitality-settings (the values
// PAY_NOW / DEFER_TO_FOLIO are accepted alongside the legacy aliases).
