import { SetMetadata } from '@nestjs/common';

// Routes decorated with @AllowUnverified() remain reachable while the user's
// account (or the active business) is still being verified. Everything else is
// blocked by the VerificationGuard until verification is APPROVED.
export const ALLOW_UNVERIFIED_KEY = 'allowUnverified';
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
