// src/ai/assist.service.ts
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
 * Daily quota (5 chats / guest device / UTC day) for the PUBLIC onboarding
 * assistant. Not tied to a signed-in User — quota key is a per-browser uuid
 * stored in localStorage, so a reset is one new guestId (same as "new day").
 */
@Injectable()
export class AssistService {
  private readonly logger = new Logger(AssistService.name);

  constructor(private readonly prisma: PrismaService) {}

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  }

  async status(guestId: string): Promise<AssistStatus> {
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
   * Reserve one chat for the guest. Throws 429 (HTTP, standard JSON) when the
   * daily allowance is used up — call BEFORE opening the SSE stream.
   */
  async consume(guestId: string): Promise<AssistStatus> {
    const current = await this.status(guestId);
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
    await this.prisma.aiAssistGuest.upsert({
      where: { guestId_date: { guestId, date: this.todayKey() } },
      create: { guestId, date: this.todayKey(), count: 1 },
      update: { count: { increment: 1 } },
    });
    return { ...current, remaining: current.remaining - 1 };
  }
}
