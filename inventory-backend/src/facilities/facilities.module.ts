// src/facilities/facilities.module.ts
import { Module } from '@nestjs/common';
import { PackagesModule } from '../packages/packages.module';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';

@Module({
  imports: [PackagesModule],
  controllers: [FacilitiesController],
  providers: [FacilitiesService],
})
export class FacilitiesModule {}
