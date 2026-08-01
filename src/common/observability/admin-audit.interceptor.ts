import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';
import { AuthPersistenceService } from '../../auth/auth-persistence.service';
import { RequestWithUser } from '../rbac/request-user.interface';

/** Records successful staff mutations without ever storing request bodies or secrets. */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly persistence: AuthPersistenceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const method = String(request.method ?? '').toUpperCase();
    const path = String(request.originalUrl ?? request.url ?? '');
    const user = request.user;
    if (
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ||
      !user ||
      user.id === 'anonymous' ||
      path.startsWith('/api/auth/')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          // Audit availability must not turn a completed staff operation into an
          // unhandled rejection. AuthService records its own critical events; this
          // generic trail is intentionally best-effort.
          void this.persistence
            .appendAudit({
              id: `audit-${randomUUID()}`,
              at: new Date().toISOString(),
              action: `${method} ${path.split('?')[0]}`,
              actor: { id: user.id, login: user.login, title: user.title },
              targetType: 'RESOURCE',
              targetId: String(request.params?.id ?? '').trim() || undefined,
              metadata: { method, path: path.split('?')[0] }
            })
            .catch(() => undefined);
        }
      })
    );
  }
}
