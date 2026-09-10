// src/vertical-profiles/vertical-profiles.module.ts
import { Module } from '@nestjs/common';
import { VerticalProfilesService } from './vertical-profiles.service';

@Module({
  providers: [VerticalProfilesService],
  exports: [VerticalProfilesService],
})
export class VerticalProfilesModule {}
