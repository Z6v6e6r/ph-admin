import { Equals, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
export class TournamentLocalOperationDto {
  @Equals(1) schemaVersion!: 1;
  @IsIn(['JOIN', 'LEAVE']) action!: 'JOIN' | 'LEAVE';
  @IsUUID() tournamentId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsUUID() originalJoinOperationId?: string;
}
export class TournamentLocalOperationReadDto {
  @Equals(1) schemaVersion!: 1;
  @IsUUID() tournamentId!: string;
  @IsUUID() operationId!: string;
}
