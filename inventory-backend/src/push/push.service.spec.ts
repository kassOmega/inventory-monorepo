import { PushService } from './push.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(async () => undefined),
}));

const setKeys = () => {
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
};

const clearKeys = () => {
  delete process.env.VAPID_SUBJECT;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
};

const makePrisma = (membershipUserIds: number[], legacyUserIds: number[]) => ({
  membership: {
    findMany: jest.fn(async () =>
      membershipUserIds.map((userId) => ({ userId })),
    ),
  },
  user: {
    findMany: jest.fn(async () => legacyUserIds.map((id) => ({ id }))),
  },
  pushSubscription: {
    findMany: jest.fn(async () => []),
    delete: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
});

describe('PushService.sendToRoleId', () => {
  beforeEach(() => setKeys());
  afterEach(() => {
    clearKeys();
    jest.clearAllMocks();
  });

  it('resolves recipients from memberships and legacy role users, deduped', async () => {
    const prisma = makePrisma([7, 9], [9, 11]);
    const svc = new PushService(prisma as never);
    const sent: number[] = [];
    jest
      .spyOn(svc, 'sendToUser')
      .mockImplementation(async (userId: number) => {
        sent.push(userId);
      });

    await svc.sendToRoleId(
      { title: 'New Kitchen Order', body: 'Order ORD-1', url: '/dashboard/restaurant' },
      5,
      3,
    );

    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where: { roleId: 5, organizationId: 3 },
      select: { userId: true },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { roleId: 5 },
      select: { id: true },
    });
    expect(sent.sort((a, b) => a - b)).toEqual([7, 9, 11]);
  });

  it('does not filter by organization when none is supplied', async () => {
    const prisma = makePrisma([4], []);
    const svc = new PushService(prisma as never);
    jest.spyOn(svc, 'sendToUser').mockImplementation(async () => undefined);

    await svc.sendToRoleId({ title: 't', body: 'b' }, 12);

    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where: { roleId: 12 },
      select: { userId: true },
    });
  });

  it('stays a no-op when push is disabled (missing VAPID keys)', async () => {
    clearKeys();
    const prisma = makePrisma([7], []);
    const svc = new PushService(prisma as never);

    await svc.sendToRoleId({ title: 't', body: 'b' }, 5, 3);

    expect(prisma.membership.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
