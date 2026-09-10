import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

@Module({
  imports: [FinanceModule],
  controllers: [CashController],
  providers: [CashService],
})
export class CashModule {}
