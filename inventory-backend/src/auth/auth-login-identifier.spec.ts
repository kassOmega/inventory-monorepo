// src/auth/auth-login-identifier.spec.ts
// Login resolves an email OR a phone number. A phone shared by more than one
// account is rejected (ambiguous), and an unknown identifier fails normally.
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(() => Promise.resolve(true)),
  hash: jest.fn(() => Promise.resolve('hashed')),
}));

function makeService(users: any[]) {
  const prisma: any = {
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.email === where.email) ?? null),
      ),
      findMany: jest.fn(({ where }: any) => {
        const tail = where?.phone?.contains ?? '';
        return Promise.resolve(users.filter((u) => (u.phone ?? '').includes(tail)));
      }),
    },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
    membership: { groupBy: jest.fn(() => Promise.resolve([])) },
  };
  const jwt = { sign: jest.fn(() => 'token') };
  const notifications = {};
  const tenants = {};
  return new AuthService(prisma, jwt as any, notifications as any, tenants as any);
}

const baseUser = (over: any) => ({
  id: 1,
  email: 'washer@x.com',
  password: 'hash',
  name: 'Washer',
  phone: '0911234567',
  status: 'ACTIVE',
  isPlatformAdmin: false,
  isOwnerAccount: false,
  role: { name: 'Washer', isSystem: false, permissions: [] },
  location: null,
  memberships: [],
  verificationStatus: 'APPROVED',
  verificationNote: null,
  verificationAttempts: 0,
  preferredLanguage: 'en',
  ...over,
});

describe('AuthService.login identifier', () => {
  it('logs in by email', async () => {
    const svc = makeService([baseUser({})]);
    const res = await svc.login({ identifier: 'washer@x.com', password: 'pw' } as any);
    expect(res.access_token).toBe('token');
  });

  it('logs in by normalized phone (separators tolerated)', async () => {
    const svc = makeService([baseUser({ phone: '0911234567' })]);
    const res = await svc.login({ identifier: '+251 911 234 567'.replace('+251', '0'), password: 'pw' } as any);
    // '0911 234 567' normalizes to 0911234567 and matches the stored value.
    expect(res.access_token).toBe('token');
  });

  it('rejects an ambiguous phone shared by two accounts', async () => {
    const svc = makeService([
      baseUser({ id: 1, email: 'a@x.com', phone: '0911234567' }),
      baseUser({ id: 2, email: 'b@x.com', phone: '0911234567' }),
    ]);
    await expect(
      svc.login({ identifier: '0911234567', password: 'pw' } as any),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an unknown identifier', async () => {
    const svc = makeService([baseUser({})]);
    await expect(
      svc.login({ identifier: 'nobody@x.com', password: 'pw' } as any),
    ).rejects.toMatchObject({ status: 401 });
  });
});
