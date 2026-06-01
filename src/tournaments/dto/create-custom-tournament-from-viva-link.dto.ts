import { IsString, IsUrl, MaxLength } from 'class-validator';
import { CreateCustomTournamentFromSourceDto } from './create-custom-tournament-from-source.dto';

export class CreateCustomTournamentFromVivaLinkDto extends CreateCustomTournamentFromSourceDto {
  @IsString()
  @MaxLength(2000)
  @IsUrl({
    require_protocol: true
  })
  vivaUrl!: string;
}
