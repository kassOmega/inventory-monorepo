import { Module } from '@nestjs/common';
import { CustomerLoyaltyService } from './customer-loyalty.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerLoyaltyService],
  // The loyalty service is exported so the sales pipeline can award/reverse
  // points inside its own checkout transaction.
  exports: [CustomersService, CustomerLoyaltyService],
})
export class CustomersModule {}
