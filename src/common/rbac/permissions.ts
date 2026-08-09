import { Role } from './role.enum';
import { RequestUser } from './request-user.interface';

export const ADMIN_PERMISSION_CATALOG = [
  { key: 'dialogs:read', label: 'Диалоги: чтение' },
  { key: 'dialogs:write', label: 'Диалоги: ответы и изменение статуса' },
  { key: 'games:read', label: 'Игры: чтение' },
  { key: 'games:write', label: 'Игры: изменения и публикация' },
  { key: 'tournaments:read', label: 'Турниры: чтение' },
  { key: 'tournaments:write', label: 'Турниры: создание и изменения' },
  { key: 'settings:read', label: 'Настройки: просмотр' },
  { key: 'settings:write', label: 'Настройки: изменение' },
  { key: 'admin-users:read', label: 'Админы и управляющие: просмотр' },
  { key: 'admin-users:write', label: 'Админы и управляющие: изменение' },
  { key: 'access:manage', label: 'Роли и права доступа: изменение' },
  { key: 'audit:read', label: 'Журнал действий: просмотр' },
  { key: 'player-ratings:read', label: 'Уровни игроков: просмотр' },
  { key: 'player-ratings:write', label: 'Уровни игроков: изменение' },
  { key: 'advertising:read', label: 'Реклама: просмотр' },
  { key: 'advertising:write', label: 'Реклама: изменение' }
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSION_CATALOG)[number]['key'];

export const ADMIN_PERMISSION_KEYS = ADMIN_PERMISSION_CATALOG.map((item) => item.key);

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, string[]> = {
  [Role.SUPER_ADMIN]: ['*'],
  [Role.TOURNAMENT_MANAGER]: ['tournaments:read', 'tournaments:write', 'games:read', 'dialogs:read'],
  [Role.GAME_MANAGER]: ['games:read', 'games:write', 'tournaments:read', 'dialogs:read'],
  [Role.STATION_ADMIN]: [
    'dialogs:read',
    'dialogs:write',
    'games:read',
    'tournaments:read'
  ],
  [Role.MANAGER]: [
    'dialogs:read',
    'dialogs:write',
    'games:read',
    'games:write',
    'tournaments:read',
    'tournaments:write',
    'settings:read',
    'settings:write',
    'admin-users:read',
    'audit:read',
    'player-ratings:read',
    'advertising:read',
    'advertising:write'
  ],
  [Role.SUPPORT]: ['dialogs:read', 'dialogs:write', 'games:read', 'tournaments:read'],
  [Role.CLIENT]: []
};

export const hasAdminPermission = (
  permissions: readonly string[] | undefined,
  permission: string
): boolean => Boolean(permissions?.includes('*') || permissions?.includes(permission));

/**
 * Resolves a station cap for one permission. Legacy/header users do not carry
 * per-permission scopes, so their existing stationIds remain the fallback.
 */
export const getStationScopeForPermission = (
  user: RequestUser | undefined,
  permission: string
): string[] | null => {
  if (!user) {
    return null;
  }
  const scoped = user.permissionStationScopes?.[permission];
  if (scoped !== undefined) {
    return scoped;
  }
  return user.stationIds.length > 0 ? user.stationIds : null;
};
