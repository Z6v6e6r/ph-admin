import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/auth.service';
import { RequestWithUser } from './request-user.interface';
import { Role } from './role.enum';
import { hasAdminPermission } from './permissions';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const resolved = await this.authService.resolveUserFromRequest(request, {
      allowHeaderFallback: true
    });
    request.user = resolved.user;
    request.authSource = resolved.source;

    if (
      request.user &&
      this.authService.shouldRequireStaffToken() &&
      this.authService.hasStaffRole(request.user.roles) &&
      resolved.source !== 'token'
    ) {
      throw new UnauthorizedException(
        'Staff access requires bearer token from /api/auth/login'
      );
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (requiredPermissions && requiredPermissions.length > 0) {
      return requiredPermissions.every((permission) =>
        hasAdminPermission(request.user?.permissions, permission)
      );
    }

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    return requiredRoles.some((role) => request.user?.roles.includes(role));
  }
}
