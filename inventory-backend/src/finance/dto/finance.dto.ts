// src/finance/dto/finance.dto.ts
import { AccountType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateAccountDto {
  @IsString() name!: string;
  @IsString() @IsOptional() code?: string;
  @IsEnum(AccountType) type!: AccountType;
  @IsInt() @IsOptional() parentId?: number;
}

export class CreateExpenseDto {
  @IsInt() accountId!: number; // expense category (account auto-linked under the hood)
  @IsString() @IsOptional() vendor?: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsInt() @IsOptional() paymentMethodId?: number;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() expenseDate?: string;
  @IsInt() @IsOptional() taxRateId?: number;
}

export class CreateIncomeDto {
  @IsInt() accountId!: number;
  @IsString() @IsOptional() description?: string;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() @IsOptional() incomeDate?: string;
}

export class JournalLineDto {
  @IsInt() accountId!: number;
  @IsNumber() @Type(() => Number) @IsOptional() debit?: number;
  @IsNumber() @Type(() => Number) @IsOptional() credit?: number;
}

export class CreateJournalEntryDto {
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() entryDate?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => JournalLineDto) lines!: JournalLineDto[];
}

export class UpdateAccountDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() code?: string;
  @IsEnum(AccountType) @IsOptional() type?: AccountType;
  @IsInt() @IsOptional() parentId?: number;
}

export class UpdateExpenseDto {
  @IsInt() @IsOptional() accountId?: number;
  @IsString() @IsOptional() vendor?: string;
  @IsNumber() @Type(() => Number) @IsOptional() amount?: number;
  @IsInt() @IsOptional() paymentMethodId?: number;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() expenseDate?: string;
}

export class UpdateIncomeDto {
  @IsInt() @IsOptional() accountId?: number;
  @IsString() @IsOptional() description?: string;
  @IsNumber() @Type(() => Number) @IsOptional() amount?: number;
  @IsString() @IsOptional() incomeDate?: string;
}

export class UpsertAccountMappingDto {
  @IsInt() @IsOptional() debitAccountId?: number;
  @IsInt() @IsOptional() creditAccountId?: number;
}
