import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
import { CreditSalesService } from './credit-sales.service';
import { CreateCreditSaleDto } from './dto/create-credit-sale.dto';

@Controller('credit-sales')
export class CreditSalesController {
  constructor(private readonly svc: CreditSalesService) {}

  @Post()
  create(@Body() body: CreateCreditSaleDto) {
    return this.svc.create(body);
  }

  @Get(':id')
  async findOne(@Param('id') ref: string) {
    return this.svc.findOne(await this.svc.resolveCreditSaleId(ref));
  }

  @Delete(':id')
  async remove(@Param('id') ref: string) {
    return this.svc.remove(await this.svc.resolveCreditSaleId(ref));
  }
}