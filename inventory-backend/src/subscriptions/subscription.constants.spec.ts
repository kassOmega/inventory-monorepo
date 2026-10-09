// src/subscriptions/subscription.constants.spec.ts
import { classify, daysUntil, periodEnd, GRACE_DAYS, TERM_DAYS } from './subscription.constants';

describe('subscription.constants', () => {
  it('uses fixed day lengths (30/90/180/365)', () => {
    expect(TERM_DAYS.MONTHLY).toBe(30);
    expect(TERM_DAYS.QUARTERLY).toBe(90);
    expect(TERM_DAYS.SEMIANNUAL).toBe(180);
    expect(TERM_DAYS.YEARLY).toBe(365);
  });

  it('periodEnd adds exactly the term length in days', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = periodEnd(start, 'MONTHLY');
    expect(end.toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(periodEnd(start, 'YEARLY').toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  it('classifies ACTIVE / GRACE / EXPIRED from the expiry date', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    const future = new Date('2026-06-20T12:00:00.000Z');
    const yesterday = new Date('2026-06-09T12:00:00.000Z');
    const longAgo = new Date('2026-06-01T12:00:00.000Z');

    expect(classify(future, now)).toBe('ACTIVE');
    expect(classify(null, now)).toBe('ACTIVE');
    // 1 day past expiry is still inside the (2-day) grace window.
    expect(classify(yesterday, now)).toBe('GRACE');
    // well past the grace window.
    expect(classify(longAgo, now)).toBe('EXPIRED');
  });

  it('grace window is 2 days', () => {
    expect(GRACE_DAYS).toBe(2);
    const now = new Date('2026-06-10T12:00:00.000Z');
    const justInside = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 60_000);
    const justOutside = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 - 60_000);
    expect(classify(justInside, now)).toBe('GRACE');
    expect(classify(justOutside, now)).toBe('EXPIRED');
  });

  it('daysUntil counts whole days to expiry (negative when past)', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    expect(daysUntil(new Date('2026-06-12T12:00:00.000Z'), now)).toBe(2);
    expect(daysUntil(new Date('2026-06-09T12:00:00.000Z'), now)).toBe(-1);
    expect(daysUntil(null, now)).toBeNull();
  });
});
