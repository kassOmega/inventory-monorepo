import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import {
  FiscalBatchAckDto,
  FiscalBatchDto,
  FiscalBatchFailDto,
  FiscalConfigDto,
} from './dto/fiscal.dto';
import { FiscalService } from './fiscal.service';

@Controller('fiscal')
export class FiscalController {
  constructor(private readonly svc: FiscalService) {}

  // Tenant-level hardware & MoR tax registration settings (1:1 per company).
  @Get('config')
  @Permissions(
    'finance.view',
    'finance.manage',
    'restaurant.manage',
    'restaurant.settle',
    'cashier.confirm',
    'cashier.view',
  )
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @Permissions('finance.manage')
  updateConfig(@Body() dto: FiscalConfigDto) {
    return this.svc.updateConfig(dto);
  }

  // Multi-order/sale consolidation (e.g. one whole table's bill).
  @Post('batch-summary')
  @Permissions(
    'restaurant.settle',
    'restaurant.manage',
    'cashier.confirm',
    'cashier.view',
    'finance.view',
    'sales.create',
  )
  batchSummary(@Body() dto: FiscalBatchDto) {
    return this.svc.getBatchSummary(dto);
  }

  @Post('batch-print')
  @Permissions('restaurant.settle', 'restaurant.manage', 'cashier.confirm', 'finance.manage')
  batchPrint(@Body() dto: FiscalBatchDto) {
    return this.svc.markBatchPrintPending(dto);
  }

  @Patch('batch-ack')
  @Permissions('restaurant.settle', 'restaurant.manage', 'cashier.confirm', 'finance.manage')
  batchAck(@Body() dto: FiscalBatchAckDto) {
    return this.svc.ackBatch(
      { orderIds: dto.orderIds, saleIds: dto.saleIds },
      {
        fsNumber: dto.fsNumber,
        ejNumber: dto.ejNumber,
        machineSerial: dto.machineSerial,
      },
    );
  }

  @Post('batch-print-failed')
  @Permissions('restaurant.settle', 'restaurant.manage', 'cashier.confirm', 'finance.manage')
  batchFailed(@Body() dto: FiscalBatchFailDto) {
    return this.svc.markBatchFailed(
      { orderIds: dto.orderIds, saleIds: dto.saleIds },
      { message: dto.message },
    );
  }
}
