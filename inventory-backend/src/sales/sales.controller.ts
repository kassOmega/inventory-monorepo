import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { parsePaging } from '../common/pagination.util';
import { FiscalService } from '../fiscal/fiscal.service';
import { FiscalAckDto, FiscalFailDto } from '../fiscal/dto/fiscal.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ReturnSaleDto } from './dto/return-sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(
    private service: SalesService,
    private fiscal: FiscalService,
  ) {}

  @Post()
  @Permissions('sales.create')
  createSale(@Body() dto: CreateSaleDto, @Req() req: RequestWithUser) {
    return this.service.createSale(dto, req.user);
  }

  @Get()
  @Permissions('sales.view')
  findAll(
    @Req() req: RequestWithUser,
    @Query('locationId') locationId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('saleType') saleType?: string,
    @Query('paymentMethodId') paymentMethodId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    return this.service.findAll(
      req.user,
      {
        locationId,
        categoryId,
        search,
        saleType,
        paymentMethodId,
        dateFrom,
        dateTo,
      },
      parsePaging(query),
    );
  }

  @Get('returns')
  @Permissions('sales.return')
  findReturns(@Req() req: RequestWithUser) {
    return this.service.findReturns(req.user);
  }

  @Get(':id')
  @Permissions('sales.view')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.service.findOne(id, req.user);
  }

  @Post(':id/return')
  @Permissions('sales.return')
  returnSale(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReturnSaleDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.returnSale(id, dto, req.user);
  }

  // --- Fiscal printing (universal invoice summary + local-agent lifecycle) ---
  @Get(':id/fiscal-summary')
  @Permissions('sales.view', 'sales.create', 'cashier.view', 'cashier.confirm', 'finance.view')
  fiscalSaleSummary(@Param('id', ParseIntPipe) id: number) {
    return this.fiscal.getSummary({ saleId: id });
  }

  @Post(':id/fiscal-print')
  @Permissions('sales.create', 'cashier.confirm', 'finance.manage')
  fiscalSalePrint(@Param('id', ParseIntPipe) id: number) {
    return this.fiscal.markPrintPending({ saleId: id });
  }

  @Patch(':id/fiscal-ack')
  @Permissions('sales.create', 'cashier.confirm', 'finance.manage')
  fiscalSaleAck(@Param('id', ParseIntPipe) id: number, @Body() dto: FiscalAckDto) {
    return this.fiscal.ack({ saleId: id }, dto);
  }

  @Post(':id/fiscal-print-failed')
  @Permissions('sales.create', 'cashier.confirm', 'finance.manage')
  fiscalSaleFailed(@Param('id', ParseIntPipe) id: number, @Body() dto: FiscalFailDto) {
    return this.fiscal.markFailed({ saleId: id }, dto);
  }

  @Put(':id')
  @Permissions('sales.edit')
  updateSale(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSaleDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.updateSale(id, dto, req.user);
  }

  @Delete('returns/:id')
  @Permissions('sales.return')
  removeReturn(
    @Param('id', ParseIntPipe) id: number,
    @Query('restore') restore: string,
    @Req() req: RequestWithUser,
  ) {
    return this.service.removeReturn(id, req.user, restore === 'true');
  }

  @Delete(':id')
  @Permissions('sales.delete')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithUser,
  ) {
    return this.service.removeSale(id, req.user);
  }
}
