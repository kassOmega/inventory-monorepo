// src/restaurant/dto/restaurant.dto.ts
import { MenuItemTrackingMode, OrderItemStatus, OrderStatus, TableStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateMenuCategoryDto {
  @IsString() name!: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsInt() @IsOptional() stationId?: number;
  // Ordered station ids the items route through (defaults to [stationId]).
  @IsArray() @IsInt({ each: true }) @IsOptional() route?: number[];
}

export class CreateStationDto {
  @IsString() @MaxLength(50) name!: string;
  @IsString() @MaxLength(50) @IsOptional() key?: string;
  @IsString() @MaxLength(50) @IsOptional() roleName?: string;
  @IsInt() @IsOptional() sortOrder?: number;
}

export class UpdateStationDto {
  @IsString() @MaxLength(50) @IsOptional() name?: string;
  @IsString() @MaxLength(50) @IsOptional() key?: string;
  @IsString() @MaxLength(50) @IsOptional() roleName?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsBoolean() @IsOptional() isActive?: boolean;
}

export class CreateMenuItemOptionDto {
  @IsString() name!: string;
  @IsNumber() @Type(() => Number) @IsOptional() extraPrice?: number;
}

export class CreateMenuItemDto {
  @IsInt() menuCategoryId!: number;
  @IsString() name!: string;
  @IsString() @IsOptional() description?: string;
  @IsNumber() @Type(() => Number) price!: number;
  @IsNumber() @Type(() => Number) @IsOptional() cost?: number;
  @IsEnum(MenuItemTrackingMode) @IsOptional() trackingMode?: MenuItemTrackingMode;
  // Required when trackingMode is BENCHMARK (estimated cost per portion).
  @IsNumber() @Type(() => Number) @IsOptional() estimatedCogs?: number;
  @IsBoolean() @IsOptional() isAvailable?: boolean;
  // Treatment duration in minutes (spa / wellness service items). Optional.
  @IsInt() @IsOptional() durationMins?: number;
  // Optional per-item station-route override (ordered station ids).
  @IsArray() @IsInt({ each: true }) @IsOptional() stationRoute?: number[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateMenuItemOptionDto) @IsOptional() options?: CreateMenuItemOptionDto[];
}

export class UpdateMenuItemOptionDto {
  @IsString() @IsOptional() name?: string;
  @IsNumber() @Type(() => Number) @IsOptional() extraPrice?: number;
}

export class UpdateMenuItemDto {
  @IsInt() @IsOptional() menuCategoryId?: number;
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsNumber() @Type(() => Number) @IsOptional() price?: number;
  @IsNumber() @Type(() => Number) @IsOptional() cost?: number;
  @IsEnum(MenuItemTrackingMode) @IsOptional() trackingMode?: MenuItemTrackingMode;
  @IsNumber() @Type(() => Number) @IsOptional() estimatedCogs?: number;
  @IsBoolean() @IsOptional() isAvailable?: boolean;
  @IsInt() @IsOptional() sortOrder?: number;
  // Treatment duration in minutes (spa / wellness service items). Optional.
  @IsInt() @IsOptional() durationMins?: number;
  // Optional per-item station-route override (ordered station ids).
  @IsArray() @IsInt({ each: true }) @IsOptional() stationRoute?: number[];
}

/** One ingredient line of a menu item recipe. */
export class MenuIngredientDto {
  @IsInt() productId!: number;
  @IsNumber() @Type(() => Number) @Min(0) quantityPerUnit!: number;
}

/** Bulk-replace a menu item's recipe (empty array clears it → manual cost fallback). */
export class SetMenuItemRecipeDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => MenuIngredientDto)
  ingredients!: MenuIngredientDto[];
}

export class UpdateMenuCategoryDto {
  @IsString() @IsOptional() name?: string;
  @IsInt() @IsOptional() sortOrder?: number;
  @IsInt() @IsOptional() stationId?: number;
  // Ordered station ids the items route through (defaults to [stationId]).
  @IsArray() @IsInt({ each: true }) @IsOptional() route?: number[];
}

export class CreateTableDto {
  @IsString() name!: string;
  @IsString() @IsOptional() zone?: string;
  @IsInt() @IsOptional() capacity?: number;
}

export class UpdateTableStatusDto {
  @IsEnum(TableStatus) status!: TableStatus;
}

export class OrderItemInputDto {
  @IsInt() menuItemId!: number;
  @IsInt() quantity!: number;
  @IsString() @IsOptional() notes?: string;
}

// Hospitality package / room charging. Only honored when the matching company
// policy is on (enablePackageRouting for packages/entitlements,
// enableRoomFolioCharging for charge-to-room); STANDARD (absent) keeps the
// classic POS flow.
export class BillingInputDto {
  @IsString() @IsOptional() type?: 'STANDARD' | 'PACKAGE' | 'ROOM_CHARGE';
  @IsString() @IsOptional() packageGuestId?: string;
  @IsString() @IsOptional() packageId?: string;
  @IsString() @IsOptional() roomNumber?: string;
  // Charge-to-room: the active hotel stay this order is billed to. Required for
  // ROOM_CHARGE when the guest is not on a package; package guests may send it
  // too so the folio link is explicit.
  @IsInt() @Type(() => Number) @IsOptional() hotelReservationId?: number;
  // Settlement intent captured at order time. DEFER_TO_FOLIO appends the
  // itemized lines to the stay/guest folio (the default for charge-to-room);
  // PAY_NOW collects the excess at the terminal.
  @IsString() @IsOptional() netChargeMode?: 'FOLIO' | 'COLLECT_NOW' | 'PAY_NOW' | 'DEFER_TO_FOLIO';
}

export class CreateOrderDto {
  @IsInt() @IsOptional() tableId?: number;
  @IsString() @IsOptional() customerName?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items!: OrderItemInputDto[];
  @IsString() @IsOptional() @MaxLength(100) clientRef?: string;
  @IsOptional() @ValidateNested() @Type(() => BillingInputDto) billing?: BillingInputDto;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus) status!: OrderStatus;
}

export class UpdateOrderDto {
  @IsInt() @IsOptional() tableId?: number;
  @IsString() @IsOptional() customerName?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) @IsOptional() items?: OrderItemInputDto[];
}

export class UpdateOrderItemStatusDto {
  @IsEnum(OrderItemStatus) status!: OrderItemStatus;
}

export class PaymentInputDto {
  @IsNumber() @Type(() => Number) @IsOptional() amount?: number;
  @IsInt() @IsOptional() paymentMethodId?: number;
  @IsString() @IsOptional() transactionReference?: string;
}

export class SettleOrderDto {
  @IsInt() @IsOptional() paymentMethodId?: number;
  @IsNumber() @Type(() => Number) @IsOptional() discount?: number;
  @IsNumber() @Type(() => Number) @IsOptional() serviceCharge?: number;
  @IsNumber() @Type(() => Number) @IsOptional() tax?: number;
  @IsNumber() @Type(() => Number) @IsOptional() paidAmount?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentInputDto) @IsOptional() payments?: PaymentInputDto[];
  // Package/room orders: where the excess (net charge) goes.
  // PAY_NOW = collect at the terminal (legacy COLLECT_NOW);
  // DEFER_TO_FOLIO = append to the guest room folio (legacy FOLIO).
  // Honored in FLEXIBLE policy; overridden by DEFER_TO_FOLIO_ONLY / COLLECT_NOW_ONLY.
  @IsString() @IsOptional() netChargeMode?: 'FOLIO' | 'COLLECT_NOW' | 'PAY_NOW' | 'DEFER_TO_FOLIO';
}

export class SettleBatchDto extends SettleOrderDto {
  @IsArray() @IsInt({ each: true }) orderIds!: number[];
}

export class CreateReservationDto {
  @IsInt() @IsOptional() tableId?: number;
  @IsString() customerName!: string;
  @IsString() @IsOptional() phone?: string;
  @IsInt() @IsOptional() partySize?: number;
  @IsString() reservedAt!: string;
  @IsString() @IsOptional() notes?: string;
}

export class UpdateReservationStatusDto {
  @IsString() status!: string;
}
