import { Controller, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { CreditPaymentsService } from './credit-payments.service';
import {
  CreateCreditPaymentDto,
  UpdateCreditPaymentDto,
} from './dto/credit-payment.dto';

@Controller('credit-payments')
export class CreditPaymentsController {
  constructor(private readonly svc: CreditPaymentsService) {}

  @Post()
  create(@Body() body: CreateCreditPaymentDto) {
    return this.svc.create(body);
  }

  @Put(':id')
  async update(
    @Param('id') ref: string,
    @Body() body: UpdateCreditPaymentDto,
  ) {
    return this.svc.update(await this.svc.resolveCreditPaymentId(ref), body);
  }

  @Delete(':id')
  async remove(@Param('id') ref: string) {
    return this.svc.remove(await this.svc.resolveCreditPaymentId(ref));
  }
}