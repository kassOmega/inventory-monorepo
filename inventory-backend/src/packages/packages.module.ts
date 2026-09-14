// src/packages/packages.module.ts
import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { HotelModule } from '../hotel/hotel.module';
import {
  PackagesController,
  GuestsController,
  FoliosController,
} from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  imports: [FinanceModule, HotelModule],
  controllers: [PackagesController, GuestsController, FoliosController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
