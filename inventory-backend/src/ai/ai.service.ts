// src/ai/ai.service.ts
// Orchestrates the AI Business Advisor: collects business metrics, calls
// Gemini (forecast reports + streaming chat), and persists insights and chat
// history to the database.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InsightType, MessageSender, Prisma, PoDraftStatus } from '@prisma/client';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { AiDataCollectorService } from './ai-data-collector.service';
import { CashFlowDto, CashFlowTargetPeriod } from './dto/cashflow.dto';
import { ChatDto } from './dto/chat.dto';
import { AssistDto } from './dto/assist.dto';
import { buildAssistSystemInstruction } from './platform-guide';
import { buildPlatformFactsText } from './platform-facts';
import { ChurnDto } from './dto/churn.dto';
import { ForecastDto, ForecastTargetPeriod } from './dto/forecast.dto';
import { PoDraftDto } from './dto/po-draft.dto';
import { PricingDto } from './dto/pricing.dto';
import {
  BusinessMetricsDigest,
  CashFlowForecastReport,
  ChurnInputCustomer,
  ChurnReport,
  FinanceSnapshot,
  ForecastReport,
  PoDraftLine,
  PricingInputItem,
  PricingReport,
  ReorderItem,
} from './entities/ai.entity';
import { ChatTurn, GeminiService } from './gemini.service';

const INSIGHT_HISTORY_LIMIT = 25;
const CHAT_HISTORY_TURNS = 10;
const AUTO_PO_LEAD_TIME_DAYS = 7;

const FORECAST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    revenueProjection: {
      type: 'OBJECT',
      properties: {
        projectedRevenue: { type: 'NUMBER' },
        projectedUnits: { type: 'NUMBER' },
        topGrowthCategories: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              category: { type: 'STRING' },
              growthPercent: { type: 'NUMBER' },
              reasoning: { type: 'STRING' },
            },
          },
        },
      },
    },
    stockOutWarnings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          product: { type: 'STRING' },
          currentStock: { type: 'NUMBER' },
          dailyVelocity: { type: 'NUMBER' },
          daysRemaining: { type: 'NUMBER' },
          recommendedReorderQty: { type: 'NUMBER' },
          recommendedReorderDate: { type: 'STRING' },
        },
      },
    },
    deadStockPlan: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          product: { type: 'STRING' },
          quantityInStock: { type: 'NUMBER' },
          suggestedDiscountPct: { type: 'NUMBER' },
          strategy: { type: 'STRING' },
        },
      },
    },
    staffingAdjustments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          day: { type: 'STRING' },
          shift: { type: 'STRING' },
          recommendedStaff: { type: 'NUMBER' },
          reasoning: { type: 'STRING' },
        },
      },
    },
  },
  required: [
    'revenueProjection',
    'stockOutWarnings',
    'deadStockPlan',
    'staffingAdjustments',
  ],
};

const WEEKLY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    recommendations: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['summary', 'recommendations'],
};

const CASH_FLOW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    buckets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          period: { type: 'STRING' },
          openingBalance: { type: 'NUMBER' },
          inflows: { type: 'NUMBER' },
          outflows: { type: 'NUMBER' },
          netCashFlow: { type: 'NUMBER' },
          closingBalance: { type: 'NUMBER' },
        },
        required: [
          'period',
          'openingBalance',
          'inflows',
          'outflows',
          'netCashFlow',
          'closingBalance',
        ],
      },
    },
    liquidityRisks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          level: { type: 'STRING' },
          month: { type: 'STRING' },
          description: { type: 'STRING' },
          recommendedAction: { type: 'STRING' },
        },
        required: ['level', 'month', 'description', 'recommendedAction'],
      },
    },
    keyActions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'buckets', 'liquidityRisks', 'keyActions'],
};

const PRICING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          productId: { type: 'NUMBER' },
          product: { type: 'STRING' },
          direction: { type: 'STRING' },
          currentSellPrice: { type: 'NUMBER' },
          suggestedSellPrice: { type: 'NUMBER' },
          suggestedDiscountPct: { type: 'NUMBER' },
          reason: { type: 'STRING' },
          expectedImpact: { type: 'STRING' },
        },
        required: [
          'productId',
          'product',
          'direction',
          'currentSellPrice',
          'suggestedSellPrice',
          'reason',
        ],
      },
    },
    marginStrategy: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'recommendations', 'marginStrategy'],
};

const CHURN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    atRisk: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          customerId: { type: 'NUMBER' },
          name: { type: 'STRING' },
          risk: { type: 'STRING' },
          daysInactive: { type: 'NUMBER' },
          outstandingCredit: { type: 'NUMBER' },
          suggestedWinBackOffer: { type: 'STRING' },
          expectedRecoveryValue: { type: 'NUMBER' },
        },
        required: [
          'customerId',
          'name',
          'risk',
          'daysInactive',
          'suggestedWinBackOffer',
        ],
      },
    },
    retentionStrategy: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'atRisk', 'retentionStrategy'],
};

// PO drafts stay deterministic (quantities computed from real inventory +
// velocity); Gemini only refines the supplier suggestion and notes.
const PO_DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier: { type: 'STRING' },
    notes: { type: 'STRING' },
  },
  required: ['supplier', 'notes'],
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: AiDataCollectorService,
    private readonly gemini: GeminiService,
    private readonly push: PushService,
  ) {}

  // =========================================================================
  // Forecast & action plan
  // =========================================================================

  async generateForecast(
    user: JwtPayload,
    tenantId: number | null,
    dto: ForecastDto,
  ): Promise<{
    report: ForecastReport;
    insight: { id: string; createdAt: Date };
  }> {
    const days = this.windowDaysFor(dto.targetPeriod);
    const metrics = await this.collector.collectMetrics({
      tenantId,
      businessType: user.businessType,
      days,
      locationId: dto.locationId,
    });
    const language = dto.language?.trim() || 'English';
    const today = new Date().toISOString().slice(0, 10);

    const report = await this.gemini.generateJson<ForecastReport>({
      systemInstruction: this.forecastSystemInstruction(language),
      prompt: this.buildForecastPrompt(metrics, dto.targetPeriod, today),
      schema: FORECAST_SCHEMA,
      kind: 'pro',
      temperature: 0.4,
    });

    const insight = await this.prisma.businessInsight.create({
      data: {
        tenantId,
        type: InsightType.DEMAND_FORECAST,
        summary: this.summarizeForecast(report, days),
        recommendations: JSON.parse(
          JSON.stringify(report),
        ) as Prisma.InputJsonValue,
        targetPeriod: dto.targetPeriod,
        createdByUserId: user.sub,
      },
      select: { id: true, createdAt: true },
    });

    return { report, insight };
  }

  private windowDaysFor(period: ForecastTargetPeriod): number {
    switch (period) {
      case ForecastTargetPeriod.NEXT_7_DAYS:
        return 30;
      case ForecastTargetPeriod.NEXT_30_DAYS:
        return 60;
      case ForecastTargetPeriod.NEXT_QUARTER:
      default:
        return 90;
    }
  }

  private forecastSystemInstruction(language: string): string {
    return [
      'You are an expert predictive analytics assistant for small retail, hospitality and manufacturing businesses.',
      'You produce structured JSON forecasts. Never include markdown or any text outside the JSON object.',
      `Respond exclusively in ${language}.`,
      'Currency is ETB (Ethiopian Birr) unless the metrics say otherwise.',
      'Base every number on the supplied metrics. When data is insufficient, state your assumption in the reasoning field.',
      'Stock-out warnings: products predicted to run out within the target period must include a recommended reorder quantity and an exact reorder date (ISO yyyy-mm-dd).',
      'Dead stock plan: propose discount or bundling strategies to clear low-velocity items before they depreciate.',
      'Staffing adjustments: recommend shift coverage based on forecasted peak sales days and peak hours.',
    ].join('\n');
  }

  private buildForecastPrompt(
    metrics: BusinessMetricsDigest,
    targetPeriod: ForecastTargetPeriod,
    today: string,
  ): string {
    const periodLabel: Record<string, string> = {
      NEXT_7_DAYS: 'the next 7 days',
      NEXT_30_DAYS: 'the next 30 days',
      NEXT_QUARTER: 'the next quarter (90 days)',
    };
    return [
      `Today's date: ${today}.`,
      `Forecast target period: ${periodLabel[targetPeriod] ?? targetPeriod}.`,
      'Business metrics (computed from actual sales over the historical window):',
      JSON.stringify(metrics),
      'Produce the forecast JSON exactly matching the requested schema.',
    ].join('\n');
  }

  private summarizeForecast(report: ForecastReport, days: number): string {
    const warnings = report.stockOutWarnings?.length ?? 0;
    const dead = report.deadStockPlan?.length ?? 0;
    const staffing = report.staffingAdjustments?.length ?? 0;
    return (
      `Projected revenue: ${report.revenueProjection?.projectedRevenue ?? 0} ` +
      `ETB (~${report.revenueProjection?.projectedUnits ?? 0} units). ` +
      `${warnings} stock-out warning(s), ${dead} dead-stock item(s), ` +
      `${staffing} staffing adjustment(s) over the next ${days} days.`
    );
  }


  // =========================================================================
  // Cash flow forecast (30/60/90-day liquidity projection)
  // =========================================================================

  async generateCashFlow(
    user: JwtPayload,
    tenantId: number | null,
    dto: CashFlowDto,
  ): Promise<{
    report: CashFlowForecastReport;
    insight: { id: string; createdAt: Date };
  }> {
    const days =
      dto.targetPeriod === CashFlowTargetPeriod.NEXT_60_DAYS
        ? 60
        : dto.targetPeriod === CashFlowTargetPeriod.NEXT_90_DAYS
          ? 90
          : 30;
    const finance = await this.collector.collectFinanceMetrics({
      tenantId,
      businessType: user.businessType,
      days,
    });
    const language = dto.language?.trim() || 'English';

    const report = await this.gemini.generateJson<CashFlowForecastReport>({
      systemInstruction: this.cashFlowSystemInstruction(language),
      prompt: this.buildCashFlowPrompt(finance, dto.targetPeriod),
      schema: CASH_FLOW_SCHEMA,
      kind: 'pro',
      temperature: 0.4,
    });

    const insight = await this.prisma.businessInsight.create({
      data: {
        tenantId,
        type: InsightType.CASH_FLOW_FORECAST,
        summary: this.summarizeCashFlow(report),
        recommendations: JSON.parse(
          JSON.stringify(report),
        ) as Prisma.InputJsonValue,
        targetPeriod: dto.targetPeriod,
        createdByUserId: user.sub,
      },
      select: { id: true, createdAt: true },
    });

    return { report, insight };
  }

  private cashFlowSystemInstruction(language: string): string {
    return [
      'You are a cash-flow and liquidity forecasting expert for small retail, hospitality and manufacturing businesses.',
      'Produce a 30/60/90-day cash flow projection combining sales inflows, credit collections, expenses and purchase outflows.',
      'Model outflows from three live feeds: recurring overhead expenses (overheadByCategory), purchase outflows and Cost of Goods Sold (COGS).',
      'Model inflows from daily sales velocity (dailyRevenueSeries) plus outstanding receivable collections (receivablesByAge).',
      'Use netCashPosition as the opening balance and flag when the projected purchase budget (projectedPurchaseBudget) would breach liquidity.',
      'Each bucket must include openingBalance, inflows, outflows, netCashFlow and closingBalance, all in ETB.',
      'Flag liquidity risks (level HIGH/MEDIUM/LOW) with a concrete recommended action for each.',
      'Ground every number in the supplied finance snapshot. When data is insufficient, state the assumption.',
      'Output strict JSON matching the schema. No markdown.',
      `Respond in ${language}.`,
    ].join('\n');
  }

  private buildCashFlowPrompt(
    finance: FinanceSnapshot,
    targetPeriod: CashFlowTargetPeriod,
  ): string {
    const periodLabel: Record<string, string> = {
      NEXT_30_DAYS: 'the next 30 days',
      NEXT_60_DAYS: 'the next 60 days',
      NEXT_90_DAYS: 'the next 90 days',
    };
    return [
      `Forecast horizon: ${periodLabel[targetPeriod] ?? targetPeriod}.`,
      'Finance snapshot (computed from actuals):',
      JSON.stringify(finance),
      'Produce the cash flow forecast JSON exactly matching the requested schema.',
    ].join('\n');
  }

  private summarizeCashFlow(report: CashFlowForecastReport): string {
    const last = report.buckets?.[report.buckets.length - 1];
    const highRisks =
      report.liquidityRisks?.filter((r) => r.level === 'HIGH').length ?? 0;
    return (
      `Cash flow forecast: projected closing balance ${last?.closingBalance ?? 0} ETB ` +
      `after ${report.buckets?.length ?? 0} period(s), ` +
      `${highRisks} high liquidity risk(s) identified.`
    );
  }

  // =========================================================================
  // Dynamic pricing recommendations (margin & discount strategy)
  // =========================================================================

  async generatePricing(
    user: JwtPayload,
    tenantId: number | null,
    dto: PricingDto,
  ): Promise<{
    report: PricingReport;
    insight: { id: string; createdAt: Date };
  }> {
    const inputs = await this.collector.collectPricingMetrics({ tenantId });
    const language = dto.language?.trim() || 'English';

    const report = await this.gemini.generateJson<PricingReport>({
      systemInstruction: this.pricingSystemInstruction(language),
      prompt: this.buildPricingPrompt(inputs),
      schema: PRICING_SCHEMA,
      kind: 'pro',
      temperature: 0.4,
    });

    const insight = await this.prisma.businessInsight.create({
      data: {
        tenantId,
        type: InsightType.PRICING_RECOMMENDATIONS,
        summary: this.summarizePricing(report),
        recommendations: JSON.parse(
          JSON.stringify(report),
        ) as Prisma.InputJsonValue,
        createdByUserId: user.sub,
      },
      select: { id: true, createdAt: true },
    });

    return { report, insight };
  }

  private pricingSystemInstruction(language: string): string {
    return [
      'You are a pricing strategy expert for small retail, hospitality and manufacturing businesses.',
      'Recommend price changes based on stock velocity, margins, stock levels and rising purchase costs.',
      'Protect profit margins: when buyPriceTrendPct is positive (purchase cost rising) and marginPct is thin (<20%), recommend RAISE to keep the margin protected.',
      'Use direction RAISE for fast-moving high-demand items with low margin, HOLD for healthy items, and DISCOUNT for slow/dead stock to clear it.',
      'suggestedSellPrice and suggestedDiscountPct must be consistent with the direction and never below the buy price.',
      'Keep recommendations advisory; never instruct to change prices automatically.',
      'Ground every number in the supplied per-product inputs.',
      'Output strict JSON matching the schema. No markdown.',
      `Respond in ${language}.`,
    ].join('\n');
  }

  private buildPricingPrompt(inputs: PricingInputItem[]): string {
    return [
      'Per-product pricing inputs (margins, buy-price trend, stock, velocity):',
      JSON.stringify(inputs),
      'Produce the pricing recommendation JSON exactly matching the requested schema.',
    ].join('\n');
  }

  private summarizePricing(report: PricingReport): string {
    const recs = report.recommendations ?? [];
    const raises = recs.filter((r) => r.direction === 'RAISE').length;
    const discounts = recs.filter((r) => r.direction === 'DISCOUNT').length;
    return (
      `Pricing plan: ${recs.length} recommendation(s) — ${raises} price raise(s), ` +
      `${discounts} discount(s) to clear stock.`
    );
  }

  // =========================================================================
  // Customer churn risk & win-back offers
  // =========================================================================

  async generateChurn(
    user: JwtPayload,
    tenantId: number | null,
    dto: ChurnDto,
  ): Promise<{
    report: ChurnReport;
    insight: { id: string; createdAt: Date };
  }> {
    const inputs = await this.collector.collectChurnMetrics({ tenantId });
    const language = dto.language?.trim() || 'English';

    const report = await this.gemini.generateJson<ChurnReport>({
      systemInstruction: this.churnSystemInstruction(language),
      prompt: this.buildChurnPrompt(inputs),
      schema: CHURN_SCHEMA,
      kind: 'pro',
      temperature: 0.4,
    });

    const insight = await this.prisma.businessInsight.create({
      data: {
        tenantId,
        type: InsightType.CUSTOMER_CHURN,
        summary: this.summarizeChurn(report),
        recommendations: JSON.parse(
          JSON.stringify(report),
        ) as Prisma.InputJsonValue,
        createdByUserId: user.sub,
      },
      select: { id: true, createdAt: true },
    });

    return { report, insight };
  }

  private churnSystemInstruction(language: string): string {
    return [
      'You are a customer retention expert for small retail, hospitality and manufacturing businesses.',
      'Analyse buying patterns and assign each listed customer a churn risk (HIGH/MEDIUM/LOW) based on days inactive, purchase frequency and outstanding credit.',
      'For each at-risk or churned customer, propose a concrete win-back offer (e.g. discount, free service, credit-line reminder) and an expected recovery value in ETB.',
      'Do not invent customers; only use the supplied customer list.',
      'Only include customers whose bucket is AT_RISK or CHURNED in the atRisk array.',
      'Ground every number in the supplied data.',
      'Output strict JSON matching the schema. No markdown.',
      `Respond in ${language}.`,
    ].join('\n');
  }

  private buildChurnPrompt(inputs: ChurnInputCustomer[]): string {
    return [
      'Customer activity snapshot:',
      JSON.stringify(inputs),
      'Produce the churn-risk JSON exactly matching the requested schema.',
    ].join('\n');
  }

  private summarizeChurn(report: ChurnReport): string {
    const atRisk = report.atRisk ?? [];
    const high = atRisk.filter((c) => c.risk === 'HIGH').length;
    return (
      `${atRisk.length} customer(s) at risk of churn (${high} high risk). ` +
      `Win-back offers are ready to review.`
    );
  }

  // =========================================================================
  // Automated purchase order drafts (reorder thresholds)
  // =========================================================================

  /**
   * Generate (and optionally persist) a purchase order draft from the items
   * currently at or below their reorder threshold.
   */
  async generatePoDraft(
    user: JwtPayload,
    tenantId: number | null,
    dto: PoDraftDto,
  ): Promise<{
    draft: { id: number; createdAt: Date } | null;
    insight: { id: string; createdAt: Date };
    items: PoDraftLine[];
    estimatedTotal: number;
    supplier: string | null;
  }> {
    const [reorder, finance] = await Promise.all([
      this.collector.collectReorderInput({
        tenantId,
        leadTimeDays: dto.leadTimeDays,
      }),
      this.collector.collectFinanceMetrics({
        tenantId,
        businessType: user.businessType,
        days: 30,
      }),
    ]);
    const built = await this.buildPoDraft(reorder, {
      language: dto.language,
      finance,
    });
    const summary =
      reorder.length === 0
        ? 'All items are above their reorder thresholds — no purchase order needed.'
        : `Purchase order draft ready for ${reorder.length} item(s) totaling ${built.estimatedTotal} ETB (projected cash position ${finance.netCashPosition} ETB).`;

    const insight = await this.prisma.businessInsight.create({
      data: {
        tenantId,
        type: InsightType.PO_DRAFT,
        summary,
        recommendations: JSON.parse(
          JSON.stringify({
            items: built.lines,
            estimatedTotal: built.estimatedTotal,
            supplier: built.supplier,
            projectedPurchaseBudget: finance.projectedPurchaseBudget,
            netCashPosition: finance.netCashPosition,
          }),
        ) as Prisma.InputJsonValue,
        createdByUserId: user.sub,
      },
      select: { id: true, createdAt: true },
    });

    let draft: { id: number; createdAt: Date } | null = null;
    if (reorder.length > 0 && dto.autoCreate !== false) {
      draft = await this.prisma.purchaseOrderDraft.create({
        data: {
          tenantId,
          supplier: built.supplier,
          items: built.lines as unknown as Prisma.InputJsonValue,
          estimatedTotal: built.estimatedTotal,
          autoGenerated: false,
          notes: built.notes,
          createdById: user.sub,
        },
        select: { id: true, createdAt: true },
      });
      await this.notifyOwner(
        tenantId,
        '📦 Purchase order draft ready',
        `A draft PO for ${reorder.length} item(s) totaling ${built.estimatedTotal} ETB is ready for review (projected cash ${finance.netCashPosition} ETB).`,
      );
    }

    return {
      draft,
      insight,
      items: built.lines,
      estimatedTotal: built.estimatedTotal,
      supplier: built.supplier,
    };
  }

  async listPoDrafts(tenantId: number | null) {
    return this.prisma.purchaseOrderDraft.findMany({
      where: tenantId != null ? { tenantId } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async deletePoDraft(
    id: number,
    tenantId: number | null,
  ): Promise<{ message: string }> {
    const existing = await this.prisma.purchaseOrderDraft.findFirst({
      where: { id, ...(tenantId != null ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Purchase order draft not found');
    }
    await this.prisma.purchaseOrderDraft.delete({ where: { id } });
    return { message: 'Purchase order draft deleted' };
  }

  /** Mark a draft as submitted (the owner placed the order). */
  async submitPoDraft(
    id: number,
    tenantId: number | null,
  ): Promise<{ message: string }> {
    const existing = await this.prisma.purchaseOrderDraft.findFirst({
      where: { id, ...(tenantId != null ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Purchase order draft not found');
    }
    await this.prisma.purchaseOrderDraft.update({
      where: { id },
      data: { status: PoDraftStatus.SUBMITTED },
    });
    return { message: 'Purchase order draft submitted' };
  }

  /** Scheduled sweep: auto-create a PO draft per org when items hit thresholds. */
  @Cron('0 */2 * * *')
  async runAutoPoDraftSweep() {
    if (process.env.PO_DRAFT_AUTOGEN_ENABLED !== 'true') return;

    const orgs = await this.prisma.organization.findMany({
      select: { id: true },
    });
    this.logger.log(`Auto PO-draft sweep: checking ${orgs.length} org(s)`);

    for (const org of orgs) {
      try {
        const reorder = await this.collector.collectReorderInput({
          tenantId: org.id,
          leadTimeDays: AUTO_PO_LEAD_TIME_DAYS,
        });
        if (reorder.length === 0) continue;

        // Don't stack drafts — one open DRAFT per org at a time.
        const open = await this.prisma.purchaseOrderDraft.findFirst({
          where: { tenantId: org.id, status: PoDraftStatus.DRAFT },
          select: { id: true },
        });
        if (open) continue;

        const built = await this.buildPoDraft(reorder, {});
        await this.prisma.purchaseOrderDraft.create({
          data: {
            tenantId: org.id,
            supplier: built.supplier,
            items: built.lines as unknown as Prisma.InputJsonValue,
            estimatedTotal: built.estimatedTotal,
            autoGenerated: true,
            notes: built.notes,
          },
        });
        await this.notifyOwner(
          org.id,
          '📦 Purchase order draft ready',
          `A draft PO for ${reorder.length} item(s) totaling ${built.estimatedTotal} ETB was auto-generated (reorder threshold hit).`,
        );
      } catch (err) {
        this.logger.warn(
          `Auto PO draft failed for org ${org.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async buildPoDraft(
    reorder: ReorderItem[],
    opts: { language?: string; finance?: FinanceSnapshot },
  ): Promise<{
    lines: PoDraftLine[];
    estimatedTotal: number;
    supplier: string | null;
    notes: string;
  }> {
    const lines: PoDraftLine[] = reorder.map((r) => ({
      productId: r.productId,
      product: r.name,
      currentStock: r.currentStock,
      suggestedQty: r.suggestedQty,
      unitPrice: r.unitPrice,
      estimatedCost: r.estimatedCost,
      urgency: r.urgency,
    }));
    const estimatedTotal =
      Math.round(lines.reduce((s, l) => s + l.estimatedCost, 0) * 100) / 100;
    let supplier: string | null = null;
    let notes = 'Auto-generated from reorder thresholds.';

    if (lines.length > 0) {
      try {
        const ai = await this.gemini.generateJson<{
          supplier: string;
          notes: string;
        }>({
          systemInstruction: this.poSystemInstruction(opts.language),
          prompt: this.buildPoPrompt(reorder, estimatedTotal, opts.finance),
          schema: PO_DRAFT_SCHEMA,
          kind: 'fast',
          temperature: 0.2,
        });
        supplier = ai.supplier?.trim() || null;
        notes = ai.notes?.trim() || notes;
      } catch (err) {
        this.logger.warn(
          `PO draft AI refinement skipped: ${(err as Error).message}`,
        );
      }
    }

    // Budget-aware note: tell the owner when the PO exceeds the projected
    // cash position so draft POs reflect forecasted revenue cash flow.
    if (opts.finance && estimatedTotal > 0) {
      const cash = opts.finance.netCashPosition;
      const safe =
        cash >= 0 && estimatedTotal <= Math.max(cash, opts.finance.projectedPurchaseBudget);
      const budgetNote = safe
        ? `This PO (${estimatedTotal} ETB) is within the projected cash position (${cash} ETB).`
        : `Caution: this PO (${estimatedTotal} ETB) exceeds the projected cash position (${cash} ETB) — consider staging the order.`;
      notes = `${notes} ${budgetNote}`.trim();
    }

    return { lines, estimatedTotal, supplier, notes };
  }

  private poSystemInstruction(language?: string): string {
    const lines = [
      'You are a purchasing assistant for a small business.',
      'You are given a list of products below their reorder threshold with suggested quantities and estimated costs, plus the business\'s projected cash position and purchase budget.',
      'Suggest a likely supplier (or null) and write brief practical notes for the purchase order.',
      'When the estimated total approaches or exceeds the projected cash position, recommend staging the order or negotiating payment terms.',
      'Do not change the quantities; they are already computed.',
      'Output strict JSON matching the schema. No markdown.',
    ];
    if (language) lines.push(`Respond in ${language}.`);
    return lines.join('\n');
  }

  private buildPoPrompt(
    reorder: ReorderItem[],
    estimatedTotal: number,
    finance?: FinanceSnapshot,
  ): string {
    const budget =
      finance != null
        ? [
            `Projected net cash position: ${finance.netCashPosition} ETB.`,
            `Projected purchase budget (reorder needs): ${finance.projectedPurchaseBudget} ETB.`,
            `Daily sales velocity: ${finance.dailyRevenueSeries.length} day(s) averaging ${finance.avgDailySalesRevenue} ETB.`,
          ]
        : [];
    return [
      'Items needing reorder (currentStock, suggestedQty, estimatedCost):',
      JSON.stringify(reorder),
      `Estimated total: ${estimatedTotal} ETB.`,
      ...budget,
      'Produce the supplier + notes JSON exactly matching the requested schema.',
    ].join('\n');
  }

  private async notifyOwner(
    tenantId: number | null,
    title: string,
    message: string,
  ): Promise<void> {
    if (tenantId == null) return;
    const ownerRole = await this.prisma.role.findFirst({
      where: { organizationId: tenantId, isSystem: true },
      select: { id: true },
    });
    const ownerUsers = await this.prisma.membership.findMany({
      where: { roleId: ownerRole?.id, organizationId: tenantId },
      select: { userId: true },
    });
    const targets: Array<{ targetUserId: number | null }> =
      ownerUsers.length > 0
        ? ownerUsers.map((m) => ({ targetUserId: m.userId }))
        : [{ targetUserId: null }];
    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          tenantId,
          type: 'PO_DRAFT',
          title,
          message,
          targetRoleId: ownerRole?.id ?? null,
          targetUserId: t.targetUserId,
        },
      });
    }

    // Reach owner devices too — previously this alert only existed in the in-app
    // bell. One role fan-out (rather than one send per row) keeps it cheap, and
    // not awaiting it keeps the AI request latency unchanged.
    if (ownerRole) {
      this.push
        .sendToRoleId({ title, body: message }, ownerRole.id, tenantId)
        .catch(() => {});
    }
  }

  // =========================================================================
  // Interactive AI coach (streaming chat)
  // =========================================================================

  async runChat(
    user: JwtPayload,
    tenantId: number | null,
    dto: ChatDto,
    onDelta: (text: string) => void,
  ): Promise<{ sessionId: string; messageId: string; content: string }> {
    const session = await this.getOrCreateSession(
      user.sub,
      tenantId,
      dto.sessionId,
      dto.message,
    );

    await this.saveMessage(session.id, tenantId, MessageSender.USER, dto.message);

    // Inject a fresh business-metrics snapshot + recent AI insights on every
    // message so the coach is grounded in the current data (lightweight RAG).
    const metrics = await this.collector.collectMetrics({
      tenantId,
      businessType: user.businessType,
      days: 30,
    });
    const insights = await this.prisma.businessInsight.findMany({
      where: {
        tenantId,
        type: {
          in: [
            InsightType.WEEKLY_SUMMARY,
            InsightType.DEAD_STOCK_ALERT,
            InsightType.DEMAND_FORECAST,
            InsightType.CASH_FLOW_FORECAST,
            InsightType.PRICING_RECOMMENDATIONS,
            InsightType.CUSTOMER_CHURN,
            InsightType.PO_DRAFT,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        type: true,
        summary: true,
        targetPeriod: true,
        createdAt: true,
      },
    });

    const history = await this.loadHistory(session.id);
    const stream = this.gemini.streamChat({
      systemInstruction: this.chatSystemInstruction(),
      history,
      prompt: this.buildChatPrompt(dto.message, metrics, insights),
    });

    const parts: string[] = [];
    for await (const delta of stream) {
      parts.push(delta);
      onDelta(delta);
    }
    const content = parts.join('').trim();
    if (!content) {
      throw new NotFoundException('The AI assistant returned an empty response.');
    }

    const message = await this.saveMessage(
      session.id,
      tenantId,
      MessageSender.ASSISTANT,
      content,
    );
    return { sessionId: session.id, messageId: message.id, content };
  }

  private async getOrCreateSession(
    userId: number,
    tenantId: number | null,
    sessionId: string | undefined,
    firstMessage: string,
  ) {
    if (sessionId) {
      const existing = await this.prisma.aiChatSession.findFirst({
        where: {
          id: sessionId,
          userId,
          ...(tenantId != null ? { tenantId } : {}),
        },
      });
      if (existing) return existing;
    }
    return this.prisma.aiChatSession.create({
      data: {
        tenantId,
        userId,
        title: this.deriveTitle(firstMessage),
      },
    });
  }

  private saveMessage(
    sessionId: string,
    tenantId: number | null,
    sender: MessageSender,
    content: string,
  ) {
    return this.prisma.aiChatMessage.create({
      data: { sessionId, tenantId, sender, content },
      select: { id: true, createdAt: true },
    });
  }

  private deriveTitle(message: string): string {
    const clean = message.replace(/\s+/g, ' ').trim();
    return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
  }

  private async loadHistory(sessionId: string) {
    const rows = await this.prisma.aiChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 40,
      select: { sender: true, content: true },
    });
    return rows
      .filter((r) => r.content.trim())
      .slice(-CHAT_HISTORY_TURNS)
      .map((r) => ({
        role: r.sender === MessageSender.USER ? ('user' as const) : ('model' as const),
        text: r.content,
      }));
  }

  private chatSystemInstruction(): string {
    return [
      'You are "AI Business Coach", an expert business advisor embedded inside an inventory and sales management system.',
      'You help business owners and managers with staff efficiency, inventory management, customer retention, cash flow and daily operations.',
      'Always ground your advice in the business metrics provided (they reflect the current organization) and keep answers practical and actionable.',
      'Be concise; use bullet points and short paragraphs where helpful. Do not invent specific numbers that are not in the provided metrics.',
      'CRITICAL LANGUAGE RULE: detect the language the customer writes in and respond fluently in that same language.',
      'Support at minimum English, Amharic and Afaan Oromoo, and any other language the customer uses. Never switch languages mid-conversation.',
    ].join('\n');
  }

  private buildChatPrompt(
    message: string,
    metrics: BusinessMetricsDigest,
    insights: Array<{
      type: InsightType;
      summary: string;
      targetPeriod: string | null;
      createdAt: Date;
    }>,
  ): string {
    const insightBlock =
      insights.length === 0
        ? 'No recent AI insights yet.'
        : insights
            .map(
              (i) =>
                `- [${i.type}${i.targetPeriod ? ` ${i.targetPeriod}` : ''} ${i.createdAt.toISOString().slice(0, 10)}] ${i.summary}`,
            )
            .join('\n');

    return [
      'Recent business metrics:',
      JSON.stringify(metrics),
      '',
      'Recent AI insights for this business:',
      insightBlock,
      '',
      `Customer message: ${message}`,
    ].join('\n');
  }


  // =========================================================================
  // Insights & chat session history
  // =========================================================================

  async getInsights(
    user: JwtPayload,
    tenantId: number | null,
    type?: InsightType,
    limit = INSIGHT_HISTORY_LIMIT,
  ) {
    return this.prisma.businessInsight.findMany({
      where: {
        tenantId,
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        summary: true,
        recommendations: true,
        targetPeriod: true,
        customerId: true,
        customer: { select: { id: true, name: true, phone: true } },
        createdAt: true,
      },
    });
  }

  async listSessions(user: JwtPayload, tenantId: number | null) {
    return this.prisma.aiChatSession.findMany({
      where: {
        userId: user.sub,
        ...(tenantId != null ? { tenantId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { sender: true, content: true, createdAt: true },
        },
      },
    });
  }

  async getSession(id: string, user: JwtPayload, tenantId: number | null) {
    const session = await this.prisma.aiChatSession.findFirst({
      where: {
        id,
        userId: user.sub,
        ...(tenantId != null ? { tenantId } : {}),
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, sender: true, content: true, createdAt: true },
        },
      },
    });
    if (!session) throw new NotFoundException('Chat session not found');
    return session;
  }

  async deleteSession(id: string, user: JwtPayload, tenantId: number | null) {
    const session = await this.prisma.aiChatSession.findFirst({
      where: {
        id,
        userId: user.sub,
        ...(tenantId != null ? { tenantId } : {}),
      },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Chat session not found');
    await this.prisma.aiChatSession.delete({ where: { id: session.id } });
    return { message: 'Chat session deleted' };
  }

  // =========================================================================
  // Scheduled weekly insights (opt-in via AI_ENABLED=true)
  // =========================================================================

  @Cron(CronExpression.EVERY_WEEK)
  async generateWeeklyInsights() {
    if (process.env.AI_ENABLED !== 'true') return;

    try {
      const orgs = await this.prisma.organization.findMany({
        select: { id: true, businessType: true },
      });
      this.logger.log(`Generating weekly AI insights for ${orgs.length} organization(s)`);

      for (const org of orgs) {
        try {
          const metrics = await this.collector.collectMetrics({
            tenantId: org.id,
            businessType: org.businessType,
            days: 30,
          });
          const report = await this.gemini.generateJson<{
            summary: string;
            recommendations: string[];
          }>({
            systemInstruction: this.weeklySystemInstruction(),
            prompt: this.buildWeeklyPrompt(metrics),
            schema: WEEKLY_SCHEMA,
            kind: 'pro',
            temperature: 0.5,
          });
          await this.prisma.businessInsight.create({
            data: {
              tenantId: org.id,
              type: InsightType.WEEKLY_SUMMARY,
              summary: report.summary,
              recommendations: JSON.parse(
                JSON.stringify(report.recommendations),
              ) as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          this.logger.warn(
            `Weekly insight failed for org ${org.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Weekly insight generation failed: ${(err as Error).message}`,
      );
    }
  }

  private weeklySystemInstruction(): string {
    return [
      'You are a business analytics assistant for small businesses.',
      'Write a concise weekly performance summary in English.',
      'Highlight wins, risks and 3-5 concrete recommended actions.',
      'Output strict JSON matching the requested schema. No markdown.',
    ].join('\n');
  }

  private buildWeeklyPrompt(metrics: BusinessMetricsDigest): string {
    return [
      'Weekly performance metrics for this business:',
      JSON.stringify(metrics),
      'Produce the weekly summary JSON matching the requested schema.',
    ].join('\n');
  }

  /**
   * runAssist — PUBLIC onboarding assistant. No auth, no tenant, no business
   * data. Answers purely from the platform guide knowledge base (platform-guide)
   * using Gemini's streamChat; the AiController owns the guest quota and SSE.
   */
  async runAssist(
    dto: AssistDto,
    onDelta: (delta: string) => void,
  ): Promise<void> {
    const systemInstruction =
      buildAssistSystemInstruction(dto.lang ?? 'en') +
      '\n\n## CURRENT PLATFORM FACTS (generated from the live system — trust these over anything above)\n' +
      buildPlatformFactsText();
    const history: ChatTurn[] = (dto.history ?? [])
      .filter((h): h is { role: 'user' | 'model'; text: string } =>
        h.role === 'user' || h.role === 'model'
          ? !!h.text && h.text.length <= 4000
          : false,
      )
      .slice(-8)
      .map((h) => ({ role: h.role, text: h.text }));
    for await (const delta of this.gemini.streamChat({
      systemInstruction,
      history,
      prompt: dto.message,
    })) {
      onDelta(delta);
    }
  }
}

