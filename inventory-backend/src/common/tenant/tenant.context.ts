// src/common/tenant/tenant.context.ts
// AsyncLocalStorage-backed request context that carries the active organization
// (tenant) id. The TenantContextInterceptor runs every HTTP handler inside
// `tenantContext.run(...)`, and the Prisma middleware reads it to automatically
// scope queries and tag new rows with the tenant.
import { AsyncLocalStorage } from 'node:async_hooks';

export const tenantContext = new AsyncLocalStorage<number | null>();

export function getCurrentTenantId(): number | null {
  return tenantContext.getStore() ?? null;
}
