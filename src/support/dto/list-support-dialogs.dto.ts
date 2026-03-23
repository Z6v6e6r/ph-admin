import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { SupportConnectorRoute } from '../support.types';

export class ListSupportDialogsDto {
  @IsOptional()
  @IsEnum(SupportConnectorRoute)
  connector?: SupportConnectorRoute;

  @IsOptional()
  @IsString()
  @MinLength(1)
  stationId?: string;
}
