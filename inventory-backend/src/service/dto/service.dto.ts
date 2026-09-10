import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateServiceCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

export class CreateServiceItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  durationMins?: number;

  @IsOptional()
  @IsInt()
  categoryId?: number | null;
}

export class CreateServiceBookingDto {
  @IsOptional()
  @IsInt()
  clientId?: number | null;

  @IsOptional()
  @IsInt()
  serviceItemId?: number | null;

  @IsDateString()
  startsAt!: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

export class UpdateServiceBookingStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
}

export class CreateServiceTicketDto {
  @IsOptional()
  @IsInt()
  clientId?: number | null;

  @IsOptional()
  @IsInt()
  bookingId?: number | null;

  @IsArray()
  @IsOptional()
  items?: Array<{ serviceItemId: number; quantity?: number }>;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  notes?: string;
}

export class AddTicketItemDto {
  @IsInt()
  @IsPositive()
  serviceItemId!: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;
}

export class PayTicketDto {
  @IsOptional()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsInt()
  paymentMethodId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRef?: string;
}

export class UpdateTicketStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'PAID' | 'CANCELLED';
}
