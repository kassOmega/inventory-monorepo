// src/inventory/inventory.controller.ts
import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { RecordWastageDto } from './dto/record-wastage.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** POST /inventory/wastage — write off spoiled/damaged stock. */
  @Post('wastage')
  @Permissions('products.adjust-stock', 'restaurant.manage')
  recordWastage(@Body() dto: RecordWastageDto, @Req() req: RequestWithUser) {
    return this.inventory.recordWastage(dto, req.user);
  }

  /** GET /inventory/wastage — wastage history (used by the Reports tab). */
  @Get('wastage')
  @Permissions('reports.view', 'products.adjust-stock')
  listWastage(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.inventory.listWastage(startDate, endDate);
  }
}
