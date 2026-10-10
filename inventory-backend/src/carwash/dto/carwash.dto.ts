import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWasherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @Min(0)
  commissionRate?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWasherDto {
  @IsString()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @Min(0)
  commissionRate?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertPriceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  vehicleType!: string;

  @IsOptional()
  @IsInt()
  washTypeId?: number | null;

  @Min(0)
  amount!: number;
}

export class CreateWashTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;
}

export class UpdateWashTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;
}

export class CreateVehicleTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;
}

export class UpdateVehicleTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;
}

export class CreateVehicleDto {
  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  plateNumber!: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  vehicleType?: string;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  plateNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;
}

export class CreateBookingItemDto {
  @IsOptional()
  @IsInt()
  vehicleId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;

  @IsOptional()
  @IsInt()
  washTypeId?: number | null;

  @IsOptional()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;
}

export class CreateBookingDto {
  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsInt()
  vehicleId?: number | null;

  @IsOptional()
  @IsInt()
  washerId?: number | null;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  vehicleType?: string;

  @IsOptional()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsBoolean()
  isTimeSlotBooking?: boolean;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  positionInQueue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  /// Multiple vehicles in one booking. When omitted, the single `vehicleId`
  /// fields above are wrapped into one item (backward compatible).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBookingItemDto)
  items?: CreateBookingItemDto[];
}

export class UpdateBookingStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: 'PENDING' | 'SERVING' | 'COMPLETED' | 'CANCELLED';
}

export class CreateWashDto {
  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsInt()
  vehicleId?: number | null;

  @IsOptional()
  @IsInt()
  washerId?: number | null;

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  participantWasherIds?: number[];

  @IsString()
  @IsOptional()
  @MaxLength(50)
  vehicleType?: string;

  @IsOptional()
  @IsInt()
  washTypeId?: number | null;

  @Min(0)
  amount!: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  plateNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  makeModel?: string;
}

export class StartWashDto {
  /** Primary washer to assign when the wash has none yet (optional). */
  @IsOptional()
  @IsInt()
  washerId?: number | null;

  /** Participant washers to record on start (optional). */
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  participantWasherIds?: number[];
}

export class UpdateWashDto {
  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsInt()
  vehicleId?: number | null;

  @IsOptional()
  @IsInt()
  washerId?: number | null;

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  participantWasherIds?: number[];

  @IsString()
  @IsOptional()
  @MaxLength(50)
  vehicleType?: string;

  @IsOptional()
  @IsInt()
  washTypeId?: number | null;

  @IsOptional()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  plateNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  makeModel?: string;
}

export class IssueEquipmentDto {
  @IsOptional()
  @IsInt()
  washerId?: number | null;

  @IsOptional()
  @IsInt()
  productId?: number | null;

  @IsPositive()
  quantity!: number;

  @IsOptional()
  @Min(0)
  unitPrice?: number;
}

export class PayEquipmentIssueDto {
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;
}

export class UpdateSettingsDto {
  @IsInt()
  @Min(5)
  slotMinutes!: number;
}

export class SettleWashDto {
  /** The payment method the money was received in (optional). */
  @IsOptional()
  @IsInt()
  paymentMethodId?: number;
}

export class CreateCarWashExpenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;
}

export class UpdateCarWashExpenseDto {
  @IsString()
  @IsOptional()
  @MaxLength(50)
  category?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  amount?: number;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;
}

export class CreateStoreItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @Min(0)
  sellingPrice?: number;

  @IsOptional()
  @Min(0)
  stock?: number;

  @IsOptional()
  @Min(0)
  minimumStock?: number;
}

export class UpdateStoreItemDto {
  @IsString()
  @IsOptional()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Min(0)
  sellingPrice?: number;

  @IsOptional()
  @Min(0)
  stock?: number;

  @IsOptional()
  @Min(0)
  minimumStock?: number;
}

export class CreateCollectionDto {
  @IsOptional()
  @Min(0)
  totalAmount?: number;

  @IsOptional()
  @IsDateString()
  collectionDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
