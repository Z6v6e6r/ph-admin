import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SupportConnectorRoute } from '../support.types';

export class ReplySupportDialogDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsEnum(SupportConnectorRoute)
  connector?: SupportConnectorRoute;
}
