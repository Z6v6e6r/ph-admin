import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/rbac/role.enum';
import { ROLE_PERMISSIONS } from '../common/rbac/role-permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Roles } from '../common/rbac/roles.decorator';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { AdminUserSummary, AuthLoginResult } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): AuthLoginResult {
    const result = this.authService.login(dto.login, dto.password);
    response.setHeader(
      'Set-Cookie',
      this.authService.buildAuthCookie(result.accessToken, this.isSecureRequest(request))
    );
    return result;
  }

  @Post('logout')
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): { ok: true } {
    response.setHeader(
      'Set-Cookie',
      this.authService.buildClearAuthCookie(this.isSecureRequest(request))
    );
    return { ok: true };
  }

  @Get('config')
  config(): { enabled: boolean; requireStaffToken: boolean } {
    return {
      enabled: this.authService.isEnabled(),
      requireStaffToken: this.authService.shouldRequireStaffToken()
    };
  }

  @Get('me')
  me(@CurrentUser() user?: RequestUser): { user: RequestUser | null } {
    return { user: user ?? null };
  }

  @Get('permissions')
  permissions(): { permissions: typeof ROLE_PERMISSIONS } {
    return { permissions: ROLE_PERMISSIONS };
  }

  @Get('admin-users')
  @Roles(Role.SUPER_ADMIN, Role.MANAGER, Role.STATION_ADMIN, Role.SUPPORT)
  adminUsers(@CurrentUser() user?: RequestUser): { users: AdminUserSummary[] } {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return { users: this.authService.listAdminUsers() };
  }

  private isSecureRequest(request: Request): boolean {
    if (request.secure) {
      return true;
    }
    const forwarded = String(request.headers['x-forwarded-proto'] ?? '')
      .toLowerCase()
      .trim();
    return forwarded.includes('https');
  }
}
