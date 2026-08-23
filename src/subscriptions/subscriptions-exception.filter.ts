import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { RequestWithUser } from '../common/rbac/request-user.interface';

const PUBLIC_ERROR_CODES = new Set([
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'POLICY_VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'SUBSCRIPTIONS_TEST_RUNTIME_DISABLED',
  'SUBSCRIPTIONS_TEST_HASH_PEPPER_REQUIRED',
  'TEST_OFFER_SOLD_OUT',
  'TEST_PURCHASE_LIMIT_REACHED',
  'TEST_PURCHASE_STATE_CONFLICT',
  'TEST_INVENTORY_CONTENTION',
  'TEST_RESERVATION_NOT_PENDING',
  'TEST_ACTIVATION_BLOCKED',
  'SUBSCRIPTIONS_ACTIVATION_REVISION_CONFLICT',
  'SUBSCRIPTIONS_ACTIVATION_STATE_CONFLICT',
  'SUBSCRIPTIONS_PUBLICATION_PRECONDITION_CHANGED',
  'SUBSCRIPTIONS_POLICY_ALREADY_PUBLISHED',
  'SUBSCRIPTIONS_POLICY_DRAFT_ALREADY_EXISTS',
  'SUBSCRIPTIONS_POLICY_SUPERSESSION_PRECONDITION_CHANGED',
  'SUBSCRIPTIONS_ACTIVE_INSTANCE_MIGRATION_UNSUPPORTED',
  'SUBSCRIPTIONS_PROVIDER_MAPPING_CONFLICT',
  'SUBSCRIPTIONS_PUBLICATION_PREVIEW_DISABLED',
  'SUBSCRIPTIONS_PUBLICATION_COMMAND_DISABLED',
  'UPSTREAM_UNAVAILABLE'
]);

@Catch()
export class SubscriptionsExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithUser>();
    const response = context.getResponse<Response>();
    const rawStatus = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawBody = exception instanceof HttpException ? exception.getResponse() : null;
    const body = rawBody && typeof rawBody === 'object'
      ? rawBody as Record<string, unknown>
      : {};
    const domainCode = typeof body.code === 'string' ? body.code : '';
    const isIntegrationTokenRejection = [
      'SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_FORBIDDEN',
      'SUBSCRIPTIONS_ACTIVATION_INTEGRATION_FORBIDDEN'
    ].includes(domainCode);
    const status = rawStatus === HttpStatus.FORBIDDEN && !request.user && !isIntegrationTokenRejection
      ? HttpStatus.UNAUTHORIZED
      : rawStatus;
    const correlationId = this.correlationId(request);
    const code = this.publicCode(status, domainCode);
    const details: Record<string, unknown> = {};
    if (domainCode && domainCode !== code) details.domainCode = domainCode;
    if (Array.isArray(body.message)) details.validationErrors = body.message.map(String);
    const rawDetails = body.details && typeof body.details === 'object'
      ? body.details as Record<string, unknown>
      : null;
    if (rawDetails && Array.isArray(rawDetails.blockers)) {
      details.blockers = rawDetails.blockers.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const issue = item as Record<string, unknown>;
        const target = issue.target === 'REAL' || issue.target === 'TEST' ? issue.target : null;
        if (typeof issue.code !== 'string' || typeof issue.message !== 'string' || !target) return [];
        return [{ code: issue.code, message: issue.message, target }];
      });
    }

    response.setHeader('X-Correlation-Id', correlationId);
    response.status(status).json({
      error: {
        code,
        message: this.message(exception, body, status),
        correlationId,
        retryable: status === HttpStatus.SERVICE_UNAVAILABLE || status >= 500,
        operationId: null,
        ...(Object.keys(details).length ? { details } : {})
      }
    });
  }

  private correlationId(request: RequestWithUser): string {
    const header = String(request.headers['x-correlation-id'] ?? '');
    if (header === header.trim() && header.length >= 8 && header.length <= 128) return header;
    return `corr:${randomUUID()}`;
  }

  private publicCode(status: number, domainCode: string): string {
    if (PUBLIC_ERROR_CODES.has(domainCode)) return domainCode;
    if (status === HttpStatus.UNAUTHORIZED) return 'AUTH_REQUIRED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.CONFLICT) return 'POLICY_VERSION_CONFLICT';
    if (status === HttpStatus.SERVICE_UNAVAILABLE || status >= 500) return 'UPSTREAM_UNAVAILABLE';
    return 'VALIDATION_ERROR';
  }

  private message(exception: unknown, body: Record<string, unknown>, status: number): string {
    if (Array.isArray(body.message)) return body.message.map(String).join('; ');
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
    if (exception instanceof ForbiddenException && status === HttpStatus.UNAUTHORIZED) {
      return 'Authentication is required';
    }
    if (exception instanceof Error && exception.message && status < 500) return exception.message;
    return status >= 500 ? 'Subscription control plane is unavailable' : 'Request failed';
  }
}
