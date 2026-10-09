import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmployeeDeductionsController } from './employee-deductions.controller';
import { EmployeeDeductionsService } from './employee-deductions.service';

@Module({
  imports: [FinanceModule, NotificationsModule],
  controllers: [EmployeeDeductionsController],
  providers: [EmployeeDeductionsService],
  exports: [EmployeeDeductionsService],
})
export class EmployeeDeductionsModule {}
