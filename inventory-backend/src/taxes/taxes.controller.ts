import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { CreateTaxRateDto, TaxSettingsDto, UpdateTaxRateDto } from './dto/tax.dto';
import { TaxesService } from './taxes.service';

@Controller('taxes')
export class TaxesController {
  constructor(private readonly svc: TaxesService) {}

  @Get()
  @Permissions(
    'finance.view',
    'finance.manage',
    'restaurant.view',
    'restaurant.settle',
    'cashier.view',
    'cashier.confirm',
    'sales.create',
    'purchases.create',
  )
  findAll() {
    return this.svc.findAll();
  }

  @Post()
  @Permissions('finance.manage')
  create(@Body() dto: CreateTaxRateDto) {
    return this.svc.create(dto);
  }

  // Declared before `:id` so "/taxes/settings" isn't captured by the id param.
  @Patch('settings')
  @Permissions('finance.manage')
  updateSettings(@Body() dto: TaxSettingsDto) {
    return this.svc.updateSettings(dto);
  }

  @Patch(':id')
  @Permissions('finance.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaxRateDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Permissions('finance.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}
