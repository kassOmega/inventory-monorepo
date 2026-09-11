import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { parsePaging } from '../common/pagination.util';
import { AddVariantDto } from './dto/add-variant.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Post()
  @Permissions('products.create')
  create(@Body() dto: CreateProductDto, @Req() req: RequestWithUser) {
    return this.service.create(dto, req.user);
  }

  @Get()
  @Permissions('products.view')
  findAll(
    @Req() req: RequestWithUser,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('locationId') locationId?: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    return this.service.findAll(
      req.user,
      search,
      categoryId,
      locationId ? +locationId : undefined,
      parsePaging(query),
    );
  }

  // The authenticated user's own location stock levels (dashboard widget).
  // Defined before @Get(':id') so it isn't captured by the id param route.
  @Get('my-inventory')
  @Permissions('products.view')
  findMyInventory(
    @Req() req: RequestWithUser,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.findMyInventory(req.user, search, categoryId);
  }

  // Duplicate detection for the add-product form: returns an exact
  // case-insensitive brand + baseName match (if any) so the form can pre-fill
  // and let the user adjust what should be different.
  @Get('lookup')
  @Permissions('products.view', 'products.create')
  lookup(
    @Query('brand') brand?: string,
    @Query('baseName') baseName?: string,
  ) {
    return this.service.lookupByBrandBase(brand, baseName);
  }

  // Exact barcode/SKU lookup for the POS "scan to cart" flow: returns the
  // matching product, plus the variant when a variant code was scanned.
  // Also declared before @Get(':id') so "by-code" is not captured by it.
  @Get('by-code')
  @Permissions('products.view')
  findByCode(
    @Query('code') code?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.service.findByCode(
      code,
      locationId ? Number(locationId) : undefined,
    );
  }

  @Get(':id')
  @Permissions('products.view')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.service.findOne(id, req.user);
  }

  @Put(':id')
  @Permissions('products.edit')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  @Permissions('products.delete')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Post(':id/variants')
  @Permissions('products.edit', 'products.adjust-stock')
  addVariant(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddVariantDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.addVariant(id, dto, req.user);
  }

  @Post(':id/adjust-stock')
  @Permissions('products.adjust-stock')
  adjustStock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustStockDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.adjustStock(id, dto, req.user);
  }
}
