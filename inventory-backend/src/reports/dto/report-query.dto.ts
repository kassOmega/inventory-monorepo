import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

function toPositiveInt() {
  return Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }
    const num = Number(value);
    return Number.isInteger(num) && num > 0 ? num : undefined;
  });
}

function toOptionalDate() {
  return Transform(({ value }) => (value === '' ? undefined : value));
}

export class ReportQueryDto {
  @IsOptional()
  @toPositiveInt()
  @IsInt()
  @IsPositive()
  locationId?: number;

  @IsOptional()
  @toPositiveInt()
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @toOptionalDate()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @toOptionalDate()
  @IsDateString()
  endDate?: string;
}
