import { SetMetadata } from '@nestjs/common';
import { BusinessType } from '@prisma/client';

// Marks a controller as belonging to one or more business verticals. The
// VerticalGuard enforces this only for controllers decorated with @Vertical();
// controllers without it are never checked (zero-risk to existing routes).
export const VERTICAL_KEY = 'vertical';
export const Vertical = (...types: BusinessType[]) =>
  SetMetadata(VERTICAL_KEY, types);
