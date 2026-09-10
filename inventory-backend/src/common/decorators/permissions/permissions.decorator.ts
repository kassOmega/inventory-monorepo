// src/common/decorators/permissions/permissions.decorator.ts
import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

// Explicitly type the return value as CustomDecorator<string>
export const Permissions = (...permissions: string[]): CustomDecorator<string> =>
  SetMetadata(PERMISSIONS_KEY, permissions);
