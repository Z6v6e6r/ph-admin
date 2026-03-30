import { Request } from 'express';
import { Role } from './role.enum';

export interface RequestUser {
  id: string;
  login?: string;
  title?: string;
  maxPublicUrl?: string;
  roles: Role[];
  stationIds: string[];
  connectorRoutes: string[];
  authSource?: 'token' | 'headers' | 'anonymous';
}

export type RequestWithUser = Request & {
  user?: RequestUser;
  authSource?: 'token' | 'headers' | 'anonymous';
};
