import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(private prisma: PrismaService) {
    if (
      process.env.VAPID_SUBJECT &&
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY
    ) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      this.enabled = true;
      this.logger.log(
        'Web Push enabled (VAPID keys configured).',
      );
    } else {
      this.logger.warn(
        'Web Push DISABLED: missing VAPID_SUBJECT, VAPID_PUBLIC_KEY or ' +
          'VAPID_PRIVATE_KEY in the environment. Set all three (and redeploy) ' +
          'to enable push notifications.',
      );
    }
  }

  async subscribe(
    userId: number,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    const result = await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      },
    });
    this.logger.log(
      `Push subscription stored for user ${userId} (${this.shortEndpoint(sub.endpoint)})`,
    );
    return result;
  }

  async sendToUser(
    userId: number,
    payload: { title: string; body: string; url?: string },
  ) {
    if (!this.enabled) {
      // The constructor already warned loudly; don't spam per-send.
      this.logger.debug(
        `Push send skipped for user ${userId} (push disabled).`,
      );
      return;
    }

    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subs.length === 0) {
      this.logger.debug(
        `No push subscriptions for user ${userId} — nothing to send.`,
      );
      return;
    }

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
        this.logger.log(
          `Push sent to user ${userId} (${this.shortEndpoint(sub.endpoint)}): "${payload.title}"`,
        );
      } catch (e: any) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          this.logger.warn(
            `Removing stale push subscription for user ${userId} (${e.statusCode}).`,
          );
          await this.prisma.pushSubscription.delete({ where: { id: sub.id } });
        } else if (e.statusCode === 401) {
          this.logger.error(
            `Push FAILED for user ${userId}: 401 Unauthorized — the VAPID private key does not match the public key the browser subscribed with. Regenerate a matching pair, update both envs, and redeploy.`,
          );
        } else {
          this.logger.error(
            `Push FAILED for user ${userId} (${e.statusCode ?? 'unknown'}): ${e.message ?? e}`,
            e.stack,
          );
        }
      }
    }
  }

  async sendToRoleId(
    payload: { title: string; body: string; url?: string },
    roleId: number,
  ) {
    if (!this.enabled) return;
    const users = await this.prisma.user.findMany({ where: { roleId } });
    for (const user of users) {
      await this.sendToUser(user.id, payload);
    }
  }

  async sendToLocation(
    payload: { title: string; body: string; url?: string },
    locationId: number,
  ) {
    if (!this.enabled) return;
    const users = await this.prisma.user.findMany({ where: { locationId } });
    for (const user of users) {
      await this.sendToUser(user.id, payload);
    }
  }

  /** Diagnostic: how many browser push subscriptions are stored. */
  async countSubscriptions(): Promise<number> {
    return this.prisma.pushSubscription.count();
  }

  /** Delete every stored subscription (used after VAPID key rotation). */
  async purgeSubscriptions(): Promise<number> {
    const result = await this.prisma.pushSubscription.deleteMany({});
    this.logger.warn(
      `Purged ${result.count} push subscription(s) (owner action).`,
    );
    return result.count;
  }

  private shortEndpoint(endpoint: string): string {
    try {
      const u = new URL(endpoint);
      return `${u.host}${u.pathname.slice(-20)}`;
    } catch {
      return endpoint.slice(-40);
    }
  }
}