// src/ai/ai.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { InsightType } from '@prisma/client';
import { Permissions } from '../common/decorators/permissions/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { AssistService } from './assist.service';
import { AiProductService } from './ai-product.service';
import { getPlatformFacts } from './platform-facts';
import { CashFlowDto } from './dto/cashflow.dto';
import { ChatDto } from './dto/chat.dto';
import { AssistDto } from './dto/assist.dto';
import { ChurnDto } from './dto/churn.dto';
import { ForecastDto } from './dto/forecast.dto';
import { PoDraftDto } from './dto/po-draft.dto';
import { PricingDto } from './dto/pricing.dto';
import { AnalyzeProductPhotoDto } from './dto/analyze-product-photo.dto';
import { SuggestVariantsDto } from './dto/suggest-variants.dto';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly usageService: AiUsageService,
    private readonly aiProductService: AiProductService,
    private readonly assistService: AssistService,
  ) {}

  private resolveTenant(req: RequestWithUser): number | null {
    return req.tenantId ?? req.user.organizationId ?? null;
  }

  /** GET /ai/usage — today's AI usage counter + entitlement for the signed-in user. */
  @Get('usage')
  @Permissions('ai.view', 'ai.chat')
  async getUsage(@Req() req: RequestWithUser) {
    const [usage, entitlement] = await Promise.all([
      this.usageService.getUsage(req.user.sub),
      this.usageService.getEntitlement(this.resolveTenant(req)),
    ]);
    return { ...usage, entitlement };
  }

  /**
   * POST /ai/product/analyze-photo — AI product assistant.
   * body: { base64Image: "data:image/jpeg;base64,...." } (or raw base64).
   * Returns a ProductForm-ready suggestion; the image is never stored.
   */
  @Post('product/analyze-photo')
  @Permissions('ai.product-assist')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async analyzeProductPhoto(
    @Body() dto: AnalyzeProductPhotoDto,
    @Req() req: RequestWithUser,
  ) {
    await this.usageService.assertAiEnabled(this.resolveTenant(req));
    await this.usageService.checkAndIncrement(req.user.sub);
    return this.aiProductService.analyzePhoto(
      dto.base64Image,
      this.resolveTenant(req),
      dto.base64Image2,
    );
  }


  /**
   * POST /ai/product/suggest-variants — AI variant suggestions for the
   * Variant Builder. body: { brand?, baseName?, existing?: [{slot1..slot4}] }.
   */
  @Post('product/suggest-variants')
  @Permissions('ai.product-assist')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async suggestVariants(
    @Body() dto: SuggestVariantsDto,
    @Req() req: RequestWithUser,
  ) {
    await this.usageService.assertAiEnabled(this.resolveTenant(req));
    await this.usageService.checkAndIncrement(req.user.sub);
    return this.aiProductService.suggestVariants({
      brand: dto.brand,
      baseName: dto.baseName,
      existing: dto.existing,
    });
  }

  /**
   * POST /ai/sales/identify-product — AI scan in the Sales page.
   * Matches the photo to an existing catalog product (never creates one).
   */
  @Post('sales/identify-product')
  @Permissions('ai.sales-assist')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async identifySalesProduct(
    @Body() dto: AnalyzeProductPhotoDto,
    @Req() req: RequestWithUser,
  ) {
    await this.usageService.assertAiEnabled(this.resolveTenant(req));
    await this.usageService.checkAndIncrement(req.user.sub);
    return this.aiProductService.identifyProduct(
      dto.base64Image,
      this.resolveTenant(req),
      dto.base64Image2,
      req.user,
    );
  }

  /**
   * POST /ai/requests/identify-product — AI scan in the Requests page.
   * Matches the photo to an existing catalog product (never creates one).
   */
  @Post('requests/identify-product')
  @Permissions('ai.requests-assist')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async identifyRequestsProduct(
    @Body() dto: AnalyzeProductPhotoDto,
    @Req() req: RequestWithUser,
  ) {
    await this.usageService.assertAiEnabled(this.resolveTenant(req));
    await this.usageService.checkAndIncrement(req.user.sub);
    return this.aiProductService.identifyProduct(
      dto.base64Image,
      this.resolveTenant(req),
      dto.base64Image2,
      req.user,
    );
  }

  /**
   * POST /ai/forecast — time-bound predictive forecast + action plan.
   * body: { targetPeriod: NEXT_7_DAYS | NEXT_30_DAYS | NEXT_QUARTER, language?, locationId? }
   */
  @Post('forecast')
  @Permissions('ai.view')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async forecast(@Body() dto: ForecastDto, @Req() req: RequestWithUser) {
    const entitlement = await this.usageService.assertAiEnabled(this.resolveTenant(req));
    const usage = await this.usageService.checkAndIncrement(req.user.sub);
    const result = await this.aiService.generateForecast(
      req.user,
      this.resolveTenant(req),
      dto,
    );
    return { ...result, usage, entitlement };
  }

  /**
   * POST /ai/cashflow — 30/60/90-day liquidity projection.
   * body: { targetPeriod: NEXT_30_DAYS | NEXT_60_DAYS | NEXT_90_DAYS, language? }
   */
  @Post('cashflow')
  @Permissions('ai.view')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async cashflow(@Body() dto: CashFlowDto, @Req() req: RequestWithUser) {
    const entitlement = await this.usageService.assertAiEnabled(this.resolveTenant(req));
    const usage = await this.usageService.checkAndIncrement(req.user.sub);
    const result = await this.aiService.generateCashFlow(
      req.user,
      this.resolveTenant(req),
      dto,
    );
    return { ...result, usage, entitlement };
  }

  /**
   * POST /ai/pricing — dynamic pricing & discount recommendations from stock velocity.
   * body: { language? }
   */
  @Post('pricing')
  @Permissions('ai.view')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async pricing(@Body() dto: PricingDto, @Req() req: RequestWithUser) {
    const entitlement = await this.usageService.assertAiEnabled(this.resolveTenant(req));
    const usage = await this.usageService.checkAndIncrement(req.user.sub);
    const result = await this.aiService.generatePricing(
      req.user,
      this.resolveTenant(req),
      dto,
    );
    return { ...result, usage, entitlement };
  }

  /**
   * POST /ai/churn — customer churn risk & win-back offers.
   * body: { language? }
   */
  @Post('churn')
  @Permissions('ai.view')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async churn(@Body() dto: ChurnDto, @Req() req: RequestWithUser) {
    const entitlement = await this.usageService.assertAiEnabled(this.resolveTenant(req));
    const usage = await this.usageService.checkAndIncrement(req.user.sub);
    const result = await this.aiService.generateChurn(
      req.user,
      this.resolveTenant(req),
      dto,
    );
    return { ...result, usage, entitlement };
  }

  /**
   * POST /ai/po-drafts — generate (and persist) a purchase order draft from
   * items at or below their reorder threshold.
   * body: { language?, leadTimeDays?, autoCreate? }
   */
  @Post('po-drafts')
  @Permissions('ai.view')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createPoDraft(@Body() dto: PoDraftDto, @Req() req: RequestWithUser) {
    const entitlement = await this.usageService.assertAiEnabled(this.resolveTenant(req));
    const usage = await this.usageService.checkAndIncrement(req.user.sub);
    const result = await this.aiService.generatePoDraft(
      req.user,
      this.resolveTenant(req),
      dto,
    );
    return { ...result, usage, entitlement };
  }

  /** GET /ai/po-drafts — recent purchase order drafts. */
  @Get('po-drafts')
  @Permissions('ai.view')
  listPoDrafts(@Req() req: RequestWithUser) {
    return this.aiService.listPoDrafts(this.resolveTenant(req));
  }

  /** POST /ai/po-drafts/:id/submit — mark a draft as submitted/ordered. */
  @Post('po-drafts/:id/submit')
  @Permissions('ai.view')
  submitPoDraft(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.aiService.submitPoDraft(+id, this.resolveTenant(req));
  }

  /** DELETE /ai/po-drafts/:id */
  @Delete('po-drafts/:id')
  @Permissions('ai.view')
  deletePoDraft(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.aiService.deletePoDraft(+id, this.resolveTenant(req));
  }

  /**
   * POST /ai/chat — streaming AI business coach (SSE). The AI detects the
   * customer's language and replies in the same language.
   * body: { message, sessionId? }
   */
  @Post('chat')
  @Permissions('ai.chat')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async chat(
    @Body() dto: ChatDto,
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    // Enforce the AI entitlement + daily quota BEFORE any SSE headers are sent.
    // When the tenant's AI is disabled/expired (403) or the quota is exhausted
    // (429), the exception propagates and Nest serializes a standard response.
    const entitlement = await this.usageService.assertAiEnabled(this.resolveTenant(req));
    const usage = await this.usageService.checkAndIncrement(req.user.sub);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const result = await this.aiService.runChat(
        req.user,
        this.resolveTenant(req),
        dto,
        (delta) => send({ type: 'delta', text: delta }),
      );
      send({
        type: 'done',
        sessionId: result.sessionId,
        messageId: result.messageId,
        usage,
        entitlement,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  }

  /** GET /ai/platform-facts — machine-readable current platform facts. */
  @Get('platform-facts')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  platformFacts() {
    return getPlatformFacts();
  }

  /** GET /ai/assist/status — free onboarding-chat counter for a visitor device. */
  @Get('assist/status')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async assistStatus(
    @Req() req: Request,
    @Query('guestId') guestId?: string,
  ) {
    const key = (guestId ?? '').trim() || `ip-${req.ip ?? 'unknown'}`;
    return this.assistService.status(key);
  }

  /**
   * POST /ai/assist — PUBLIC onboarding assistant (SSE). No login required.
   * Guests get ASSIST_DAILY_LIMIT chats per device per day; an IP throttle is
   * applied on top. body: { guestId, message, lang?, history? }
   */
  @Post('assist')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async assist(
    @Body() dto: AssistDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Reserve a free chat BEFORE streaming headers so an exhausted quota is a
    // normal JSON 429 response.
    const guestKey = dto.guestId.trim() || `ip-${req.ip ?? 'unknown'}`;
    const status = await this.assistService.consume(guestKey);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await this.aiService.runAssist(dto, (delta) =>
        send({ type: 'delta', text: delta }),
      );
      send({ type: 'done', remaining: status.remaining, limit: status.limit });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      send({ type: 'error', message });
    } finally {
      res.end();
    }
  }

  /** GET /ai/insights — recent AI insights history. */
  @Get('insights')
  @Permissions('ai.view')
  getInsights(
    @Req() req: RequestWithUser,
    @Query('type') type?: InsightType,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit =
      Number(limit) > 0 && Number(limit) <= 100 ? Number(limit) : 25;
    return this.aiService.getInsights(
      req.user,
      this.resolveTenant(req),
      type,
      parsedLimit,
    );
  }

  /** GET /ai/chat/sessions — the caller's chat sessions. */
  @Get('chat/sessions')
  @Permissions('ai.chat')
  listSessions(@Req() req: RequestWithUser) {
    return this.aiService.listSessions(req.user, this.resolveTenant(req));
  }

  /** GET /ai/chat/sessions/:id — full history of one session. */
  @Get('chat/sessions/:id')
  @Permissions('ai.chat')
  getSession(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.aiService.getSession(id, req.user, this.resolveTenant(req));
  }

  /** DELETE /ai/chat/sessions/:id */
  @Delete('chat/sessions/:id')
  @Permissions('ai.chat')
  deleteSession(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.aiService.deleteSession(id, req.user, this.resolveTenant(req));
  }
}
