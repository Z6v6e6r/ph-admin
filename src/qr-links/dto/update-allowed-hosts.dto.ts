import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min
} from 'class-validator';

export class UpdateAllowedHostsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  hosts!: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
