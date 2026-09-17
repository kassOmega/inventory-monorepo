import { Body, Controller, Post, Req } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { RestockDto } from './dto/restock.dto';
import { BatchRestockDto } from './dto/batch-restock.dto';
import { RegisterPurchaseDto } from './dto/register-purchase.dto';
import { RestockService } from './restock.service';

@Controller('restock')
export class RestockController {
  constructor(private service: RestockService) {}

  @Post()
  @Permissions('restock.create')
  restock(@Body() dto: RestockDto, @Req() req: RequestWithUser) {
    return this.service.restock(dto, req.user);
  }

  /**
   * Restock many items at once: several products (with their variants) across
   * several locations. Validated up front; one request per receiving location.
   */
  @Post('batch')
  @Permissions('restock.create')
  restockBatch(@Body() dto: BatchRestockDto, @Req() req: RequestWithUser) {
    return this.service.restockBatch(dto, req.user);
  }

  @Post('purchase')
  @Permissions('restock.create', 'finance.manage')
  purchase(@Body() dto: RegisterPurchaseDto, @Req() req: RequestWithUser) {
    return this.service.registerPurchase(dto, req.user);
  }
}
