import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ADMIN_PERMISSION_CATALOG } from '../common/rbac/permissions';
import { Permissions } from '../common/rbac/permissions.decorator';
import { RequestUser } from '../common/rbac/request-user.interface';
import { CreateAdminRoleDto } from './dto/create-admin-role.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateAdminRoleDto } from './dto/update-admin-role.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { AuthService } from './auth.service';
import { AdminAuditEntry, AdminRoleDefinition, AdminUserSummary, AuthLoginResult } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthLoginResult> {
    const result = await this.authService.login(dto.login, dto.password);
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
  permissions(): { catalog: typeof ADMIN_PERMISSION_CATALOG } {
    return { catalog: ADMIN_PERMISSION_CATALOG };
  }

  @Get('admin-users')
  @Permissions('admin-users:read')
  async adminUsers(@CurrentUser() user?: RequestUser): Promise<{ users: AdminUserSummary[] }> {
    this.requireUser(user);
    return { users: await this.authService.listAdminUsers() };
  }

  @Post('admin-users')
  @Permissions('admin-users:write')
  async createAdminUser(
    @Body() dto: CreateAdminUserDto,
    @CurrentUser() user?: RequestUser
  ): Promise<AdminUserSummary> {
    return this.authService.createAdminUser(dto, this.requireUser(user));
  }

  @Patch('admin-users/:id')
  @Permissions('admin-users:write')
  async updateAdminUser(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentUser() user?: RequestUser
  ): Promise<AdminUserSummary> {
    return this.authService.updateAdminUser(id, dto, this.requireUser(user));
  }

  @Delete('admin-users/:id')
  @Permissions('admin-users:write')
  async deleteAdminUser(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<{ ok: true }> {
    await this.authService.deleteAdminUser(id, this.requireUser(user));
    return { ok: true };
  }

  @Get('roles')
  @Permissions('admin-users:read')
  async roles(@CurrentUser() user?: RequestUser): Promise<{ roles: AdminRoleDefinition[] }> {
    this.requireUser(user);
    return { roles: await this.authService.listAdminRoles() };
  }

  @Post('roles')
  @Permissions('access:manage')
  async createRole(
    @Body() dto: CreateAdminRoleDto,
    @CurrentUser() user?: RequestUser
  ): Promise<AdminRoleDefinition> {
    return this.authService.createAdminRole(dto, this.requireUser(user));
  }

  @Patch('roles/:id')
  @Permissions('access:manage')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentUser() user?: RequestUser
  ): Promise<AdminRoleDefinition> {
    return this.authService.updateAdminRole(id, dto, this.requireUser(user));
  }

  @Delete('roles/:id')
  @Permissions('access:manage')
  async deleteRole(
    @Param('id') id: string,
    @CurrentUser() user?: RequestUser
  ): Promise<{ ok: true }> {
    await this.authService.deleteAdminRole(id, this.requireUser(user));
    return { ok: true };
  }

  @Get('audit')
  @Permissions('audit:read')
  async audit(
    @Query('actorId') actorId: string | undefined,
    @Query('targetId') targetId: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user?: RequestUser
  ): Promise<{ items: AdminAuditEntry[] }> {
    this.requireUser(user);
    return {
      items: await this.authService.listAudit({
        actorId: String(actorId ?? '').trim() || undefined,
        targetId: String(targetId ?? '').trim() || undefined,
        limit: limit ? Number(limit) : undefined
      })
    };
  }

  private requireUser(user?: RequestUser): RequestUser {
    if (!user) {
      throw new UnauthorizedException('User context is missing');
    }
    return user;
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
