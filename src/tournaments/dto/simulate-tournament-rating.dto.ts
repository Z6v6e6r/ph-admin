import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested
} from 'class-validator';
import { AmericanoPlayerDto } from './americano-player.dto';

class AmericanoRatingSimulationParamsDto {
  @IsOptional()
  @IsNumber()
  K?: number;

  @IsOptional()
  @IsNumber()
  D?: number;

  @IsOptional()
  @IsNumber()
  B?: number;

  @IsOptional()
  @IsNumber()
  minRating?: number;

  @IsOptional()
  @IsNumber()
  maxRating?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  round?: number;
}

class AmericanoRatingSetDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  team1?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  team2?: number | null;
}

class AmericanoRatingMatchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  court?: number | null;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  team1!: [string, string];

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  team2!: [string, string];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => AmericanoRatingSetDto)
  sets?: AmericanoRatingSetDto[];
}

class AmericanoRatingRoundDto {
  @IsInt()
  @Min(1)
  roundNumber!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmericanoRatingMatchDto)
  matches!: AmericanoRatingMatchDto[];
}

export class SimulateTournamentRatingDto {
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(48)
  @ValidateNested({ each: true })
  @Type(() => AmericanoPlayerDto)
  players!: AmericanoPlayerDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmericanoRatingRoundDto)
  rounds!: AmericanoRatingRoundDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AmericanoRatingSimulationParamsDto)
  params?: AmericanoRatingSimulationParamsDto;
}
