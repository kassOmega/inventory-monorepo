import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCreditPaymentDto {
  @IsInt()
  customerId!: number;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  paymentMethodId?: number;

  // Optional link to the specific credit sale being settled.
  @IsOptional()
  @IsInt()
  saleId?: number | null;
}

export class UpdateCreditPaymentDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  paymentMethodId?: number;

  @IsOptional()
  @IsString()
  paidAt?: string;

  @IsOptional()
  @IsInt()
  saleId?: number | null;
}
