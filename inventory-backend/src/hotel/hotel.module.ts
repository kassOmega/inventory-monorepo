import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { HotelController } from './hotel.controller';
import { HotelService } from './hotel.service';

@Module({
  imports: [FinanceModule],
  controllers: [HotelController],
  providers: [HotelService],
})
export class HotelModule {}
