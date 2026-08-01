import { Role } from '../common/rbac/role.enum';
import { RequestUser } from '../common/rbac/request-user.interface';

export type AuthSource = 'token' | 'headers' | 'anonymous';

export interface AuthResolvedUser {
  user?: RequestUser;
  source: AuthSource;
}

export interface AuthLoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: RequestUser;
}

export interface AdminUserConfig {
  id?: string;
  login: string;
  password: string;
  title?: string;
  maxPublicUrl?: string;
  /** Legacy built-in role identifiers, retained for environment bootstrap. */
  roles?: Role[];
  /** Persisted role identifiers. Custom roles are supported alongside built-in roles. */
  roleIds?: string[];
  stationIds: string[];
  connectorRoutes?: string[];
  active?: boolean;
}

export interface AdminUserRecord {
  id: string;
  login: string;
  password: string;
  title?: string;
  maxPublicUrl?: string;
  roles: Role[];
  roleIds: string[];
  stationIds: string[];
  connectorRoutes: string[];
  active: boolean;
}

export interface AdminUserSummary {
  id: string;
  login: string;
  title?: string;
  maxPublicUrl?: string;
  roles: Role[];
  roleIds: string[];
  stationIds: string[];
  connectorRoutes: string[];
  active: boolean;
}

export interface AdminRoleDefinition {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  stationIds: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuditActor {
  id: string;
  login?: string;
  title?: string;
}

export interface AdminAuditEntry {
  id: string;
  at: string;
  action: string;
  actor?: AdminAuditActor;
  targetType: 'ADMIN_USER' | 'ROLE' | 'AUTH' | 'RESOURCE';
  targetId?: string;
  targetLabel?: string;
  metadata?: Record<string, string | number | boolean | null>;
}
