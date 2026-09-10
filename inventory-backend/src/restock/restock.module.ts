import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestockController } from './restock.controller';
import { RestockService } from './restock.service';

@Module({
  imports: [NotificationsModule, FinanceModule],
  providers: [RestockService],
  controllers: [RestockController],
})
export class RestockModule {}
