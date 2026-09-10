import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [AiModule],
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
