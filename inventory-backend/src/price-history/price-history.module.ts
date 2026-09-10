import { Module } from '@nestjs/common';
import { PriceHistoryController } from './price-history.controller';
import { PriceHistoryService } from './price-history.service';

@Module({
  controllers: [PriceHistoryController],
  providers: [PriceHistoryService]
})
export class PriceHistoryModule {}
