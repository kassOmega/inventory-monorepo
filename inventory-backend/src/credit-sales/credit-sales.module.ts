import { Module } from '@nestjs/common';
import { CreditSalesController } from './credit-sales.controller';
import { CreditSalesService } from './credit-sales.service';

@Module({
  controllers: [CreditSalesController],
  providers: [CreditSalesService],
  exports: [CreditSalesService],
})
export class CreditSalesModule {}