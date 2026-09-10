import { ProductKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * On-the-fly item creation inside the inventory purchase flow. When
 * `variantAttributes` are provided a Root Item + Initial Variant are created
 * and the purchase is registered against that variant; otherwise a standalone
 * Root Item is created.
 */
export class CreatePurchaseItemDto {
  @IsString()
  name!: string; // baseName of the new item

  @IsOptional()
  @IsString()
  brand?: string;

  // Unit of measure (required for INGREDIENT items, e.g. kg, L, g).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  // Product category - always required for new items (Product.categoryId).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsEnum(ProductKind)
  kind?: ProductKind;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  sellPrice?: number;

  // e.g. { size: '41', color: 'Blue' } or { volume: '330ml' }.
  @IsOptional()
  @IsObject()
  variantAttributes?: Record<string, string>;

  // Hospitality multi-variant creation: one entry per variant, each carrying its
  // own quantity + total cost. Supersedes `variantAttributes` for hospitality.
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseVariantDto)
  variants?: CreatePurchaseVariantDto[];
}

/**
 * One variant line in a hospitality multi-variant inventory purchase. Each
 * variant carries its own quantity and total cost so the per-unit buy price
 * (totalCost / quantity) is derived per variant.
 */
export class CreatePurchaseVariantDto {
  // e.g. { size: '41', color: 'Blue' } or { volume: '330ml' }.
  @IsObject()
  attributes!: Record<string, string>;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  // Money spent (ETB) on this variant line.
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalCost!: number;
}

/**
 * One purchase line targeting an existing variant of a product (hospitality
 * multi-variant purchase of an existing item).
 */
export class RegisterPurchaseLineDto {
  @Type(() => Number)
  @IsInt()
  variantId!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalCost!: number;
}

/**
 * Inventory purchase / expense registration (the "Inventory Purchase" tab of
 * the dual-mode Add Expense modal). Either targets an existing item
 * (`productId` + optional `variantId` or `lines`) or creates one on the fly
 * (`createNew`).
 *
 * The unit buy price is derived server-side: unitBuyPrice = totalAmount / qty.
 * For multi-variant purchases (`lines` / `createNew.variants`) the aggregates
 * are derived from the per-variant quantities and totals.
 * `paid` selects the ledger credit leg: true -> Cash, false -> Accounts Payable.
 */
export class RegisterPurchaseDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  // Required when the target product has variants; stock lands on this row.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  variantId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePurchaseItemDto)
  createNew?: CreatePurchaseItemDto;

  // Hospitality multi-variant purchase of an EXISTING variant product: one line
  // per variant (each with its own quantity + total cost). Hospitality only.
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RegisterPurchaseLineDto)
  lines?: RegisterPurchaseLineDto[];

  @IsInt()
  @Type(() => Number)
  @IsPositive()
  quantity!: number;

  // Total money spent (ETB) on this purchase - drives the derived unit price.
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  totalAmount!: number;

  // true -> Credit Cash; false -> Credit Accounts Payable. Defaults to true.
  @IsOptional()
  @IsBoolean()
  paid?: boolean;

  // Target location (store/shop). Standalone orgs omit it - the backend
  // resolves the org's single shop.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  storeId?: number;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  expenseDate?: string;
}
