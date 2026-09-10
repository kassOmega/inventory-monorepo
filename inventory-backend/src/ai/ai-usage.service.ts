// src/ai/ai-usage.service.ts
// Per-user daily quota + per-tenant AI entitlement for the AI endpoints
// (POST /ai/chat and POST /ai/forecast).
//
//  - Daily quota: UserDailyAiUsage keyed by (userId, date).
//  - Entitlement: Organization.aiEnabled + Organization.aiTrialEndsAt
//    (new orgs get a 15-day free trial; the trial end date is set manually on
//    the owner's User account when it is created and inherited by their orgs).
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_AI_TRIAL_DAYS = 15;

export interface AiUsageInfo {
  date: string;
  count: number;
  quota: number;
  remaining: number;
  limitReached: boolean;
}

export interface AiEntitlement {
  enabled: boolean;
  trialEndsAt: string | null;
  inTrial: boolean;
  expired: boolean;
  /** True when AI is switched on but no access end date is set (no active window). */
  requiresDate?: boolean;
}

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  get quota(): number {
    const parsed = Number(process.env.AI_DAILY_QUOTA);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 15;
  }

  /** Per-user daily cap: user.dailyAiQuota overrides the global default. */
  async getQuota(userId: number): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dailyAiQuota: true },
    });
    if (user?.dailyAiQuota != null && user.dailyAiQuota > 0) {
      return user.dailyAiQuota;
    }
    return this.quota;
  }

  /** Server-local date in "YYYY-MM-DD" (quota resets at local midnight). */
  getToday(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /** Default trial end date for a newly created tenant (now + 15 days). */
  defaultTrialEnd(): Date {
    return new Date(Date.now() + DEFAULT_AI_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  }

  // =========================================================================
  // Per-tenant entitlement (AI is on-demand + free 15-day trial)
  // =========================================================================

  async getEntitlement(tenantId: number | null): Promise<AiEntitlement> {
    if (tenantId == null) {
      return { enabled: false, trialEndsAt: null, inTrial: false, expired: false };
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { aiEnabled: true, aiTrialEndsAt: true },
    });
    if (!org) {
      return { enabled: false, trialEndsAt: null, inTrial: false, expired: false };
    }
    return this.buildEntitlement(org.aiEnabled, org.aiTrialEndsAt);
  }

  /** Throws 403 when the tenant's AI feature is disabled or the trial expired. */
  async assertAiEnabled(tenantId: number | null): Promise<AiEntitlement> {
    const entitlement = await this.getEntitlement(tenantId);
    if (entitlement.expired) {
      throw new ForbiddenException(
        `⚠️ The AI free trial ended on ${entitlement.trialEndsAt}. Contact the admin to extend or enable the AI feature.`,
      );
    }
    if (entitlement.requiresDate) {
      throw new ForbiddenException(
        '🤖 AI is enabled for this business but has no active access window. Ask the admin to set a trial/access end date.',
      );
    }
    if (!entitlement.enabled) {
      throw new ForbiddenException(
        '🤖 The AI feature is not enabled for this business. Contact the admin to enable it.',
      );
    }
    return entitlement;
  }

  private buildEntitlement(
    aiEnabled: boolean,
    aiTrialEndsAt: Date | null,
  ): AiEntitlement {
    const now = new Date();
    const hasDate = aiTrialEndsAt != null;
    const inWindow = hasDate && aiTrialEndsAt! >= now;
    return {
      // AI is usable ONLY when an access window has an end date set AND that
      // date is in the future. A null end date means "no active access".
      enabled: aiEnabled && inWindow,
      trialEndsAt: hasDate ? aiTrialEndsAt!.toISOString().slice(0, 10) : null,
      inTrial: aiEnabled && inWindow,
      expired: aiEnabled && hasDate && aiTrialEndsAt! < now,
      requiresDate: aiEnabled && !hasDate,
    };
  }

  // =========================================================================
  // Per-user daily quota
  // =========================================================================

  /** Read today's usage without incrementing (for the UI usage badge). */
  async getUsage(userId: number): Promise<AiUsageInfo> {
    const date = this.getToday();
    const quota = await this.getQuota(userId);
    const row = await this.prisma.userDailyAiUsage.findUnique({
      where: { userId_date: { userId, date } },
    });
    const count = row?.count ?? 0;
    return this.info(date, count, quota);
  }

  /**
   * Atomically check the daily quota and increment the counter.
   * Throws HTTP 429 when the quota is exhausted.
   */
  async checkAndIncrement(userId: number): Promise<AiUsageInfo> {
    const date = this.getToday();
    const quota = await this.getQuota(userId);

    let row = await this.prisma.userDailyAiUsage.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!row) {
      row = await this.prisma.userDailyAiUsage.create({
        data: { userId, date, count: 0 },
      });
    }

    // Atomic increment guarded by the quota, so concurrent requests cannot
    // overshoot the limit.
    const updated = await this.prisma.userDailyAiUsage.updateMany({
      where: { id: row.id, count: { lt: quota } },
      data: { count: { increment: 1 } },
    });

    if (updated.count === 0) {
      const info = this.info(date, row.count, quota);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `⚠️ Daily limit reached: You have used ${quota}/${quota} daily AI queries. Quota resets at midnight.`,
          remainingChats: 0,
          quota,
          count: row.count,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.info(date, row.count + 1, quota);
  }

  private info(date: string, count: number, quota: number): AiUsageInfo {
    return {
      date,
      count,
      quota,
      remaining: Math.max(0, quota - count),
      limitReached: count >= quota,
    };
  }
}
