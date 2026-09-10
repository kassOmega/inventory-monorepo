// src/common/interceptors/tenant-context.interceptor.ts
// Wraps every request handler in the tenant AsyncLocalStorage context so that the
// Prisma middleware can resolve the active organization id for the duration of
// the request.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantContext } from '../tenant/tenant.context';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const tenantId: number | null =
      req?.tenantId ?? req?.user?.organizationId ?? null;

    return new Observable((subscriber) => {
      tenantContext.run(tenantId, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
