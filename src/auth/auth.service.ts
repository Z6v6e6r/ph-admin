import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { isProductionRuntime } from '../common/mongo-index.guard';
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  hasAdminPermission
} from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { Role, STAFF_ROLES } from '../common/rbac/role.enum';
import { resolveRequestUser } from '../common/rbac/request-user.util';
import { AuthPersistenceService } from './auth-persistence.service';
import {
  AdminAuditEntry,
  AdminRoleDefinition,
  AdminUserConfig,
  AdminUserRecord,
  AdminUserSummary,
  AuthLoginResult,
  AuthResolvedUser
} from './auth.types';

interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
  typ: 'admin';
}

interface AdminUserInput {
  login?: string;
  password?: string;
  title?: string;
  maxPublicUrl?: string;
  roleIds?: string[];
  stationIds?: string[];
  connectorRoutes?: string[];
  active?: boolean;
}

interface AdminRoleInput {
  id?: string;
  name?: string;
  description?: string;
  permissions?: string[];
  stationIds?: string[];
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly productionRuntime = isProductionRuntime();
  private readonly authEnabled = this.readBooleanEnv('ADMIN_AUTH_ENABLED', true);
  private readonly requireStaffToken = this.readBooleanEnv(
    'ADMIN_AUTH_REQUIRE_STAFF_TOKEN',
    true
  );
  private readonly tokenTtlHours = this.readNumberEnv('ADMIN_AUTH_TTL_HOURS', 12);
  private readonly secret =
    String(process.env.ADMIN_AUTH_SECRET ?? '').trim() || 'dev-insecure-admin-auth-secret';
  private readonly usersByLogin = new Map<string, AdminUserRecord>();
  private readonly usersById = new Map<string, AdminUserRecord>();
  private readonly rolesById = new Map<string, AdminRoleDefinition>();

  constructor(private readonly persistence: AuthPersistenceService) {}

  async onModuleInit(): Promise<void> {
    await this.initializeRoles();
    await this.initializeUsers();
  }

  isEnabled(): boolean {
    return this.authEnabled;
  }

  shouldRequireStaffToken(): boolean {
    return this.authEnabled && this.requireStaffToken;
  }

  hasStaffRole(roles: Role[]): boolean {
    return roles.some((role) => STAFF_ROLES.includes(role));
  }

  hasStaffAccess(user?: RequestUser): boolean {
    return Boolean(
      user &&
        (this.hasStaffRole(user.roles) ||
          (Array.isArray(user.roleIds) && user.roleIds.length > 0) ||
          hasAdminPermission(user.permissions, 'dialogs:read'))
    );
  }

  async listAdminUsers(): Promise<AdminUserSummary[]> {
    await this.refreshUsersFromPersistence();
    return Array.from(this.usersByLogin.values())
      .map((user) => this.toAdminUserSummary(user))
      .sort((left, right) => left.login.localeCompare(right.login));
  }

  async listAdminRoles(): Promise<AdminRoleDefinition[]> {
    await this.refreshRolesFromPersistence();
    return Array.from(this.rolesById.values())
      .map((role) => this.cloneRole(role))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }

  async listAudit(filters: {
    actorId?: string;
    targetId?: string;
    limit?: number;
  }): Promise<AdminAuditEntry[]> {
    if (!this.persistence.isEnabled()) {
      return [];
    }
    return this.persistence.listAudit(filters);
  }

  async createAdminUser(input: AdminUserInput, actor: RequestUser): Promise<AdminUserSummary> {
    this.ensurePersistenceForMutation();
    await this.refreshUsersFromPersistence();
    await this.refreshRolesFromPersistence();

    const login = this.normalizeLogin(input.login);
    if (this.usersByLogin.has(login)) {
      throw new ConflictException('Логин уже используется');
    }
    const password = this.normalizeNewPassword(input.password);
    const roleIds = this.normalizeRoleIds(input.roleIds);
    this.assertRoleAssignmentAllowed(roleIds, actor);
    const record: AdminUserRecord = {
      id: `admin-${randomBytes(12).toString('hex')}`,
      login,
      password: this.hashPassword(password),
      title: this.normalizeOptionalText(input.title, 160),
      maxPublicUrl: this.normalizeOptionalText(input.maxPublicUrl, 1000),
      roles: this.legacyRolesForRoleIds(roleIds),
      roleIds,
      stationIds: this.normalizeStringList(input.stationIds),
      connectorRoutes: this.normalizeConnectorRoutes(input.connectorRoutes),
      active: input.active !== false
    };
    await this.persistence.upsertUser(record);
    this.storeUser(record);
    await this.recordAudit('ADMIN_USER_CREATED', actor, 'ADMIN_USER', record.id, record.login, {
      roleIds: record.roleIds.join(','),
      active: record.active
    });
    return this.toAdminUserSummary(record);
  }

  async updateAdminUser(
    id: string,
    input: AdminUserInput,
    actor: RequestUser
  ): Promise<AdminUserSummary> {
    this.ensurePersistenceForMutation();
    await this.refreshUsersFromPersistence();
    await this.refreshRolesFromPersistence();
    const current = this.usersById.get(String(id).trim());
    if (!current) {
      throw new NotFoundException('Администратор не найден');
    }

    const nextLogin = input.login === undefined ? current.login : this.normalizeLogin(input.login);
    const duplicate = this.usersByLogin.get(nextLogin);
    if (duplicate && duplicate.id !== current.id) {
      throw new ConflictException('Логин уже используется');
    }

    const nextRoleIds =
      input.roleIds === undefined ? current.roleIds.slice() : this.normalizeRoleIds(input.roleIds);
    this.assertRoleAssignmentAllowed(nextRoleIds, actor);
    const nextActive = input.active === undefined ? current.active : input.active === true;
    this.assertNotLastSuperAdmin(current, nextRoleIds, nextActive);

    const next: AdminUserRecord = {
      ...current,
      login: nextLogin,
      title:
        input.title === undefined ? current.title : this.normalizeOptionalText(input.title, 160),
      maxPublicUrl:
        input.maxPublicUrl === undefined
          ? current.maxPublicUrl
          : this.normalizeOptionalText(input.maxPublicUrl, 1000),
      roleIds: nextRoleIds,
      roles: this.legacyRolesForRoleIds(nextRoleIds),
      stationIds:
        input.stationIds === undefined
          ? current.stationIds.slice()
          : this.normalizeStringList(input.stationIds),
      connectorRoutes:
        input.connectorRoutes === undefined
          ? current.connectorRoutes.slice()
          : this.normalizeConnectorRoutes(input.connectorRoutes),
      active: nextActive
    };
    if (input.password !== undefined && String(input.password).length > 0) {
      next.password = this.hashPassword(this.normalizeNewPassword(input.password));
    }
    await this.persistence.upsertUser(next);
    this.storeUser(next);
    await this.recordAudit('ADMIN_USER_UPDATED', actor, 'ADMIN_USER', next.id, next.login, {
      roleIds: next.roleIds.join(','),
      active: next.active,
      passwordChanged: input.password !== undefined && String(input.password).length > 0
    });
    return this.toAdminUserSummary(next);
  }

  async deleteAdminUser(id: string, actor: RequestUser): Promise<void> {
    this.ensurePersistenceForMutation();
    await this.refreshUsersFromPersistence();
    const current = this.usersById.get(String(id).trim());
    if (!current) {
      throw new NotFoundException('Администратор не найден');
    }
    if (current.id === actor.id) {
      throw new BadRequestException('Нельзя удалить собственную учётную запись');
    }
    this.assertNotLastSuperAdmin(current, [], false);
    await this.persistence.deleteUser(current.id);
    this.usersByLogin.delete(current.login);
    this.usersById.delete(current.id);
    await this.recordAudit('ADMIN_USER_DELETED', actor, 'ADMIN_USER', current.id, current.login);
  }

  async createAdminRole(input: AdminRoleInput, actor: RequestUser): Promise<AdminRoleDefinition> {
    this.ensurePersistenceForMutation();
    await this.refreshRolesFromPersistence();
    const id = this.normalizeRoleId(input.id, false);
    if (this.rolesById.has(id)) {
      throw new ConflictException('Роль с таким кодом уже существует');
    }
    const permissions = this.normalizePermissions(input.permissions);
    this.assertPermissionsAssignable(permissions, actor);
    const now = new Date().toISOString();
    const role: AdminRoleDefinition = {
      id,
      name: this.requireText(input.name, 'Название роли', 120),
      description: this.normalizeOptionalText(input.description, 500),
      permissions,
      stationIds: this.normalizeStringList(input.stationIds),
      isSystem: false,
      createdAt: now,
      updatedAt: now
    };
    await this.persistence.upsertRole(role);
    this.rolesById.set(role.id, role);
    await this.recordAudit('ROLE_CREATED', actor, 'ROLE', role.id, role.name, {
      permissions: role.permissions.join(',')
    });
    return this.cloneRole(role);
  }

  async updateAdminRole(
    id: string,
    input: AdminRoleInput,
    actor: RequestUser
  ): Promise<AdminRoleDefinition> {
    this.ensurePersistenceForMutation();
    await this.refreshRolesFromPersistence();
    const current = this.rolesById.get(String(id).trim());
    if (!current) {
      throw new NotFoundException('Роль не найдена');
    }
    const permissions =
      input.permissions === undefined
        ? current.permissions.slice()
        : this.normalizePermissions(input.permissions);
    this.assertPermissionsAssignable(permissions, actor);
    if (current.id === Role.SUPER_ADMIN && !permissions.includes('*')) {
      throw new BadRequestException('Роль суперадмина должна сохранять полный доступ');
    }
    const next: AdminRoleDefinition = {
      ...current,
      name: input.name === undefined ? current.name : this.requireText(input.name, 'Название роли', 120),
      description:
        input.description === undefined
          ? current.description
          : this.normalizeOptionalText(input.description, 500),
      permissions,
      stationIds:
        input.stationIds === undefined
          ? current.stationIds.slice()
          : this.normalizeStringList(input.stationIds),
      updatedAt: new Date().toISOString()
    };
    await this.persistence.upsertRole(next);
    this.rolesById.set(next.id, next);
    await this.recordAudit('ROLE_UPDATED', actor, 'ROLE', next.id, next.name, {
      permissions: next.permissions.join(',')
    });
    return this.cloneRole(next);
  }

  async deleteAdminRole(id: string, actor: RequestUser): Promise<void> {
    this.ensurePersistenceForMutation();
    await this.refreshRolesFromPersistence();
    await this.refreshUsersFromPersistence();
    const role = this.rolesById.get(String(id).trim());
    if (!role) {
      throw new NotFoundException('Роль не найдена');
    }
    if (role.isSystem) {
      throw new BadRequestException('Системную роль нельзя удалить');
    }
    const assignedUser = Array.from(this.usersById.values()).find((user) =>
      user.roleIds.includes(role.id)
    );
    if (assignedUser) {
      throw new ConflictException('Сначала снимите роль с пользователей');
    }
    await this.persistence.deleteRole(role.id);
    this.rolesById.delete(role.id);
    await this.recordAudit('ROLE_DELETED', actor, 'ROLE', role.id, role.name);
  }

  async login(login: string, password: string): Promise<AuthLoginResult> {
    if (!this.authEnabled) {
      throw new UnauthorizedException('Auth is disabled');
    }
    await this.refreshUsersFromPersistence();
    const normalizedLogin = String(login).trim().toLowerCase();
    const user = this.usersByLogin.get(normalizedLogin);
    if (!user || !user.active || !this.passwordsEqual(password, user.password)) {
      await this.recordAudit(
        'AUTH_LOGIN_FAILED',
        undefined,
        'AUTH',
        user?.id,
        normalizedLogin || undefined,
        { reason: !user ? 'unknown_login' : user.active ? 'invalid_password' : 'inactive' }
      );
      throw new UnauthorizedException('Invalid login or password');
    }
    const requestUser = this.toRequestUser(user, 'token');
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + this.tokenTtlHours * 60 * 60;
    const accessToken = this.signToken({
      sub: user.id,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
      typ: 'admin'
    });
    await this.recordAudit('AUTH_LOGIN_SUCCEEDED', requestUser, 'AUTH', user.id, user.login);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      user: requestUser
    };
  }

  async resolveUserFromRequest(
    request: Request,
    options: { allowHeaderFallback?: boolean } = {}
  ): Promise<AuthResolvedUser> {
    const authorizationCredential = this.extractAuthorizationCredential(request);
    const cookieCredential = this.extractCookieCredential(request);
    if (
      (authorizationCredential.present && !authorizationCredential.token) ||
      (cookieCredential.present && !cookieCredential.token)
    ) {
      return { source: 'anonymous' };
    }
    const authorizationToken = authorizationCredential.token;
    const cookieToken = cookieCredential.token;
    if (authorizationToken && cookieToken) {
      const authorizationPayload = this.verifyToken(authorizationToken);
      const cookiePayload = this.verifyToken(cookieToken);
      if (
        authorizationPayload &&
        cookiePayload &&
        authorizationPayload.sub !== cookiePayload.sub
      ) {
        throw new UnauthorizedException('Conflicting authentication credentials');
      }
    }

    const token = authorizationToken || cookieToken;
    if (token) {
      const payload = this.verifyToken(token);
      if (payload) {
        const persisted = await this.findActiveUserById(payload.sub);
        if (persisted) {
          return { user: this.toRequestUser(persisted, 'token'), source: 'token' };
        }
      }
      return { source: 'anonymous' };
    }

    if (options.allowHeaderFallback === false) {
      return { source: 'anonymous' };
    }

    const headerUser = resolveRequestUser(request.headers);
    if (headerUser.id !== 'anonymous' || headerUser.roles.length > 0) {
      return {
        user: this.withLegacyPermissions(headerUser, 'headers'),
        source: 'headers'
      };
    }
    return {
      user: this.withLegacyPermissions(headerUser, 'anonymous'),
      source: 'anonymous'
    };
  }

  buildAuthCookie(accessToken: string, secure: boolean): string {
    const maxAgeSeconds = this.tokenTtlHours * 60 * 60;
    return [
      `phab_admin_token=${encodeURIComponent(accessToken)}`,
      `Max-Age=${maxAgeSeconds}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      secure ? 'Secure' : ''
    ]
      .filter(Boolean)
      .join('; ');
  }

  buildClearAuthCookie(secure: boolean): string {
    return [
      'phab_admin_token=',
      'Max-Age=0',
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      secure ? 'Secure' : ''
    ]
      .filter(Boolean)
      .join('; ');
  }

  private async initializeRoles(): Promise<void> {
    const defaults = this.defaultRoles();
    if (this.persistence.isEnabled()) {
      if (!this.productionRuntime) {
        await this.persistence.seedRoles(defaults);
      }
      const persisted = await this.persistence.loadRoles();
      this.setRoles(persisted.length > 0 ? persisted : defaults);
      return;
    }
    this.setRoles(defaults);
  }

  private async initializeUsers(): Promise<void> {
    if (!this.authEnabled) {
      this.clearUsers();
      return;
    }
    const envUsers = this.parseUsers();
    if (this.persistence.isEnabled()) {
      const persistedUsers = await this.persistence.loadUsers();
      if (persistedUsers.length > 0) {
        this.setUsers(persistedUsers);
        this.logger.log(`Loaded admin users from MongoDB: ${persistedUsers.length}`);
        return;
      }
      if (envUsers.length > 0) {
        if (!this.productionRuntime) {
          await this.persistence.seedUsers(envUsers);
          this.logger.warn(`Seeded admin users to MongoDB: ${envUsers.length}`);
        } else {
          this.logger.log(
            `Loaded admin users from ADMIN_AUTH_USERS_JSON without production bootstrap writes: ${envUsers.length}`
          );
        }
        this.setUsers(envUsers);
        return;
      }
    }
    if (envUsers.length > 0) {
      this.setUsers(envUsers);
      return;
    }
    if (this.productionRuntime) {
      throw new Error('ADMIN_AUTH_ENABLED=true but no admin users found in MongoDB or ADMIN_AUTH_USERS_JSON');
    }
    const fallbackUser = this.buildFallbackUser();
    if (this.persistence.isEnabled() && !this.productionRuntime) {
      await this.persistence.seedUsers([fallbackUser]);
    }
    this.setUsers([fallbackUser]);
    this.logger.warn('Using default admin credentials. Configure MongoDB admin_users or ADMIN_AUTH_USERS_JSON.');
  }

  private async refreshUsersFromPersistence(): Promise<void> {
    if (!this.persistence.isEnabled()) {
      return;
    }
    const persistedUsers = await this.persistence.loadUsers();
    if (persistedUsers.length > 0) {
      this.setUsers(persistedUsers);
    } else if (this.usersByLogin.size > 0 && !this.productionRuntime) {
      await this.persistence.seedUsers(Array.from(this.usersByLogin.values()));
    }
  }

  private async refreshRolesFromPersistence(): Promise<void> {
    if (!this.persistence.isEnabled()) {
      return;
    }
    const roles = await this.persistence.loadRoles();
    if (roles.length > 0) {
      this.setRoles(roles);
    }
  }

  private async findActiveUserById(id: string): Promise<AdminUserRecord | null> {
    const normalizedId = String(id).trim();
    if (!normalizedId) {
      return null;
    }
    if (this.persistence.isEnabled()) {
      const persisted = await this.persistence.findUserById(normalizedId);
      if (persisted) {
        const normalized = this.normalizeUserRecord(persisted);
        this.storeUser(normalized);
        return normalized.active ? normalized : null;
      }
    }
    const inMemory = this.usersById.get(normalizedId);
    return inMemory?.active ? inMemory : null;
  }

  private defaultRoles(): AdminRoleDefinition[] {
    const now = new Date(0).toISOString();
    return Object.values(Role).map((role) => ({
      id: role,
      name: this.defaultRoleName(role),
      permissions: DEFAULT_ROLE_PERMISSIONS[role].slice(),
      stationIds: [],
      isSystem: true,
      createdAt: now,
      updatedAt: now
    }));
  }

  private defaultRoleName(role: Role): string {
    const names: Record<Role, string> = {
      [Role.SUPER_ADMIN]: 'Суперадмин',
      [Role.TOURNAMENT_MANAGER]: 'Менеджер турниров',
      [Role.GAME_MANAGER]: 'Менеджер игр',
      [Role.STATION_ADMIN]: 'Админ станции',
      [Role.MANAGER]: 'Управляющий',
      [Role.SUPPORT]: 'Поддержка',
      [Role.CLIENT]: 'Клиент'
    };
    return names[role];
  }

  private buildFallbackUser(): AdminUserRecord {
    return {
      id: 'superadmin-local',
      login: 'admin',
      password: this.hashPassword('admin12345'),
      title: 'Суперадмин',
      roles: [Role.SUPER_ADMIN],
      roleIds: [Role.SUPER_ADMIN],
      stationIds: [],
      connectorRoutes: [],
      active: true
    };
  }

  private setRoles(roles: AdminRoleDefinition[]): void {
    this.rolesById.clear();
    for (const role of roles) {
      const normalized = this.normalizeRoleDefinition(role);
      this.rolesById.set(normalized.id, normalized);
    }
    for (const role of this.defaultRoles()) {
      if (!this.rolesById.has(role.id)) {
        this.rolesById.set(role.id, role);
      }
    }
  }

  private setUsers(users: AdminUserRecord[]): void {
    this.clearUsers();
    for (const user of users) {
      this.storeUser(this.normalizeUserRecord(user));
    }
  }

  private clearUsers(): void {
    this.usersByLogin.clear();
    this.usersById.clear();
  }

  private storeUser(user: AdminUserRecord): void {
    const normalized = this.normalizeUserRecord(user);
    const existing = this.usersById.get(normalized.id);
    if (existing && existing.login !== normalized.login) {
      this.usersByLogin.delete(existing.login);
    }
    this.usersByLogin.set(normalized.login, normalized);
    this.usersById.set(normalized.id, normalized);
  }

  private parseUsers(): AdminUserRecord[] {
    const raw = String(process.env.ADMIN_AUTH_USERS_JSON ?? '').trim();
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as AdminUserConfig[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((entry, index) => {
          const login = String(entry?.login ?? '').trim().toLowerCase();
          const password = String(entry?.password ?? '');
          const roleIds = this.normalizeRoleIds(entry?.roleIds ?? entry?.roles ?? []);
          if (!login || !password || roleIds.length === 0) {
            return null;
          }
          return this.normalizeUserRecord({
            id: String(entry?.id ?? `admin-${index + 1}`).trim() || `admin-${index + 1}`,
            login,
            password,
            title: this.normalizeOptionalText(entry?.title, 160),
            maxPublicUrl: this.normalizeOptionalText(entry?.maxPublicUrl, 1000),
            roles: this.legacyRolesForRoleIds(roleIds),
            roleIds,
            stationIds: this.normalizeStringList(entry?.stationIds),
            connectorRoutes: this.normalizeConnectorRoutes(entry?.connectorRoutes),
            active: entry?.active !== false
          });
        })
        .filter((entry): entry is AdminUserRecord => entry !== null);
    } catch (error) {
      this.logger.error(`Invalid ADMIN_AUTH_USERS_JSON: ${String(error)}`);
      return [];
    }
  }

  private toRequestUser(
    user: AdminUserRecord,
    authSource: 'token' | 'headers' | 'anonymous'
  ): RequestUser {
    const roleIds = user.roleIds.filter((roleId) => this.rolesById.has(roleId));
    const matchedRoles = roleIds
      .map((roleId) => this.rolesById.get(roleId))
      .filter((role): role is AdminRoleDefinition => Boolean(role));
    const permissions = Array.from(
      new Set(matchedRoles.flatMap((role) => role.permissions.map((permission) => String(permission))))
    );
    const accountScope = this.normalizeStringList(user.stationIds);
    const roleScope = Array.from(
      new Set(matchedRoles.flatMap((role) => this.normalizeStringList(role.stationIds)))
    );
    const stationIds =
      accountScope.length > 0 && roleScope.length > 0
        ? accountScope.filter((stationId) => roleScope.includes(stationId))
        : accountScope.length > 0
          ? accountScope
          : roleScope;
    return {
      id: user.id,
      login: user.login,
      title: user.title,
      maxPublicUrl: user.maxPublicUrl,
      roles: this.legacyRolesForRoleIds(roleIds),
      roleIds,
      permissions,
      permissionStationScopes: this.resolvePermissionStationScopes(
        matchedRoles,
        accountScope
      ),
      stationIds,
      connectorRoutes: user.connectorRoutes.slice(),
      authSource
    };
  }

  private withLegacyPermissions(
    user: RequestUser,
    authSource: 'headers' | 'anonymous'
  ): RequestUser {
    const permissions = Array.from(
      new Set(user.roles.flatMap((role) => DEFAULT_ROLE_PERMISSIONS[role] ?? []))
    );
    return {
      ...user,
      roleIds: user.roles.slice(),
      permissions,
      authSource
    };
  }

  private resolvePermissionStationScopes(
    roles: AdminRoleDefinition[],
    accountScope: string[]
  ): Record<string, string[] | null> {
    const scopes: Record<string, string[] | null> = {};
    for (const { key: permission } of ADMIN_PERMISSION_CATALOG) {
      const grantingRoles = roles.filter((role) =>
        hasAdminPermission(role.permissions, permission)
      );
      if (grantingRoles.length === 0) {
        continue;
      }
      const allStations = grantingRoles.some(
        (role) => this.normalizeStringList(role.stationIds).length === 0
      );
      const roleStations = Array.from(
        new Set(
          grantingRoles.flatMap((role) => this.normalizeStringList(role.stationIds))
        )
      );
      if (accountScope.length === 0) {
        scopes[permission] = allStations ? null : roleStations;
        continue;
      }
      scopes[permission] = allStations
        ? accountScope.slice()
        : accountScope.filter((stationId) => roleStations.includes(stationId));
    }
    return scopes;
  }

  private toAdminUserSummary(user: AdminUserRecord): AdminUserSummary {
    return {
      id: user.id,
      login: user.login,
      title: user.title,
      maxPublicUrl: user.maxPublicUrl,
      roles: user.roles.slice(),
      roleIds: user.roleIds.slice(),
      stationIds: user.stationIds.slice(),
      connectorRoutes: user.connectorRoutes.slice(),
      active: user.active
    };
  }

  private normalizeUserRecord(user: AdminUserRecord): AdminUserRecord {
    const legacyRoles = this.legacyRolesForRoleIds(user.roles ?? []);
    const roleIds = this.normalizeRoleIds([
      ...(Array.isArray(user.roleIds) ? user.roleIds : []),
      ...legacyRoles
    ]);
    return {
      id: String(user.id ?? '').trim(),
      login: String(user.login ?? '').trim().toLowerCase(),
      password: String(user.password ?? ''),
      title: this.normalizeOptionalText(user.title, 160),
      maxPublicUrl: this.normalizeOptionalText(user.maxPublicUrl, 1000),
      roles: this.legacyRolesForRoleIds(roleIds),
      roleIds,
      stationIds: this.normalizeStringList(user.stationIds),
      connectorRoutes: this.normalizeConnectorRoutes(user.connectorRoutes),
      active: user.active !== false
    };
  }

  private normalizeRoleDefinition(role: AdminRoleDefinition): AdminRoleDefinition {
    const id = this.normalizeRoleId(role.id, true);
    const systemRole = (Object.values(Role) as string[]).includes(id);
    const fallbackName = systemRole ? this.defaultRoleName(id as Role) : id;
    return {
      id,
      name: this.normalizeOptionalText(role.name, 120) || fallbackName,
      description: this.normalizeOptionalText(role.description, 500),
      permissions: this.normalizePermissions(role.permissions, systemRole ? DEFAULT_ROLE_PERMISSIONS[id as Role] : []),
      stationIds: this.normalizeStringList(role.stationIds),
      isSystem: role.isSystem === true || systemRole,
      createdAt: this.normalizeOptionalText(role.createdAt, 80) || new Date(0).toISOString(),
      updatedAt: this.normalizeOptionalText(role.updatedAt, 80) || new Date(0).toISOString()
    };
  }

  private cloneRole(role: AdminRoleDefinition): AdminRoleDefinition {
    return {
      ...role,
      permissions: role.permissions.slice(),
      stationIds: role.stationIds.slice()
    };
  }

  private normalizeRoleIds(rawRoleIds: unknown): string[] {
    if (!Array.isArray(rawRoleIds)) {
      throw new BadRequestException('Укажите хотя бы одну роль');
    }
    const ids = rawRoleIds
      .map((roleId) => this.normalizeRoleId(roleId, true))
      .filter((roleId) => roleId.length > 0);
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) {
      throw new BadRequestException('Укажите хотя бы одну роль');
    }
    return unique;
  }

  private normalizeRoleId(value: unknown, allowSystem: boolean): string {
    const raw = String(value ?? '').trim();
    const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
    if (allowSystem && (Object.values(Role) as string[]).includes(upper)) {
      return upper;
    }
    const normalized = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!normalized || normalized.length > 64) {
      throw new BadRequestException('Код роли: 1–64 символа, латиница, цифры, _ или -');
    }
    return normalized;
  }

  private normalizePermissions(rawPermissions: unknown, fallback: string[] = []): string[] {
    if (rawPermissions === undefined) {
      return fallback.slice();
    }
    if (!Array.isArray(rawPermissions)) {
      throw new BadRequestException('Права роли должны быть массивом');
    }
    const permissions = Array.from(
      new Set(rawPermissions.map((permission) => String(permission).trim()).filter(Boolean))
    );
    const invalid = permissions.filter(
      (permission) => permission !== '*' && !ADMIN_PERMISSION_KEYS.includes(permission as never)
    );
    if (invalid.length > 0) {
      throw new BadRequestException(`Неизвестные права: ${invalid.join(', ')}`);
    }
    return permissions;
  }

  private legacyRolesForRoleIds(roleIds: unknown): Role[] {
    if (!Array.isArray(roleIds)) {
      return [];
    }
    return Array.from(
      new Set(
        roleIds
          .map((roleId) => String(roleId).trim().toUpperCase())
          .filter((roleId): roleId is Role => (Object.values(Role) as string[]).includes(roleId))
      )
    );
  }

  private normalizeLogin(value: unknown): string {
    const login = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,120}$/.test(login)) {
      throw new BadRequestException('Логин: 2–120 символов, латиница, цифры, точка, _ или -');
    }
    return login;
  }

  private normalizeNewPassword(value: unknown): string {
    const password = String(value ?? '');
    if (password.length < 10 || password.length > 200) {
      throw new BadRequestException('Пароль должен содержать от 10 до 200 символов');
    }
    return password;
  }

  private requireText(value: unknown, label: string, maxLength: number): string {
    const text = this.normalizeOptionalText(value, maxLength);
    if (!text) {
      throw new BadRequestException(`${label} обязательно`);
    }
    return text;
  }

  private normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
    const text = String(value ?? '').trim();
    if (!text) {
      return undefined;
    }
    if (text.length > maxLength) {
      throw new BadRequestException(`Максимальная длина — ${maxLength} символов`);
    }
    return text;
  }

  private normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(
      new Set(
        value
          .map((item) => String(item ?? '').trim())
          .filter((item) => item.length > 0)
      )
    );
  }

  private normalizeConnectorRoutes(value: unknown): string[] {
    return this.normalizeStringList(value).map((route) =>
      route.toUpperCase().replace(/[\s-]+/g, '_')
    );
  }

  private assertRoleAssignmentAllowed(roleIds: string[], actor: RequestUser): void {
    const unknown = roleIds.filter((roleId) => !this.rolesById.has(roleId));
    if (unknown.length > 0) {
      throw new BadRequestException(`Роли не найдены: ${unknown.join(', ')}`);
    }
    const permissions = Array.from(
      new Set(
        roleIds.flatMap((roleId) => this.rolesById.get(roleId)?.permissions ?? [])
      )
    );
    this.assertPermissionsAssignable(permissions, actor);
  }

  private assertPermissionsAssignable(permissions: string[], actor: RequestUser): void {
    if (hasAdminPermission(actor.permissions, '*')) {
      return;
    }
    const unavailable = permissions.filter(
      (permission) => !hasAdminPermission(actor.permissions, permission)
    );
    if (unavailable.length > 0) {
      throw new ForbiddenException('Нельзя выдать права, которых нет у вас');
    }
  }

  private assertNotLastSuperAdmin(
    current: AdminUserRecord,
    nextRoleIds: string[],
    nextActive: boolean
  ): void {
    const currentIsSuper = current.active && current.roleIds.includes(Role.SUPER_ADMIN);
    const remainsSuper = nextActive && nextRoleIds.includes(Role.SUPER_ADMIN);
    if (!currentIsSuper || remainsSuper) {
      return;
    }
    const otherActiveSupers = Array.from(this.usersById.values()).filter(
      (user) => user.id !== current.id && user.active && user.roleIds.includes(Role.SUPER_ADMIN)
    );
    if (otherActiveSupers.length === 0) {
      throw new BadRequestException('В системе должен остаться хотя бы один активный суперадмин');
    }
  }

  private ensurePersistenceForMutation(): void {
    if (!this.persistence.isEnabled()) {
      throw new ServiceUnavailableException(
        'Для изменения ролей и сотрудников требуется подключение к MongoDB'
      );
    }
  }

  private async recordAudit(
    action: string,
    actor: RequestUser | undefined,
    targetType: AdminAuditEntry['targetType'],
    targetId?: string,
    targetLabel?: string,
    metadata?: AdminAuditEntry['metadata']
  ): Promise<void> {
    try {
      await this.persistence.appendAudit({
        id: `audit-${randomBytes(12).toString('hex')}`,
        at: new Date().toISOString(),
        action,
        actor: actor
          ? { id: actor.id, login: actor.login, title: actor.title }
          : undefined,
        targetType,
        targetId,
        targetLabel,
        metadata
      });
    } catch (error) {
      this.logger.error(`Unable to write admin audit event: ${String(error)}`);
    }
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('base64url');
    const digest = scryptSync(password, salt, 64).toString('base64url');
    return `scrypt$${salt}$${digest}`;
  }

  private passwordsEqual(candidate: string, stored: string): boolean {
    if (stored.startsWith('scrypt$')) {
      const [, salt, digest] = stored.split('$');
      if (!salt || !digest) {
        return false;
      }
      const candidateDigest = scryptSync(candidate, salt, 64).toString('base64url');
      return this.safeStringEquals(candidateDigest, digest);
    }
    // Existing deployments may still contain the old bootstrap plaintext. It is
    // accepted only for login and replaced with a hash on the next password update.
    return this.safeStringEquals(candidate, stored);
  }

  private signToken(payload: TokenPayload): string {
    const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString(
      'base64url'
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signedPart = `${encodedHeader}.${encodedPayload}`;
    return `${signedPart}.${this.signRaw(signedPart)}`;
  }

  private verifyToken(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signedPart = `${encodedHeader}.${encodedPayload}`;
    if (!this.safeStringEquals(encodedSignature, this.signRaw(signedPart))) {
      return null;
    }
    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as TokenPayload;
      if (
        !payload ||
        payload.typ !== 'admin' ||
        !String(payload.sub ?? '').trim() ||
        typeof payload.exp !== 'number' ||
        payload.exp < Math.floor(Date.now() / 1000)
      ) {
        return null;
      }
      return payload;
    } catch (_error) {
      return null;
    }
  }

  private signRaw(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private extractAuthorizationCredential(request: Request): {
    present: boolean;
    token: string | null;
  } {
    const authorization = request.headers.authorization;
    if (authorization === undefined) {
      return { present: false, token: null };
    }
    const match = String(authorization).match(/^Bearer\s+(.+)$/i);
    const token = String(match?.[1] ?? '').trim();
    return { present: true, token: token || null };
  }

  private extractCookieCredential(request: Request): {
    present: boolean;
    token: string | null;
  } {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return { present: false, token: null };
    }
    for (const entry of cookieHeader.split(';')) {
      const [name, ...rest] = entry.split('=');
      if (name.trim() !== 'phab_admin_token') {
        continue;
      }
      const rawValue = rest.join('=').trim();
      if (!rawValue) {
        return { present: true, token: null };
      }
      try {
        const decoded = decodeURIComponent(rawValue).trim();
        return { present: true, token: decoded || null };
      } catch (_error) {
        return { present: true, token: rawValue || null };
      }
    }
    return { present: false, token: null };
  }

  private readBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = String(process.env[name] ?? '').trim().toLowerCase();
    return raw ? ['1', 'true', 'yes', 'on'].includes(raw) : fallback;
  }

  private readNumberEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  private safeStringEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
