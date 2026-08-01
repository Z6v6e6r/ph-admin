import { Role } from './role.enum';
import { DEFAULT_ROLE_PERMISSIONS } from './permissions';

/**
 * Legacy export kept for integrations that still request /auth/permissions.
 * Runtime access is resolved from persisted role definitions by AuthService.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = DEFAULT_ROLE_PERMISSIONS;
