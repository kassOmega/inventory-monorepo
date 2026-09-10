import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SuggestVariantItemDto {
  @IsOptional()
  @IsString()
  slot1?: string;

  @IsOptional()
  @IsString()
  slot2?: string;

  @IsOptional()
  @IsString()
  slot3?: string;

  @IsOptional()
  @IsString()
  slot4?: string;

  @IsOptional()
  @IsString()
  sku?: string;
}

/** AI variant suggestion request (from the Variant Builder). */
export class SuggestVariantsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  baseName?: string;

  /** Variant rows already in the form — the AI keeps them and fills the gaps. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SuggestVariantItemDto)
  existing?: SuggestVariantItemDto[];
}
