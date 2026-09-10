// src/common/guards/permissions/permissions.guard.ts
import { PERMISSIONS_KEY } from '../../decorators/permissions/permissions.decorator';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // System role (Owner) always passes. Platform admins do NOT bypass business
    // permissions — they only manage the platform via the /admin endpoints.
    if (user?.isSuperuser) {
      return true;
    }

    return requiredPermissions.some((key) => user?.permissions?.includes(key));
  }
}
