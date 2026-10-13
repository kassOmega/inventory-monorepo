import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { SalesModule } from '../sales/sales.module';
import { HotelModule } from '../hotel/hotel.module';
import { ServiceModule } from '../service/service.module';
import { CarWashModule } from '../carwash/carwash.module';
import { GuestOrdersController } from './guest-orders.controller';
import { GuestOrdersService } from './guest-orders.service';
import { GuestOrderConversionService } from './guest-order-conversion.service';
import { GuestOrderNagService } from './guest-order-nag.service';

@Module({
  imports: [
    NotificationsModule,
    RestaurantModule,
    SalesModule,
    HotelModule,
    ServiceModule,
    CarWashModule,
  ],
  controllers: [GuestOrdersController],
  providers: [GuestOrdersService, GuestOrderConversionService, GuestOrderNagService],
  exports: [GuestOrdersService],
})
export class GuestOrdersModule {}
