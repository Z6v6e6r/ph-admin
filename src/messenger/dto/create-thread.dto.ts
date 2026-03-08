import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from 'class-validator';
import { AiAssistMode, ConnectorRoute } from '../messenger.types';

export class CreateThreadDto {
  @IsEnum(ConnectorRoute)
  connector!: ConnectorRoute;

  @IsString()
  @MinLength(1)
  stationId!: string;

  @IsOptional()
  @IsString()
  stationName?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  assignedSupportId?: string;

  @IsOptional()
  @IsEnum(AiAssistMode)
  aiMode?: AiAssistMode;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  subject?: string;
}
