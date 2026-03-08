import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString
} from 'class-validator';
import { Role } from '../../common/rbac/role.enum';
import { ConnectorRoute } from '../messenger.types';

export class UpdateAccessRuleDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  stationIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ConnectorRoute, { each: true })
  connectorRoutes?: ConnectorRoute[];

  @IsOptional()
  @IsBoolean()
  canRead?: boolean;

  @IsOptional()
  @IsBoolean()
  canWrite?: boolean;
}
