// src/common/user-payload.util.spec.ts
import { BusinessType, LocationType } from '@prisma/client';
import { buildTokenClaims, buildUserPayload } from './user-payload.util';

/**
 * The signed JWT must stay small. `JwtStrategy.validate()` reloads the full
 * payload from the database on every request, so the token only needs the user
 * id — embedding permissions/memberships bloats the Set-Cookie header for no
 * benefit (and was the suspected cause of a production 502).
 */
describe('user-payload token shaping', () => {
  const user = {
    id: 7,
    email: 'owner@example.com',
    preferredLanguage: 'am',
    roleId: 2,
    locationId: 5,
    isPlatformAdmin: false,
    isOwnerAccount: true,
    verificationStatus: 'APPROVED',
    verificationNote: null,
    verificationAttempts: 0,
    role: {
      name: 'OWNER',
      isSystem: true,
      permissions: [{ permission: { key: 'dashboard.view' } }],
    },
    location: { type: LocationType.SHOP },
    memberships: [
      {
        organizationId: 10,
        roleId: 2,
        organization: {
          name: 'Car Wash Co',
          businessType: BusinessType.CAR_WASH,
          aiEnabled: true,
          aiTrialEndsAt: null,
          verificationStatus: 'APPROVED',
          standalone: false,
          defaultLanguage: 'en',
        },
        role: {
          name: 'OWNER',
          isSystem: true,
          permissions: [
            { permission: { key: 'carwash.washes.view' } },
            { permission: { key: 'carwash.prices.view' } },
          ],
        },
      },
      {
        organizationId: 11,
        roleId: 2,
        organization: {
          name: 'Second Shop',
          businessType: BusinessType.RETAIL,
          aiEnabled: true,
          aiTrialEndsAt: null,
          verificationStatus: 'APPROVED',
          standalone: false,
          defaultLanguage: 'en',
        },
        role: {
          name: 'OWNER',
          isSystem: true,
          permissions: [{ permission: { key: 'products.view' } }],
        },
      },
    ],
  };

  it('signs only the identity claims (no permissions, no memberships)', () => {
    const full = buildUserPayload(user);
    const claims = buildTokenClaims(full);

    expect(claims).toEqual({
      sub: 7,
      email: 'owner@example.com',
      preferredLanguage: 'am',
    });
    expect(claims).not.toHaveProperty('permissions');
    expect(claims).not.toHaveProperty('memberships');
    // The signed token is a tiny fraction of the full payload.
    expect(JSON.stringify(claims).length).toBeLessThan(
      JSON.stringify(full).length / 5,
    );
  });

  it('still builds the full request payload for guards/services', () => {
    const full = buildUserPayload(user);

    expect(full.permissions).toEqual(['carwash.washes.view', 'carwash.prices.view']);
    expect(full.memberships).toHaveLength(2);
    expect(full.organizationId).toBe(10);
    expect(full.businessType).toBe(BusinessType.CAR_WASH);
    expect(full.locationType).toBe(LocationType.SHOP);
  });
});
