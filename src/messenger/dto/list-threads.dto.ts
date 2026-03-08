import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ConnectorRoute } from '../messenger.types';

export class ListThreadsDto {
  @IsOptional()
  @IsEnum(ConnectorRoute)
  connector?: ConnectorRoute;

  @IsOptional()
  @IsString()
  @MinLength(1)
  stationId?: string;
}
