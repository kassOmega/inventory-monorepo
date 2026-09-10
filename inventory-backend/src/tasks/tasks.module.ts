import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksService } from './tasks.service';

@Module({
  imports: [NotificationsModule],
  providers: [TasksService],
})
export class TasksModule {}
