import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly svc: PaymentMethodsService) {}

  // Reading the org's payment methods is required by every sales-adjacent flow
  // (sales, quick purchases, credits, request receipt-and-sell) in addition to
  // finance/cashier — so any authenticated member who can record money
  // movement needs read access. Mutations stay owner/finance-only below.
  @Get()
  @Permissions(
    'finance.view',
    'restaurant.view',
    'cashier.view',
    'sales.create',
    'purchases.create',
    'credits.manage',
    'requests.confirm',
    // Front desk collects money at checkout / settled a folio.
    'hotel.view',
    'hotel.reception',
  )
  findAll() {
    return this.svc.findAll();
  }

  @Post()
  @Permissions('finance.manage')
  create(@Body() dto: { name: string; isDigital?: boolean; account?: string }) {
    return this.svc.create(dto.name, dto.isDigital ?? false, dto.account);
  }

  @Patch(':id')
  @Permissions('finance.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: { name?: string; isDigital?: boolean; account?: string }) {
    return this.svc.update(id, dto.name, dto.isDigital, dto.account);
  }

  @Delete(':id')
  @Permissions('finance.manage')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}
