import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { VerticalProfilesModule } from '../vertical-profiles/vertical-profiles.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [NotificationsModule, VerticalProfilesModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
