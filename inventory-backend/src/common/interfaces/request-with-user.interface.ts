import { JwtPayload } from './jwt-payload.interface';

export class RequestWithUser {
  user!: JwtPayload;
  /** Resolved active organization id, populated by the TenantGuard. */
  tenantId?: number | null;
}
