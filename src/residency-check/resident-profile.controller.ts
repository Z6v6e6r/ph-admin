import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { ResidentProfileResponse, ResidentStaffSession } from './residency-check.types';
import {
  ResidentProfileRequestBody,
  ResidentProfileService
} from './resident-profile.service';

const DEFAULT_PUBLIC_ORIGIN = 'https://padlhub.su';
const LOCAL_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const MAX_FORWARDED_CREDENTIAL_LENGTH = 8192;

const isProduction = (): boolean =>
  String(process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';

/** Browser origins allowed to call the PII endpoint with staff cookies. */
export function trustedResidencyOrigins(): Set<string> {
  const raw =
    String(process.env.RESIDENCY_CHECK_ADMIN_ORIGINS ?? '').trim() ||
    DEFAULT_PUBLIC_ORIGIN;
  const origins = new Set<string>();
  for (const item of raw.split(',')) {
    try {
      origins.add(new URL(item.trim()).origin.toLowerCase());
    } catch {
      // Malformed entries are ignored; the default origin stays trusted.
    }
  }
  if (origins.size === 0) {
    origins.add(DEFAULT_PUBLIC_ORIGIN);
  }
  if (!isProduction()) {
    for (const origin of LOCAL_ORIGINS) {
      origins.add(origin);
    }
  }
  return origins;
}

function readHeader(request: Request | undefined, name: string): string {
  const value = request?.headers ? request.headers[name] : undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = typeof raw === 'string' ? raw.trim() : '';
  return normalized.length > MAX_FORWARDED_CREDENTIAL_LENGTH
    ? ''
    : normalized;
}

/**
 * Staff-only display profile for the mobile resident check screen.
 *
 * This endpoint returns personal data (name/photo), so it is not a lookup by
 * id: the caller must present the short-lived pass token and station from the
 * scanned QR, and E verifies that pass server-side against D with the staff
 * session of this very request before any PII is read. There is no route that
 * accepts a bare subscription instance id.
 */
@Controller('v1/admin/residency')
@Roles(...STAFF_ROLES)
export class ResidentProfileController {
  constructor(private readonly service: ResidentProfileService) {}

  @Post('profile')
  @Permissions('resident-services:issue')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  profile(
    @Body() body: ResidentProfileRequestBody | undefined,
    @Req() request: Request,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<ResidentProfileResponse> {
    if (!user) {
      throw new UnauthorizedException({
        code: 'RESIDENCY_AUTH_REQUIRED',
        message: 'Staff authorization is required'
      });
    }
    this.assertTrustedOrigin(request);
    const cookie = readHeader(request, 'cookie');
    const authorization = readHeader(request, 'authorization');
    const staffSession: ResidentStaffSession = {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {})
    };
    return this.service.resolve(body, staffSession);
  }

  /**
   * Same-origin guard for a credentialed, PII-bearing POST. The admin app
   * enables permissive CORS, so without this a third-party page could replay a
   * staff session against this route. Non-browser callers without an Origin
   * header are not blocked; cross-site browser callers are.
   */
  private assertTrustedOrigin(request: Request): void {
    const origin = readHeader(request, 'origin').toLowerCase();
    if (!origin) {
      return;
    }
    if (!trustedResidencyOrigins().has(origin)) {
      throw new ForbiddenException({
        code: 'RESIDENCY_ORIGIN_FORBIDDEN',
        message: 'Request origin is not trusted'
      });
    }
  }
}
