import { IsPhoneNumber } from 'class-validator';

export class TournamentMechanicsAccessDto {
  @IsPhoneNumber('RU')
  phone!: string;
}
