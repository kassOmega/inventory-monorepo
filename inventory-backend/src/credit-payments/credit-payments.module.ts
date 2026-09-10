import { Module } from '@nestjs/common';
import { CreditPaymentsController } from './credit-payments.controller';
import { CreditPaymentsService } from './credit-payments.service';

@Module({
  controllers: [CreditPaymentsController],
  providers: [CreditPaymentsService],
  exports: [CreditPaymentsService],
})
export class CreditPaymentsModule {}