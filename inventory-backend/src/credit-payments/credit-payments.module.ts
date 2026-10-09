import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CreditPaymentsController } from './credit-payments.controller';
import { CreditPaymentsService } from './credit-payments.service';

@Module({
  imports: [FinanceModule],
  controllers: [CreditPaymentsController],
  providers: [CreditPaymentsService],
  exports: [CreditPaymentsService],
})
export class CreditPaymentsModule {}