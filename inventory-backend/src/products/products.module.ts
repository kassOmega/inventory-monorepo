import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [NotificationsModule, FinanceModule],
  providers: [ProductsService],
  controllers: [ProductsController],
})
export class ProductsModule {}
