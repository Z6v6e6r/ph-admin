import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';
import { RequestWithUser } from '../common/rbac/request-user.interface';
import { RESIDENT_SERVICES_ERROR_CODES } from './resident-services.types';

const RESIDENT_PUBLIC_CODES = new Set<string>([
  ...Object.values(RESIDENT_SERVICES_ERROR_CODES),
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND'
]);

@Catch()
export class ResidentServicesExceptionFilter implements ExceptionFilter {
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
    const correlationId = this.correlationId(request);
    const status = rawStatus;
    const code = this.publicCode(status, domainCode);
    const details = this.details(body);
    response.setHeader('X-Correlation-Id', correlationId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.status(status).json({
      error: {
        code,
        message: this.message(exception, body, status),
        correlationId,
        retryable: status === HttpStatus.SERVICE_UNAVAILABLE || status >= 500,
        operationId: null,
        ...(details ? { details } : {})
      }
    });
  }

  private details(body: Record<string, unknown>): Record<string, unknown> | null {
    if (body.details && typeof body.details === 'object') {
      return body.details as Record<string, unknown>;
    }
    if (body.cause && typeof body.cause === 'object') {
      return body.cause as Record<string, unknown>;
    }
    return null;
  }

  private correlationId(request: RequestWithUser): string {
    const header = String(request.headers['x-correlation-id'] ?? '');
    if (header === header.trim() && header.length >= 8 && header.length <= 128) {
      return header;
    }
    return 'corr:' + randomUUID();
  }

  private publicCode(status: number, domainCode: string): string {
    if (RESIDENT_PUBLIC_CODES.has(domainCode)) return domainCode;
    if (status === HttpStatus.UNAUTHORIZED) return 'AUTH_REQUIRED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.CONFLICT) return 'CONFLICT';
    if (status === HttpStatus.SERVICE_UNAVAILABLE || status >= 500) return 'UPSTREAM_UNAVAILABLE';
    return 'VALIDATION_ERROR';
  }

  private message(
    exception: unknown,
    body: Record<string, unknown>,
    status: number
  ): string {
    if (Array.isArray(body.message)) return body.message.map(String).join('; ');
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
    if (status >= 500) return 'Resident services request failed';
    if (exception instanceof Error && exception.message) return exception.message;
    return 'Resident services request failed';
  }
}
