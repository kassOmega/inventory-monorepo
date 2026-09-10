import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { PurchasesService } from './purchases.service';

@Controller('purchases')
export class PurchasesController {
  constructor(private svc: PurchasesService) {}

  @Post()
  @Permissions('purchases.create')
  create(
    @Body() dto: { productName: string; quantity: number; unitPrice: number; sellPrice: number; notes?: string; paymentMethodId?: number; clientRef?: string },
    @Req() req: RequestWithUser,
  ) {
    return this.svc.create(dto, req.user);
  }

  @Get()
  @Permissions('purchases.view')
  findAll(@Query('status') status?: string, @Query('search') search?: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Query('shopId') shopId?: string, @Req() req?: RequestWithUser) {
    return this.svc.findAll(req!.user, status, search, startDate, endDate, shopId ? Number(shopId) : undefined);
  }

  @Get('stats')
  @Permissions('purchases.view')
  stats(@Query('shopId') shopId?: string, @Query('search') search?: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string, @Req() req?: RequestWithUser) {
    return this.svc.stats(req!.user, shopId ? Number(shopId) : undefined, search, startDate, endDate);
  }

  @Patch(':id/approve')
  @Permissions('purchases.approve')
  approve(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.svc.approve(id, req.user);
  }

  @Patch(':id/reject')
  @Permissions('purchases.approve')
  reject(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.svc.reject(id, req.user);
  }
}