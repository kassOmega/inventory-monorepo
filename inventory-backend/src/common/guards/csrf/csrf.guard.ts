// src/common/guards/csrf/csrf.guard.ts
// CSRF defense for cookie-authenticated sessions. Cross-site scripts cannot set
// custom headers without a CORS preflight, and our CORS allow-list only admits
// the frontend origin — so requiring `X-Requested-With: XMLHttpRequest` on every
// state-changing request blocks cross-site request forgery even for
// SameSite=None cookies. Bearer-token clients (which are not cookie-based) are
// unaffected.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    if (SAFE_METHODS.has(req.method)) return true;

    // Non-cookie clients authenticate with the Authorization header — they are
    // not subject to CSRF (an attacker cannot set that header cross-origin).
    if (req.headers?.authorization) return true;

    if (req.headers?.['x-requested-with'] !== 'XMLHttpRequest') {
      throw new ForbiddenException('CSRF protection failed');
    }
    return true;
  }
}
