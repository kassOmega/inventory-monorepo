// src/ai/ai.module.ts
import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { AiController } from './ai.controller';
import { AiDataCollectorService } from './ai-data-collector.service';
import { AiProductService } from './ai-product.service';
import { AssistService } from './assist.service';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { GeminiService } from './gemini.service';

@Module({
  imports: [PushModule],
  controllers: [AiController],
  providers: [
    AiService,
    AssistService,
    AiDataCollectorService,
    AiProductService,
    AiUsageService,
    GeminiService,
  ],
  exports: [GeminiService, AiUsageService],
})
export class AiModule {}
