import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { GuestOrdersModule } from '../guest-orders/guest-orders.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [NotificationsModule, GuestOrdersModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
