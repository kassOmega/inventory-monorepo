// src/restaurant/restaurant.module.ts
import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { MenuRecipeService } from './menu-recipe.service';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';

@Module({
  imports: [NotificationsModule, FinanceModule, FiscalModule],
  controllers: [RestaurantController],
  providers: [RestaurantService, MenuRecipeService],
  exports: [MenuRecipeService],
})
export class RestaurantModule {}
