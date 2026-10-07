// src/carwash/carwash.module.ts
import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { CarWashController } from './carwash.controller';
import { CarWashService } from './carwash.service';

@Module({
  imports: [FinanceModule],
  controllers: [CarWashController],
  providers: [CarWashService],
})
export class CarWashModule {}
