// src/verification/verification.module.ts
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VerificationAiService } from './verification-ai.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [AiModule, NotificationsModule],
  controllers: [VerificationController],
  providers: [VerificationService, VerificationAiService],
  exports: [VerificationService],
})
export class VerificationModule {}
