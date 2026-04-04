import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PublicTournamentAccessCheckDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  levelLabel?: string;
}
