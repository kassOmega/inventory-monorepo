// src/cash/cash.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { CashService } from './cash.service';
import { RecordCollectionDto, RecordFloatDto, UpdateCashSettingsDto } from './dto/cash.dto';

@Controller('cashier')
export class CashController {
  constructor(private cash: CashService) {}

  @Get('pending')
  @Permissions('cashier.view')
  listPending(
    @Query('waiterId') waiterId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.cash.listPendingPayments({
      waiterId: waiterId ? Number(waiterId) : undefined,
      dateFrom,
      dateTo,
    });
  }

  @Post('payments/:id/confirm')
  @Permissions('cashier.confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.cash.confirmPayment(id, req.user.sub);
  }

  @Post('facility-payments/:id/confirm')
  @Permissions('cashier.confirm')
  confirmFacility(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.cash.confirmFacilityPayment(id, req.user.sub);
  }

  @Get('floats')
  @Permissions('finance.view', 'cashier.view')
  listFloats() {
    return this.cash.listFloats();
  }

  @Post('floats')
  @Permissions('finance.manage')
  recordFloat(@Body() dto: RecordFloatDto, @Req() req: RequestWithUser) {
    return this.cash.recordFloat(dto, req.user.sub);
  }

  @Get('collections')
  @Permissions('finance.view', 'cashier.view')
  listCollections() {
    return this.cash.listCollections();
  }

  @Post('collections')
  @Permissions('finance.manage')
  recordCollection(@Body() dto: RecordCollectionDto, @Req() req: RequestWithUser) {
    return this.cash.recordCollection(dto, req.user.sub);
  }

  @Get('summary')
  @Permissions('finance.view', 'cashier.view')
  summary() {
    return this.cash.collectionSummary();
  }

  @Get('staff')
  @Permissions('cashier.view', 'finance.view')
  listStaff() {
    return this.cash.listStaff();
  }

  @Get('settings')
  @Permissions('finance.view', 'cashier.view')
  getSettings() {
    return this.cash.getSettings();
  }

  @Put('settings')
  @Permissions('finance.manage')
  updateSettings(@Body() dto: UpdateCashSettingsDto) {
    return this.cash.updateSettings(dto);
  }
}
