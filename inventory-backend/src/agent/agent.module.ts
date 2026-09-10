// src/agent/agent.module.ts
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AgentController } from './agent.controller';
import { AgentRunnerService } from './agent-runner.service';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';

@Module({
  imports: [AiModule],
  controllers: [AgentController],
  providers: [AgentService, AgentRunnerService, AgentToolsService],
})
export class AgentModule {}
