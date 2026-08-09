import { Request } from 'express';
import { Role } from './role.enum';

export interface RequestUser {
  id: string;
  login?: string;
  title?: string;
  maxPublicUrl?: string;
  roles: Role[];
  roleIds?: string[];
  permissions?: string[];
  /**
   * Effective station scope for each permission. `null` means all stations;
   * an empty array means the permission is granted but no assigned station
   * matches. This preserves role-to-permission scope when a user has several
   * roles with different station lists.
   */
  permissionStationScopes?: Record<string, string[] | null>;
  stationIds: string[];
  connectorRoutes: string[];
  authSource?: 'token' | 'headers' | 'anonymous';
}

export type RequestWithUser = Request & {
  user?: RequestUser;
  authSource?: 'token' | 'headers' | 'anonymous';
};
