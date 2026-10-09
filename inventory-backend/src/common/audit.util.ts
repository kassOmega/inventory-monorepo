// src/common/audit.util.ts
// Shared, best-effort audit writer. Every mutating action should record a row in
// `AuditLog` so the Reports → Audit Trail is never empty for an active business.
// Auditing must never break the primary action, so failures are swallowed (and
// logged to the console) rather than thrown.
import { PrismaClient } from '@prisma/client';
import { getCurrentTenantId } from './tenant/tenant.context';

/** A Prisma client or transaction client (both expose `auditLog.create`). */
type PrismaLike = {
  auditLog: { create: (args: { data: AuditEntry }) => Promise<unknown> };
};

export interface AuditEntry {
  userId: number;
  action: string;
  details: string;
  /** Defaults to the active tenant context when omitted. */
  tenantId?: number | null;
}

/**
 * Write an audit row, best-effort. Pass the caller's transaction client when the
 * action runs in a transaction so the row commits with it; otherwise pass the
 * Prisma service. Never throws.
 */
export async function auditBestEffort(
  db: PrismaLike | PrismaClient | unknown,
  entry: AuditEntry,
): Promise<void> {
  try {
    const client = db as PrismaLike;
    if (!client?.auditLog?.create) return;
    await client.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        details: entry.details,
        tenantId:
          entry.tenantId !== undefined ? entry.tenantId : getCurrentTenantId(),
      },
    });
  } catch (err) {
    // Auditing is secondary: never let it fail the business action.
    // eslint-disable-next-line no-console
    console.warn('[audit] failed to record', entry.action, err);
  }
}
