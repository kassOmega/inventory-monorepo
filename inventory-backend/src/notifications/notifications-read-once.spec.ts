// src/notifications/notifications-read-once.spec.ts
// Read-once: with a dedupe key, the same business event never creates a second
// notification for a recipient (read or not), and recipient fan-out gives each
// member their own row.
import { NotificationsService } from './notifications.service';

function makeService() {
  const rows: any[] = [];
  const prisma: any = {
    role: { findFirst: jest.fn(async () => ({ id: 9 })) },
    membership: {
      findMany: jest.fn(async () => [{ userId: 1 }, { userId: 2 }]),
    },
    user: { findMany: jest.fn(async () => [{ id: 1 }]) },
    notification: {
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find(
          (r) =>
            r.dedupeKey === where.dedupeKey &&
            r.targetUserId === where.targetUserId,
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: rows.length + 1, isRead: false, ...data };
        rows.push(created);
        return created;
      }),
    },
  };
  const push: any = { sendToUser: jest.fn(() => Promise.resolve()) };
  const svc = new NotificationsService(prisma, push);
  return { svc, prisma, rows, push };
}

describe('NotificationsService read-once', () => {
  it('creates one row per recipient and never regenerates the same dedupe key', async () => {
    const { svc, rows, push } = makeService();

    await svc.notifyOwner('New thing', 'body', { dedupeKey: 'EVT:1' });
    expect(rows).toHaveLength(2); // two owners → two rows
    expect(push.sendToUser).toHaveBeenCalledTimes(2);

    // Re-trigger the SAME event → no new rows, no new pushes.
    await svc.notifyOwner('New thing', 'body', { dedupeKey: 'EVT:1' });
    expect(rows).toHaveLength(2);
    expect(push.sendToUser).toHaveBeenCalledTimes(2);

    // Even after one is read, re-triggering still creates nothing.
    rows[0].isRead = true;
    await svc.notifyOwner('New thing', 'body', { dedupeKey: 'EVT:1' });
    expect(rows).toHaveLength(2);
  });

  it('without a dedupe key each call still creates a new row (legacy behaviour)', async () => {
    const { svc, rows } = makeService();
    await svc.notifyOwner('Ping', 'body');
    await svc.notifyOwner('Ping', 'body');
    expect(rows).toHaveLength(4); // 2 owners × 2 calls
  });

  it('a different dedupe key still notifies', async () => {
    const { svc, rows } = makeService();
    await svc.notifyOwner('Event', 'body', { dedupeKey: 'EVT:1' });
    await svc.notifyOwner('Event', 'body', { dedupeKey: 'EVT:2' });
    expect(rows).toHaveLength(4); // 2 owners × 2 distinct events
  });
});
