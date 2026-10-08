// src/purchases/purchases.controller.ts
// One controller for every purchase — paid or credited. The route is the same
// for both; `paymentType` in the body decides how approval books it.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import {
  CreatePurchaseBulkDto,
  CreatePurchaseDto,
  CreateVendorPaymentDto,
  UpdatePurchaseDto,
  UpdateVendorPaymentDto,
} from './dto/purchase.dto';
import { PurchaseFilters, PurchasesService } from './purchases.service';

@Controller('purchases')
export class PurchasesController {
  constructor(private svc: PurchasesService) {}

  @Post()
  @Permissions('purchases.create')
  create(@Body() dto: CreatePurchaseDto, @Req() req: RequestWithUser) {
    return this.svc.create(dto, req.user);
  }

  @Post('bulk')
  @Permissions('purchases.create')
  createBulk(@Body() dto: CreatePurchaseBulkDto, @Req() req: RequestWithUser) {
    return this.svc.createBulk(dto, req.user);
  }

  @Get()
  @Permissions('purchases.view')
  findAll(
    @Query('paymentType') paymentType?: string,
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('shopId') shopId?: string,
    @Query('vendorCustomerId') vendorCustomerId?: string,
    @Req() req?: RequestWithUser,
  ) {
    return this.svc.findAll(
      req!.user,
      parseFilters({
        paymentType,
        status,
        paymentStatus,
        search,
        startDate,
        endDate,
        shopId,
        vendorCustomerId,
      }),
    );
  }

  @Get('stats')
  @Permissions('purchases.view')
  stats(
    @Query('paymentType') paymentType?: string,
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('shopId') shopId?: string,
    @Query('vendorCustomerId') vendorCustomerId?: string,
    @Req() req?: RequestWithUser,
  ) {
    return this.svc.stats(
      req!.user,
      parseFilters({
        paymentType,
        status,
        paymentStatus,
        search,
        startDate,
        endDate,
        shopId,
        vendorCustomerId,
      }),
    );
  }

  @Get(':id')
  @Permissions('purchases.view')
  findOne(@Param('id') ref: string) {
    return this.svc.findOne(ref);
  }

  @Patch(':id')
  @Permissions('purchases.create')
  async update(@Param('id') ref: string, @Body() dto: UpdatePurchaseDto) {
    return this.svc.update(await this.svc.resolvePurchaseId(ref), dto);
  }

  @Delete(':id')
  @Permissions('purchases.create')
  async remove(@Param('id') ref: string) {
    return this.svc.remove(await this.svc.resolvePurchaseId(ref));
  }

  @Patch(':id/approve')
  @Permissions('purchases.approve')
  async approve(@Param('id') ref: string, @Req() req: RequestWithUser) {
    return this.svc.approve(await this.svc.resolvePurchaseId(ref), req.user);
  }

  @Patch(':id/reject')
  @Permissions('purchases.approve')
  async reject(@Param('id') ref: string, @Req() req: RequestWithUser) {
    return this.svc.reject(await this.svc.resolvePurchaseId(ref), req.user);
  }

  // --- Vendor paybacks (credit purchases only) ----------------------------

  @Post(':id/payments')
  @Permissions('purchases.create', 'credits.manage')
  async createPayment(
    @Param('id') ref: string,
    @Body() dto: CreateVendorPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.svc.createPayment(
      await this.svc.resolvePurchaseId(ref),
      dto,
      req.user,
    );
  }

  @Patch('payments/:id')
  @Permissions('purchases.create', 'credits.manage')
  async updatePayment(
    @Param('id') ref: string,
    @Body() dto: UpdateVendorPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.svc.updatePayment(
      await this.svc.resolvePaymentId(ref),
      dto,
      req.user,
    );
  }

  @Delete('payments/:id')
  @Permissions('purchases.create', 'credits.manage')
  async removePayment(@Param('id') ref: string) {
    return this.svc.removePayment(await this.svc.resolvePaymentId(ref));
  }
}

/** Query strings arrive as text — only the filters that are set are passed on. */
function parseFilters(q: Record<string, string | undefined>): PurchaseFilters {
  const filters: PurchaseFilters = {};
  if (q.paymentType) filters.paymentType = q.paymentType;
  if (q.status) filters.status = q.status;
  if (q.paymentStatus) filters.paymentStatus = q.paymentStatus;
  if (q.search) filters.search = q.search;
  if (q.startDate) filters.startDate = q.startDate;
  if (q.endDate) filters.endDate = q.endDate;
  if (q.shopId) filters.shopId = Number(q.shopId);
  if (q.vendorCustomerId) filters.vendorCustomerId = Number(q.vendorCustomerId);
  return filters;
}
