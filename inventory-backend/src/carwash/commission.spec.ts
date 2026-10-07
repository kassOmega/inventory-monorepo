// src/carwash/commission.spec.ts
import { computeWashCommissions } from './commission';

describe('computeWashCommissions', () => {
  const washer = (id: number, commissionRate: number) => ({
    id,
    commissionRate,
  });
  const map = (...ws: Array<{ id: number; commissionRate: number }>) =>
    new Map(ws.map((w) => [w.id, w]));

  it('splits revenue equally across the N washers, each keeping their own %', () => {
    const result = computeWashCommissions({
      amount: 100,
      primaryWasherId: 1,
      participantWasherIds: [2],
      washersById: map(washer(1, 50), washer(2, 50)),
    });
    expect(result.commissions).toEqual({ 1: 25, 2: 25 });
    expect(result.totalCommission).toBeCloseTo(50);
    expect(result.ownerShare).toBeCloseTo(50);
  });

  it('handles unequal commission rates (60/40 -> 30/20, owner 50)', () => {
    const result = computeWashCommissions({
      amount: 100,
      primaryWasherId: 1,
      participantWasherIds: [2],
      washersById: map(washer(1, 60), washer(2, 40)),
    });
    expect(result.commissions[1]).toBeCloseTo(30);
    expect(result.commissions[2]).toBeCloseTo(20);
    expect(result.ownerShare).toBeCloseTo(50);
  });

  it('dedupes the primary washer when also listed as a participant', () => {
    const result = computeWashCommissions({
      amount: 100,
      primaryWasherId: 1,
      participantWasherIds: [1],
      washersById: map(washer(1, 50)),
    });
    // One distinct washer -> N = 1, so they keep 50% of the full 100.
    expect(result.commissions[1]).toBeCloseTo(50);
    expect(result.ownerShare).toBeCloseTo(50);
  });

  it('returns full owner share when no washer is involved', () => {
    const result = computeWashCommissions({
      amount: 100,
      primaryWasherId: null,
      participantWasherIds: [],
      washersById: map(),
    });
    expect(result.totalCommission).toBe(0);
    expect(result.ownerShare).toBe(100);
  });
});
