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
  roles: Role[];
  stationIds: string[];
}

export interface AdminUserSummary {
  id: string;
  login: string;
  roles: Role[];
  stationIds: string[];
}
