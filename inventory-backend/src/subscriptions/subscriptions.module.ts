// src/subscriptions/subscriptions.module.ts
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { SubscriptionAiService } from './subscription-ai.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [SubscriptionsController, AdminSubscriptionsController],
  providers: [SubscriptionsService, SubscriptionAiService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
