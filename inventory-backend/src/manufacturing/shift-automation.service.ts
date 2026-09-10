import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { tenantContext } from "../common/tenant/tenant.context";

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const isToday = (d: Date, now: Date) =>
  d.getFullYear() === now.getFullYear() &&
  d.getMonth() === now.getMonth() &&
  d.getDate() === now.getDate();

/**
 * Auto shift clock: runs every minute. Sessions for today that have reached
 * their startTime become ACTIVE; ACTIVE sessions past their endTime are ended
 * after a handover check (owner notified when a leaver has unreturned items).
 */
@Injectable()
export class ShiftAutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron("* * * * *")
  async autoRun() {
    const now = new Date();
    const nowHhmm = hhmm(now);

    const scheduled = await this.prisma.shiftSession.findMany({
      where: { status: "SCHEDULED" },
    });
    for (const session of scheduled) {
      if (isToday(session.date, now) && session.startTime <= nowHhmm) {
        await this.prisma.shiftSession.update({
          where: { id: session.id },
          data: { status: "ACTIVE", startedAt: now, triggeredBy: "AUTO" },
        });
      }
    }

    const active = await this.prisma.shiftSession.findMany({
      where: { status: "ACTIVE" },
    });
    for (const session of active) {
      if (session.endTime <= nowHhmm) {
        await this.endSessionForOrg(session.organizationId, session.id, now);
      }
    }
  }

  private async endSessionForOrg(orgId: number, sessionId: number, now: Date) {
    await tenantContext.run(orgId, async () => {
      const session = await this.prisma.shiftSession.findUnique({
        where: { id: sessionId },
        include: { assignments: true },
      });
      if (!session) return;
      const workerIds = (session.assignments ?? [])
        .map((a) => a.workerId)
        .filter((w): w is number => w != null);
      const openIssues = workerIds.length
        ? await this.prisma.materialIssue.findMany({
            where: {
              issuedToId: { in: workerIds },
              status: { in: ["OPEN", "PARTIAL"] as any },
            },
            include: { returns: true },
          })
        : [];
      const missing = openIssues
        .map((issue) => {
          const returned = (issue.returns ?? []).reduce((s, r) => s + r.quantity, 0);
          return { workerId: issue.issuedToId, shortQty: issue.quantity - returned };
        })
        .filter((m) => m.shortQty > 0);
      await this.prisma.shiftSession.update({
        where: { id: sessionId },
        data: { status: "ENDED", endedAt: now, handoverClean: missing.length === 0 },
      });
      if (missing.length > 0) {
        const ids = [...new Set(missing.map((m) => m.workerId).filter((w): w is number => w != null))];
        const workers = ids.length
          ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { name: true } })
          : [];
        await this.notifications
          .notifyOwner(
            "Shift handover: unreturned materials",
            `Shift "${session.name}" ended with ${missing.length} outstanding material issue(s) from: ${workers.map((w) => w.name).join(", ") || "unknown workers"}`,
          )
          .catch(() => undefined);
      }
    });
  }
}
