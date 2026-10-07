// src/carwash/commission.ts
// Canonical car-wash commission calculation. A wash has one primary washer plus
// any number of participant washers. The wash amount is split equally across the
// N involved washers, and each washer keeps their own commissionRate % of their
// own slice. The owner keeps the remainder. This mirrors the car-wash app's
// CommissionCalculator and is the single source of truth for owner share, washer
// earnings and net profit everywhere.

export interface CommissionedWasher {
  id: number;
  commissionRate: number;
}

export interface WashCommissionResult {
  /** washerId -> commission amount */
  commissions: Record<number, number>;
  ownerShare: number;
  totalCommission: number;
}

export function computeWashCommissions(args: {
  amount: number;
  primaryWasherId?: number | null;
  participantWasherIds: number[];
  washersById: Map<number, CommissionedWasher>;
}): WashCommissionResult {
  const involved = new Set<number>();
  if (args.primaryWasherId != null) involved.add(args.primaryWasherId);
  for (const id of args.participantWasherIds) involved.add(id);

  const n = involved.size;
  const commissions: Record<number, number> = {};
  let totalCommission = 0;

  if (n > 0) {
    for (const id of involved) {
      const washer = args.washersById.get(id);
      if (!washer) continue;
      const commission = (args.amount * (washer.commissionRate / 100)) / n;
      commissions[id] = commission;
      totalCommission += commission;
    }
  }

  return {
    commissions,
    ownerShare: args.amount - totalCommission,
    totalCommission,
  };
}
