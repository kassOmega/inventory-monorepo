// src/auth/auth-washer-profile.spec.ts
// A washer may change their own password but may not change their email; other
// non-owner staff cannot change their password at all.
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(() => Promise.resolve(true)),
  hash: jest.fn(() => Promise.resolve('newhash')),
}));

function makeService(opts: { isWasher: boolean }) {
  const user = {
    id: 9,
    email: 'washer@x.com',
    password: 'oldhash',
    name: 'W',
    phone: '0911',
  };
  const prisma: any = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(user)),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 9, email: 'washer@x.com', name: 'W', ...data })),
    },
    carWashWasher: {
      findFirst: jest.fn(() => Promise.resolve(opts.isWasher ? { id: 1 } : null)),
    },
    auditLog: { create: jest.fn(() => Promise.resolve({})) },
  };
  return new AuthService(prisma, { sign: jest.fn() } as any, {} as any, {} as any);
}

const owner = { sub: 1, isSuperuser: true } as any;
const washer = { sub: 9, isSuperuser: false } as any;
const plainStaff = { sub: 9, isSuperuser: false } as any;

describe('AuthService washer profile rules', () => {
  it('lets a washer change their own password', async () => {
    const svc = makeService({ isWasher: true });
    await expect(
      svc.changePassword(washer, 'old', 'newpass'),
    ).resolves.toBeTruthy();
  });

  it('blocks a non-owner non-washer from changing their password', async () => {
    const svc = makeService({ isWasher: false });
    await expect(
      svc.changePassword(plainStaff, 'old', 'newpass'),
    ).rejects.toBeTruthy();
  });

  it('ignores an email change for a washer but applies phone/name', async () => {
    const svc = makeService({ isWasher: true });
    const prisma = (svc as any).prisma;
    await svc.updateProfile(9, { name: 'New', email: 'evil@x.com', phone: '0999' });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.name).toBe('New');
    expect(data.phone).toBe('0999');
    expect(data.email).toBeUndefined();
  });
});
