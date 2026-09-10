import { IsString } from 'class-validator';

export class CreateLocationCategoryDto {
  @IsString()
  name!: string;
}
