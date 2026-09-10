// src/manufacturing/manufacturing.module.ts
import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';

import { ShiftAutomationService } from './shift-automation.service';

@Module({
  imports: [FinanceModule, NotificationsModule],
  controllers: [ManufacturingController],
  providers: [ManufacturingService, ShiftAutomationService],
})
export class ManufacturingModule {}
