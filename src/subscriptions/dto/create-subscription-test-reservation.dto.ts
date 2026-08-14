import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSubscriptionTestReservationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  clientRef!: string;
}
