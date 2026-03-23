import { Role } from './role.enum';

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  [Role.SUPER_ADMIN]: ['*'],
  [Role.TOURNAMENT_MANAGER]: [
    'tournaments:read',
    'games:read',
    'messenger:read',
    'messenger:stations:read',
    'messenger:settings:read',
    'messenger:response-metrics:read',
    'messenger:ai:read'
  ],
  [Role.GAME_MANAGER]: [
    'games:read',
    'tournaments:read',
    'messenger:read',
    'messenger:stations:read',
    'messenger:settings:read',
    'messenger:response-metrics:read',
    'messenger:ai:read'
  ],
  [Role.STATION_ADMIN]: [
    'games:read',
    'tournaments:read',
    'messenger:read',
    'messenger:write',
    'messenger:stations:read',
    'messenger:response-metrics:read',
    'messenger:ai:read',
    'messenger:ai:write',
    'clients:manage'
  ],
  [Role.MANAGER]: [
    'games:read',
    'tournaments:read',
    'messenger:read',
    'messenger:write',
    'messenger:stations:read',
    'messenger:settings:read',
    'messenger:settings:write',
    'messenger:response-metrics:read',
    'messenger:ai:read',
    'messenger:ai:write',
    'reports:read'
  ],
  [Role.SUPPORT]: [
    'messenger:read',
    'messenger:write',
    'messenger:stations:read',
    'messenger:settings:read',
    'messenger:response-metrics:read',
    'messenger:ai:read',
    'messenger:ai:write',
    'clients:read'
  ],
  [Role.CLIENT]: ['messenger:read:own', 'messenger:write:own']
};
