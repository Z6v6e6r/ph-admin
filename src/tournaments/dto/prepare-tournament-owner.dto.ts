import { IsString, IsUUID, Matches } from 'class-validator';

/** Public discovery identity only; the backend resolves every integration reference. */
export class PrepareTournamentOwnerDto {
  @IsUUID('4')
  tournamentId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}
