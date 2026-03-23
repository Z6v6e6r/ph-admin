import { IncomingHttpHeaders } from 'http';
import { Role } from './role.enum';
import { RequestUser } from './request-user.interface';

const ROLE_ALIASES: Record<string, Role> = {
  SUPERADMIN: Role.SUPER_ADMIN,
  TOURNAMENTMANAGER: Role.TOURNAMENT_MANAGER,
  GAMEMANAGER: Role.GAME_MANAGER,
  STATIONADMIN: Role.STATION_ADMIN,
  ADMINSTATION: Role.STATION_ADMIN,
  OPERATIONSMANAGER: Role.MANAGER,
  MANAGER: Role.MANAGER,
  SUPPORT: Role.SUPPORT,
  CLIENT: Role.CLIENT
};

const normalizeRole = (rawRole: string): Role | undefined => {
  const normalized = rawRole.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((Object.values(Role) as string[]).includes(normalized)) {
    return normalized as Role;
  }

  const aliasKey = normalized.replace(/_/g, '');
  return ROLE_ALIASES[aliasKey];
};

const parseRolesHeader = (value?: string | string[]): Role[] => {
  if (!value) {
    return [];
  }

  const raw = Array.isArray(value) ? value.join(',') : value;
  const parsedRoles = raw
    .split(',')
    .map((entry) => normalizeRole(entry))
    .filter((entry): entry is Role => entry !== undefined);

  return Array.from(new Set(parsedRoles));
};

const parseStationIdsHeader = (value?: string | string[]): string[] => {
  if (!value) {
    return [];
  }

  const raw = Array.isArray(value) ? value.join(',') : value;
  const stationIds = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(stationIds));
};

export const resolveRequestUser = (headers: IncomingHttpHeaders): RequestUser => {
  const id = String(headers['x-user-id'] ?? 'anonymous');
  const login = String(headers['x-user-login'] ?? '').trim() || undefined;
  const fromRoles = parseRolesHeader(headers['x-user-roles']);
  const fromRole = parseRolesHeader(headers['x-user-role']);
  const roles = Array.from(new Set([...fromRoles, ...fromRole]));
  const fromStationIds = parseStationIdsHeader(headers['x-station-ids']);
  const fromStationId = parseStationIdsHeader(headers['x-station-id']);
  const stationIds = Array.from(new Set([...fromStationIds, ...fromStationId]));

  if (roles.length === 0 && id !== 'anonymous') {
    return { id, login, roles: [Role.CLIENT], stationIds };
  }

  return { id, login, roles, stationIds };
};
