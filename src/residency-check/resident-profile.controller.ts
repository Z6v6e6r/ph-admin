import {
  Controller,
  Get,
  Header,
  Query,
  UnauthorizedException
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { STAFF_ROLES } from '../common/rbac/role.enum';
import { Roles } from '../common/rbac/roles.decorator';
import { ResidentProfileResponse } from './residency-check.types';
import { ResidentProfileService } from './resident-profile.service';

/**
 * Staff-only display profile for the mobile resident check screen.
 *
 * Preview, issuance, return and journal belong to the resident-services domain
 * and are called by the browser directly; this controller owns only the
 * missing name/photo lookup and never exposes provider identifiers.
 */
@Controller('v1/admin/residency')
@Roles(...STAFF_ROLES)
export class ResidentProfileController {
  constructor(private readonly service: ResidentProfileService) {}

  @Get('profile')
  @Permissions('resident-services:issue')
  @Header('Cache-Control', 'private, no-store')
  profile(
    @Query('subscriptionInstanceId') subscriptionInstanceId: string | undefined,
    @CurrentUser() user: RequestUser | undefined
  ): Promise<ResidentProfileResponse> {
    if (!user) {
      throw new UnauthorizedException({
        code: 'RESIDENCY_AUTH_REQUIRED',
        message: 'Staff authorization is required'
      });
    }
    return this.service.resolve(subscriptionInstanceId);
  }
}
