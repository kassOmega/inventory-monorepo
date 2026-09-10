import { LocationType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  name!: string;

  @IsEnum(LocationType)
  type!: LocationType;

  @IsInt()
  @IsOptional()
  categoryId?: number;
}
