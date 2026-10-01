// src/common/duplicate.util.ts
// Re-throws a Prisma unique-constraint violation (P2002) as a clean 409 so the
// caller can tell the user "this was already submitted / already exists".
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { tr } from '../i18n/i18n.service';

export function assertNotDuplicate(
  err: unknown,
  key = 'errors.recordExists',
): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  ) {
    throw new ConflictException(tr(key));
  }
  throw err;
}
