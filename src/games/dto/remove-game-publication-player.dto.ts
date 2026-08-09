import { IsOptional, IsString } from 'class-validator';

export class RemoveGamePublicationPlayerDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
