// src/common/tenant/tenant.context.ts
// AsyncLocalStorage-backed request context that carries the active organization
// (tenant) id. The TenantContextInterceptor runs every HTTP handler inside
// `tenantContext.run(...)`, and the Prisma middleware reads it to automatically
// scope queries and tag new rows with the tenant.
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException } from '@nestjs/common';

export const tenantContext = new AsyncLocalStorage<number | null>();

export function getCurrentTenantId(): number | null {
  return tenantContext.getStore() ?? null;
}

/**
 * Same as getCurrentTenantId() but narrows away `null` for write paths whose
 * models have a NOT NULL tenant (Product, Sale, Order, Inventory). Throws the
 * same error the services raise when a request has no active organization, so
 * a missing tenant can never turn into a cross-tenant write.
 */
export function requireTenantId(): number {
  const id = getCurrentTenantId();
  if (id == null) throw new BadRequestException('No active organization');
  return id;
}
