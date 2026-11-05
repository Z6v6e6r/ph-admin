import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getStationScopeForPermission } from '../common/rbac/permissions';
import { RequestUser } from '../common/rbac/request-user.interface';
import { RESIDENT_SERVICES_ID_PATTERN } from './resident-services.config';
import { RESIDENT_SERVICES_ERROR_CODES } from './resident-services.types';

export function requireResidentStaff(
  user: RequestUser | undefined,
  permission: string
): string {
  if (!user || user.id === 'anonymous') {
    throw new ForbiddenException({
      code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
      message: 'Staff authorization is required'
    });
  }
  if (!(user.permissions?.includes('*') || user.permissions?.includes(permission))) {
    throw new ForbiddenException({
      code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
      message: 'Resident services permission is required'
    });
  }
  return user.id;
}

export function residentStationScope(
  user: RequestUser | undefined,
  permission: string
): string[] | null {
  return getStationScopeForPermission(user, permission);
}

export function requireResidentStation(
  user: RequestUser | undefined,
  permission: string,
  stationId: string | undefined
): string {
  const normalized = String(stationId ?? '').trim();
  if (!normalized || !RESIDENT_SERVICES_ID_PATTERN.test(normalized)) {
    throw new BadRequestException({
      code: RESIDENT_SERVICES_ERROR_CODES.STATION_REQUIRED,
      message: 'A valid station id is required for resident service operations'
    });
  }
  const scope = residentStationScope(user, permission);
  if (scope !== null && (scope.length === 0 || !scope.includes(normalized))) {
    throw new ForbiddenException({
      code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
      message: 'Station is outside the allowed scope'
    });
  }
  return normalized;
}

export function assertResidentStationInScope(
  user: RequestUser | undefined,
  permission: string,
  stationId: string
): void {
  const scope = residentStationScope(user, permission);
  if (scope !== null && (scope.length === 0 || !scope.includes(stationId))) {
    throw new ForbiddenException({
      code: RESIDENT_SERVICES_ERROR_CODES.STATION_FORBIDDEN,
      message: 'Station is outside the allowed scope'
    });
  }
}
