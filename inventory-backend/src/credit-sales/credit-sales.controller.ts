import { Controller, Post, Get, Delete, Body, Param, Req } from '@nestjs/common';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { CreditSalesService } from './credit-sales.service';
import { CreateCreditSaleDto } from './dto/create-credit-sale.dto';

@Controller('credit-sales')
export class CreditSalesController {
  constructor(private readonly svc: CreditSalesService) {}

  @Post()
  create(@Body() body: CreateCreditSaleDto, @Req() req: RequestWithUser) {
    return this.svc.create(body, req.user.sub);
  }

  @Get(':id')
  async findOne(@Param('id') ref: string) {
    return this.svc.findOne(await this.svc.resolveCreditSaleId(ref));
  }

  @Delete(':id')
  async remove(@Param('id') ref: string, @Req() req: RequestWithUser) {
    return this.svc.remove(await this.svc.resolveCreditSaleId(ref), req.user.sub);
  }
}
