// src/ai/assist.service.ts
import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const ASSIST_DAILY_LIMIT = 5;

/** Guest status payload returned by GET /ai/assist/status and stream events. */
export interface AssistStatus {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Daily quota (5 chats / client IP / UTC day) for the PUBLIC onboarding
 * assistant. The quota is bound to the real client IP seen by the server and
 * stored under an HMAC digest, so rotating the client-supplied `guestId` can
 * never reset the daily allowance. The raw IP is never persisted.
 */
@Injectable()
export class AssistService {
  private readonly logger = new Logger(AssistService.name);

  constructor(private readonly prisma: PrismaService) {}

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  }

  /** Non-reversible per-IP quota key (HMAC-SHA256, truncated for storage). */
  private quotaKey(clientIp: string): string {
    const secret = process.env.JWT_SECRET ?? 'kass-assist-quota-salt';
    return createHmac('sha256', secret)
      .update(clientIp ?? 'unknown')
      .digest('hex')
      .slice(0, 40);
  }

  async status(clientIp: string): Promise<AssistStatus> {
    const guestId = this.quotaKey(clientIp);
    const rec = await this.prisma.aiAssistGuest.findUnique({
      where: { guestId_date: { guestId, date: this.todayKey() } },
    });
    const used = rec?.count ?? 0;
    return {
      used,
      limit: ASSIST_DAILY_LIMIT,
      remaining: Math.max(0, ASSIST_DAILY_LIMIT - used),
    };
  }

  /**
   * Reserve one chat for the client IP. Throws 429 (HTTP, standard JSON) when
   * the daily allowance is used up — call BEFORE opening the SSE stream.
   */
  async consume(clientIp: string): Promise<AssistStatus> {
    const current = await this.status(clientIp);
    if (current.remaining <= 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Daily free-chat limit reached for this device.',
          remaining: 0,
          limit: ASSIST_DAILY_LIMIT,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const guestId = this.quotaKey(clientIp);
    await this.prisma.aiAssistGuest.upsert({
      where: { guestId_date: { guestId, date: this.todayKey() } },
      create: { guestId, date: this.todayKey(), count: 1 },
      update: { count: { increment: 1 } },
    });
    return { ...current, remaining: current.remaining - 1 };
  }
}
