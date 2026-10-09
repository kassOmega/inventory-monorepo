import { Controller, Post, Put, Delete, Body, Param, Req } from '@nestjs/common';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { CreditPaymentsService } from './credit-payments.service';
import {
  CreateCreditPaymentDto,
  UpdateCreditPaymentDto,
} from './dto/credit-payment.dto';

@Controller('credit-payments')
export class CreditPaymentsController {
  constructor(private readonly svc: CreditPaymentsService) {}

  @Post()
  create(@Body() body: CreateCreditPaymentDto, @Req() req: RequestWithUser) {
    return this.svc.create({ ...body, actorId: req.user.sub });
  }

  @Put(':id')
  async update(
    @Param('id') ref: string,
    @Body() body: UpdateCreditPaymentDto,
    @Req() req: RequestWithUser,
  ) {
    return this.svc.update(
      await this.svc.resolveCreditPaymentId(ref),
      body,
      req.user.sub,
    );
  }

  @Delete(':id')
  async remove(@Param('id') ref: string, @Req() req: RequestWithUser) {
    return this.svc.remove(
      await this.svc.resolveCreditPaymentId(ref),
      req.user.sub,
    );
  }
}
