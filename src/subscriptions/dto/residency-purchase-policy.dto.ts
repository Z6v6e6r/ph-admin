import { IsIn, IsString, IsUUID, Matches } from 'class-validator';

export class ResidencyPurchasePolicyDto {
  @IsUUID()
  exerciseId!: string;

  @IsUUID()
  stationId!: string;

  @IsString()
  @Matches(/^viva:direction:[1-9]\d{0,15}:type:[1-9]\d{0,15}$/)
  externalEventTypeId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  startsAt!: string;

  @IsIn([60, 90, 120])
  durationMinutes!: 60 | 90 | 120;
}
