import { SetMetadata } from '@nestjs/common';

// Routes decorated with @AllowExpired() stay reachable even when the active
// business's subscription is EXPIRED (past grace). Used for the renewal surface
// (viewing the subscription, listing bank accounts, submitting a receipt) so an
// expired tenant can always pay to renew. Everything that MUTATES data is blocked
// while EXPIRED.
export const ALLOW_EXPIRED_KEY = 'allowExpired';
export const AllowExpired = () => SetMetadata(ALLOW_EXPIRED_KEY, true);
