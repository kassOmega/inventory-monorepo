// src/carwash/carwash-washer-account.spec.ts
// createWasher must provision and link a login account, so every washer can sign
// in (by email or phone). Uses the phone-derived placeholder email when no email
// is supplied.
import { CarWashService } from './carwash.service';
import { tenantContext } from '../common/tenant/tenant.context';

jest.mock('bcrypt', () => ({
  hash: jest.fn(() => Promise.resolve('hashed')),
  compare: jest.fn(() => Promise.resolve(true)),
}));

function setup() {
  const calls: any = { userCreate: null, membership: null, link: null };
  const tx: any = {
    carWashWasher: {
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 55, ...data })),
      update: jest.fn(({ data }: any) => {
        calls.link = data;
        return Promise.resolve({ id: 55, ...data });
      }),
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: 55, userId: 9 })),
    },
    user: {
      findUnique: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(({ data }: any) => {
        calls.userCreate = data;
        return Promise.resolve({ id: 9, ...data });
      }),
    },
    role: {
      findFirst: jest.fn(() => Promise.resolve({ id: 7, systemKey: 'WASHER' })),
    },
    membership: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(({ data }: any) => {
        calls.membership = data;
        return Promise.resolve(data);
      }),
    },
  };
  const prisma: any = {
    $transaction: (fn: any) => fn(tx),
    role: tx.role,
  };
  return { svc: new CarWashService(prisma, {} as any), calls };
}

describe('CarWashService.createWasher account provisioning', () => {
  it('creates a user + membership and links the washer', async () => {
    const { svc, calls } = setup();
    await tenantContext.run(1, () =>
      svc.createWasher({ name: 'Abel', email: 'abel@x.com', phone: '0911 223 344' } as any),
    );
    expect(calls.userCreate).toMatchObject({
      email: 'abel@x.com',
      phone: '0911223344',
      name: 'Abel',
    });
    expect(calls.membership).toMatchObject({
      organizationId: 1,
      roleId: 7,
      status: 'ACTIVE',
    });
    expect(calls.link).toEqual({ userId: 9 });
  });

  it('derives a placeholder email from the phone when no email is given', async () => {
    const { svc, calls } = setup();
    await tenantContext.run(1, () =>
      svc.createWasher({ name: 'Meles', phone: '093435678' } as any),
    );
    expect(calls.userCreate.email).toBe('washer+093435678@carwash.local');
    expect(calls.userCreate.phone).toBe('093435678');
  });
});
