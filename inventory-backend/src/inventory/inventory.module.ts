// src/inventory/inventory.module.ts
import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [FinanceModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
